# -*- coding: utf-8 -*-
"""
JH-WallCraft v3.1 底图目录与图像处理缓存。

自动发现仓库下 user_backdrops/ 中的用户自定义底图（优先排在画廊顶部），
并合并精选 Steam Wallpaper Engine 非二次元大气/星空/科幻素材。
"""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

from wallcraft_config import BASE_DIR, CACHE_DIR

USER_BACKDROPS_DIR = BASE_DIR / "user_backdrops"
STEAM_WORKSHOP = Path("D:/Steam/steamapps/workshop/content/431960")
STEAM_DEFAULT = Path("D:/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects")
FRAMES_DIR = CACHE_DIR / "steam_frames"
THUMBS_DIR = CACHE_DIR / "thumbs"
BG_CACHE_DIR = CACHE_DIR / "bg_cache"

_USER_FRIENDLY_NAMES: dict[str, tuple[str, str]] = {
    "user_01_eva_astronaut": ("空间站出舱宇航员", "Sci-Fi"),
    "user_02_toha_cockpit": ("东亚重工驾驶舱", "Sci-Fi"),
    "user_03_exo_astronaut": ("深空外骨骼宇航员", "Sci-Fi"),
    "user_04_storm_door": ("暴风云海之门", "Atmospheric"),
    "user_05_world_timezones": ("暗黑世界时区地图", "Geek"),
}

_CUSTOM_CENTERING: dict[str, tuple[float, float]] = {
    "user_03_exo_astronaut": (0.95, 0.5),
}

CURATED_BACKDROPS: list[dict[str, Any]] = [
    {
        "id": "steam_clouds",
        "name": "暮云天光 (Steam #884307090)",
        "category": "Atmospheric",
        "kind": "image",
        "path": str(STEAM_WORKSHOP / "884307090/imgs/10.jpg"),
        "width": 4474,
        "height": 2517,
    },
    {
        "id": "steam_alpine_stars",
        "name": "阿尔卑斯星空雪峰 (Steam #884307090)",
        "category": "Night Sky",
        "kind": "image",
        "path": str(STEAM_WORKSHOP / "884307090/imgs/1.jpg"),
        "width": 2880,
        "height": 1800,
    },
    {
        "id": "steam_milkyway",
        "name": "银河火山夜路 4K (Steam #884307090)",
        "category": "Night Sky",
        "kind": "image",
        "path": str(STEAM_WORKSHOP / "884307090/imgs/7.jpg"),
        "width": 3840,
        "height": 2160,
    },
    {
        "id": "steam_yosemite",
        "name": "紫霞优胜美地雪谷 4K (Steam #884307090)",
        "category": "Landscape",
        "kind": "image",
        "path": str(STEAM_WORKSHOP / "884307090/imgs/9.jpg"),
        "width": 3840,
        "height": 2160,
    },
    {
        "id": "steam_canyon",
        "name": "科罗拉多马蹄湾 8K (Steam #884307090)",
        "category": "Landscape",
        "kind": "image",
        "path": str(STEAM_WORKSHOP / "884307090/imgs/8.jpg"),
        "width": 7680,
        "height": 4320,
    },
    {
        "id": "steam_galaxy",
        "name": "深空螺旋星系 (WE Default)",
        "category": "Space",
        "kind": "image",
        "path": str(STEAM_DEFAULT / "deep_space/materials/galaxy_2_base.png"),
        "width": 1920,
        "height": 1080,
    },
    {
        "id": "steam_vortex",
        "name": "暗夜几何矩阵 4K (WE Default)",
        "category": "Geek",
        "kind": "image",
        "path": str(STEAM_DEFAULT / "razer_vortex/materials/vortex.png"),
        "width": 3840,
        "height": 2160,
    },
    {
        "id": "steam_scifi_city",
        "name": "科幻巨构城市 (Steam #1913758975)",
        "category": "Sci-Fi",
        "kind": "video",
        "path": str(STEAM_WORKSHOP / "1913758975/科技城市.mp4"),
        "width": 1920,
        "height": 1080,
    },
    {
        "id": "steam_fui_tech",
        "name": "FUI 科幻交互界面 (Steam #1516818117)",
        "category": "Technology",
        "kind": "video",
        "path": str(STEAM_WORKSHOP / "1516818117/FUI ECHO - Screen Graphics \u2044 Fantasy User Interface(Cuted).mp4"),
        "width": 1920,
        "height": 1080,
    },
    {
        "id": "steam_apoc_nature",
        "name": "末世自然电车 (Steam #917043694)",
        "category": "Nature",
        "kind": "video",
        "path": str(STEAM_WORKSHOP / "917043694/Apoc1.0000.mp4"),
        "width": 1920,
        "height": 1080,
    },
]

