# AGENTS.md · JH-WallCraft v2 AI 协作上下文导航

本文档为 `JH-WallCraft`（双机多屏极客玻璃态日程与数据看板壁纸系统）的 AI 协作上下文导航与工程规范。

---

## 1. 系统架构与三屏分工

`JH-WallCraft v3` 采用 **一号机 Wallpaper Engine 超低开销实时网页壁纸 + 二号机事件驱动智能静态同步 + 单一真实配置源 (`wallcraft_config.json`)**：

1. **一号机 · 右屏主屏 (`JH-WallCraft-Right`, WE Monitor 0, `2560×1440`) — 实时交互 Focus HUD**
   - 底图经 `/api/backdrop-image/m1_right` 叠底，无 `requestAnimationFrame`、无 WebGL、无连续 CSS 动画，全屏/最大化应用时随 Wallpaper Engine 自动暂停全部定时器（零后台开销）。
   - 支持 **1 秒本地时钟**、**3 秒 `RTX 4090 / 内存 / 磁盘` 实时遥测**（`/api/live-fast` 服务端 2s 共享缓存）、**桌面直接点击勾选待办**（`/api/todo-toggle`）与切换模式（`/api/mode`）。
2. **一号机 · 左屏副屏 (`JH-WallCraft-Left`, WE Monitor 1, `1920×1200`) — 实时日历与代码热力图**
   - 滚动 6 周作战日历（跨午夜自动滚动高亮）、交互式 12 周 GitHub 热力图（悬停显示单日提交次数）、`JH-Thesis` SVG 进度环与文献库总览。
3. **二号机 (`m2_main`, `192.168.3.222`, `2560×1440`) — 极简算力舱（0 显存占用静态方案）**
   - 二号机未安装 Wallpaper Engine，由一号机 `wallpaper_server.py` 后台守护线程每 20 秒低开销巡检 `5080 + ComfyUI + NAS`，仅在队列/负载状态跃迁或 120 秒心跳时重绘并推送 PNG（计划任务 `JH-WallCraft-AutoSync` 仅作 `--targets m2` 兜底）。

---

## 2. 仓库目录与文件索引

```text
JH-WallCraft/
├── wallcraft_config.py        # 统一配置加载/原子保存与本地日期工具（严格禁止 UTC 偏移解析）
├── wallcraft_config.example.json # 公开配置模板（真实配置写入已 gitignore 的 wallcraft_config.json）
├── wallcraft_backdrops.py     # Steam Wallpaper Engine 精选底图目录、ffmpeg 抽帧与模糊暗角缓存
├── wallcraft_win.py           # Windows IDesktopWallpaper COM 多显示器分屏控制 + A/B ping-pong 防缓存
├── wallcraft_agent.py         # 二号机纯 stdlib 交互会话代理 (TCP 18766, X-WallCraft-Token 鉴权)
├── wallcraft_collectors.py    # 并发采集：GitHub热力图 / JH-Thesis字数 / references.sqlite / 4090 / 5080+Comfy / NAS
├── wallcraft_renderer.py      # Pillow 13 极客深色毛玻璃渲染引擎（透明图层 alpha_composite + CJK 字体守卫）
├── wallcraft_sync.py          # 主控 CLI 同步工具（支持单独 --targets m2 同步）
├── deploy_we.py               # Wallpaper Engine 双屏 Web 项目安装与应用工具
├── we_projects/               # Wallpaper Engine 实时 Web 壁纸源码（Right / Left / shared）
├── wallpaper_server.py        # 一号机本地实时遥测/控制服务 (127.0.0.1:18766) + 二号机守护线程
├── index.html / style.css / app.js # 纯原生零构建极客毛玻璃 Web 控制台
├── gen_wallpaper.js / wallpaper-engine.js # v1 遗留脚本（保留参考）
└── README.md / AGENTS.md
```

---

## 3. 工程红线与避坑规范

1. **本地日期解析红线**：严禁使用 `new Date("YYYY-MM-DD")` 等隐式 UTC 解析；Python 端统一使用 `wallcraft_config.parse_local_date()` 与 `today_local()`。
2. **Pillow RGBA 混色与中文字体红线**：
   - 半透明元素必须经 `LayerCanvas`（独立透明 `(0,0,0,0)` 图层 + `Image.alpha_composite`）合成，禁止对全透明底之外的 RGBA 画布直接画半透明形状后丢弃 Alpha。
   - 含中文的字符串必须由 `font_for()` 自动切换至 `msyh.ttc` / `msyhbd.ttc`，且过滤非 BMP Emoji，防止豆腐块。
3. **无窗口 `pythonw.exe` 运行安全**：后台服务与代理不可假设 `sys.stdout` / `sys.stderr` 非 `None`，所有日志写入 `.cache/server.log` 或 `agent.log` 并做空值保护。
4. **隐私与凭据安全**：`wallcraft_config.json`、`.wallcraft_secret`、`agent_token.txt`、`.cache/`、`output/` 均在 `.gitignore` 中忽略，禁止提交到仓库或硬编码进源码；`references.sqlite` 必须以只读 URI (`?mode=ro`) 打开。
5. **双机桌面会话机制**：Windows `IDesktopWallpaper` COM 接口必须在交互式桌面会话内调用。一号机使用计划任务 `JH-WallCraft-Server`（登录自启）和 `JH-WallCraft-AutoSync`（每 5 分钟刷新）；二号机通过 `JH-WallCraft-Agent` 交互式计划任务接收局域网 Token 鉴权推送。

---

## 4. 常用命令与接口

```powershell
# 1. 仅本地渲染三屏预览图到 output/（不修改桌面）
python -X utf8 wallcraft_sync.py --targets all --preview-only --force-collect

# 2. 渲染并立即同步三块屏幕壁纸
python -X utf8 wallcraft_sync.py --targets all

# 3. 仅刷新数据采集检查
python -X utf8 wallcraft_collectors.py

# 4. 查看一号机当前显示器与壁纸路径
python -X utf8 wallcraft_win.py --list

# 5. 启动本地总控服务 & 打开 Web 控制台 (http://127.0.0.1:18766)
python -X utf8 wallpaper_server.py
```
