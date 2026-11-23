# -*- coding: utf-8 -*-
"""
JH-WallCraft v2 数据采集层。

并发采集本地 GitHub 热力图、硕士论文字数、最近文献库论文、
一号机 GPU/系统指标、二号机 5080 + ComfyUI 指标，以及绿联 NAS 状态。
任何外部节点离线均优雅降级，确保壁纸渲染永不中断。
"""

from __future__ import annotations

import collections
import ctypes
import datetime as dt
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from wallcraft_config import CACHE_DIR, format_local_date, now_local, today_local


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


def _read_cache(name: str, max_age_sec: int, force: bool = False) -> dict | None:
    if force:
        return None
    p = CACHE_DIR / name
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if time.time() - float(data.get("_cached_at", 0)) <= max_age_sec:
            return data
    except Exception:
        pass
    return None


def _write_cache(name: str, payload: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        out = dict(payload)
        out["_cached_at"] = time.time()
        (CACHE_DIR / name).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _git_log_repo(repo_path: Path, since_days: int) -> tuple[str, list[str]]:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo_path), "log", f"--since={since_days} days ago", "--format=%ad", "--date=short"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=6,
            creationflags=flags,
        )
        if proc.returncode != 0:
            return repo_path.name, []
        return repo_path.name, [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
    except Exception:
        return repo_path.name, []


def collect_github_heatmap(github_root: str | Path, weeks: int = 12, force: bool = False) -> dict[str, Any]:
    """Scan local GitHub repositories in parallel to build a 12-week commit heatmap."""
    cached = _read_cache("github_cache.json", max_age_sec=120, force=force)
    if cached is not None:
        return cached

    root = Path(github_root)
    today = today_local()
    current_monday = today - dt.timedelta(days=today.weekday())
    grid_start = current_monday - dt.timedelta(weeks=weeks - 1)
    total_days = weeks * 7
    since_days = (today - grid_start).days + 2

    repos: list[Path] = []
    if root.exists():
        for entry in root.iterdir():
            if entry.is_dir() and not entry.name.startswith("_") and (entry / ".git").exists():
                repos.append(entry)

    daily = collections.Counter()
    repo_totals = collections.Counter()
    if repos:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for name, dates in pool.map(lambda p: _git_log_repo(p, since_days), repos):
                for d_str in dates:
                    daily[d_str] += 1
                    repo_totals[name] += 1

    # Build aligned week x weekday cells
    cells: list[dict[str, Any]] = []
    for offset in range(total_days):
        day = grid_start + dt.timedelta(days=offset)
        ds = format_local_date(day)
        is_future = day > today
        cnt = 0 if is_future else int(daily.get(ds, 0))
        cells.append({
            "date": ds,
            "week": offset // 7,
            "dow": offset % 7,
            "count": cnt,
            "future": is_future,
        })

    # Compute current streak (ending today or yesterday if today=0)
    streak = 0
    cursor = today
    if daily.get(format_local_date(today), 0) == 0:
        cursor = today - dt.timedelta(days=1)
    while cursor >= grid_start and daily.get(format_local_date(cursor), 0) > 0:
        streak += 1
        cursor -= dt.timedelta(days=1)

    grid_counts = [c["count"] for c in cells if not c["future"]]
    active_days = sum(1 for c in grid_counts if c > 0)
    total_commits = sum(grid_counts)
    today_commits = int(daily.get(format_local_date(today), 0))
    max_daily = max(grid_counts) if grid_counts else 0

    top_repos = [{"name": n, "commits": c} for n, c in repo_totals.most_common(5) if c > 0]
    result = {
        "ok": True,
        "weeks": weeks,
        "repo_count": len(repos),
        "total_commits": total_commits,
        "active_days": active_days,
        "today_commits": today_commits,
        "streak_days": streak,
        "max_daily": max_daily,
        "top_repos": top_repos,
        "cells": cells,
    }
    _write_cache("github_cache.json", result)
    return result


def collect_thesis_stats(thesis_dir: str | Path, target_words: int = 40000) -> dict[str, Any]:
    """Parse 00..06 markdown chapters in JH-Thesis and compute CJK character counts."""
    base = Path(thesis_dir)
    chapters: list[dict[str, Any]] = []
    total_cjk = 0
    total_eng = 0
    latest_mtime = 0.0

    if base.exists():
        files = sorted(p for p in base.iterdir() if p.is_file() and re.match(r"^0[0-9]-.*\.md$", p.name))
        for p in files:
            try:
                txt = p.read_text(encoding="utf-8", errors="ignore")
                mtime = p.stat().st_mtime
                latest_mtime = max(latest_mtime, mtime)
            except Exception:
                continue
            clean = re.sub(r"```[\s\S]*?```", "", txt)
            clean = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", clean)
            clean = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", clean)
            clean = re.sub(r"<[^>]+>", "", clean)
            cjk = len(re.findall(r"[\u4e00-\u9fff]", clean))
            eng = len(re.findall(r"[A-Za-z0-9]+", clean))
            total_cjk += cjk
            total_eng += eng
            short_title = re.sub(r"\.md$", "", p.name)
            chapters.append({
                "file": p.name,
                "label": short_title,
                "cjk": cjk,
                "eng": eng,
                "updated": dt.datetime.fromtimestamp(mtime).strftime("%m-%d %H:%M"),
            })

    pct = round(min(100.0, (total_cjk / max(1, target_words)) * 100), 1)
    updated_str = dt.datetime.fromtimestamp(latest_mtime).strftime("%m-%d %H:%M") if latest_mtime > 0 else "--"
    return {
        "ok": len(chapters) > 0,
        "total_cjk": total_cjk,
        "total_eng": total_eng,
        "target_words": target_words,
        "pct": pct,
        "updated": updated_str,
        "chapters": chapters,
    }


def _clean_paper_title(title: str) -> str:
    t = (title or "Untitled").strip()
    t = re.sub(r"\.pdf$", "", t, flags=re.IGNORECASE)
    t = t.replace("_", " ")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def collect_recent_papers(db_path: str | Path, limit: int = 10) -> dict[str, Any]:
    """Read newest grabbed papers from references.sqlite in strict read-only URI mode."""
    p = Path(db_path)
    if not p.exists():
        return {"ok": False, "total_docs": 0, "total_pages": 0, "today_count": 0, "papers": []}

    today_str = format_local_date(today_local())
    uri = p.resolve().as_uri() + "?mode=ro"
    con = None
    try:
        con = sqlite3.connect(uri, uri=True, timeout=2.0)
        total_docs = int(con.execute("SELECT COUNT(*) FROM documents").fetchone()[0] or 0)
        total_pages = int(con.execute("SELECT COALESCE(SUM(pages), 0) FROM documents").fetchone()[0] or 0)

        rows = con.execute(
            """
            SELECT d.title, d.authors, d.year, d.pages, MAX(s.mtime_ns) AS mt
            FROM documents d
            JOIN sources s ON d.id = s.doc_id
            GROUP BY d.id
            ORDER BY mt DESC
            LIMIT ?
            """,
            (int(limit),),
        ).fetchall()

        # Also count papers added today
        today_start = dt.datetime.combine(today_local(), dt.time.min).timestamp() * 1e9
        today_row = con.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT d.id, MAX(s.mtime_ns) AS mt
                FROM documents d JOIN sources s ON d.id = s.doc_id
                GROUP BY d.id HAVING mt >= ?
            )
            """,
            (today_start,),
        ).fetchone()
        today_count = int(today_row[0] or 0) if today_row else 0

        papers = []
        for title, authors, year, pages, mt in rows:
            dt_obj = dt.datetime.fromtimestamp(mt / 1e9) if mt else None
            date_str = dt_obj.strftime("%Y-%m-%d") if dt_obj else ""
            time_str = dt_obj.strftime("%m-%d %H:%M") if dt_obj else ""
            papers.append({
                "title": _clean_paper_title(str(title or "")),
                "authors": str(authors or "").strip(),
                "year": str(year or "").strip(),
                "pages": int(pages or 0),
                "date": date_str,
                "added_at": time_str,
                "is_today": date_str == today_str,
            })

        return {
            "ok": True,
            "total_docs": total_docs,
            "total_pages": total_pages,
            "today_count": today_count,
            "papers": papers,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "total_docs": 0, "total_pages": 0, "today_count": 0, "papers": []}
    finally:
        if con is not None:
            try:
                con.close()
            except Exception:
                pass


def collect_local_gpu() -> dict[str, Any]:
    """Collect Machine 1 GPU (RTX 4090), RAM, and C/D disk stats."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    gpu: dict[str, Any] = {"ok": False, "name": "RTX 4090"}
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
        if proc.returncode == 0 and proc.stdout.strip():
            parts = [p.strip() for p in proc.stdout.strip().splitlines()[0].split(",")]
            if len(parts) >= 6:
                mu, mt = float(parts[2]), float(parts[3])
                gpu = {
                    "ok": True,
                    "name": parts[0],
                    "util_pct": int(float(parts[1])),
                    "vram_used_mb": int(mu),
                    "vram_total_mb": int(mt),
                    "vram_pct": round((mu / mt) * 100, 1) if mt > 0 else 0.0,
                    "temp_c": int(float(parts[4])),
                    "power_w": round(float(parts[5]), 1) if parts[5] not in ("", "[N/A]") else 0.0,
                }
    except Exception as exc:
        gpu["error"] = str(exc)

    ram = {"total_gb": 0.0, "used_gb": 0.0, "pct": 0}
    stat = _MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
        ram = {
            "total_gb": round(stat.ullTotalPhys / (1024**3), 1),
            "used_gb": round((stat.ullTotalPhys - stat.ullAvailPhys) / (1024**3), 1),
            "pct": int(stat.dwMemoryLoad),
        }

    disks = []
    for letter in ("C", "D"):
        try:
            u = shutil.disk_usage(f"{letter}:\\")
            disks.append({
                "drive": letter,
                "total_gb": round(u.total / (1024**3), 1),
                "used_gb": round(u.used / (1024**3), 1),
                "free_gb": round(u.free / (1024**3), 1),
                "pct": round((u.used / u.total) * 100, 1) if u.total > 0 else 0.0,
            })
        except OSError:
            pass

    return {"ok": gpu.get("ok", False), "gpu": gpu, "ram": ram, "disks": disks}


