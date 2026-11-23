# -*- coding: utf-8 -*-
"""
JH-WallCraft v2.1 极客深色弥散光玻璃态渲染引擎 (Pillow 13)。

三屏完全职责分离 + Steam Wallpaper Engine 精选底图毛玻璃叠加：
  1. m1_right (2560×1440): 一号机专属 Focus HUD + 桌面收纳框 + 倒计时/待办/论文/最新论文雷达 + 本机 4090/内存/磁盘状态
  2. m1_left  (1920×1200): 一号机专属 全屏 6周作战日历 + GitHub 12周提交热力图 + 论文章节与文献总览
  3. m2_main  (自适应分辨率): 二号机极简算力舱 (>60% 通透星空底图留白 + 负载联动变色 + 底部悬浮 5080/ComfyUI + 可选 NAS Dock)
"""

from __future__ import annotations

import datetime as dt
import os
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from wallcraft_backdrops import build_processed_backdrop, resolve_backdrop_path
from wallcraft_config import format_local_date, now_local, parse_local_date, today_local

FONT_DIR = Path("C:/Windows/Fonts")
_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}
_NOISE_TILE_CACHE: dict[int, Image.Image] = {}
_CJK_RE = re.compile(r"[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]")

THEME_PALETTES: dict[str, dict[str, Any]] = {
    "geek-indigo": {
        "label": "GEEK INDIGO",
        "accent": (99, 102, 241),
        "accent2": (56, 189, 248),
        "accent3": (168, 85, 247),
        "hex": "#6366f1",
        "orbs": [(79, 70, 229), (14, 165, 233), (139, 92, 246)],
    },
    "cyber-cyan": {
        "label": "CYBER CYAN",
        "accent": (34, 211, 238),
        "accent2": (59, 130, 246),
        "accent3": (20, 184, 166),
        "hex": "#22d3ee",
        "orbs": [(6, 182, 212), (37, 99, 235), (20, 184, 166)],
    },
    "emerald-matrix": {
        "label": "EMERALD MATRIX",
        "accent": (16, 185, 129),
        "accent2": (6, 182, 212),
        "accent3": (59, 130, 246),
        "hex": "#10b981",
        "orbs": [(16, 185, 129), (6, 182, 212), (29, 78, 216)],
    },
    "amber-forge": {
        "label": "AMBER FORGE",
        "accent": (249, 115, 22),
        "accent2": (244, 63, 94),
        "accent3": (245, 158, 11),
        "hex": "#f97316",
        "orbs": [(234, 88, 12), (219, 39, 119), (245, 158, 11)],
    },
}


def resolve_theme(cfg: dict[str, Any], screen_id: str, telemetry: dict[str, Any]) -> dict[str, Any]:
    """Resolve active palette considering circadian mode and Machine 2 GPU load."""
    if screen_id == "m2_main":
        m2 = telemetry.get("m2") or {}
        if m2.get("busy"):
            p = dict(THEME_PALETTES["amber-forge"])
            p["label"] = "COMPUTING // LAVA"
            p["boost"] = 1.25
            return p
        p = dict(THEME_PALETTES["cyber-cyan"])
        p["label"] = "STANDBY // COOL"
        p["boost"] = 1.0
        return p

    preset = cfg.get("themePreset", "auto-circadian")
    if preset == "auto-circadian":
        hour = now_local().hour
        if 6 <= hour < 12:
            preset = "cyber-cyan"
        elif 12 <= hour < 18:
            preset = "geek-indigo"
        elif 18 <= hour < 22:
            preset = "amber-forge"
        else:
            preset = "geek-indigo"
    p = dict(THEME_PALETTES.get(preset, THEME_PALETTES["geek-indigo"]))
    p["boost"] = 1.0
    return p


def _raw_font(role: str, px: int) -> ImageFont.FreeTypeFont:
    px = max(10, int(round(px)))
    key = (role, px)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    candidates = {
        "ui": ["msyh.ttc", "segoeui.ttf"],
        "ui_bold": ["msyhbd.ttc", "segoeuib.ttf", "msyh.ttc"],
        "mono": ["consola.ttf", "msyh.ttc"],
        "mono_bold": ["consolab.ttf", "msyhbd.ttc"],
        "num": ["segoeuib.ttf", "consolab.ttf", "msyhbd.ttc"],
    }.get(role, ["msyh.ttc"])
    font_obj = None
    for fn in candidates:
        fp = FONT_DIR / fn
        if fp.exists():
            try:
                font_obj = ImageFont.truetype(str(fp), px)
                break
            except Exception:
                pass
    if font_obj is None:
        font_obj = ImageFont.load_default()
    _FONT_CACHE[key] = font_obj
    return font_obj


def font_for(text: str, role: str, px: float) -> ImageFont.FreeTypeFont:
    """Select CJK-capable font automatically whenever non-ASCII/CJK glyphs appear."""
    if text and (_CJK_RE.search(text) or any(ord(ch) > 127 and ch not in "·—…×" for ch in text)):
        if "bold" in role or role == "num":
            return _raw_font("ui_bold", int(round(px)))
        return _raw_font("ui", int(round(px)))
    return _raw_font(role, int(round(px)))


def clean_text(text: str) -> str:
    """Strip unsupported non-BMP emoji characters to avoid square tofu glyphs."""
    if not text:
        return ""
    cleaned = re.sub(r"[\U00010000-\U0010ffff\u2600-\u27bf\ufe0f]", "", str(text))
    return re.sub(r"\s+", " ", cleaned).strip()


def hex_to_rgb(hex_color: str, fallback: tuple[int, int, int] = (96, 165, 250)) -> tuple[int, int, int]:
    s = (hex_color or "").strip().lstrip("#")
    if len(s) == 6:
        try:
            return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
        except ValueError:
            pass
    return fallback


def measure_w(draw: ImageDraw.ImageDraw, text: str, role: str, px: float) -> float:
    t = clean_text(text)
    if not t:
        return 0.0
    return float(draw.textlength(t, font=font_for(t, role, px)))


def text_h(draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont) -> int:
    bbox = draw.textbbox((0, 0), "Ag中", font=font)
    return max(10, bbox[3] - bbox[1])


def fit_text(draw: ImageDraw.ImageDraw, text: str, role: str, px: float, max_w: float) -> tuple[str, ImageFont.FreeTypeFont]:
    """Truncate text cleanly with ellipsis and return (fitted_text, safe_font)."""
    t = clean_text(text)
    f = font_for(t, role, px)
    if not t or max_w <= 8:
        return "", f
    if draw.textlength(t, font=f) <= max_w:
        return t, f
    ell = "…"
    lo, hi = 0, len(t)
    best = ""
    while lo <= hi:
        mid = (lo + hi) // 2
        cand = t[:mid].rstrip() + ell
        if draw.textlength(cand, font=f) <= max_w:
            best = cand
            lo = mid + 1
        else:
            hi = mid - 1
    return (best or ell), f


def is_late_night(cfg: dict[str, Any]) -> bool:
    if not cfg.get("lateNightNudge", True):
        return False
    now = now_local()
    hm = now.hour * 60 + now.minute
    return 90 <= hm <= 300


# ─────────────────────────────────────────────
# 透明分层绘制上下文
# ─────────────────────────────────────────────

