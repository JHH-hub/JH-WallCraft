# -*- coding: utf-8 -*-
"""
JH-WallCraft v3.1 Steam Wallpaper Engine 部署与应用工具。

采用 DETACHED_PROCESS + DEVNULL 彻底避免 Windows 管道句柄继承阻塞，
并将 JH-WallCraft-Right / JH-WallCraft-Left 部署至 Monitor 0 与 Monitor 1。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image

from wallcraft_config import BASE_DIR, OUTPUT_DIR

WE_ROOT = Path("D:/Steam/steamapps/common/wallpaper_engine")
WE_EXE = WE_ROOT / "wallpaper64.exe"
WE_EXE_32 = WE_ROOT / "wallpaper32.exe"
WE_CONFIG = WE_ROOT / "config.json"
STEAM_WE_URI = "steam://rungameid/431960"
WE_MYPROJECTS = WE_ROOT / "projects/myprojects"
SRC_PROJECTS = BASE_DIR / "we_projects"
SHARED_DIR = SRC_PROJECTS / "shared"


def _make_preview_jpg(src_png: Path, dst_jpg: Path) -> None:
    if not src_png.exists():
        return
    with Image.open(src_png) as im:
        thumb = im.convert("RGB")
        thumb.thumbnail((800, 500), Image.Resampling.LANCZOS)
        thumb.save(dst_jpg, format="JPEG", quality=88)


def _running_we_process() -> str | None:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-Process wallpaper64, wallpaper32 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            creationflags=flags,
        )
        names = [line.strip().lower() for line in (proc.stdout or "").splitlines() if line.strip()]
        if "wallpaper64" in names:
            return "wallpaper64"
        if "wallpaper32" in names:
            return "wallpaper32"
        return None
    except Exception:
        return None


def _is_we_running() -> bool:
    return _running_we_process() is not None


def _active_we_exe() -> Path:
    if _running_we_process() == "wallpaper32" and WE_EXE_32.exists():
        return WE_EXE_32
    return WE_EXE


def _spawn_detached(cmd: list[str], wait_sec: float = 5.0, cwd: str | None = None) -> int:
    """Spawn Wallpaper Engine control command without inheriting stdout/stderr pipe handles."""
    detached = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
    new_grp = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=detached | new_grp,
    )
    try:
        return proc.wait(timeout=wait_sec)
    except subprocess.TimeoutExpired:
        return 0


def _ensure_we_running(timeout_sec: float = 15.0) -> bool:
    if _is_we_running():
        return True
    try:
        os.startfile(STEAM_WE_URI)
    except Exception:
        launcher = WE_ROOT / "launcher.exe"
        if not launcher.exists():
            return False
        detached = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
        new_grp = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
        subprocess.Popen(
            [str(launcher)],
            cwd=str(WE_ROOT),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=detached | new_grp,
        )

    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if _is_we_running():
            time.sleep(3.5)
            return _is_we_running()
        time.sleep(0.5)
    return _is_we_running()


def _read_config_selected() -> dict:
    try:
        if not WE_CONFIG.exists():
            return {}
        data = json.loads(WE_CONFIG.read_text(encoding="utf-8"))
        gen = data.get("Administrator", {}).get("general", {})
        return {
            "wallpaperconfig": gen.get("wallpaperconfig", {}).get("selectedwallpapers", {}),
            "wallpaperconfigvd0": gen.get("wallpaperconfigvd0", {}).get("selectedwallpapers", {}),
        }
    except Exception as exc:
        return {"error": str(exc)}


def install_projects() -> dict[str, str]:
    """Copy canonical we_projects into Wallpaper Engine myprojects folder."""
    WE_MYPROJECTS.mkdir(parents=True, exist_ok=True)
    installed: dict[str, str] = {}
    mapping = [
        ("JH-WallCraft-Right", OUTPUT_DIR / "m1_right.png"),
        ("JH-WallCraft-Left", OUTPUT_DIR / "m1_left.png"),
    ]
    for name, preview_png in mapping:
        src_dir = SRC_PROJECTS / name
        dst_dir = WE_MYPROJECTS / name
        dst_dir.mkdir(parents=True, exist_ok=True)
        for item in src_dir.iterdir():
            if item.is_file():
                shutil.copy2(item, dst_dir / item.name)
        if SHARED_DIR.exists():
            for item in SHARED_DIR.iterdir():
                if item.is_file():
                    shutil.copy2(item, dst_dir / item.name)
        _make_preview_jpg(preview_png, dst_dir / "preview.jpg")
        installed[name] = str(dst_dir / "index.html")
    return installed


def apply_to_wallpaper_engine(installed: dict[str, str] | None = None) -> dict:
    """Apply Right -> Monitor 0 and Left -> Monitor 1 via Steam-started Wallpaper Engine CLI."""
    if installed is None:
        installed = install_projects()
    if not WE_EXE.exists() and not WE_EXE_32.exists():
        return {"ok": False, "error": f"wallpaper64.exe not found: {WE_EXE}"}

    if not _ensure_we_running():
        return {"ok": False, "error": "Wallpaper Engine did not start via Steam within timeout"}

    we_exe = _active_we_exe()
    calls = [
        ("m1_right", 0, installed["JH-WallCraft-Right"]),
        ("m1_left", 1, installed["JH-WallCraft-Left"]),
    ]
    results = []
    for idx, (screen, mon_idx, target_html) in enumerate(calls):
        if idx > 0:
            time.sleep(1.5)
        rc = _spawn_detached(
            [str(we_exe), "-control", "openWallpaper", "-file", target_html, "-monitor", str(mon_idx)],
            wait_sec=5.0,
            cwd=str(WE_ROOT),
        )
        results.append({
            "screen": screen,
            "monitor": mon_idx,
            "file": target_html,
            "returncode": rc,
        })

    time.sleep(2.5)
    config_selected = _read_config_selected()
    return {
        "ok": all(r["returncode"] == 0 for r in results),
        "we_exe": str(we_exe),
        "applied": results,
        "config_selected": config_selected,
    }


def install_and_apply(apply_now: bool = True) -> dict:
    installed = install_projects()
    if apply_now:
        res = apply_to_wallpaper_engine(installed)
        res["installed"] = installed
        return res
    return {"ok": True, "installed": installed}


def main() -> int:
    parser = argparse.ArgumentParser(description="部署并应用 JH-WallCraft Wallpaper Engine 网页壁纸")
    parser.add_argument("--apply", action="store_true", help="部署后立即应用到双屏")
    args = parser.parse_args()
    res = install_and_apply(apply_now=args.apply)
    if sys.stdout is not None:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