def _http_get_json(url: str, headers: dict[str, str] | None = None, timeout: float = 2.5) -> dict | None:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def collect_machine2(cfg: dict[str, Any]) -> dict[str, Any]:
    """Collect Machine 2 metrics from WallCraftAgent (:18766) and ComfyUI (:8188)."""
    m2_cfg = cfg.get("nodes", {}).get("m2", {})
    if not m2_cfg.get("enabled", True):
        return {"ok": False, "agent_online": False, "comfy_online": False, "busy": False}

    host = m2_cfg.get("host", "192.168.3.222")
    agent_port = int(m2_cfg.get("agentPort", 18766))
    comfy_port = int(m2_cfg.get("comfyPort", 8188))
    token = m2_cfg.get("token", "")

    agent_data: dict[str, Any] = {}
    agent_online = False
    try:
        agent_data = _http_get_json(
            f"http://{host}:{agent_port}/metrics",
            headers={"X-WallCraft-Token": token},
            timeout=5.0,
        ) or {}
        agent_online = bool(agent_data.get("ok"))
    except Exception:
        agent_online = False

    comfy_online = False
    comfy_version = ""
    queue_running = 0
    queue_pending = 0
    comfy_vram_free_gb = 0.0
    comfy_vram_total_gb = 0.0
    try:
        stats = _http_get_json(f"http://{host}:{comfy_port}/system_stats", timeout=2.0)
        if stats:
            comfy_online = True
            comfy_version = str(stats.get("system", {}).get("comfyui_version", ""))
            devs = stats.get("devices") or []
            if devs:
                comfy_vram_free_gb = round(devs[0].get("vram_free", 0) / (1024**3), 1)
                comfy_vram_total_gb = round(devs[0].get("vram_total", 0) / (1024**3), 1)
        q = _http_get_json(f"http://{host}:{comfy_port}/queue", timeout=2.0)
        if q:
            queue_running = len(q.get("queue_running") or [])
            queue_pending = len(q.get("queue_pending") or [])
    except Exception:
        pass

    gpu = agent_data.get("gpu") or {"ok": False, "name": "RTX 5080 Laptop"}
    util_pct = int(gpu.get("util_pct", 0) or 0)
    vram_pct = float(gpu.get("vram_pct", 0.0) or 0.0)
    busy = bool(queue_running > 0 or util_pct >= 45 or vram_pct >= 65.0)

    return {
        "ok": agent_online or comfy_online,
        "agent_online": agent_online,
        "comfy_online": comfy_online,
        "busy": busy,
        "gpu": gpu,
        "ram": agent_data.get("ram") or {"total_gb": 0.0, "used_gb": 0.0, "pct": 0},
        "disks": agent_data.get("disks") or [],
        "monitors": agent_data.get("monitors") or [],
        "comfy": {
            "online": comfy_online,
            "version": comfy_version,
            "running": queue_running,
            "pending": queue_pending,
            "vram_free_gb": comfy_vram_free_gb,
            "vram_total_gb": comfy_vram_total_gb,
        },
    }


