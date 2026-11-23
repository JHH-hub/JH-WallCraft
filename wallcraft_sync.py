# -*- coding: utf-8 -*-
"""
JH-WallCraft v2 主控同步脚本。

用法：
  python wallcraft_sync.py --targets all --preview-only --force-collect
  python wallcraft_sync.py --targets all
  python wallcraft_sync.py --targets m1 --mode sprint
  python wallcraft_sync.py --targets m2
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

from wallcraft_collectors import collect_all
from wallcraft_config import CACHE_DIR, OUTPUT_DIR, load_config, save_config
from wallcraft_renderer import render_m1_left, render_m1_right, render_m2_main
from wallcraft_win import apply_monitor_wallpapers, list_monitors, save_pingpong_png

LOCK_PATH = CACHE_DIR / "sync.lock"
WALL_CACHE_DIR = CACHE_DIR / "applied"


def _acquire_lock(timeout_sec: float = 0.0) -> bool:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if LOCK_PATH.exists():
        try:
            age = time.time() - LOCK_PATH.stat().st_mtime
            if age < 120:
                return False
        except OSError:
            pass
    try:
        LOCK_PATH.write_text(f"{os.getpid()} {int(time.time())}", encoding="utf-8")
        return True
    except OSError:
        return False


def _release_lock() -> None:
    try:
        if LOCK_PATH.exists():
            LOCK_PATH.unlink()
    except OSError:
        pass


def _resolve_m1_monitors() -> dict[str, dict[str, Any]]:
    """Map logical roles (m1_right, m1_left) to active Machine 1 monitor descriptors."""
    mons = list_monitors()
    if not mons:
        return {}
    primary = next((m for m in mons if m.get("primary")), mons[0])
    others = [m for m in mons if m["id"] != primary["id"]]
    # Sort secondary monitors left-to-right; left screen typically has negative X
    others.sort(key=lambda m: (m.get("left", 0), m.get("index", 0)))
    mapping = {"m1_right": primary}
    if others:
        mapping["m1_left"] = others[0]
    return mapping


def _resolve_m2_dimensions(cfg: dict[str, Any], telemetry: dict[str, Any]) -> tuple[int, int]:
    """Use live monitor dimensions reported by Machine 2 agent, falling back to config."""
    mons = (telemetry.get("m2") or {}).get("monitors") or []
    if mons:
        primary = next((m for m in mons if m.get("primary")), mons[0])
        w, h = int(primary.get("width", 0)), int(primary.get("height", 0))
        if w >= 800 and h >= 600:
            return w, h
    scr = cfg.get("screens", {}).get("m2_main", {})
    return int(scr.get("width", 2560)), int(scr.get("height", 1440))


def _push_m2_wallpaper(cfg: dict[str, Any], png_bytes: bytes) -> dict[str, Any]:
    m2 = cfg.get("nodes", {}).get("m2", {})
    host = m2.get("host", "192.168.3.222")
    port = int(m2.get("agentPort", 18766))
    token = m2.get("token", "")
    target = m2.get("applyTarget", "all")
    url = f"http://{host}:{port}/set?target={target}"
    req = urllib.request.Request(
        url,
        data=png_bytes,
        method="POST",
        headers={
            "Content-Type": "image/png",
            "X-WallCraft-Token": token,
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_sync(
    targets: list[str] | str = "all",
    mode_override: str | None = None,
    preview_only: bool = False,
    force_collect: bool = False,
    cfg_override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Render and optionally apply wallpapers to selected screens."""
    if isinstance(targets, str):
        targets = [targets]
    expanded: set[str] = set()
    for t in targets:
        if t == "all":
            expanded.update(["m1_right", "m1_left", "m2_main"])
        elif t == "m1":
            expanded.update(["m1_right", "m1_left"])
        elif t == "m2":
            expanded.add("m2_main")
        elif t in {"m1_right", "m1_left", "m2_main"}:
            expanded.add(t)

    if not preview_only and not _acquire_lock():
        return {"ok": False, "error": "another sync is already running"}

    try:
        cfg = cfg_override if cfg_override is not None else load_config()
        if mode_override in {"daily", "sprint", "clean"}:
            cfg = dict(cfg)
            cfg["mode"] = mode_override

        telemetry = collect_all(cfg, force=force_collect)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        WALL_CACHE_DIR.mkdir(parents=True, exist_ok=True)

        m1_map = _resolve_m1_monitors()
        m1_assignments: list[tuple[str, str]] = []
        results: dict[str, Any] = {
            "ok": True,
            "preview_only": preview_only,
            "mode": cfg.get("mode", "daily"),
            "collected_at": telemetry.get("collected_at"),
            "screens": {},
        }

        if "m1_right" in expanded:
            mon = m1_map.get("m1_right")
            scr = cfg.get("screens", {}).get("m1_right", {})
            w = int(mon["width"]) if mon else int(scr.get("width", 2560))
            h = int(mon["height"]) if mon else int(scr.get("height", 1440))
            img = render_m1_right(cfg, telemetry, width=w, height=h)
            prev_path = OUTPUT_DIR / "m1_right.png"
            img.save(prev_path, format="PNG")
            if not preview_only and mon:
                applied_path = save_pingpong_png(img, WALL_CACHE_DIR, "wallcraft_m1_right")
                m1_assignments.append((mon["id"], str(applied_path)))
            results["screens"]["m1_right"] = {"width": w, "height": h, "preview": str(prev_path)}

        if "m1_left" in expanded:
            mon = m1_map.get("m1_left")
            scr = cfg.get("screens", {}).get("m1_left", {})
            w = int(mon["width"]) if mon else int(scr.get("width", 1920))
            h = int(mon["height"]) if mon else int(scr.get("height", 1200))
            img = render_m1_left(cfg, telemetry, width=w, height=h)
            prev_path = OUTPUT_DIR / "m1_left.png"
            img.save(prev_path, format="PNG")
            if not preview_only and mon:
                applied_path = save_pingpong_png(img, WALL_CACHE_DIR, "wallcraft_m1_left")
                m1_assignments.append((mon["id"], str(applied_path)))
            results["screens"]["m1_left"] = {"width": w, "height": h, "preview": str(prev_path)}

        if not preview_only and m1_assignments:
            results["m1_apply"] = apply_monitor_wallpapers(m1_assignments)
            if not results["m1_apply"].get("ok"):
                results["ok"] = False

        if "m2_main" in expanded:
            w, h = _resolve_m2_dimensions(cfg, telemetry)
            img = render_m2_main(cfg, telemetry, width=w, height=h)
            prev_path = OUTPUT_DIR / "m2_main.png"
            img.save(prev_path, format="PNG")
            # Update cached m2 resolution in config if changed
            if cfg.get("screens", {}).get("m2_main", {}).get("width") != w or cfg.get("screens", {}).get("m2_main", {}).get("height") != h:
                try:
                    fresh = load_config()
                    fresh.setdefault("screens", {}).setdefault("m2_main", {})["width"] = w
                    fresh["screens"]["m2_main"]["height"] = h
                    save_config(fresh)
                except Exception:
                    pass

            m2_info: dict[str, Any] = {"width": w, "height": h, "preview": str(prev_path)}
            if not preview_only:
                if (telemetry.get("m2") or {}).get("agent_online") or cfg.get("nodes", {}).get("m2", {}).get("enabled", True):
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    try:
                        m2_res = _push_m2_wallpaper(cfg, buf.getvalue())
                        m2_info["apply"] = m2_res
                        if not m2_res.get("ok"):
                            results["ok"] = False
                    except Exception as exc:
                        m2_info["apply"] = {"ok": False, "error": str(exc)}
                        results["ok"] = False
                else:
                    m2_info["apply"] = {"ok": False, "error": "m2 agent offline"}
            results["screens"]["m2_main"] = m2_info

        return results
    finally:
        if not preview_only:
            _release_lock()


def main() -> int:
    parser = argparse.ArgumentParser(description="JH-WallCraft v2 双机多屏同步工具")
    parser.add_argument("--targets", default="all", help="同步目标: all|m1|m2|m1_right|m1_left (支持逗号分隔)")
    parser.add_argument("--mode", choices=["daily", "sprint", "clean"], default=None, help="临时覆盖场景模式")
    parser.add_argument("--preview-only", action="store_true", help="仅渲染预览图到 output/，不设为桌面壁纸")
    parser.add_argument("--force-collect", action="store_true", help="跳过缓存强制重新采集数据")
    args = parser.parse_args()

    target_list = [t.strip() for t in args.targets.split(",") if t.strip()]
    res = run_sync(
        targets=target_list,
        mode_override=args.mode,
        preview_only=args.preview_only,
        force_collect=args.force_collect,
    )
    if sys.stdout is not None:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
