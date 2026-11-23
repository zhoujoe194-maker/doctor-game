# 交给 Codex 的任务 · doctor-game Windows 桌面测试版

请直接实现这一版，在包含本文件的提交上新建开发分支，保留已有工作。交付可下载、可在 Windows x64 双击安装的 doctor-game，让玩家能从录制或导入录像一路走到赛后复盘。同时备好将来接入 Steam 的构建文件。当前公开发布范围仅限开发分支与草稿 PR。

先读 `AGENTS.md`、`docs/product.md`、`docs/windows.md` 和 `docs/validation.md`。打开 `docs/images/workspace-desktop.png`、`docs/images/report-desktop.png`，对照 Aimlabs 2.0 Results 的官方图看它怎样放置回放、时间线与下一步操作。沿用 Electron 和原生 JS、HTML、CSS；浏览器预览供开发使用。

- [Aimlabs 官方结果页截图](https://clan.fastly.steamstatic.com/images/30632227/061487196be8880f4f28cd7e0ed1cdc7e217b15c.png)
- [Aimlabs 开发者公告，见 Aimlabs 2.0 Results Screen](https://store.steampowered.com/oldnews/?appids=714010&enddate=1793516400&feed=steam_community_announcements&l=english)

## 玩家打开应用后看到什么

读取 `.agents/skills/game-ui-ux/SKILL.md` 和 `.agents/skills/frontend-design/SKILL.md`。用本项目的品牌、图标、配色和中文文案完成界面。Aimlabs 供分析布局与操作顺序使用。

1. **第一次打开**。让玩家一眼看到「开始录制」与「导入录像」，并能检查当前 DPI 和灵敏度。去掉占据空工作台中央的静态准星、装饰编号和宣传语。没有录像时留一个能执行的下一步；有录像时直接显示最近一局与可继续复盘的入口。
2. **录制期间**。显示录制状态、时长和「结束并分析」。保留窗口选择、用户取消、权限被拒后的恢复、托盘录制和本地无音频存储。
3. **赛后复盘**。让真实回放成为面积最大的区域，播放器旁提供可选片段，时间线上可见当前片段的位置。选中片段能跳到对应时间，慢放、确认、排除和恢复都在回放附近完成。报告显示已确认且可量化的样本数，以及「保持当前值」或现有规则支持的试用建议。演示素材须清楚标识。
4. **视觉验收**。收紧重复卡片、边框和留白，保证视频中的敌方轮廓与准星清晰可见。状态同时用文字或图形表达。至少检查 1280×720、1440×900 及现有最小桌面窗口；小窗口可以折叠片段列表。实际操作 Tab、Enter 和焦点返回，检查播放器、确认键及主要操作均可触达。

保留档案、录像、历史和导出兼容性。沿用现有样本资格和推荐阈值，合成示例与手动标记只用于复盘。重构后验证这些边界。

## 玩家怎样下载和安装

读取 `.agents/skills/electron-builder/SKILL.md`，检查 `scripts/package.mjs` 现有 `pack:win` 产物。以同一份经过白名单筛选的应用目录生成 Windows x64 NSIS 安装器，给出一条本地构建命令。安装后的开始菜单入口应能在没有 Node、pnpm 或开发服务器的 Windows 上直接启动。支持卸载，升级保留录像、设置和历史。测试包未签名时标明实际签名状态。

提供测试者能取得的版本化安装包、SHA-256 和使用说明，可用 Windows CI 的构建产物或本次环境提供的下载文件。若使用 CI，使用手动触发或适当的 PR 构建，仅上传测试 artifact。安装包和录像留在源码仓库外。能使用 Windows 时实际安装、启动、导入、回放、重启、升级和卸载；分别记录验证结果与需要 Windows 真机补测的项目。

## 为 Steam 留好分发入口

读取 `.agents/skills/steam-publish/SKILL.md`。复用上面的已打包应用文件夹作为 SteamPipe 内容目录。提供可填入 AppID 与 DepotID 的 app/depot VDF 模板和简短说明，写清 Windows 启动项相对于安装根的路径（当前为 `doctorgame.exe`）。Steam 安装后直接启动程序。检查映射文件清单、入口和运行依赖，排除独立安装器、开发文件、签名材料及录像。

用临时数字 ID 与合成目录做离线检查，生产模板保留占位符，将离线检查与真实 Steam 构建分别记录。此次止于发布准备，保留人工上传步骤；不登录 Steam、不上传、不付费、不设置 SetLive。可按 Player Tools 核对 Steamworks 入驻要求，商店资格及审核由 Valve 确定。

- [electron-builder Windows NSIS 文档](https://www.electron.build/nsis/)
- [Valve SteamPipe 构建与上传](https://partner.steamgames.com/doc/sdk/uploading)
- [Valve 软件类别与入驻](https://partner.steamgames.com/doc/gettingstarted/onboarding)

## 提交时给我看什么

运行适用的 `npm test`、`npm run test:ui`、`node tests/electron-smoke.mjs` 和安装包构建，验证从安装好的 app 导入一段合成测试录像到复盘的完整路径。提交前读取 `.agents/skills/verification-before-completion/SKILL.md`。交付草稿 PR、工作台和复盘的前后截图、安装包获取位置与校验值、Steam 模板路径、测试结果。标明截图取自 Electron 还是浏览器。若环境阻断某一项，完成其余工作并写明具体阻碍与重试命令。整个任务以实际操作和产物验收。