def _tcp_probe(host: str, port: int, timeout: float = 0.6) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def collect_nas(cfg: dict[str, Any], force: bool = False) -> dict[str, Any]:
    """Probe NAS LAN service ports and fetch 10-min cached uptime + /volume1 disk usage via SSH."""
    nas_cfg = cfg.get("nodes", {}).get("nas", {})
    if not nas_cfg.get("enabled", True):
        return {"ok": False}

    host = nas_cfg.get("host", "192.168.3.225")
    ports = [
        ("大肥鱼 QQ", 6099),
        ("霁月 QQ", 6100),
        ("UGOS Web", 80),
        ("Proxy", 17891),
    ]
    with ThreadPoolExecutor(max_workers=4) as pool:
        probes = list(pool.map(lambda item: (item[0], item[1], _tcp_probe(host, item[1])), ports))
    services = [{"name": name, "port": port, "up": up} for name, port, up in probes]

    # 10-minute cached SSH query for uptime + /volume1 storage
    ssh_cache = _read_cache("nas_ssh_cache.json", max_age_sec=600, force=force)
    if ssh_cache is None:
        ssh_tool = cfg.get("paths", {}).get("sshTool", "")
        ssh_data: dict[str, Any] = {"ssh_ok": False, "uptime_str": "--", "load_avg": "--", "vol_used_gb": 0, "vol_total_gb": 0, "vol_pct": 0}
        if ssh_tool and Path(ssh_tool).exists():
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            try:
                proc = subprocess.run(
                    [
                        "python", "-X", "utf8", ssh_tool, "run", "nas",
                        "--command", "uptime; df -BG /volume1 | tail -n 1",
                        "--timeout", "10",
                    ],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=14,
                    creationflags=flags,
                )
                if proc.returncode == 0 and proc.stdout:
                    lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
                    for ln in lines:
                        if "load average" in ln:
                            m_up = re.search(r"up\s+(.+?),\s+\d+\s+user", ln)
                            m_ld = re.search(r"load average:\s*([0-9.,\s]+)", ln)
                            if m_up:
                                ssh_data["uptime_str"] = m_up.group(1).strip()
                            if m_ld:
                                ssh_data["load_avg"] = m_ld.group(1).split(",")[0].strip()
                        elif "/volume1" in ln or "G" in ln:
                            parts = ln.split()
                            if len(parts) >= 5 and parts[1].endswith("G"):
                                try:
                                    tot = int(parts[1].rstrip("G"))
                                    used = int(parts[2].rstrip("G"))
                                    pct = int(parts[4].rstrip("%"))
                                    ssh_data["vol_total_gb"] = tot
                                    ssh_data["vol_used_gb"] = used
                                    ssh_data["vol_pct"] = pct
                                except ValueError:
                                    pass
                    ssh_data["ssh_ok"] = True
            except Exception:
                pass
        if ssh_data.get("ssh_ok"):
            _write_cache("nas_ssh_cache.json", ssh_data)
        ssh_cache = ssh_data

    any_up = any(s["up"] for s in services) or bool(ssh_cache.get("ssh_ok"))
    return {
        "ok": any_up,
        "name": nas_cfg.get("name", "DXP4800PLUS-JH"),
        "host": host,
        "services": services,
        "uptime_str": ssh_cache.get("uptime_str", "--"),
        "load_avg": ssh_cache.get("load_avg", "--"),
        "vol_used_gb": ssh_cache.get("vol_used_gb", 0),
        "vol_total_gb": ssh_cache.get("vol_total_gb", 0),
        "vol_pct": ssh_cache.get("vol_pct", 0),
    }


