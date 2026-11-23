# JH-WallCraft v3

双机三屏极客深色毛玻璃动态桌面系统：**一号机走 Steam Wallpaper Engine 超低开销实时网页壁纸（3秒硬件跳动 + 桌面直接勾选待办），二号机走事件驱动 0 显存静态推送**。

## 架构亮点

- **一号机双屏实时联动 (`we_projects/`)**：
  - **右屏主屏 (`JH-WallCraft-Right`)**：秒级实时时钟、3 秒刷新 `RTX 4090 / 内存 / 磁盘`、桌面直接点击勾选待办或切换「日常 / 冲刺 / 纯净」模式、实时论文字数与最新论文雷达。
  - **左屏副屏 (`JH-WallCraft-Left`)**：跨天自动滚动 6 周日历、悬停可看每日提交数的 GitHub 12 周交互热力图、论文进度环与文献总览。
  - **超低资源设计**：无 `requestAnimationFrame`、无 WebGL、无循环 CSS 动画；当有窗口最大化或全屏时随 Wallpaper Engine 自动冻结全部定时器（0 后台消耗）。
- **二号机 (`RTX 5080`, `192.168.3.222`)**：
  - 由一号机服务每 20 秒低开销巡检状态，**仅当 GPU 负载、ComfyUI 队列状态跃迁或配置变更时**才重绘并推送 4K 银河算力舱壁纸（120 秒兜底心跳，0 显存占用）。

## 快速使用

1. **Web 控制台**：访问 `http://127.0.0.1:18766`
   - 支持切换 **日常极客 / 冲刺 DDL / 纯净极简** 三种模式、色系预设、实时编辑待办/日程/里程碑/备忘录，并在线预览与一键同步三屏。
2. **命令行同步**：
   ```powershell
   python -X utf8 wallcraft_sync.py --targets all
   python -X utf8 wallcraft_sync.py --targets all --preview-only
   ```
3. **后台自动刷新**：
   - 一号机计划任务 `JH-WallCraft-Server`（开机后台托管 `http://127.0.0.1:18766`）与 `JH-WallCraft-AutoSync`（每 5 分钟静默同步三屏）。
   - 二号机交互式计划任务 `JH-WallCraft-Agent`（监听局域网 `18766` 并校验 Token）。