_CATALOG_MAP = {item["id"]: item for item in CURATED_BACKDROPS}


def _discover_user_backdrops() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not USER_BACKDROPS_DIR.exists():
        return items
    valid_exts = {".jpg", ".jpeg", ".png", ".webp"}
    for p in sorted(USER_BACKDROPS_DIR.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_file() or p.suffix.lower() not in valid_exts:
            continue
        bid = p.stem if p.stem.startswith("user_") else f"user_{p.stem}"
        friendly, cat = _USER_FRIENDLY_NAMES.get(bid, (p.stem, "Custom"))
        w, h = 0, 0
        try:
            with Image.open(p) as im:
                w, h = im.size
        except Exception:
            continue
        items.append({
            "id": bid,
            "name": f"{friendly} (我的底图)",
            "category": cat,
            "kind": "user",
            "path": str(p.resolve()),
            "width": w,
            "height": h,
        })
    return items


def _extract_video_frame(backdrop_id: str, video_path: Path) -> Path | None:
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    out_png = FRAMES_DIR / f"{backdrop_id}.png"
    if out_png.exists() and out_png.stat().st_size > 1024:
        return out_png
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-ss", "00:00:03", "-i", str(video_path), "-frames:v", "1", "-q:v", "2", str(out_png)],
            capture_output=True,
            timeout=15,
            creationflags=flags,
        )
        if proc.returncode == 0 and out_png.exists() and out_png.stat().st_size > 1024:
            return out_png
    except Exception:
        pass
    return None


def resolve_backdrop_path(spec: str | None) -> Path | None:
    """Resolve a user backdrop ID, curated Steam ID, or explicit path to an existing file."""
    if not spec or str(spec).strip().lower() in ("", "none", "off"):
        return None
    raw = str(spec).strip()

    for entry in _discover_user_backdrops():
        if entry["id"] == raw:
            return Path(entry["path"])

    if raw in _CATALOG_MAP:
        item = _CATALOG_MAP[raw]
        p = Path(item["path"])
        if not p.exists():
            return None
        if item.get("kind") == "video":
            return _extract_video_frame(raw, p)
        return p

    p = Path(raw)
    if p.exists() and p.is_file():
        return p
    return None


def list_backdrops() -> list[dict[str, Any]]:
    """Return 'none', user-uploaded backdrops first, then available Steam backdrops."""
    items: list[dict[str, Any]] = [
        {"id": "none", "name": "纯深色弥散光 (无底图)", "category": "Minimal", "kind": "none", "width": 0, "height": 0}
    ]
    items.extend(_discover_user_backdrops())
    for entry in CURATED_BACKDROPS:
        p = Path(entry["path"])
        if p.exists():
            items.append({
                "id": entry["id"],
                "name": entry["name"],
                "category": entry["category"],
                "kind": entry["kind"],
                "path": entry["path"],
                "width": entry["width"],
                "height": entry["height"],
            })
    return items


