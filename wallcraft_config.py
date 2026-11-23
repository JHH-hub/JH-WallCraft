# -*- coding: utf-8 -*-
"""
JH-WallCraft v2 统一配置管理与本地日期工具。

禁止直接使用含时区歧义的 UTC 日期解析，所有日期均按本地零点处理。
"""

from __future__ import annotations

import copy
import datetime as dt
import json
import os
import secrets
import tempfile
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "wallcraft_config.json"
EXAMPLE_CONFIG_PATH = BASE_DIR / "wallcraft_config.example.json"
SECRET_PATH = BASE_DIR / ".wallcraft_secret"
CACHE_DIR = BASE_DIR / ".cache"
OUTPUT_DIR = BASE_DIR / "output"


def today_local() -> dt.date:
    """Return current local date without UTC shift."""
    return dt.datetime.now().date()


def now_local() -> dt.datetime:
    """Return current local datetime."""
    return dt.datetime.now()


def parse_local_date(value: str | None, fallback: dt.date | None = None) -> dt.date:
    """Parse YYYY-MM-DD strictly as a local calendar date."""
    if isinstance(value, str) and value.strip():
        parts = value.strip().split("-")
        if len(parts) == 3:
            try:
                y, m, d = (int(parts[0]), int(parts[1]), int(parts[2]))
                return dt.date(y, m, d)
            except ValueError:
                pass
    return fallback if fallback is not None else today_local()


def format_local_date(d: dt.date) -> str:
    """Format local date as YYYY-MM-DD."""
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d}"


def rolling_calendar_range(ref_date: dt.date | None = None) -> tuple[str, str]:
    """Compute a 6-week rolling calendar span starting on Monday of the current week."""
    ref = ref_date or today_local()
    monday = ref - dt.timedelta(days=ref.weekday())
    end_day = monday + dt.timedelta(days=41)
    return format_local_date(monday), format_local_date(end_day)


def _load_or_create_secret() -> str:
    """Load or generate a 32-hex-char LAN token stored outside version control."""
    if SECRET_PATH.exists():
        raw = SECRET_PATH.read_text(encoding="utf-8").strip()
        if len(raw) >= 16:
            return raw
    token = secrets.token_hex(16)
    SECRET_PATH.write_text(token, encoding="utf-8")
    return token


