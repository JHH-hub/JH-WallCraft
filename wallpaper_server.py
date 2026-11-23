# -*- coding: utf-8 -*-
"""
JH-WallCraft v3 主控本地服务与实时桌面遥测服务端 (默认 127.0.0.1:18766)。

功能：
  - 静态托管 Web 控制台 (index.html / style.css / app.js 等)
  - GET  /health                   服务健康状态
  - GET  /api/config               读取统一配置（脱敏返回二号机 token 状态）
  - POST /api/config               保存统一配置（保留现有 token）
  - GET  /api/telemetry            全量遥测采集
  - GET  /api/live-fast            3秒轮询轻量接口：一号机 4090/RAM/磁盘 + configVersion
  - GET  /api/live-slow            60秒慢数据接口：日历/待办/GitHub热力图/论文字数/论文雷达
  - GET  /api/backdrop-image/<id>  输出经过亮度/模糊/暗角处理的 JPEG 底图（禁用返回 204）
  - POST /api/todo-toggle          桌面壁纸直接点击切换单条待办完成状态
  - POST /api/mode                 桌面壁纸直接切换场景模式 (daily|sprint|clean)
  - POST /api/we-apply             同步源码并下发应用到 Steam Wallpaper Engine 双屏
  - GET  /api/backdrops            精选 Steam 底图列表
  - GET  /api/backdrop-thumb/<id>  底图缩略图 (JPEG)
  - GET  /api/preview/<screen>     渲染静态预览 PNG (m1_right|m1_left|m2_main)
  - POST /api/apply                触发静态渲染并下发壁纸（用于二号机或手动回退）
  - POST /set                      兼容旧版直传 PNG 设为本机主屏壁纸
  - 后台守护线程：每 20 秒低开销巡检二号机 5080 + ComfyUI + NAS，仅状态跃迁或 120s 心跳重绘推送
"""

from __future__ import annotations

import argparse
import copy
import io
import json
import mimetypes
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from wallcraft_backdrops import (
    build_processed_backdrop,
    get_backdrop_thumbnail,
    list_backdrops,
    resolve_backdrop_path,
)
from wallcraft_collectors import (
    collect_all,
    collect_github_heatmap,
    collect_local_gpu,
    collect_machine2,
    collect_nas,
    collect_recent_papers,
    collect_thesis_stats,
)
from wallcraft_config import BASE_DIR, CACHE_DIR, CONFIG_PATH, OUTPUT_DIR, load_config, now_local, save_config
from wallcraft_renderer import render_m1_left, render_m1_right, render_m2_main
from wallcraft_sync import _push_m2_wallpaper, _resolve_m1_monitors, _resolve_m2_dimensions, run_sync
from wallcraft_win import apply_monitor_wallpapers, save_pingpong_png

SERVER_LOG = CACHE_DIR / "server.log"