def get_backdrop_thumbnail(backdrop_id: str) -> bytes | None:
    """Return cached 320x180 JPEG thumbnail bytes for a user or curated backdrop."""
    if backdrop_id == "none":
        THUMBS_DIR.mkdir(parents=True, exist_ok=True)
        tp = THUMBS_DIR / "none.jpg"
        if not tp.exists():
            im = Image.new("RGB", (320, 180), (11, 15, 28))
            d = ImageDraw.Draw(im)
            d.ellipse((-40, -40, 200, 160), fill=(48, 56, 128))
            d.ellipse((140, 20, 360, 220), fill=(18, 92, 130))
            im = im.filter(ImageFilter.GaussianBlur(radius=28))
            im.save(tp, format="JPEG", quality=86)
        return tp.read_bytes()

    src = resolve_backdrop_path(backdrop_id)
    if not src:
        return None
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        mtime_ns = src.stat().st_mtime_ns
    except OSError:
        mtime_ns = 0
    tp = THUMBS_DIR / f"{backdrop_id}.jpg"
    meta_p = THUMBS_DIR / f"{backdrop_id}.mtime"
    if tp.exists() and tp.stat().st_size > 512 and meta_p.exists() and meta_p.read_text(encoding="utf-8").strip() == str(mtime_ns):
        return tp.read_bytes()

    try:
        with Image.open(src) as im:
            thumb = ImageOps.fit(im.convert("RGB"), (320, 180), method=Image.Resampling.LANCZOS)
            thumb.save(tp, format="JPEG", quality=86)
        meta_p.write_text(str(mtime_ns), encoding="utf-8")
        return tp.read_bytes()
    except Exception:
        return None


def build_processed_backdrop(
    path: Path,
    width: int,
    height: int,
    brightness: int = 72,
    blur: int = 0,
    vignette: int = 38,
) -> Image.Image:
    """Center-crop, upscale-sharpen if needed, color-grade, blur, and vignette with disk cache."""
    BG_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        mtime_ns = path.stat().st_mtime_ns
    except OSError:
        mtime_ns = 0
    key_str = f"v32|{path.resolve()}|{mtime_ns}|{width}x{height}|{brightness}|{blur}|{vignette}"
    digest = hashlib.md5(key_str.encode("utf-8")).hexdigest()[:16]
    cache_path = BG_CACHE_DIR / f"{digest}.png"

    if cache_path.exists():
        try:
            with Image.open(cache_path) as cached:
                return cached.convert("RGBA")
        except Exception:
            pass

    centering = _CUSTOM_CENTERING.get(path.stem, (0.5, 0.5))
    with Image.open(path) as src:
        src_w, _ = src.size
        fitted = ImageOps.fit(src.convert("RGB"), (width, height), method=Image.Resampling.LANCZOS, centering=centering)

    if src_w < width and blur == 0:
        fitted = fitted.filter(ImageFilter.UnsharpMask(radius=1.2, percent=65, threshold=3))

    fitted = ImageEnhance.Contrast(fitted).enhance(1.06)
    b_factor = max(0.15, min(1.2, brightness / 100.0))
    fitted = ImageEnhance.Brightness(fitted).enhance(b_factor)

    if blur > 0:
        fitted = fitted.filter(ImageFilter.GaussianBlur(radius=float(blur)))

    rgba = fitted.convert("RGBA")

    if vignette > 0:
        v_strength = max(0.0, min(1.0, vignette / 100.0))
        vw, vh = max(64, width // 4), max(64, height // 4)
        vig = Image.new("RGBA", (vw, vh), (7, 9, 16, int(180 * v_strength)))
        vd = ImageDraw.Draw(vig)
        pad_x = int(vw * 0.12)
        pad_y = int(vh * 0.10)
        vd.ellipse((pad_x, pad_y, vw - pad_x, vh - int(vh * 0.16)), fill=(7, 9, 16, 0))
        vig = vig.filter(ImageFilter.GaussianBlur(radius=max(16, int(min(vw, vh) * 0.22))))
        vig_up = vig.resize((width, height), Image.Resampling.BICUBIC)
        rgba = Image.alpha_composite(rgba, vig_up)

    try:
        rgba.convert("RGB").save(cache_path, format="PNG")
    except Exception:
        pass
    return rgba