def build_default_config() -> dict[str, Any]:
    """Build a complete default config using real local paths and current dates."""
    if EXAMPLE_CONFIG_PATH.exists():
        base = json.loads(EXAMPLE_CONFIG_PATH.read_text(encoding="utf-8"))
    else:
        base = {}

    cal_start, cal_end = rolling_calendar_range()
    today = today_local()
    default_target = today + dt.timedelta(days=38)
    defaults: dict[str, Any] = {
        "version": 2,
        "mode": "daily",
        "themePreset": "auto-circadian",
        "glowIntensity": 100,
        "iconZones": True,
        "lateNightNudge": True,
        "bezelContinuousGlow": True,
        "m2ShowNas": True,
        "rollingCalendar": True,
        "backdrops": {
            "enabled": True,
            "brightness": 62,
            "blur": 2,
            "vignette": 52,
            "m1_right": "steam_clouds",
            "m1_left": "steam_alpine_stars",
            "m2_main": "steam_milkyway",
            "m2Brightness": 78,
            "m2Blur": 0,
        },
        "calendarStart": cal_start,
        "calendarEnd": cal_end,
        "countdown": {
            "name": "硕士论文定稿",
            "date": format_local_date(default_target),
            "startDate": format_local_date(today - dt.timedelta(days=21)),
        },
        "thesisTargetWords": 40000,
        "paths": {
            "githubRoot": "C:/Users/Administrator/Documents/GitHub",
            "thesisDir": "C:/Users/Administrator/Documents/GitHub/JH-Thesis/03-论文/正文",
            "papersDb": "C:/Users/Administrator/Documents/GitHub/JH-Thesis/.reference-db/references.sqlite",
            "sshTool": "C:/Users/Administrator/.gemini/config/skills/pxlsan-ssh/scripts/remote.py",
        },
        "nodes": {
            "m2": {
                "enabled": True,
                "host": "192.168.3.222",
                "agentPort": 18766,
                "comfyPort": 8188,
                "token": _load_or_create_secret(),
                "applyTarget": "all",
            },
            "nas": {
                "enabled": True,
                "host": "192.168.3.225",
                "name": "DXP4800PLUS-JH",
            },
        },
        "screens": {
            "m1_right": {"label": "一号机 · 右屏 (主屏)", "role": "focus_hud", "width": 2560, "height": 1440},
            "m1_left": {"label": "一号机 · 左屏 (BenQ SW240)", "role": "calendar_deck", "width": 1920, "height": 1200},
            "m2_main": {"label": "二号机 · RTX 5080", "role": "compute_deck", "width": 2560, "height": 1600},
        },
        "todos": [],
        "events": [],
        "milestones": [],
        "marks": [],
        "memos": [],
    }
    merged = _deep_merge(defaults, base)
    merged["calendarStart"] = cal_start
    merged["calendarEnd"] = cal_end
    token = merged.get("nodes", {}).get("m2", {}).get("token", "")
    if not token or token == "REPLACE_WITH_32_HEX_TOKEN":
        merged.setdefault("nodes", {}).setdefault("m2", {})["token"] = _load_or_create_secret()
    return merged


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge dict override onto base without mutating inputs."""
    result = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = copy.deepcopy(v)
    return result


def normalize_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Normalize config fields, keeping rolling calendar synced when enabled."""
    out = copy.deepcopy(cfg)
    if out.get("rollingCalendar", True):
        cs, ce = rolling_calendar_range()
        out["calendarStart"] = cs
        out["calendarEnd"] = ce
    if out.get("mode") not in {"daily", "sprint", "clean"}:
        out["mode"] = "daily"
    valid_themes = {"auto-circadian", "geek-indigo", "cyber-cyan", "emerald-matrix", "amber-forge"}
    if out.get("themePreset") not in valid_themes:
        out["themePreset"] = "auto-circadian"
    out["glowIntensity"] = max(20, min(160, int(out.get("glowIntensity", 100))))
    out["thesisTargetWords"] = max(5000, int(out.get("thesisTargetWords", 40000)))
    bd = out.setdefault("backdrops", {})
    bd["enabled"] = bool(bd.get("enabled", True))
    bd["brightness"] = max(20, min(100, int(bd.get("brightness", 62))))
    bd["m2Brightness"] = max(20, min(100, int(bd.get("m2Brightness", 78))))
    bd["blur"] = max(0, min(20, int(bd.get("blur", 2))))
    bd["m2Blur"] = max(0, min(20, int(bd.get("m2Blur", 0))))
    bd["vignette"] = max(0, min(100, int(bd.get("vignette", 52))))
    return out


def load_config() -> dict[str, Any]:
    """Load unified config from wallcraft_config.json, initializing if absent."""
    defaults = build_default_config()
    if not CONFIG_PATH.exists():
        save_config(defaults)
        return normalize_config(defaults)

    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    merged = _deep_merge(defaults, raw)
    if merged.get("nodes", {}).get("m2", {}).get("token") in ("", "REPLACE_WITH_32_HEX_TOKEN", None):
        merged["nodes"]["m2"]["token"] = _load_or_create_secret()
    return normalize_config(merged)


def save_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Atomically persist config to wallcraft_config.json."""
    normalized = normalize_config(cfg)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=".cfg_", suffix=".tmp", dir=str(CONFIG_PATH.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
        os.replace(tmp_name, CONFIG_PATH)
    finally:
        if os.path.exists(tmp_name):
            try:
                os.remove(tmp_name)
            except OSError:
                pass
    return normalized


if __name__ == "__main__":
    cfg = load_config()
    safe_copy = copy.deepcopy(cfg)
    if "nodes" in safe_copy and "m2" in safe_copy["nodes"]:
        t = safe_copy["nodes"]["m2"].get("token", "")
        safe_copy["nodes"]["m2"]["token"] = f"{t[:6]}...({len(t)} chars)" if t else ""
    print(json.dumps(safe_copy, ensure_ascii=False, indent=2))
