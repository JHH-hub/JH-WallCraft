# -*- coding: utf-8 -*-
"""
JH-WallCraft Windows 原生多显示器壁纸控制模块 (IDesktopWallpaper COM)。

支持按显示器精确设置不同壁纸（Fill 模式），并通过 A/B ping-pong 文件名切换
确保 Windows 桌面立即刷新不命中路径缓存。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Iterable

DWPOS_FILL = 4

_PS_BRIDGE_CS = r"""
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct WC_RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}

[ComImport]
[Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDesktopWallpaper {
    void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
    [return: MarshalAs(UnmanagedType.LPWStr)]
    string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
    [return: MarshalAs(UnmanagedType.LPWStr)]
    string GetMonitorDevicePathAt(uint monitorIndex);
    uint GetMonitorDevicePathCount();
    WC_RECT GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
    void SetBackgroundColor(uint color);
    uint GetBackgroundColor();
    void SetPosition(int position);
    int GetPosition();
}

[ComImport]
[Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD")]
public class DesktopWallpaperClass {}

public static class WallCraftCom {
    private static string Esc(string s) {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "");
    }

    public static void ListMonitors() {
        var dw = (IDesktopWallpaper)(new DesktopWallpaperClass());
        uint count = dw.GetMonitorDevicePathCount();
        var items = new List<string>();
        for (uint i = 0; i < count; i++) {
            string id = "";
            try { id = dw.GetMonitorDevicePathAt(i) ?? ""; } catch { continue; }
            int left = 0, top = 0, right = 0, bottom = 0;
            bool active = true;
            try {
                WC_RECT r = dw.GetMonitorRECT(id);
                left = r.Left; top = r.Top; right = r.Right; bottom = r.Bottom;
            } catch {
                active = false;
            }
            int w = right - left;
            int h = bottom - top;
            if (!active || w <= 0 || h <= 0) continue;
            string wp = "";
            try { wp = dw.GetWallpaper(id) ?? ""; } catch {}
            bool isPrimary = (left == 0 && top == 0);
            items.Add(string.Format(
                "{{\"index\":{0},\"id\":\"{1}\",\"left\":{2},\"top\":{3},\"right\":{4},\"bottom\":{5},\"width\":{6},\"height\":{7},\"primary\":{8},\"wallpaper\":\"{9}\"}}",
                i, Esc(id), left, top, right, bottom, w, h, isPrimary ? "true" : "false", Esc(wp)
            ));
        }
        Console.WriteLine("[" + string.Join(",", items) + "]");
    }

    public static void ApplyWallpapers(string[] ids, string[] paths, int position) {
        var dw = (IDesktopWallpaper)(new DesktopWallpaperClass());
        try { dw.SetPosition(position); } catch {}
        var results = new List<string>();
        for (int i = 0; i < ids.Length; i++) {
            string id = ids[i];
            string p = paths[i];
            bool ok = true;
            string err = "";
            try {
                dw.SetWallpaper(id, p);
            } catch (Exception ex) {
                ok = false;
                err = ex.Message;
            }
            results.Add(string.Format(
                "{{\"id\":\"{0}\",\"path\":\"{1}\",\"ok\":{2},\"error\":\"{3}\"}}",
                Esc(id), Esc(p), ok ? "true" : "false", Esc(err)
            ));
        }
        Console.WriteLine("{\"ok\":true,\"applied\":[" + string.Join(",", results) + "]}");
    }
}
"""


def _run_ps(ps_body: str, timeout: int = 20) -> str:
    """Run a PowerShell snippet via UTF-16LE EncodedCommand with hidden window."""
    full_script = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n"
        "$cs = @'\n"
        + _PS_BRIDGE_CS
        + "\n'@\n"
        "Add-Type -TypeDefinition $cs -ErrorAction Stop\n"
        + ps_body
    )
    encoded = base64.b64encode(full_script.encode("utf-16le")).decode("ascii")
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        creationflags=creationflags,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"PowerShell COM error ({proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout.strip()


def list_monitors() -> list[dict]:
    """Query active monitors and their current wallpapers via IDesktopWallpaper."""
    raw = _run_ps("[WallCraftCom]::ListMonitors()")
    if not raw:
        return []
    monitors = json.loads(raw)
    if monitors and not any(m.get("primary") for m in monitors):
        monitors[0]["primary"] = True
    return monitors


def save_pingpong_png(image_or_bytes, base_dir: Path | str, stem: str) -> Path:
    """Save PNG using alternating _a.png / _b.png filenames to bypass Windows path caching."""
    target_dir = Path(base_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    state_file = target_dir / f".{stem}.pingpong"
    last = state_file.read_text(encoding="utf-8").strip() if state_file.exists() else "b"
    next_slot = "a" if last != "a" else "b"
    out_path = (target_dir / f"{stem}_{next_slot}.png").resolve()

    if isinstance(image_or_bytes, (bytes, bytearray)):
        out_path.write_bytes(bytes(image_or_bytes))
    else:
        image_or_bytes.save(out_path, format="PNG")

    state_file.write_text(next_slot, encoding="utf-8")
    return out_path


def _ps_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def apply_monitor_wallpapers(assignments: Iterable[tuple[str, str]], position: int = DWPOS_FILL) -> dict:
    """Apply wallpapers per monitor ID using IDesktopWallpaper::SetPosition + SetWallpaper."""
    pairs = [(mid, str(Path(p).resolve())) for mid, p in assignments]
    if not pairs:
        return {"ok": False, "error": "empty assignments", "applied": []}

    for _, p in pairs:
        if not os.path.exists(p):
            return {"ok": False, "error": f"file not found: {p}", "applied": []}

    id_expr = "@(" + ", ".join(_ps_quote(mid) for mid, _ in pairs) + ")"
    path_expr = "@(" + ", ".join(_ps_quote(p) for _, p in pairs) + ")"
    ps_body = (
        f"[string[]]$ids = {id_expr}\n"
        f"[string[]]$paths = {path_expr}\n"
        f"[WallCraftCom]::ApplyWallpapers($ids, $paths, {int(position)})\n"
    )
    raw = _run_ps(ps_body)
    data = json.loads(raw) if raw else {"ok": False, "applied": []}
    data["ok"] = bool(data.get("applied")) and all(item.get("ok") for item in data["applied"])
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="JH-WallCraft Windows 多屏壁纸工具")
    parser.add_argument("--list", action="store_true", help="列出当前显示器与壁纸路径")
    parser.add_argument("--set", nargs=2, metavar=("MONITOR_ID", "IMAGE_PATH"), action="append", help="为指定显示器设置壁纸")
    args = parser.parse_args()

    if args.list:
        print(json.dumps(list_monitors(), ensure_ascii=False, indent=2))
        return 0
    if args.set:
        res = apply_monitor_wallpapers([(m, p) for m, p in args.set])
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0 if res.get("ok") else 1
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
