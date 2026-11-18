# CLAUDE.md · JH-WallCraft AI 协作上下文导航

> 本文件与根目录 [AGENTS.md](AGENTS.md) 保持同步，供 Claude Code、Antigravity 及各类协作 Agent 直接读取项目架构、排版规则与运行命令。

---

## 1. 项目定位与核心工作流

`JH-WallCraft` 是一套面向个人日程管理、倒计时追踪与 `Vertex-AssetDesk` 美术资产生产进度可视化的**桌面壁纸生成系统**。系统支持两种互补的运行模式：

1. **Web 交互式壁纸工作台 + 本地守护服务自动换壁纸**
   - 浏览器打开 `index.html`，通过 Canvas 2D 实时渲染壁纸，配置持久化在 `localStorage`。
   - 启动时通过 `assetdesk-client.js` 只读拉取本机 `Vertex-AssetDesk`（`127.0.0.1:18765`）今日焦点与周统计，支持离线缓存降级与 `.jsonl` 手动导入。
   - 页面常驻时每分钟检测日期变化，跨天或点击「🖼️ 设为壁纸」时将 PNG 字节 POST 到本地 `wallpaper_server.py`（`127.0.0.1:18766/set`），由 Python 调用 Windows Win32 API `SystemParametersInfoW` 直接更新系统桌面壁纸。
2. **CLI 命令行全景数据看板生成模式 (`gen_wallpaper.js` + `set_wallpaper.ps1`)**
   - 使用 Node.js `canvas` 离线渲染 `3840×2400` 4K 壁纸，除日历、时间线事件、里程碑、待办与备忘录外，直接聚合 `Vertex-AssetDesk` 的 `animTracker_v6.json` / `events.jsonl` 与 `fetch_km_articles.js` 抓取的 `km_articles.json`，额外绘制左侧「每日推荐阅读 + 进行中项目」以及底部「项目环形图 + 本周活动柱状图 + 动画趋势折线图 + 已完成项目卡片墙」。

---

## 2. 仓库目录与文件职责索引

```text
JH-WallCraft/
├── index.html              # Web 端主界面：左侧配置折叠面板 + 右侧 Canvas 预览区 + 事件/节点/标记编辑弹窗
├── style.css               # Web 端深色主题样式表
├── wallpaper-engine.js     # ★ 浏览器端 Canvas 2D 渲染引擎 (window.WallpaperEngine)
├── assetdesk-client.js     # ★ AssetDesk 只读客户端 (window.AssetDeskClient)：/api/wallpaper -> /slots 回退 -> localStorage 快照兜底
├── app.js                  # ★ Web 端主控制器 (WallpaperApp)：DOM 绑定、localStorage 持久化、跨天自动更新、调用 18766 设壁纸
│
├── wallpaper_server.py     # ★ 本地壁纸设置守护服务（默认 127.0.0.1:18766）：GET /health、POST /set 调用 SystemParametersInfoW
├── set_wallpaper.ps1       # PowerShell 脚本：P/Invoke user32.dll SystemParametersInfo 直接刷新 Windows 桌面壁纸
│
├── gen_wallpaper.js        # ★ Node.js (node-canvas) CLI 版 4K 壁纸生成器（含 AssetDesk 图表、已完成项目墙、KM 每日推荐）
├── fetch_km_articles.js    # 调用 mcporter 拉取 KM 热榜并按 AI/设计关键词过滤生成本地 km_articles.json
├── _analyze_layout.js      # 壁纸版面像素密度诊断工具（按行/列统计亮度 > 55 的内容像素分布，排查越界与碰撞）
├── make_wp.py              # Python Pillow 轻量版单月日历壁纸生成脚本
│
├── package.json            # Node 依赖定义（devDependencies: canvas@^3.2.3）
└── README.md               # 使用说明文档
```

---

## 3. 核心架构与排版机制详解

### 3.1 桌面安全区与响应式坐标系统 (`wallpaper-engine.js` & `gen_wallpaper.js`)
- **基准分辨率与缩放因子**：以 `3840×2400`（16:10 4K）为基准，`scale = width / 3840`，所有字号、边距、圆角、行高均乘以 `scale`。
- **左侧 1/3 留空约定**：
  - `wallpaper-engine.js` 中 `leftStart = Math.round(width / 3)`，将**屏幕左侧 1/3 留给桌面快捷方式图标**，主日历与底部三栏面板（`今日待办` | `AssetDesk 进度` | `备忘录`）严格排布在右侧 2/3 区域（右边距 `sideMargin = Math.round(80 * scale)`）。
  - `gen_wallpaper.js` 在左侧空白区的下半部分（`y >= 540 * s`）排布「每日推荐（KM 文章）」与「进行中项目卡片」，上半部分（`y < 540 * s`）仍保持留空给桌面图标。