def collect_all(cfg: dict[str, Any], force: bool = False) -> dict[str, Any]:
    """Collect all telemetry sources concurrently without throwing on node outages."""
    paths = cfg.get("paths", {})
    with ThreadPoolExecutor(max_workers=6) as pool:
        f_gh = pool.submit(collect_github_heatmap, paths.get("githubRoot", ""), 12, force)
        f_th = pool.submit(collect_thesis_stats, paths.get("thesisDir", ""), int(cfg.get("thesisTargetWords", 40000)))
        f_pp = pool.submit(collect_recent_papers, paths.get("papersDb", ""), 10)
        f_m1 = pool.submit(collect_local_gpu)
        f_m2 = pool.submit(collect_machine2, cfg)
        f_nas = pool.submit(collect_nas, cfg, force)

        return {
            "collected_at": now_local().strftime("%Y-%m-%d %H:%M:%S"),
            "collected_hm": now_local().strftime("%H:%M"),
            "github": f_gh.result(),
            "thesis": f_th.result(),
            "papers": f_pp.result(),
            "m1": f_m1.result(),
            "m2": f_m2.result(),
            "nas": f_nas.result(),
        }


if __name__ == "__main__":
    from wallcraft_config import load_config
    data = collect_all(load_config(), force=True)
    summary = {
        "collected_at": data["collected_at"],
        "github": {k: v for k, v in data["github"].items() if k != "cells"},
        "thesis": {k: v for k, v in data["thesis"].items() if k != "chapters"},
        "thesis_chapters": len(data["thesis"].get("chapters", [])),
        "papers_meta": {k: v for k, v in data["papers"].items() if k != "papers"},
        "papers_top3": [p["title"][:45] for p in data["papers"].get("papers", [])[:3]],
        "m1": data["m1"],
        "m2": data["m2"],
        "nas": data["nas"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