class LayerCanvas:
    """Manages an RGBA base canvas with dedicated transparent overlay layers for true alpha compositing."""

    def __init__(self, base: Image.Image) -> None:
        self.base = base.convert("RGBA")
        self.width, self.height = self.base.size
        self._overlay = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self._overlay, "RGBA")

    def flush(self) -> None:
        self.base = Image.alpha_composite(self.base, self._overlay)
        self._overlay = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self._overlay, "RGBA")

    def text(
        self,
        xy: tuple[float, float],
        text: str,
        role: str,
        px: float,
        fill: tuple[int, int, int, int],
        max_w: float | None = None,
        shadow: bool = False,
    ) -> None:
        t = clean_text(text)
        if not t:
            return
        if max_w is not None:
            t, f = fit_text(self.draw, t, role, px, max_w)
        else:
            f = font_for(t, role, px)
        xi, yi = int(round(xy[0])), int(round(xy[1]))
        if shadow:
            self.draw.text((xi, yi + max(1, int(round(px * 0.05)))), t, font=f, fill=(5, 7, 14, 175))
        self.draw.text((xi, yi), t, font=f, fill=fill)

    def text_right(
        self,
        right_x: float,
        y: float,
        text: str,
        role: str,
        px: float,
        fill: tuple[int, int, int, int],
        max_w: float | None = None,
        shadow: bool = False,
    ) -> None:
        t = clean_text(text)
        if not t:
            return
        if max_w is not None:
            t, f = fit_text(self.draw, t, role, px, max_w)
        else:
            f = font_for(t, role, px)
        tw = self.draw.textlength(t, font=f)
        xi, yi = int(round(right_x - tw)), int(round(y))
        if shadow:
            self.draw.text((xi, yi + max(1, int(round(px * 0.05)))), t, font=f, fill=(5, 7, 14, 175))
        self.draw.text((xi, yi), t, font=f, fill=fill)

    def glass_card(
        self,
        box: tuple[int, int, int, int],
        radius: int = 18,
        fill_rgba: tuple[int, int, int, int] = (10, 14, 26, 158),
        border_rgba: tuple[int, int, int, int] = (255, 255, 255, 32),
        accent_rgba: tuple[int, int, int] | None = None,
        blur_radius: int = 24,
        border_width: int = 1,
    ) -> None:
        self.flush()
        draw_glass_card(
            self.base, box,
            radius=radius, fill_rgba=fill_rgba, border_rgba=border_rgba,
            accent_rgba=accent_rgba, blur_radius=blur_radius, border_width=border_width,
        )

    def pill(
        self,
        x: float,
        y: float,
        text: str,
        role: str,
        px: float,
        bg_rgba: tuple[int, int, int, int],
        fg_rgba: tuple[int, int, int, int],
        border_rgba: tuple[int, int, int, int] | None = None,
        pad_x: int = 10,
        pad_y: int = 4,
    ) -> int:
        txt = clean_text(text)
        f = font_for(txt, role, px)
        tw = self.draw.textlength(txt, font=f)
        th = text_h(self.draw, f)
        pw = int(round(tw + pad_x * 2))
        ph = int(round(th + pad_y * 2))
        xi, yi = int(round(x)), int(round(y))
        r = ph // 2
        self.draw.rounded_rectangle((xi, yi, xi + pw, yi + ph), radius=r, fill=bg_rgba, outline=border_rgba, width=1 if border_rgba else 0)
        self.draw.text((xi + pad_x, yi + pad_y - 1), txt, font=f, fill=fg_rgba)
        return pw

    def progress_bar(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        pct: float,
        fill_rgba: tuple[int, int, int, int],
        bg_rgba: tuple[int, int, int, int] = (255, 255, 255, 24),
    ) -> None:
        xi, yi, wi, hi = int(round(x)), int(round(y)), int(round(w)), max(4, int(round(h)))
        r = max(2, hi // 2)
        self.draw.rounded_rectangle((xi, yi, xi + wi, yi + hi), radius=r, fill=bg_rgba)
        clamped = max(0.0, min(100.0, float(pct)))
        if clamped > 0.5:
            fw = max(hi, int(round(wi * (clamped / 100.0))))
            self.draw.rounded_rectangle((xi, yi, xi + fw, yi + hi), radius=r, fill=fill_rgba)

    def ring_aa(
        self,
        cx: int,
        cy: int,
        radius: int,
        thickness: int,
        pct: float,
        fg_rgb: tuple[int, int, int],
        bg_rgba: tuple[int, int, int, int] = (255, 255, 255, 26),
    ) -> None:
        self.flush()
        draw_ring_aa(self.base, cx, cy, radius, thickness, pct, fg_rgb, bg_rgba)

    def status_dot(self, cx: float, cy: float, r: float, ok: bool, busy: bool = False) -> None:
        col = (249, 115, 22) if busy else ((52, 211, 153) if ok else (248, 113, 113))
        cxi, cyi, ri = int(round(cx)), int(round(cy)), max(3, int(round(r)))
        self.draw.ellipse((cxi - ri * 2, cyi - ri * 2, cxi + ri * 2, cyi + ri * 2), fill=(col[0], col[1], col[2], 60))
        self.draw.ellipse((cxi - ri, cyi - ri, cxi + ri, cyi + ri), fill=(col[0], col[1], col[2], 255))

    def checkmark(self, x: float, y: float, size: float, done: bool, p0: bool, accent: tuple[int, int, int]) -> None:
        xi, yi, sz = int(round(x)), int(round(y)), max(12, int(round(size)))
        r = max(3, int(sz * 0.25))
        if done:
            self.draw.rounded_rectangle((xi, yi, xi + sz, yi + sz), radius=r, fill=(16, 185, 129, 235))
            p1 = (xi + sz * 0.24, yi + sz * 0.54)
            p2 = (xi + sz * 0.44, yi + sz * 0.74)
            p3 = (xi + sz * 0.78, yi + sz * 0.28)
            self.draw.line([p1, p2, p3], fill=(7, 9, 16, 255), width=max(2, int(sz * 0.14)))
        else:
            col = (244, 63, 94, 210) if p0 else (accent[0], accent[1], accent[2], 185)
            self.draw.rounded_rectangle((xi, yi, xi + sz, yi + sz), radius=r, outline=col, width=max(1, int(sz * 0.1)))

    def final_rgb(self) -> Image.Image:
        self.flush()
        return self.base.convert("RGB")


# ─────────────────────────────────────────────
# 背景合成（Steam 底图 + 弥散光晕 + 点阵 + 顶部可读性暗幕）
# ─────────────────────────────────────────────

def _get_dither_tile(strength: int = 3) -> Image.Image:
    if strength in _NOISE_TILE_CACHE:
        return _NOISE_TILE_CACHE[strength]
    raw = os.urandom(128 * 128)
    tile = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    px = tile.load()
    for y in range(128):
        for x in range(128):
            val = raw[y * 128 + x]
            lum = 255 if val > 128 else 0
            px[x, y] = (lum, lum, lum, strength)
    _NOISE_TILE_CACHE[strength] = tile
    return tile


def _resolve_screen_backdrop(cfg: dict[str, Any], screen_id: str) -> tuple[Path | None, int, int, int]:
    bd = cfg.get("backdrops") or {}
    if not bd.get("enabled", True):
        return None, 62, 2, 52
    spec = bd.get(screen_id)
    path = resolve_backdrop_path(spec)
    if screen_id == "m2_main":
        brightness = int(bd.get("m2Brightness", 78))
        blur = int(bd.get("m2Blur", 0))
        vignette = max(25, int(bd.get("vignette", 52)) - 12)
    else:
        brightness = int(bd.get("brightness", 62))
        blur = int(bd.get("blur", 2))
        vignette = int(bd.get("vignette", 52))
    return path, brightness, blur, vignette


def create_ambient_canvas(
    width: int,
    height: int,
    palette: dict[str, Any],
    orb_specs: list[tuple[float, float, float, int]],
    glow_intensity: int = 100,
    sprint_vignette: bool = False,
    backdrop_path: Path | None = None,
    bg_brightness: int = 62,
    bg_blur: int = 2,
    bg_vignette: int = 52,
) -> tuple[Image.Image, bool]:
    """Build obsidian or Steam-photo backdrop layered with atmospheric diffusion orbs & top scrim."""
    has_backdrop = backdrop_path is not None
    if has_backdrop:
        base = build_processed_backdrop(backdrop_path, width, height, brightness=bg_brightness, blur=bg_blur, vignette=bg_vignette)
    else:
        base = Image.new("RGBA", (width, height), (7, 9, 16, 255))

    # Diffusion orbs (softer alpha over photo backdrops so original art tones breathe)
    sw, sh = max(64, width // 4), max(64, height // 4)
    glow_layer = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow_layer)
    orb_scale = 0.50 if has_backdrop else 1.0
    intn = (glow_intensity / 100.0) * float(palette.get("boost", 1.0)) * orb_scale
    orbs = palette["orbs"]

    for idx, (nx, ny, nr, alpha_base) in enumerate(orb_specs):
        rgb = orbs[idx % len(orbs)]
        cx, cy = nx * sw, ny * sh
        rad = nr * max(sw, sh)
        alpha = max(6, min(200, int(alpha_base * intn)))
        gd.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=(rgb[0], rgb[1], rgb[2], alpha))

    blur_r = max(24, int(min(sw, sh) * 0.24))
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=blur_r))
    glow_up = glow_layer.resize((width, height), Image.Resampling.BICUBIC)
    base = Image.alpha_composite(base, glow_up)

    # Top readability gradient scrim when backdrop is active
    if has_backdrop:
        scrim_h = max(90, int(height * 0.14))
        scrim = Image.new("RGBA", (1, scrim_h), (0, 0, 0, 0))
        sp = scrim.load()
        for y in range(scrim_h):
            a = int(135 * ((1.0 - y / scrim_h) ** 1.6))
            sp[0, y] = (7, 9, 16, a)
        base.alpha_composite(scrim.resize((width, scrim_h), Image.Resampling.BILINEAR), (0, 0))

    # Precision geek dot-grid
    grid = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(grid)
    step = max(28, int(round(36 * (width / 2560))))
    dot_alpha = 9 if has_backdrop else 16
    dot_col = (148, 163, 184, dot_alpha)
    for y in range(step // 2, height, step):
        for x in range(step // 2, width, step):
            gdraw.point((x, y), fill=dot_col)

    if sprint_vignette:
        a = palette["accent"]
        gdraw.rectangle((0, 0, width - 1, height - 1), outline=(a[0], a[1], a[2], 65), width=max(2, int(4 * width / 2560)))

    base = Image.alpha_composite(base, grid)

    if not has_backdrop:
        tile = _get_dither_tile(3)
        dither_full = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        for y in range(0, height, 128):
            for x in range(0, width, 128):
                dither_full.paste(tile, (x, y))
        base = Image.alpha_composite(base, dither_full)

    return base, has_backdrop


def _aa_round_mask(w: int, h: int, r: int) -> Image.Image:
    scale = 2
    mw, mh, mr = w * scale, h * scale, r * scale
    mask = Image.new("L", (mw, mh), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, mw - 1, mh - 1), radius=mr, fill=255)
    return mask.resize((w, h), Image.Resampling.LANCZOS)


def draw_glass_card(
    canvas: Image.Image,
    box: tuple[int, int, int, int],
    radius: int = 18,
    fill_rgba: tuple[int, int, int, int] = (10, 14, 26, 158),
    border_rgba: tuple[int, int, int, int] = (255, 255, 255, 32),
    accent_rgba: tuple[int, int, int] | None = None,
    blur_radius: int = 24,
    border_width: int = 1,
) -> None:
    x1, y1, x2, y2 = [int(round(v)) for v in box]
    w, h = x2 - x1, y2 - y1
    if w <= 4 or h <= 4:
        return

    pad = min(blur_radius * 2, 38)
    cx1, cy1 = max(0, x1 - pad), max(0, y1 - pad)
    cx2, cy2 = min(canvas.width, x2 + pad), min(canvas.height, y2 + pad)
    crop = canvas.crop((cx1, cy1, cx2, cy2)).filter(ImageFilter.GaussianBlur(radius=blur_radius))
    blurred = crop.crop((x1 - cx1, y1 - cy1, x1 - cx1 + w, y1 - cy1 + h)).convert("RGBA")

    tint = Image.new("RGBA", (w, h), fill_rgba)
    glass = Image.alpha_composite(blurred, tint)

    sheen = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sheen_h = max(12, int(h * 0.24))
    for i in range(sheen_h):
        a = int(15 * (1.0 - i / sheen_h))
        if a > 0:
            sd.line((0, i, w, i), fill=(255, 255, 255, a))
    if accent_rgba is not None:
        sd.line((radius, 1, w - radius, 1), fill=(accent_rgba[0], accent_rgba[1], accent_rgba[2], 95), width=max(1, border_width))
    glass = Image.alpha_composite(glass, sheen)

    mask = _aa_round_mask(w, h, radius)
    canvas.paste(glass, (x1, y1), mask)

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, outline=border_rgba, width=border_width)
    canvas.alpha_composite(overlay, (x1, y1))


