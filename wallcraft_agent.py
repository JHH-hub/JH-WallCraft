# -*- coding: utf-8 -*-
"""
JH-WallCraft 二号机轻量交互式守护代理 (Pure Python 3.12 stdlib)。

部署在二号机交互式桌面会话 (Session 1) 内，提供：
  - GET  /health     最小健康检查（无需鉴权）
  - GET  /monitors   查询本机交互会话内的显示器清单与分辨率
  - GET  /metrics    采集 GPU (nvidia-smi) + RAM + C/D 磁盘 + 显示器缓存
  - POST /set        接收 PNG 字节并通过 IDesktopWallpaper 应用到指定/全部显示器
"""

from __future__ import annotations

import argparse
import ctypes
import json
import shutil
import subprocess
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from wallcraft_win import apply_monitor_wallpapers, list_monitors, save_pingpong_png

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_TOKEN_FILE = BASE_DIR / "agent_token.txt"
DEFAULT_OUT_DIR = BASE_DIR / "wallpapers"


class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def get_ram_stats() -> dict:
    stat = _MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
        total_gb = round(stat.ullTotalPhys / (1024**3), 1)
        used_gb = round((stat.ullTotalPhys - stat.ullAvailPhys) / (1024**3), 1)
        return {"total_gb": total_gb, "used_gb": used_gb, "pct": int(stat.dwMemoryLoad)}
    return {"total_gb": 0.0, "used_gb": 0.0, "pct": 0}


def get_gpu_stats() -> dict:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            creationflags=flags,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return {"ok": False}
        line = proc.stdout.strip().splitlines()[0]
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            return {"ok": False}
        mem_used = float(parts[2])
        mem_total = float(parts[3])
        return {
            "ok": True,
            "name": parts[0],
            "util_pct": int(float(parts[1])),
            "vram_used_mb": int(mem_used),
            "vram_total_mb": int(mem_total),
            "vram_pct": round((mem_used / mem_total) * 100, 1) if mem_total > 0 else 0.0,
            "temp_c": int(float(parts[4])),
            "power_w": round(float(parts[5]), 1) if parts[5] not in ("", "[N/A]") else 0.0,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def get_disk_stats() -> list[dict]:
    disks = []
    for letter in ("C", "D"):
        drive = f"{letter}:\\"
        try:
            usage = shutil.disk_usage(drive)
            total_gb = round(usage.total / (1024**3), 1)
            free_gb = round(usage.free / (1024**3), 1)
            used_gb = round(usage.used / (1024**3), 1)
            pct = round((usage.used / usage.total) * 100, 1) if usage.total > 0 else 0.0
            disks.append({"drive": letter, "total_gb": total_gb, "used_gb": used_gb, "free_gb": free_gb, "pct": pct})
        except OSError:
            pass
    return disks


class AgentState:
    def __init__(self, token: str, out_dir: Path):
        self.token = token
        self.out_dir = out_dir
        self._monitors_cache: list[dict] = []
        self._monitors_ts: float = 0.0

    def get_monitors(self, force: bool = False) -> list[dict]:
        now = time.time()
        if force or not self._monitors_cache or (now - self._monitors_ts) > 300:
            self._monitors_cache = list_monitors()
            self._monitors_ts = now
        return self._monitors_cache


class AgentHandler(BaseHTTPRequestHandler):
    server_version = "WallCraftAgent/2.0"

    def _send_json(self, status: int, payload: dict | list) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _check_auth(self) -> bool:
        expected = self.server.agent_state.token
        provided = self.headers.get("X-WallCraft-Token", "").strip()
        if not expected or provided != expected:
            self._send_json(401, {"ok": False, "error": "unauthorized"})
            return False
        return True

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/health":
            self._send_json(200, {"ok": True, "service": "wallcraft-agent"})
            return
        if not self._check_auth():
            return

        state: AgentState = self.server.agent_state
        if parsed.path == "/monitors":
            try:
                force = qs.get("refresh", ["0"])[0] == "1"
                mons = state.get_monitors(force=force)
                self._send_json(200, {"ok": True, "monitors": mons})
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if parsed.path == "/metrics":
            try:
                force = qs.get("refresh", ["0"])[0] == "1"
                mons = state.get_monitors(force=force)
                payload = {
                    "ok": True,
                    "timestamp": int(time.time()),
                    "gpu": get_gpu_stats(),
                    "ram": get_ram_stats(),
                    "disks": get_disk_stats(),
                    "monitors": mons,
                }
                self._send_json(200, payload)
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/set":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        if not self._check_auth():
            return

        qs = urllib.parse.parse_qs(parsed.query)
        target = qs.get("target", ["all"])[0]
        try:
            length = int(self.headers.get("Content-Length", "0"))
            image_bytes = self.rfile.read(length)
            if not image_bytes:
                self._send_json(400, {"ok": False, "error": "empty body"})
                return

            state: AgentState = self.server.agent_state
            mons = state.get_monitors(force=True)
            if not mons:
                self._send_json(500, {"ok": False, "error": "no active monitors found"})
                return

            if target == "primary":
                selected = [next((m for m in mons if m.get("primary")), mons[0])]
            elif target == "all":
                selected = mons
            else:
                try:
                    idx = int(target)
                    selected = [m for m in mons if int(m["index"]) == idx]
                except ValueError:
                    selected = [m for m in mons if m["id"] == target]
                if not selected:
                    selected = [mons[0]]

            stem = f"wallcraft_m2_{target}"
            saved_path = save_pingpong_png(image_bytes, state.out_dir, stem)
            assignments = [(m["id"], str(saved_path)) for m in selected]
            res = apply_monitor_wallpapers(assignments)
            res["saved_path"] = str(saved_path)
            res["monitors"] = state.get_monitors(force=True)
            self._send_json(200 if res.get("ok") else 500, res)
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})

    def log_message(self, fmt: str, *args) -> None:
        log_path = BASE_DIR / "agent.log"
        try:
            with open(log_path, "a", encoding="utf-8") as fh:
                fh.write("[wallcraft-agent] %s\n" % (fmt % args))
        except Exception:
            pass
        if sys.stderr is not None:
            try:
                sys.stderr.write("[wallcraft-agent] %s\n" % (fmt % args))
            except Exception:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="JH-WallCraft 二号机轻量代理")
    parser.add_argument("--bind", default="0.0.0.0", help="绑定地址 (默认 0.0.0.0)")
    parser.add_argument("--port", type=int, default=18766, help="监听端口 (默认 18766)")
    parser.add_argument("--token-file", default=str(DEFAULT_TOKEN_FILE), help="鉴权 Token 文件")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="壁纸输出目录")
    args = parser.parse_args()

    token_path = Path(args.token_file)
    if not token_path.exists():
        sys.stderr.write(f"[wallcraft-agent] token file missing: {token_path}\n")
        return 1
    token = token_path.read_text(encoding="utf-8").strip()

    server = ThreadingHTTPServer((args.bind, args.port), AgentHandler)
    server.agent_state = AgentState(token=token, out_dir=Path(args.out_dir))
    # Pre-warm monitor cache without blocking startup
    import threading
    threading.Thread(target=lambda: server.agent_state.get_monitors(force=True), daemon=True).start()
    if sys.stdout is not None:
        print(f"[wallcraft-agent] listening on http://{args.bind}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