- **日历单元格防碰撞规则**：
  - 每个日期格内按纵向比例分层排布：左上角日期数字（1 日显示月份标签）、右上角特殊标记紫底胶囊（`mark`）、中段跨天时间线事件空心圆角条（`event`，最多叠放 3 层）、底部关键节点实心色块（`milestone`）。
  - 当某日既有时间线事件又有关键节点时，里程碑色块需根据当日事件条层数自动下移或避让，防止文字重叠。

### 3.2 本地日期解析红线（防东八区 UTC 偏移 Bug）
- **严禁直接调用 `new Date("YYYY-MM-DD")`**！在 ECMAScript 规范中，仅含年月日的 ISO 字符串会被按 **UTC 零点**解析，在本地时间比对时会因时区或 `setHours(0,0,0,0)` 产生一天偏差，导致「今天」高亮或跨天事件错位。
- **必须使用本地日期构造函数**：
  - `wallpaper-engine.js` 中使用 `this.parseLocalDate(str)`（`const [y, m, d] = str.split('-').map(Number); new Date(y, m - 1, d)`）。
  - `gen_wallpaper.js` 中使用 `localDate(str)` 与本地零点 `today`。

### 3.3 本地服务端口与外部数据联动
| 服务 / 数据源 | 默认地址 / 路径 | 职责与容错策略 |
|---|---|---|
| `wallpaper_server.py` | `http://127.0.0.1:18766` | 接收浏览器 `POST /set` 的 PNG 二进制流，写入 `~/wallcraft_wallpaper.png` 并设为系统壁纸；未启动时顶部状态栏显示「🟡 本地服务未连接（仅下载）」。 |
| `Vertex-AssetDesk` | `http://127.0.0.1:18765` | `assetdesk-client.js` 依次尝试 `/api/wallpaper` → `/slots` → `localStorage` 缓存快照，保证 AssetDesk 未启动时壁纸生成不报错。 |
| `km_articles.json` | 仓库根目录本地缓存（Git 忽略） | 由 `fetch_km_articles.js` 生成；拉取失败或结果为空时保留旧文件，避免壁纸推荐栏变空。 |

---

## 4. 常用运行与验证命令

### 4.1 启动 Web 端与本地壁纸设置服务
```powershell
# 1. 启动本地桌面壁纸设置守护服务（监听 127.0.0.1:18766）
python wallpaper_server.py

# 2. 启动静态服务器预览 Web 界面（或直接双击 index.html）
python -m http.server 8080
# 浏览器访问 http://localhost:8080
```

### 4.2 命令行生成 4K 数据看板壁纸并应用到桌面
```powershell
# 1. （可选）更新 KM 每日推荐文章缓存
node fetch_km_articles.js

# 2. 使用 node-canvas 生成 4K 壁纸（可指定输出路径）
node gen_wallpaper.js C:\Users\Administrator\wallcraft_wallpaper.png

# 3. 诊断生成壁纸的像素密度与版面边界
node _analyze_layout.js

# 4. 通过 PowerShell 将 PNG 立即设为 Windows 桌面壁纸
powershell -ExecutionPolicy Bypass -File set_wallpaper.ps1
```

---

## 5. 编码与维护规范

1. **Web 端零构建依赖**：
   - `index.html`、`app.js`、`wallpaper-engine.js`、`assetdesk-client.js`、`style.css` 保持纯原生浏览器脚本与样式，不引入打包器或前端框架；全局类通过 `window.WallpaperEngine`、`window.AssetDeskClient` 暴露。
2. **双端渲染逻辑同步**：
   - 若修改了弥散光预设色系（`blue-purple`、`pink-orange`、`green-cyan`、`gold-warm`）或日历单元格的事件/节点防碰撞逻辑，请同步检查 `wallpaper-engine.js`（浏览器端）与 `gen_wallpaper.js`（Node CLI 端）。
3. **本地缓存与隐私保护**：
   - `km_articles.json`、`.session_tmps/` 及临时导出的壁纸文件不纳入版本控制（已在 `.gitignore` 中忽略）。
   - 修改 `gen_wallpaper.js`、`fetch_km_articles.js`、`set_wallpaper.ps1` 中的本机路径时，优先支持环境变量或命令行参数覆盖，严禁提交任何 API Key、Token 或内网认证凭据。
4. **Git 提交规范**：
   - 遵循 Conventional Commits（`feat:`、`fix:`、`docs:`、`chore:`），提交前运行 `git status` 与 `git diff` 核对变更。