def draw_ring_aa(
    canvas: Image.Image,
    cx: int,
    cy: int,
    radius: int,
    thickness: int,
    pct: float,
    fg_rgb: tuple[int, int, int],
    bg_rgba: tuple[int, int, int, int] = (255, 255, 255, 26),
) -> None:
    aa = 2
    size = (radius + thickness + 8) * 2
    big = Image.new("RGBA", (size * aa, size * aa), (0, 0, 0, 0))
    bd = ImageDraw.Draw(big)
    pad = (thickness // 2 + 6) * aa
    box = (pad, pad, size * aa - pad, size * aa - pad)
    bd.arc(box, start=0, end=360, fill=bg_rgba, width=thickness * aa)
    clamped = max(0.0, min(100.0, float(pct)))
    if clamped > 0.3:
        end_angle = -90.0 + 360.0 * (clamped / 100.0)
        bd.arc(box, start=-90.0, end=end_angle, fill=(fg_rgb[0], fg_rgb[1], fg_rgb[2], 245), width=thickness * aa)
    small = big.resize((size, size), Image.Resampling.LANCZOS)
    canvas.alpha_composite(small, (cx - size // 2, cy - size // 2))


def _draw_header_badges(
    lc: LayerCanvas,
    right_x: float,
    y: float,
    cfg: dict[str, Any],
    palette: dict[str, Any],
    collected_hm: str,
    s: float,
    extra_tag: str | None = None,
) -> None:
    pills: list[tuple[str, tuple[int, int, int, int], tuple[int, int, int, int], tuple[int, int, int, int] | None]] = []
    if is_late_night(cfg):
        pills.append(("NIGHT OWL // 记得收尾休息", (244, 63, 94, 48), (254, 205, 211, 255), (244, 63, 94, 130)))
    mode = cfg.get("mode", "daily").upper()
    if mode != "DAILY":
        pills.append((f"MODE // {mode}", (245, 158, 11, 46), (253, 230, 138, 255), (245, 158, 11, 125)))
    if extra_tag:
        a = palette["accent"]
        pills.append((extra_tag, (a[0], a[1], a[2], 46), (224, 242, 254, 255), (a[0], a[1], a[2], 125)))
    pills.append((f"SYNC {collected_hm}", (12, 16, 28, 155), (203, 213, 225, 240), (255, 255, 255, 42)))

    cur_x = right_x
    for txt, bg, fg, bd in reversed(pills):
        tw = int(round(measure_w(lc.draw, txt, "mono_bold", 14 * s) + 20 * s))
        cur_x -= tw
        lc.pill(cur_x, y, txt, "mono_bold", 14 * s, bg, fg, bd, pad_x=int(10 * s), pad_y=int(5 * s))
        cur_x -= int(10 * s)


def _draw_heatmap_grid(
    lc: LayerCanvas,
    x: int,
    y: int,
    w: int,
    h: int,
    gh: dict[str, Any],
    palette: dict[str, Any],
    s: float,
) -> None:
    cells = gh.get("cells") or []
    weeks = int(gh.get("weeks", 12))
    if not cells:
        lc.text((x, y + int(20 * s)), "暂无 GitHub 提交数据", "ui", 16 * s, (100, 116, 139, 220))
        return

    lbl_w = int(26 * s)
    gx = x + lbl_w
    gw = w - lbl_w
    gap = max(4, int(7 * s))
    cell_w = max(8, (gw - gap * (weeks - 1)) // weeks)
    cell_h = max(8, (h - gap * 6) // 7)
    sz = min(cell_w, cell_h, int(29 * s))
    grid_total_w = weeks * sz + (weeks - 1) * gap
    grid_total_h = 7 * sz + 6 * gap
    gx = x + lbl_w + max(0, (gw - grid_total_w) // 2)
    gy = y + max(0, (h - grid_total_h) // 2)

    dows = ["M", "", "W", "", "F", "", "S"]
    for row_i, lbl in enumerate(dows):
        if lbl:
            lc.text((gx - int(20 * s), gy + row_i * (sz + gap) + int(sz * 0.16)), lbl, "mono", 12 * s, (148, 163, 184, 210))

    max_cnt = max([c["count"] for c in cells] or [1])
    a1 = palette["accent2"]
    a2 = palette["accent"]
    for c in cells:
        cx = gx + c["week"] * (sz + gap)
        cy = gy + c["dow"] * (sz + gap)
        r = max(3, int(5 * s))
        if c.get("future"):
            lc.draw.rounded_rectangle((cx, cy, cx + sz, cy + sz), radius=r, outline=(255, 255, 255, 18), width=1)
            continue
        cnt = int(c.get("count", 0))
        if cnt <= 0:
            col = (255, 255, 255, 20)
            bd = (255, 255, 255, 20)
        else:
            ratio = cnt / max(1, max_cnt)
            if ratio < 0.25:
                col = (a1[0], a1[1], a1[2], 82)
                bd = (a1[0], a1[1], a1[2], 115)
            elif ratio < 0.55:
                col = (a1[0], a1[1], a1[2], 144)
                bd = (a1[0], a1[1], a1[2], 175)
            elif ratio < 0.8:
                col = (a1[0], a1[1], a1[2], 200)
                bd = (a2[0], a2[1], a2[2], 215)
            else:
                col = (min(255, a1[0] + 45), min(255, a1[1] + 45), min(255, a1[2] + 45), 245)
                bd = (224, 242, 254, 220)
        lc.draw.rounded_rectangle((cx, cy, cx + sz, cy + sz), radius=r, fill=col, outline=bd, width=1)


# ─────────────────────────────────────────────
# 1) 一号机右屏：纯一号机 Focus HUD + 4090/内存/磁盘 (2560×1440)
# ─────────────────────────────────────────────

def render_m1_right(cfg: dict[str, Any], telemetry: dict[str, Any], width: int = 2560, height: int = 1440) -> Image.Image:
    s = width / 2560.0
    palette = resolve_theme(cfg, "m1_right", telemetry)
    accent = palette["accent"]
    accent2 = palette["accent2"]
    mode = cfg.get("mode", "daily")
    clean_mode = (mode == "clean")
    sprint_mode = (mode == "sprint")

    orbs = [
        (0.02, 0.42, 0.56, 76) if cfg.get("bezelContinuousGlow", True) else (0.38, 0.25, 0.50, 65),
        (0.76, 0.14, 0.52, 68),
        (0.62, 0.84, 0.48, 56),
    ]
    bd_path, bg_br, bg_bl, bg_vig = _resolve_screen_backdrop(cfg, "m1_right")
    base, has_bd = create_ambient_canvas(
        width, height, palette, orbs,
        glow_intensity=int(cfg.get("glowIntensity", 100)),
        sprint_vignette=sprint_mode,
        backdrop_path=bd_path,
        bg_brightness=bg_br,
        bg_blur=bg_bl,
        bg_vignette=bg_vig,
    )
    card_fill = (9, 13, 24, 150) if has_bd else (12, 16, 29, 172)
    card_bd = (255, 255, 255, 36) if has_bd else (255, 255, 255, 28)
    lc = LayerCanvas(base)

    # Left 1/3 Desktop Icon Dock Zones
    left_limit = int(805 * s)
    if cfg.get("iconZones", True):
        zx1, zx2 = int(46 * s), int(766 * s)
        zones = [
            ("01 // TOOLS & APPS", int(52 * s), int(468 * s)),
            ("02 // ACTIVE WORKSPACES", int(490 * s), int(924 * s)),
            ("03 // INBOX & ASSETS", int(946 * s), int(1352 * s)),
        ]
        for label, zy1, zy2 in zones:
            lc.glass_card(
                (zx1, zy1, zx2, zy2),
                radius=int(16 * s),
                fill_rgba=(8, 12, 22, 68 if has_bd else 58),
                border_rgba=(255, 255, 255, 28 if has_bd else 20),
                blur_radius=14,
            )
            lc.text((zx1 + int(18 * s), zy1 + int(14 * s)), label, "mono_bold", 15 * s, (203, 213, 225, 175), shadow=has_bd)

    rx1 = left_limit + int(16 * s)
    rx2 = width - int(54 * s)
    rw = rx2 - rx1
    top_y = int(48 * s)
    bot_y = height - int(78 * s)

    now = now_local()
    today = today_local()
    weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    wk_num = today.isocalendar().week

    # ── Header + Hero Countdown ──
    header_h = int(172 * s)
    cd_w = int(660 * s)
    cd_box = (rx2 - cd_w, top_y, rx2, top_y + header_h - int(10 * s))

    date_str = f"{today.year}.{today.month:02d}.{today.day:02d}"
    lc.text((rx1, top_y + int(4 * s)), date_str, "num", 52 * s, (248, 250, 252, 255), shadow=has_bd)
    lc.text((rx1 + int(2 * s), top_y + int(72 * s)), f"{weekdays[today.weekday()]} // W{wk_num:02d} // NODE-01 PRIMARY", "mono", 17 * s, (203, 213, 225, 235), shadow=has_bd)

    _draw_header_badges(
        lc, cd_box[0] - int(18 * s), top_y + int(12 * s),
        cfg, palette, telemetry.get("collected_hm", "--:--"), s,
        extra_tag=palette["label"],
    )

    lc.glass_card(
        cd_box, radius=int(20 * s),
        fill_rgba=(10, 14, 28, 162) if has_bd else (14, 18, 34, 178),
        border_rgba=(accent[0], accent[1], accent[2], 128 if sprint_mode else 86),
        accent_rgba=accent,
        border_width=2 if sprint_mode else 1,
    )
    if clean_mode:
        lc.text((cd_box[0] + int(26 * s), cd_box[1] + int(22 * s)), "FOCUS MODE // CLEAN DESK", "mono_bold", 15 * s, (accent2[0], accent2[1], accent2[2], 235))
        lc.text((cd_box[0] + int(26 * s), cd_box[1] + int(56 * s)), f"{now.hour:02d}:{now.minute:02d}", "num", 58 * s, (248, 250, 252, 255))
        lc.text((cd_box[0] + int(210 * s), cd_box[1] + int(82 * s)), "PRIVACY GUARD ACTIVE", "mono", 17 * s, (148, 163, 184, 225))
    else:
        cd_cfg = cfg.get("countdown") or {}
        cd_name = clean_text(cd_cfg.get("name") or "TARGET")
        target_d = parse_local_date(cd_cfg.get("date"))
        start_d = parse_local_date(cd_cfg.get("startDate"), today - dt.timedelta(days=20))
        days_left = (target_d - today).days
        total_span = max(1, (target_d - start_d).days)
        elapsed_pct = max(0.0, min(100.0, ((today - start_d).days / total_span) * 100.0))

        lc.text((cd_box[0] + int(26 * s), cd_box[1] + int(20 * s)), f"DEADLINE // {format_local_date(target_d)}", "mono_bold", 14 * s, (accent2[0], accent2[1], accent2[2], 235))
        lc.text((cd_box[0] + int(26 * s), cd_box[1] + int(50 * s)), cd_name, "ui_bold", 26 * s, (248, 250, 252, 255), max_w=360 * s)

        val_str = f"{days_left}" if days_left >= 0 else f"+{abs(days_left)}"
        lc.text_right(cd_box[2] - int(26 * s), cd_box[1] + int(10 * s), val_str, "num", 64 * s, (244, 63, 94, 255) if days_left <= 7 else (248, 250, 252, 255))
        lc.text_right(cd_box[2] - int(26 * s), cd_box[1] + int(86 * s), "DAYS LEFT" if days_left >= 0 else "DAYS OVER", "mono_bold", 15 * s, (148, 163, 184, 225))
        lc.progress_bar(cd_box[0] + int(26 * s), cd_box[3] - int(24 * s), cd_w - int(52 * s), int(8 * s), elapsed_pct, (accent[0], accent[1], accent[2], 235))

    gap = int(20 * s)
    mid_y1 = top_y + header_h + int(8 * s)
    mid_h = int(560 * s)
    mid_y2 = mid_y1 + mid_h
    bot_y1 = mid_y2 + gap
    bot_y2 = bot_y

    col_left_w = int(rw * 0.52)
    col_right_x = rx1 + col_left_w + gap
    col_right_w = rx2 - col_right_x

    # ── Middle Left: Today's Focus Todos ──
    focus_box = (rx1, mid_y1, rx1 + col_left_w, mid_y2)
    lc.glass_card(focus_box, radius=int(20 * s), fill_rgba=card_fill, border_rgba=card_bd, accent_rgba=accent2)
    fx, fy = focus_box[0] + int(26 * s), focus_box[1] + int(22 * s)

    if clean_mode:
        gh = telemetry.get("github") or {}
        lc.text((fx, fy), "本地代码提交脉搏 // GITHUB PULSE", "ui_bold", 23 * s, (248, 250, 252, 255))
        lc.text((fx, fy + int(36 * s)), f"{gh.get('total_commits', 0)} COMMITS IN 12W // STREAK {gh.get('streak_days', 0)}D", "mono", 14 * s, (accent2[0], accent2[1], accent2[2], 225))
        _draw_heatmap_grid(lc, fx, fy + int(76 * s), col_left_w - int(52 * s), mid_h - int(110 * s), gh, palette, s)
    else:
        todos = cfg.get("todos") or []
        done_cnt = sum(1 for t in todos if t.get("done"))
        lc.text((fx, fy), "今日聚焦 // TOP FOCUS", "ui_bold", 23 * s, (248, 250, 252, 255))
        stat_pill = f"{done_cnt}/{len(todos)} DONE"
        pw = int(measure_w(lc.draw, stat_pill, "mono_bold", 14 * s) + 20 * s)
        lc.pill(focus_box[2] - int(26 * s) - pw, fy + int(2 * s), stat_pill, "mono_bold", 14 * s, (accent2[0], accent2[1], accent2[2], 36), (186, 230, 253, 255), (accent2[0], accent2[1], accent2[2], 95), pad_x=int(10 * s), pad_y=int(4 * s))

        sorted_todos = sorted(todos, key=lambda t: (bool(t.get("done")), not bool(t.get("p0"))))
        ty = fy + int(56 * s)
        row_h = int(60 * s)
        for item in sorted_todos[:7]:
            if ty + row_h > focus_box[3] - int(18 * s):
                break
            is_done = bool(item.get("done"))
            is_p0 = bool(item.get("p0")) or ("🔴" in str(item.get("text", "")))
            row_bg = (255, 255, 255, 11) if (not is_p0 or is_done) else (244, 63, 94, 26)
            row_bd = (244, 63, 94, 90) if (is_p0 and not is_done) else (255, 255, 255, 22)
            lc.draw.rounded_rectangle((fx, ty, focus_box[2] - int(26 * s), ty + int(48 * s)), radius=int(11 * s), fill=row_bg, outline=row_bd, width=1)
            lc.checkmark(fx + int(14 * s), ty + int(14 * s), int(20 * s), is_done, is_p0, accent2)
            text_x = fx + int(46 * s)
            max_tw = (focus_box[2] - int(42 * s)) - text_x - (int(56 * s) if (is_p0 and not is_done) else 0)
            txt_col = (148, 163, 184, 155) if is_done else (241, 245, 249, 250)
            lc.text((text_x, ty + int(11 * s)), str(item.get("text", "")), "ui", 20 * s, txt_col, max_w=max_tw)
            if is_p0 and not is_done:
                lc.pill(focus_box[2] - int(76 * s), ty + int(12 * s), "P0", "mono_bold", 13 * s, (244, 63, 94, 48), (254, 205, 211, 255), (244, 63, 94, 130), pad_x=int(8 * s), pad_y=int(3 * s))
            ty += row_h
        if not sorted_todos:
            lc.text((fx, ty + int(20 * s)), "暂无待办，可在控制台添加今日焦点任务", "ui", 19 * s, (148, 163, 184, 220))

    # ── Middle Right Top: JH-Thesis Live Progress ──
    th_h = int(320 * s)
    th_box = (col_right_x, mid_y1, rx2, mid_y1 + th_h)
    lc.glass_card(th_box, radius=int(20 * s), fill_rgba=card_fill, border_rgba=card_bd, accent_rgba=accent)
    th = telemetry.get("thesis") or {}
    tx, ty = th_box[0] + int(26 * s), th_box[1] + int(20 * s)
    lc.text((tx, ty), "硕士论文实时字数 // JH-THESIS", "ui_bold", 23 * s, (248, 250, 252, 255))
    total_cjk = int(th.get("total_cjk", 0))
    target_w = int(th.get("target_words", cfg.get("thesisTargetWords", 40000)))
    pct = float(th.get("pct", 0.0))

    big_num = f"{total_cjk:,}"
    lc.text((tx, ty + int(42 * s)), big_num, "num", 44 * s, (248, 250, 252, 255))
    nw = measure_w(lc.draw, big_num, "num", 44 * s)
    lc.text((tx + nw + int(12 * s), ty + int(62 * s)), f"/ {target_w:,} 字 ({pct:.1f}%)", "ui", 16 * s, (148, 163, 184, 235))
    lc.text_right(th_box[2] - int(26 * s), ty + int(64 * s), f"UPD {th.get('updated', '--')}", "mono", 14 * s, (148, 163, 184, 210))
    lc.progress_bar(tx, ty + int(98 * s), col_right_w - int(52 * s), int(10 * s), pct, (accent[0], accent[1], accent[2], 235))

    chapters = th.get("chapters") or []
    cy = ty + int(124 * s)
    max_ch = max([c.get("cjk", 1) for c in chapters] or [1])
    for ch in chapters[:7]:
        lc.text((tx, cy), ch.get("label", ""), "ui", 15 * s, (203, 213, 225, 240), max_w=195 * s)
        bar_x = tx + int(205 * s)
        bar_w = col_right_w - int(320 * s)
        lc.progress_bar(bar_x, cy + int(6 * s), bar_w, int(7 * s), (ch.get("cjk", 0) / max_ch) * 100.0, (accent2[0], accent2[1], accent2[2], 220))
        lc.text_right(th_box[2] - int(26 * s), cy + int(2 * s), f"{ch.get('cjk', 0):,}", "mono", 14 * s, (148, 163, 184, 225))
        cy += int(24 * s)

    # ── Middle Right Bottom: Memos (or Disks in Clean Mode) ──
    memo_box = (col_right_x, mid_y1 + th_h + gap, rx2, mid_y2)
    lc.glass_card(memo_box, radius=int(20 * s), fill_rgba=card_fill, border_rgba=card_bd, accent_rgba=(245, 158, 11))
    mx, my = memo_box[0] + int(26 * s), memo_box[1] + int(20 * s)
    if clean_mode:
        lc.text((mx, my), "创作节奏 // GITHUB STREAK", "ui_bold", 23 * s, (248, 250, 252, 255))
        gh = telemetry.get("github") or {}
        lc.text((mx, my + int(52 * s)), f"连续提交 {gh.get('streak_days', 0)} 天  ·  今日 +{gh.get('today_commits', 0)} commits", "ui_bold", 19 * s, (226, 232, 240, 245))
        lc.text((mx, my + int(92 * s)), f"近12周累计 {gh.get('total_commits', 0)} commits  ·  覆盖 {gh.get('active_days', 0)} 天", "ui", 16 * s, (148, 163, 184, 230))
    else:
        lc.text((mx, my), "灵感与备忘 // MEMO", "ui_bold", 23 * s, (248, 250, 252, 255))
        memos = cfg.get("memos") or []
        my_cur = my + int(50 * s)
        for mm in memos[:4]:
            if my_cur + int(34 * s) > memo_box[3] - int(14 * s):
                break
            lc.draw.ellipse((mx + int(2 * s), my_cur + int(8 * s), mx + int(10 * s), my_cur + int(16 * s)), fill=(245, 158, 11, 225))
            lc.text((mx + int(20 * s), my_cur), str(mm.get("text", "")), "ui", 18 * s, (226, 232, 240, 245), max_w=col_right_w - int(74 * s))
            my_cur += int(36 * s)

    # ── Bottom Left: Recent Papers Radar ──
    pp_box = (rx1, bot_y1, rx1 + col_left_w, bot_y2)
    lc.glass_card(pp_box, radius=int(20 * s), fill_rgba=card_fill, border_rgba=card_bd, accent_rgba=accent2)
    px, py = pp_box[0] + int(26 * s), pp_box[1] + int(20 * s)
    papers_data = telemetry.get("papers") or {}
    lc.text((px, py), "最新论文雷达 // PAPER RADAR", "ui_bold", 23 * s, (248, 250, 252, 255))
    meta_pill = f"馆藏 {papers_data.get('total_docs', 0)} 篇 · 今日 +{papers_data.get('today_count', 0)}"
    mpw = int(measure_w(lc.draw, meta_pill, "ui_bold", 13 * s) + 20 * s)
    lc.pill(pp_box[2] - int(26 * s) - mpw, py + int(2 * s), meta_pill, "ui_bold", 13 * s, (accent2[0], accent2[1], accent2[2], 36), (186, 230, 253, 255), (accent2[0], accent2[1], accent2[2], 95), pad_x=int(10 * s), pad_y=int(4 * s))

    p_cur = py + int(54 * s)
    for pp in (papers_data.get("papers") or [])[:5]:
        if p_cur + int(68 * s) > pp_box[3] - int(12 * s):
            break
        badge_w = 0
        if pp.get("is_today"):
            badge_w = lc.pill(px, p_cur + int(2 * s), "TODAY", "mono_bold", 12 * s, (16, 185, 129, 48), (110, 231, 183, 255), (16, 185, 129, 130), pad_x=int(7 * s), pad_y=int(2 * s)) + int(10 * s)
        elif pp.get("year"):
            badge_w = lc.pill(px, p_cur + int(2 * s), pp["year"], "mono_bold", 12 * s, (255, 255, 255, 20), (203, 213, 225, 240), None, pad_x=int(7 * s), pad_y=int(2 * s)) + int(10 * s)

        lc.text((px + badge_w, p_cur), pp.get("title", ""), "ui_bold", 17 * s, (241, 245, 249, 250), max_w=col_left_w - int(58 * s) - badge_w)
        meta_parts = [x for x in [pp.get("authors") or "Unknown", f"{pp.get('pages', 0)}p", pp.get("added_at", "")] if x]
        lc.text((px + badge_w, p_cur + int(26 * s)), "  ·  ".join(meta_parts), "ui", 13 * s, (148, 163, 184, 215), max_w=col_left_w - int(58 * s) - badge_w)
        p_cur += int(66 * s)

    # ── Bottom Right: Pure Machine 1 Workstation Hardware Status (NO M2/NAS) ──
    hw_box = (col_right_x, bot_y1, rx2, bot_y2)
    lc.glass_card(hw_box, radius=int(20 * s), fill_rgba=card_fill, border_rgba=card_bd, accent_rgba=accent)
    hx, hy = hw_box[0] + int(26 * s), hw_box[1] + int(20 * s)
    lc.text((hx, hy), "本机工作站状态 // NODE-01 LOCAL", "ui_bold", 23 * s, (248, 250, 252, 255))

    m1 = telemetry.get("m1") or {}
    m1g = m1.get("gpu") or {}
    m1ram = m1.get("ram") or {}
    m1disks = m1.get("disks") or []
    m1_vram = f"{m1g.get('vram_used_mb', 0)/1024:.1f} / {m1g.get('vram_total_mb', 24564)/1024:.0f} GB" if m1g.get("ok") else "--"

    hw_rows: list[tuple[str, bool, bool, str, float, tuple[int, int, int]]] = [
        (
            "RTX 4090 // GPU & VRAM",
            m1g.get("ok", False),
            int(m1g.get("util_pct", 0) or 0) >= 60,
            f"{m1g.get('util_pct', 0)}%  ·  {m1_vram}  ·  {m1g.get('temp_c', 0)}C  ·  {m1g.get('power_w', 0):.0f}W" if m1g.get("ok") else "OFFLINE",
            float(m1g.get("vram_pct", 0.0)),
            accent2,
        ),
        (
            "SYSTEM RAM // MEMORY",
            bool(m1ram.get("total_gb", 0)),
            False,
            f"{m1ram.get('used_gb', 0):.1f} / {m1ram.get('total_gb', 0):.1f} GB  ({m1ram.get('pct', 0)}%)",
            float(m1ram.get("pct", 0)),
            accent,
        ),
    ]
    for d in m1disks[:2]:
        hw_rows.append((
            f"LOCAL DISK // {d['drive']}:\\",
            True,
            float(d.get("pct", 0)) >= 90.0,
            f"已用 {d['used_gb']:.0f} / {d['total_gb']:.0f} GB  ·  剩余 {d['free_gb']:.0f} GB",
            float(d.get("pct", 0)),
            (52, 211, 153),
        ))

    ry = hy + int(56 * s)
    for label, ok, busy, desc, bar_pct, bar_rgb in hw_rows:
        if ry + int(68 * s) > hw_box[3] - int(10 * s):
            break
        lc.status_dot(hx + int(8 * s), ry + int(10 * s), 5 * s, ok, busy)
        lc.text((hx + int(26 * s), ry), label, "mono_bold", 15 * s, (241, 245, 249, 250))
        lc.text_right(hw_box[2] - int(26 * s), ry + int(1 * s), desc, "ui", 14 * s, (203, 213, 225, 230), max_w=col_right_w - int(250 * s))
        lc.progress_bar(hx + int(26 * s), ry + int(28 * s), col_right_w - int(78 * s), int(7 * s), bar_pct, (bar_rgb[0], bar_rgb[1], bar_rgb[2], 225))
        ry += int(68 * s)

    return lc.final_rgb()


# ─────────────────────────────────────────────
# 2) 一号机左屏：全屏 6周日历 + GitHub 热力图 + 论文总览 (1920×1200)
# ─────────────────────────────────────────────

def render_m1_left(cfg: dict[str, Any], telemetry: dict[str, Any], width: int = 1920, height: int = 1200) -> Image.Image:
    s = width / 1920.0
    palette = resolve_theme(cfg, "m1_left", telemetry)
    accent = palette["accent"]
    accent2 = palette["accent2"]
    mode = cfg.get("mode", "daily")
    clean_mode = (mode == "clean")
    sprint_mode = (mode == "sprint")

    orbs = [
        (0.98, 0.42, 0.56, 76) if cfg.get("bezelContinuousGlow", True) else (0.72, 0.35, 0.50, 65),
        (0.18, 0.16, 0.52, 64),
        (0.32, 0.85, 0.48, 54),
    ]
    bd_path, bg_br, bg_bl, bg_vig = _resolve_screen_backdrop(cfg, "m1_left")
    base, has_bd = create_ambient_canvas(
        width, height, palette, orbs,
        glow_intensity=int(cfg.get("glowIntensity", 100)),
        sprint_vignette=sprint_mode,
        backdrop_path=bd_path,
        bg_brightness=bg_br,
        bg_blur=bg_bl,
        bg_vignette=bg_vig,
    )
    card_fill = (9, 13, 24, 148) if has_bd else (12, 16, 29, 172)
    card_bd = (255, 255, 255, 36) if has_bd else (255, 255, 255, 28)
    lc = LayerCanvas(base)

    margin = int(42 * s)
    top_y = int(34 * s)
    bot_y = height - int(62 * s)
    full_w = width - margin * 2
    today = today_local()

    # ── Header ──
    cs = parse_local_date(cfg.get("calendarStart"))
    ce = parse_local_date(cfg.get("calendarEnd"), cs + dt.timedelta(days=41))
    cal_title = f"{cs.year}.{cs.month:02d} — {ce.year}.{ce.month:02d}" if cs.month != ce.month else f"{cs.year}年{cs.month:02d}月"
    lc.text((margin, top_y), cal_title, "num", 38 * s, (248, 250, 252, 255), shadow=has_bd)
    lc.text((margin, top_y + int(46 * s)), "COMMAND DECK // 6-WEEK HORIZON + CREATION ANALYTICS", "mono", 14 * s, (203, 213, 225, 230), shadow=has_bd)

    _draw_header_badges(
        lc, width - margin, top_y + int(8 * s),
        cfg, palette, telemetry.get("collected_hm", "--:--"), s,
        extra_tag="NODE-01 // SECONDARY",
    )

    # ── Calendar Glass Container ──
    cal_top = top_y + int(76 * s)
    avail_h = bot_y - cal_top
    cal_box_h = int(avail_h * 0.62)
    cal_box = (margin, cal_top, width - margin, cal_top + cal_box_h)
    lc.glass_card(cal_box, radius=int(20 * s), fill_rgba=card_fill, border_rgba=card_bd, accent_rgba=accent)

    pad = int(16 * s)
    gx1 = cal_box[0] + pad
    gx2 = cal_box[2] - pad
    gw = gx2 - gx1
    cell_w = gw / 7.0
    dow_h = int(28 * s)
    grid_top = cal_box[1] + int(12 * s) + dow_h
    grid_h = cal_box[3] - pad - grid_top
    cell_h = grid_h / 6.0

    wn = ["MON 一", "TUE 二", "WED 三", "THU 四", "FRI 五", "SAT 六", "SUN 日"]
    for col in range(7):
        col_cx = gx1 + col * cell_w + cell_w * 0.5
        tw = measure_w(lc.draw, wn[col], "ui_bold", 13 * s)
        col_fill = (251, 146, 60, 235) if col >= 5 else (203, 213, 225, 225)
        lc.text((col_cx - tw * 0.5, cal_box[1] + int(11 * s)), wn[col], "ui_bold", 13 * s, col_fill)

    grid_monday = cs - dt.timedelta(days=cs.weekday())
    date_map: dict[str, dict[str, Any]] = {}
    cell_pad = int(3 * s)

    for row in range(6):
        for col in range(7):
            d = grid_monday + dt.timedelta(days=row * 7 + col)
            ds = format_local_date(d)
            x1 = int(round(gx1 + col * cell_w + cell_pad))
            y1 = int(round(grid_top + row * cell_h + cell_pad))
            x2 = int(round(gx1 + (col + 1) * cell_w - cell_pad))
            y2 = int(round(grid_top + (row + 1) * cell_h - cell_pad))
            date_map[ds] = {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "row": row, "col": col, "w": x2 - x1, "h": y2 - y1}

            in_range = (cs <= d <= ce)
            is_today = (d == today)
            is_wknd = (col >= 5)

            if is_today:
                lc.draw.rounded_rectangle((x1, y1, x2, y2), radius=int(10 * s), fill=(accent2[0], accent2[1], accent2[2], 46), outline=(accent2[0], accent2[1], accent2[2], 240), width=2)
            elif in_range:
                bg = (255, 255, 255, 13) if not is_wknd else (255, 255, 255, 8)
                lc.draw.rounded_rectangle((x1, y1, x2, y2), radius=int(10 * s), fill=bg, outline=(255, 255, 255, 22), width=1)
            else:
                lc.draw.rounded_rectangle((x1, y1, x2, y2), radius=int(10 * s), fill=(255, 255, 255, 4), outline=(255, 255, 255, 12), width=1)

            num_col = (accent2[0], accent2[1], accent2[2], 255) if is_today else ((253, 186, 116, 235) if (is_wknd and in_range) else ((241, 245, 249, 245) if in_range else (100, 116, 139, 185)))
            lc.text((x1 + int(9 * s), y1 + int(5 * s)), str(d.day), "num", 21 * s, num_col)
            if d.day == 1 or (row == 0 and col == 0):
                nw = measure_w(lc.draw, str(d.day), "num", 21 * s)
                lc.text((x1 + int(15 * s) + nw, y1 + int(10 * s)), f"{d.month}月", "ui_bold", 12 * s, (52, 211, 153, 240))
            if is_today:
                tw = measure_w(lc.draw, "TODAY", "mono_bold", 10 * s) + int(10 * s)
                lc.pill(x2 - int(tw) - int(6 * s), y1 + int(6 * s), "TODAY", "mono_bold", 10 * s, (accent2[0], accent2[1], accent2[2], 62), (224, 242, 254, 255), None, pad_x=int(5 * s), pad_y=int(2 * s))

    lc.flush()

    if not clean_mode:
        bar_h = int(18 * s)
        lane_top = int(35 * s)
        lane_gap = int(3 * s)
        lane_occ: dict[tuple[str, int], bool] = {}

        for ev in cfg.get("events") or []:
            es = parse_local_date(ev.get("start"))
            ee = parse_local_date(ev.get("end"), es)
            if ee < es:
                es, ee = ee, es
            vis_days = []
            cur = max(es, grid_monday)
            last_vis = grid_monday + dt.timedelta(days=41)
            while cur <= min(ee, last_vis):
                vis_days.append(format_local_date(cur))
                cur += dt.timedelta(days=1)
            if not vis_days:
                continue

            chosen_lane = 0
            while chosen_lane < 2:
                if all(not lane_occ.get((ds, chosen_lane)) for ds in vis_days):
                    break
                chosen_lane += 1
            if chosen_lane >= 2:
                chosen_lane = 1
            for ds in vis_days:
                lane_occ[(ds, chosen_lane)] = True

            segs = []
            for ds in vis_days:
                cl = date_map.get(ds)
                if not cl:
                    continue
                if not segs or segs[-1]["row"] != cl["row"]:
                    segs.append({"row": cl["row"], "x1": cl["x1"] + int(5 * s), "x2": cl["x2"] - int(5 * s), "y1": cl["y1"], "first": len(segs) == 0})
                else:
                    segs[-1]["x2"] = cl["x2"] - int(5 * s)

            rgb = hex_to_rgb(ev.get("color", "#38bdf8"))
            for sg in segs:
                sy = sg["y1"] + lane_top + chosen_lane * (bar_h + lane_gap)
                lc.draw.rounded_rectangle((sg["x1"], sy, sg["x2"], sy + bar_h), radius=int(5 * s), fill=(rgb[0], rgb[1], rgb[2], 48), outline=(rgb[0], rgb[1], rgb[2], 220), width=1)
                if sg["first"]:
                    lc.text((sg["x1"] + int(6 * s), sy + int(1 * s)), str(ev.get("name", "")), "ui_bold", 12 * s, (241, 245, 249, 250), max_w=(sg["x2"] - sg["x1"]) - int(12 * s))

        ms_per_day: dict[str, int] = {}
        for ms in cfg.get("milestones") or []:
            ds = str(ms.get("date", ""))
            cl = date_map.get(ds)
            if not cl:
                continue
            idx = ms_per_day.get(ds, 0)
            ms_per_day[ds] = idx + 1
            if idx >= 1:
                continue
            rgb = hex_to_rgb(ms.get("color", "#f43f5e"))
            my = cl["y2"] - bar_h - int(6 * s)
            lbl, _ = fit_text(lc.draw, str(ms.get("name", "")), "ui_bold", 12 * s, cl["w"] - int(22 * s))
            mw = int(measure_w(lc.draw, lbl, "ui_bold", 12 * s) + int(14 * s))
            lc.draw.rounded_rectangle((cl["x1"] + int(5 * s), my, cl["x1"] + int(5 * s) + mw, my + bar_h), radius=int(5 * s), fill=(rgb[0], rgb[1], rgb[2], 232))
            lc.text((cl["x1"] + int(12 * s), my + int(1 * s)), lbl, "ui_bold", 12 * s, (7, 9, 16, 255))

        for mk in cfg.get("marks") or []:
            ds = str(mk.get("date", ""))
            cl = date_map.get(ds)
            if not cl or ds == format_local_date(today):
                continue
            tag_txt = clean_text(f"{mk.get('time') or mk.get('name', '')}")
            if not tag_txt:
                continue
            tag_fit, _ = fit_text(lc.draw, tag_txt, "ui_bold", 11 * s, cl["w"] * 0.48)
            tw = int(measure_w(lc.draw, tag_fit, "ui_bold", 11 * s) + int(10 * s))
            lc.pill(cl["x2"] - tw - int(5 * s), cl["y1"] + int(6 * s), tag_fit, "ui_bold", 11 * s, (244, 114, 182, 52), (251, 207, 232, 255), (244, 114, 182, 135), pad_x=int(5 * s), pad_y=int(2 * s))

    # ── Bottom Analytics Deck ──
    gap = int(20 * s)
    ana_top = cal_box[3] + gap
    ana_bot = bot_y
    left_card_w = int(full_w * 0.62)

    gh_box = (margin, ana_top, margin + left_card_w, ana_bot)
    lc.glass_card(gh_box, radius=int(20 * s), fill_rgba=card_fill, border_rgba=card_bd, accent_rgba=accent2)
    gh = telemetry.get("github") or {}
    gx, gy = gh_box[0] + int(24 * s), gh_box[1] + int(18 * s)
    lc.text((gx, gy), "本地代码热力图 // GITHUB 12-WEEK PULSE", "ui_bold", 21 * s, (248, 250, 252, 255))
    kpi_txt = f"{gh.get('total_commits', 0)} COMMITS  ·  {gh.get('active_days', 0)}D ACTIVE  ·  STREAK {gh.get('streak_days', 0)}D  ·  TODAY {gh.get('today_commits', 0)}"
    lc.text_right(gh_box[2] - int(24 * s), gy + int(4 * s), kpi_txt, "mono", 14 * s, (accent2[0], accent2[1], accent2[2], 240))

    hm_w = int((left_card_w - int(60 * s)) * 0.66)
    hm_h = (ana_bot - ana_top) - int(74 * s)
    _draw_heatmap_grid(lc, gx, gy + int(50 * s), hm_w, hm_h, gh, palette, s)

    repo_x = gx + hm_w + int(28 * s)
    repo_w = gh_box[2] - int(24 * s) - repo_x
    lc.text((repo_x, gy + int(46 * s)), "TOP ACTIVE REPOS (12W)", "mono_bold", 13 * s, (148, 163, 184, 220))
    top_repos = gh.get("top_repos") or []
    max_rc = max([r["commits"] for r in top_repos] or [1])
    ry = gy + int(76 * s)
    for rp in top_repos[:5]:
        if ry + int(42 * s) > ana_bot - int(12 * s):
            break
        lc.text((repo_x, ry), rp["name"], "mono", 14 * s, (226, 232, 240, 245), max_w=repo_w - int(55 * s))
        lc.text_right(repo_x + repo_w, ry, str(rp["commits"]), "mono", 14 * s, (accent2[0], accent2[1], accent2[2], 235))
        lc.progress_bar(repo_x, ry + int(22 * s), repo_w, int(6 * s), (rp["commits"] / max_rc) * 100.0, (accent[0], accent[1], accent[2], 225))
        ry += int(42 * s)

    th_box = (gh_box[2] + gap, ana_top, width - margin, ana_bot)
    lc.glass_card(th_box, radius=int(20 * s), fill_rgba=card_fill, border_rgba=card_bd, accent_rgba=accent)
    tx, ty = th_box[0] + int(24 * s), th_box[1] + int(18 * s)
    th = telemetry.get("thesis") or {}
    pp = telemetry.get("papers") or {}

    lc.text((tx, ty), "论文与文献总览 // THESIS & REFS", "ui_bold", 21 * s, (248, 250, 252, 255))

    ring_r = int(68 * s)
    ring_cx = tx + ring_r + int(12 * s)
    ring_cy = ty + int(132 * s)
    pct = float(th.get("pct", 0.0))
    lc.ring_aa(ring_cx, ring_cy, ring_r, int(14 * s), pct, accent)

    pct_str = f"{pct:.0f}%"
    pw_r = measure_w(lc.draw, pct_str, "num", 32 * s)
    lc.text((ring_cx - pw_r * 0.5, ring_cy - int(22 * s)), pct_str, "num", 32 * s, (248, 250, 252, 255))
    sub_r = f"{th.get('total_cjk', 0)//1000}k/{int(th.get('target_words', 40000))//1000}k"
    sw_r = measure_w(lc.draw, sub_r, "mono", 13 * s)
    lc.text((ring_cx - sw_r * 0.5, ring_cy + int(14 * s)), sub_r, "mono", 13 * s, (148, 163, 184, 225))

    list_x = ring_cx + ring_r + int(26 * s)
    list_w = th_box[2] - int(22 * s) - list_x
    cy = ty + int(52 * s)
    chapters = th.get("chapters") or []
    max_ch = max([c["cjk"] for c in chapters] or [1])
    for ch in chapters[:7]:
        if cy + int(25 * s) > ana_bot - int(58 * s):
            break
        lc.text((list_x, cy), ch["label"], "ui", 13 * s, (226, 232, 240, 235), max_w=int(130 * s))
        bx = list_x + int(136 * s)
        bw = max(40, list_w - int(196 * s))
        lc.progress_bar(bx, cy + int(5 * s), bw, int(6 * s), (ch["cjk"] / max_ch) * 100.0, (accent2[0], accent2[1], accent2[2], 225))
        lc.text_right(th_box[2] - int(22 * s), cy + int(1 * s), f"{ch['cjk']:,}", "mono", 12 * s, (148, 163, 184, 225))
        cy += int(24 * s)

    ref_y = ana_bot - int(46 * s)
    lc.draw.line((tx, ref_y - int(8 * s), th_box[2] - int(24 * s), ref_y - int(8 * s)), fill=(255, 255, 255, 24), width=1)
    ref_str = f"文献库: {pp.get('total_docs', 0)} 篇 ({pp.get('total_pages', 0):,} 页)  ·  今日新增 +{pp.get('today_count', 0)}"
    lc.text((tx, ref_y), ref_str, "ui_bold", 14 * s, (accent2[0], accent2[1], accent2[2], 240))

    return lc.final_rgb()


# ─────────────────────────────────────────────
# 3) 二号机 (RTX 5080)：极简通透算力舱（>60% 星空留白 + 负载变色 + 底部悬浮 Dock）
# ─────────────────────────────────────────────

def render_m2_main(cfg: dict[str, Any], telemetry: dict[str, Any], width: int = 2560, height: int = 1440) -> Image.Image:
    s = width / 2560.0
    palette = resolve_theme(cfg, "m2_main", telemetry)
    accent = palette["accent"]
    accent2 = palette["accent2"]
    m2 = telemetry.get("m2") or {}
    busy = bool(m2.get("busy"))
    sprint_mode = (cfg.get("mode", "daily") == "sprint")

    orbs = [
        (0.14, 0.16, 0.50, 72 if busy else 52),
        (0.86, 0.22, 0.48, 66 if busy else 48),
        (0.50, 0.90, 0.56, 68 if busy else 46),
    ]
    bd_path, bg_br, bg_bl, bg_vig = _resolve_screen_backdrop(cfg, "m2_main")
    base, has_bd = create_ambient_canvas(
        width, height, palette, orbs,
        glow_intensity=int(cfg.get("glowIntensity", 100)),
        sprint_vignette=busy or sprint_mode,
        backdrop_path=bd_path,
        bg_brightness=bg_br,
        bg_blur=bg_bl,
        bg_vignette=bg_vig,
    )
    lc = LayerCanvas(base)

    margin = int(58 * s)
    top_y = int(42 * s)
    bot_y = height - int(74 * s)
    full_w = width - margin * 2
    today = today_local()
    weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

    # ── Top Strip (minimal, unboxed over top scrim, preserving >60% open starry sky!) ──
    lc.text((margin, top_y), "NODE-02 // RTX 5080", "num", 38 * s, (248, 250, 252, 255), shadow=True)
    lc.text((margin, top_y + int(48 * s)), f"{today.year}.{today.month:02d}.{today.day:02d}  {weekdays[today.weekday()]}  //  COMPUTE DECK", "mono", 15 * s, (203, 213, 225, 230), shadow=True)

    _draw_header_badges(
        lc, width - margin, top_y + int(8 * s),
        cfg, palette, telemetry.get("collected_hm", "--:--"), s,
        extra_tag=palette["label"],
    )

    # ── Bottom Floating Minimal Glass Dock (height = 316*s, leaves >68% open sky!) ──
    dock_h = int(316 * s)
    dock_y1 = bot_y - dock_h
    dock_y2 = bot_y
    show_nas = bool(cfg.get("m2ShowNas", True))
    card_fill = (8, 12, 22, 152) if has_bd else (12, 16, 29, 174)
    card_bd = (255, 255, 255, 38)

    g2 = m2.get("gpu") or {}
    comfy = m2.get("comfy") or {}
    ram2 = m2.get("ram") or {}
    disks2 = m2.get("disks") or []

    if show_nas:
        gap = int(24 * s)
        left_w = int(full_w * 0.61)
        gpu_box = (margin, dock_y1, margin + left_w, dock_y2)
        nas_box = (gpu_box[2] + gap, dock_y1, width - margin, dock_y2)
    else:
        left_w = int(full_w * 0.62)
        gx_start = (width - left_w) // 2
        gpu_box = (gx_start, dock_y1, gx_start + left_w, dock_y2)
        nas_box = None

    # Dock Card 1: RTX 5080 + ComfyUI + Local Disks ONLY
    lc.glass_card(
        gpu_box, radius=int(22 * s),
        fill_rgba=card_fill,
        border_rgba=(accent[0], accent[1], accent[2], 120) if busy else card_bd,
        accent_rgba=accent,
        border_width=2 if busy else 1,
    )
    x1, y1 = gpu_box[0] + int(28 * s), gpu_box[1] + int(22 * s)
    inner_w = (gpu_box[2] - gpu_box[0]) - int(56 * s)

    lc.status_dot(x1 + int(8 * s), y1 + int(14 * s), 6 * s, m2.get("agent_online", False), busy)
    lc.text((x1 + int(26 * s), y1), "RTX 5080 LAPTOP // COMFYUI", "ui_bold", 22 * s, (248, 250, 252, 255))

    comfy_txt = f"ComfyUI v{comfy.get('version', '?')}  ·  RUN {comfy.get('running', 0)}  ·  PEND {comfy.get('pending', 0)}" if comfy.get("online") else "ComfyUI :8188 OFFLINE"
    cp_w = int(measure_w(lc.draw, comfy_txt, "mono_bold", 13 * s) + 22 * s)
    lc.pill(
        gpu_box[2] - int(28 * s) - cp_w, y1 + int(1 * s),
        comfy_txt, "mono_bold", 13 * s,
        (249, 115, 22, 46) if comfy.get("running", 0) > 0 else ((16, 185, 129, 36) if comfy.get("online") else (248, 113, 113, 32)),
        (254, 215, 170, 255) if comfy.get("running", 0) > 0 else ((167, 243, 208, 255) if comfy.get("online") else (254, 202, 202, 240)),
        (16, 185, 129, 95) if comfy.get("online") else None,
        pad_x=int(11 * s), pad_y=int(5 * s),
    )

    if g2.get("ok"):
        u_str = f"{g2.get('util_pct', 0)}%"
        lc.text((x1, y1 + int(46 * s)), u_str, "num", 48 * s, (accent[0], accent[1], accent[2], 255))
        uw = measure_w(lc.draw, u_str, "num", 48 * s)
        lc.text((x1 + uw + int(18 * s), y1 + int(64 * s)), f"TEMP {g2.get('temp_c', 0)}C   ·   {g2.get('power_w', 0):.0f}W   ·   RAM {ram2.get('used_gb', 0):.1f}/{ram2.get('total_gb', 0):.0f}G ({ram2.get('pct', 0)}%)", "mono", 16 * s, (203, 213, 225, 240))

        vram_line_y = y1 + int(118 * s)
        lc.text((x1, vram_line_y), "VRAM ALLOCATION", "mono_bold", 14 * s, (148, 163, 184, 220))
        lc.text_right(gpu_box[2] - int(28 * s), vram_line_y, f"{g2.get('vram_used_mb', 0)/1024:.1f} / {g2.get('vram_total_mb', 16303)/1024:.1f} GB ({g2.get('vram_pct', 0):.0f}%)", "mono_bold", 15 * s, (241, 245, 249, 245))
        lc.progress_bar(x1, vram_line_y + int(25 * s), inner_w, int(10 * s), float(g2.get("vram_pct", 0)), (accent[0], accent[1], accent[2], 240))
    else:
        lc.text((x1, y1 + int(62 * s)), "AGENT STANDBY", "num", 40 * s, (148, 163, 184, 215))

    # Side-by-side local C:\ and D:\ disk bars at bottom of GPU card
    disk_y = dock_y2 - int(74 * s)
    lc.draw.line((x1, disk_y - int(16 * s), gpu_box[2] - int(28 * s), disk_y - int(16 * s)), fill=(255, 255, 255, 20), width=1)
    if disks2:
        d_gap = int(28 * s)
        d_w = (inner_w - d_gap) // max(1, min(2, len(disks2)))
        for idx, d in enumerate(disks2[:2]):
            dx = x1 + idx * (d_w + d_gap)
            lc.text((dx, disk_y), f"DISK {d['drive']}:\\", "mono_bold", 14 * s, (226, 232, 240, 240))
            lc.text_right(dx + d_w, disk_y, f"余 {d['free_gb']:.0f}G / {d['total_gb']:.0f}G", "ui", 14 * s, (148, 163, 184, 230))
            lc.progress_bar(dx, disk_y + int(24 * s), d_w, int(7 * s), float(d.get("pct", 0)), (accent2[0], accent2[1], accent2[2], 220))

    # Dock Card 2: Compact UGREEN NAS
    if nas_box is not None:
        lc.glass_card(nas_box, radius=int(22 * s), fill_rgba=card_fill, border_rgba=card_bd, accent_rgba=(52, 211, 153))
        x3, y3 = nas_box[0] + int(28 * s), nas_box[1] + int(22 * s)
        nas_w = (nas_box[2] - nas_box[0]) - int(56 * s)
        nas = telemetry.get("nas") or {}

        lc.status_dot(x3 + int(8 * s), y3 + int(14 * s), 6 * s, nas.get("ok", False), False)
        lc.text((x3 + int(26 * s), y3), "绿联 NAS // DXP4800+", "ui_bold", 22 * s, (248, 250, 252, 255))
        lc.text_right(nas_box[2] - int(28 * s), y3 + int(4 * s), f"LOAD {nas.get('load_avg', '--')}", "mono", 14 * s, (148, 163, 184, 225))

        lc.text((x3, y3 + int(46 * s)), f"UP: {nas.get('uptime_str', '--')}", "num", 26 * s, (52, 211, 153, 245), max_w=nas_w)
        lc.text((x3, y3 + int(92 * s)), "/volume1 STORAGE", "mono_bold", 14 * s, (148, 163, 184, 220))
        lc.text_right(nas_box[2] - int(28 * s), y3 + int(92 * s), f"{nas.get('vol_used_gb', 0)} / {nas.get('vol_total_gb', 0)} GB ({nas.get('vol_pct', 0)}%)", "mono_bold", 14 * s, (241, 245, 249, 240))
        lc.progress_bar(x3, y3 + int(117 * s), nas_w, int(9 * s), float(nas.get("vol_pct", 0)), (52, 211, 153, 230))

        svcs = nas.get("services") or []
        sx_start, sy_start = x3, dock_y2 - int(104 * s)
        pill_col_w = (nas_w - int(14 * s)) // 2
        for idx, sv in enumerate(svcs[:4]):
            px_i = sx_start + (idx % 2) * (pill_col_w + int(14 * s))
            py_i = sy_start + (idx // 2) * int(42 * s)
            up = bool(sv.get("up"))
            lc.draw.rounded_rectangle(
                (px_i, py_i, px_i + pill_col_w, py_i + int(34 * s)),
                radius=int(9 * s),
                fill=(16, 185, 129, 32) if up else (248, 113, 113, 26),
                outline=(52, 211, 153, 100) if up else (248, 113, 113, 100),
                width=1,
            )
            lc.status_dot(px_i + int(14 * s), py_i + int(17 * s), 4 * s, up, False)
            lc.text((px_i + int(26 * s), py_i + int(7 * s)), f"{sv['name']} :{sv['port']}", "ui_bold", 14 * s, (241, 245, 249, 245))

    return lc.final_rgb()