def _safe_log(msg: str) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with open(SERVER_LOG, "a", encoding="utf-8") as fh:
            fh.write(f"[{now_local().strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        pass
    if sys.stderr is not None:
        try:
            sys.stderr.write(msg + "\n")
        except Exception:
            pass


def _redact_config(cfg: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(cfg)
    m2 = out.get("nodes", {}).get("m2", {})
    tok = m2.get("token", "")
    m2["hasToken"] = bool(tok)
    m2["token"] = ""
    return out


def get_config_version() -> str:
    try:
        return str(CONFIG_PATH.stat().st_mtime_ns) if CONFIG_PATH.exists() else "0"
    except OSError:
        return "0"


class ServerState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._telemetry: dict[str, Any] | None = None
        self._telemetry_ts: float = 0.0
        self._fast_m1: dict[str, Any] | None = None
        self._fast_ts: float = 0.0
        self._slow_bundle: dict[str, Any] | None = None
        self._slow_ts: float = 0.0
        self._slow_cfg_ver: str = ""
        self._bd_cache: dict[tuple[str, str], bytes | None] = {}

    def invalidate_config(self) -> None:
        with self._lock:
            self._slow_cfg_ver = ""
            self._bd_cache.clear()

    def get_telemetry(self, cfg: dict[str, Any], force: bool = False) -> dict[str, Any]:
        with self._lock:
            now = time.time()
            if not force and self._telemetry is not None and (now - self._telemetry_ts) < 20.0:
                return self._telemetry
        data = collect_all(cfg, force=force)
        with self._lock:
            self._telemetry = data
            self._telemetry_ts = time.time()
        return data

    def get_fast_metrics(self, cfg: dict[str, Any]) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            if self._fast_m1 is not None and (now - self._fast_ts) < 2.0:
                m1 = self._fast_m1
            else:
                m1 = None
        if m1 is None:
            m1 = collect_local_gpu()
            with self._lock:
                self._fast_m1 = m1
                self._fast_ts = time.time()
        return {
            "ok": True,
            "configVersion": get_config_version(),
            "serverTime": now_local().strftime("%H:%M:%S"),
            "mode": cfg.get("mode", "daily"),
            "themePreset": cfg.get("themePreset", "auto-circadian"),
            "m1": m1,
        }

    def get_slow_bundle(self, cfg: dict[str, Any], force: bool = False) -> dict[str, Any]:
        ver = get_config_version()
        now = time.time()
        with self._lock:
            if not force and self._slow_bundle is not None and self._slow_cfg_ver == ver and (now - self._slow_ts) < 20.0:
                return self._slow_bundle

        paths = cfg.get("paths", {})
        with ThreadPoolExecutor(max_workers=3) as pool:
            f_gh = pool.submit(collect_github_heatmap, paths.get("githubRoot", ""), 12, force)
            f_th = pool.submit(collect_thesis_stats, paths.get("thesisDir", ""), int(cfg.get("thesisTargetWords", 40000)))
            f_pp = pool.submit(collect_recent_papers, paths.get("papersDb", ""), 10)
            gh, th, pp = f_gh.result(), f_th.result(), f_pp.result()

        bundle = {
            "ok": True,
            "configVersion": ver,
            "collected_hm": now_local().strftime("%H:%M"),
            "config": _redact_config(cfg),
            "github": gh,
            "thesis": th,
            "papers": pp,
        }
        with self._lock:
            self._slow_bundle = bundle
            self._slow_ts = time.time()
            self._slow_cfg_ver = ver
        return bundle

    def get_backdrop_jpeg(self, cfg: dict[str, Any], screen: str) -> bytes | None:
        ver = get_config_version()
        key = (screen, ver)
        with self._lock:
            if key in self._bd_cache:
                return self._bd_cache[key]

        bd = cfg.get("backdrops") or {}
        if not bd.get("enabled", True):
            with self._lock:
                self._bd_cache[key] = None
            return None

        path = resolve_backdrop_path(bd.get(screen))
        if path is None:
            with self._lock:
                self._bd_cache[key] = None
            return None

        scr = cfg.get("screens", {}).get(screen, {})
        w = int(scr.get("width", 2560 if screen != "m1_left" else 1920))
        h = int(scr.get("height", 1440 if screen != "m1_left" else 1200))
        if screen == "m2_main":
            br, bl, vig = int(bd.get("m2Brightness", 78)), int(bd.get("m2Blur", 0)), max(25, int(bd.get("vignette", 52)) - 12)
        else:
            br, bl, vig = int(bd.get("brightness", 62)), int(bd.get("blur", 2)), int(bd.get("vignette", 52))

        rgba = build_processed_backdrop(path, w, h, brightness=br, blur=bl, vignette=vig)
        buf = io.BytesIO()
        rgba.convert("RGB").save(buf, format="JPEG", quality=90, optimize=True)
        jpg = buf.getvalue()
        with self._lock:
            self._bd_cache[key] = jpg
        return jpg


def _m2_watcher_loop(stop_event: threading.Event) -> None:
    """Poll Machine 2 every 20s and push updated wallpaper only on meaningful state transitions or 120s heartbeat."""
    last_snap: dict[str, Any] = {}
    last_push_ts: float = 0.0
    while not stop_event.wait(20.0):
        try:
            cfg = load_config()
            m2_cfg = cfg.get("nodes", {}).get("m2", {})
            if not m2_cfg.get("enabled", True):
                continue

            m2 = collect_machine2(cfg)
            if not m2.get("agent_online"):
                continue

            nas = collect_nas(cfg, force=False)
            g2 = m2.get("gpu") or {}
            comfy = m2.get("comfy") or {}
            snap = {
                "busy": bool(m2.get("busy")),
                "running": int(comfy.get("running", 0) or 0),
                "pending": int(comfy.get("pending", 0) or 0),
                "util": int(g2.get("util_pct", 0) or 0),
                "vram": float(g2.get("vram_pct", 0.0) or 0.0),
                "temp": int(g2.get("temp_c", 0) or 0),
                "cfg_ver": get_config_version(),
                "nas_ok": bool(nas.get("ok")),
            }

            now = time.time()
            changed = (
                not last_snap
                or snap["busy"] != last_snap["busy"]
                or snap["running"] != last_snap["running"]
                or snap["pending"] != last_snap["pending"]
                or snap["cfg_ver"] != last_snap["cfg_ver"]
                or snap["nas_ok"] != last_snap["nas_ok"]
                or abs(snap["util"] - last_snap["util"]) >= 15
                or abs(snap["vram"] - last_snap["vram"]) >= 5.0
                or abs(snap["temp"] - last_snap["temp"]) >= 4
                or (now - last_push_ts) >= 120.0
            )
            if not changed:
                continue

            telemetry = {
                "collected_at": now_local().strftime("%Y-%m-%d %H:%M:%S"),
                "collected_hm": now_local().strftime("%H:%M"),
                "m2": m2,
                "nas": nas,
            }
            w, h = _resolve_m2_dimensions(cfg, telemetry)
            img = render_m2_main(cfg, telemetry, width=w, height=h)
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            img.save(OUTPUT_DIR / "m2_main.png", format="PNG")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            res = _push_m2_wallpaper(cfg, buf.getvalue())
            if res.get("ok"):
                last_snap = snap
                last_push_ts = now
        except Exception as exc:
            _safe_log(f"[m2-watcher] error: {exc}")


class WallCraftHandler(BaseHTTPRequestHandler):
    server_version = "WallCraftServer/3.0"

    def _send_bytes(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        if content_type:
            self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send_bytes(status, "application/json; charset=utf-8", body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        state: ServerState = self.server.wc_state

        if path == "/health":
            self._send_json(200, {"ok": True, "service": "wallcraft-wallpaper-server", "version": 3})
            return

        if path == "/api/config":
            try:
                cfg = load_config()
                self._send_json(200, {"ok": True, "config": _redact_config(cfg), "configVersion": get_config_version()})
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if path == "/api/live-fast":
            try:
                cfg = load_config()
                self._send_json(200, state.get_fast_metrics(cfg))
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if path == "/api/live-slow":
            try:
                cfg = load_config()
                force = qs.get("force", ["0"])[0] == "1"
                self._send_json(200, state.get_slow_bundle(cfg, force=force))
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if path.startswith("/api/backdrop-image/"):
            screen = path.split("/api/backdrop-image/", 1)[1].strip("/")
            if screen not in {"m1_right", "m1_left", "m2_main"}:
                self._send_json(404, {"ok": False, "error": "unknown screen"})
                return
            try:
                cfg = load_config()
                jpg = state.get_backdrop_jpeg(cfg, screen)
                if jpg is None:
                    self._send_bytes(204, "", b"")
                    return
                self._send_bytes(200, "image/jpeg", jpg)
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if path == "/api/telemetry":
            try:
                cfg = load_config()
                force = qs.get("force", ["0"])[0] == "1"
                data = state.get_telemetry(cfg, force=force)
                self._send_json(200, {"ok": True, "telemetry": data})
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if path == "/api/backdrops":
            try:
                self._send_json(200, {"ok": True, "backdrops": list_backdrops()})
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if path.startswith("/api/backdrop-thumb/"):
            bid = path.split("/api/backdrop-thumb/", 1)[1].strip("/")
            try:
                data = get_backdrop_thumbnail(bid)
                if data is None:
                    self._send_json(404, {"ok": False, "error": "backdrop not found"})
                    return
                self._send_bytes(200, "image/jpeg", data)
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if path.startswith("/api/preview/"):
            screen = path.split("/api/preview/", 1)[1].strip("/")
            if screen not in {"m1_right", "m1_left", "m2_main"}:
                self._send_json(404, {"ok": False, "error": "unknown screen"})
                return
            try:
                refresh = qs.get("refresh", ["0"])[0] == "1"
                prev_file = OUTPUT_DIR / f"{screen}.png"
                if refresh or not prev_file.exists():
                    cfg = load_config()
                    telemetry = state.get_telemetry(cfg, force=False)
                    if screen == "m1_right":
                        scr = cfg.get("screens", {}).get("m1_right", {})
                        img = render_m1_right(cfg, telemetry, int(scr.get("width", 2560)), int(scr.get("height", 1440)))
                    elif screen == "m1_left":
                        scr = cfg.get("screens", {}).get("m1_left", {})
                        img = render_m1_left(cfg, telemetry, int(scr.get("width", 1920)), int(scr.get("height", 1200)))
                    else:
                        w, h = _resolve_m2_dimensions(cfg, telemetry)
                        img = render_m2_main(cfg, telemetry, w, h)
                    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                    img.save(prev_file, format="PNG")
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    self._send_bytes(200, "image/png", buf.getvalue())
                else:
                    self._send_bytes(200, "image/png", prev_file.read_bytes())
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        if ".." in rel or rel.startswith(".") or rel in ("wallcraft_config.json", "agent_token.txt"):
            self._send_json(403, {"ok": False, "error": "forbidden"})
            return
        file_path = (BASE_DIR / rel).resolve()
        if not str(file_path).startswith(str(BASE_DIR.resolve())) or not file_path.is_file():
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        ctype, _ = mimetypes.guess_type(str(file_path))
        self._send_bytes(200, ctype or "application/octet-stream", file_path.read_bytes())

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        state: ServerState = self.server.wc_state

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length) if length > 0 else b""
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})
            return

        if path == "/api/config":
            try:
                incoming = json.loads(raw_body.decode("utf-8"))
                current = load_config()
                if "nodes" in incoming and "m2" in incoming["nodes"]:
                    if not incoming["nodes"]["m2"].get("token"):
                        incoming["nodes"]["m2"]["token"] = current.get("nodes", {}).get("m2", {}).get("token", "")
                merged = copy.deepcopy(current)
                for k, v in incoming.items():
                    if k in ("nodes", "paths", "screens", "backdrops") and isinstance(v, dict) and isinstance(merged.get(k), dict):
                        for sk, sv in v.items():
                            if isinstance(sv, dict) and isinstance(merged[k].get(sk), dict):
                                merged[k][sk].update(sv)
                            else:
                                merged[k][sk] = sv
                    else:
                        merged[k] = v
                saved = save_config(merged)
                state.invalidate_config()
                self._send_json(200, {"ok": True, "config": _redact_config(saved), "configVersion": get_config_version()})
            except Exception as exc:
                self._send_json(400, {"ok": False, "error": str(exc)})
            return

        if path == "/api/todo-toggle":
            try:
                body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                idx = int(body.get("index", -1))
                cfg = load_config()
                todos = cfg.get("todos") or []
                if idx < 0 or idx >= len(todos):
                    self._send_json(400, {"ok": False, "error": "invalid todo index"})
                    return
                todos[idx]["done"] = not bool(todos[idx].get("done"))
                saved = save_config(cfg)
                state.invalidate_config()
                self._send_json(200, {"ok": True, "todos": saved.get("todos", []), "configVersion": get_config_version()})
            except Exception as exc:
                self._send_json(400, {"ok": False, "error": str(exc)})
            return

        if path == "/api/mode":
            try:
                body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                mode = str(body.get("mode", "")).strip()
                if mode not in {"daily", "sprint", "clean"}:
                    self._send_json(400, {"ok": False, "error": "invalid mode"})
                    return
                cfg = load_config()
                cfg["mode"] = mode
                saved = save_config(cfg)
                state.invalidate_config()
                self._send_json(200, {"ok": True, "mode": saved.get("mode"), "configVersion": get_config_version()})
            except Exception as exc:
                self._send_json(400, {"ok": False, "error": str(exc)})
            return

        if path == "/api/we-apply":
            try:
                from deploy_we import install_and_apply
                res = install_and_apply(apply_now=True)
                self._send_json(200 if res.get("ok") else 500, res)
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if path == "/api/apply":
            try:
                body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                targets = body.get("targets") or ["all"]
                mode = body.get("mode")
                force_collect = bool(body.get("force", True))
                res = run_sync(targets=targets, mode_override=mode, preview_only=False, force_collect=force_collect)
                try:
                    state.get_telemetry(load_config(), force=False)
                except Exception:
                    pass
                self._send_json(200 if res.get("ok") else 500, res)
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if path.startswith("/set"):
            if not raw_body:
                self._send_json(400, {"ok": False, "error": "empty body"})
                return
            try:
                m1_map = _resolve_m1_monitors()
                primary = m1_map.get("m1_right")
                if not primary:
                    self._send_json(500, {"ok": False, "error": "no monitor found"})
                    return
                saved_path = save_pingpong_png(raw_body, CACHE_DIR / "applied", "wallcraft_legacy")
                res = apply_monitor_wallpapers([(primary["id"], str(saved_path))])
                self._send_json(200 if res.get("ok") else 500, res)
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        self._send_json(404, {"ok": False, "error": "not found"})

    def log_message(self, fmt: str, *args) -> None:
        _safe_log("[wallpaper-server] %s" % (fmt % args))


def main() -> int:
    parser = argparse.ArgumentParser(description="JH-WallCraft v3 本地控制与实时遥测服务")
    parser.add_argument("--port", type=int, default=18766, help="监听端口 (默认 18766)")
    args = parser.parse_args()

    stop_event = threading.Event()
    watcher = threading.Thread(target=_m2_watcher_loop, args=(stop_event,), daemon=True)
    watcher.start()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), WallCraftHandler)
    server.wc_state = ServerState()
    if sys.stdout is not None:
        print(f"[wallpaper-server] v3 listening on http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        stop_event.set()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
