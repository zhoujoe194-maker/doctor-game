# 玩家体验修复设计记录

2026-11-21（北京时间）。实现负责人 DSH。基线 `14d2a0989b2953fdd0fd275e359978af26573b04`（`0.2.0-beta.1`），本轮分支
`codex/player-experience-review`；审查任务见 [GitHub #3](https://github.com/zhoujoe194-maker/doctor-game/issues/3)
与 `docs/player-experience-audit.md`。负责人负责独立验收与 after 对照，本文只记录实现侧的设计、实测与限制。

## 实际读取的文件与环境

- `AGENTS.md`、`README.md`、`docs/product.md`、`docs/validation.md`、
  `docs/desktop-beta-design.md`、`docs/desktop-beta-validation.md`、`docs/player-experience-audit.md`。
- `.agents/skills/frontend-design/SKILL.md`、`.agents/skills/game-ui-ux/SKILL.md`；
  `npx --yes skills@1.9.0 list -a codex` 返回 12 项项目 skills，与 `skills-lock.json`（v2）逐项一致。
- 现有实现与测试：`src/app.js`、`src/media.js`、`src/storage.js`、`src/analysis.js`、
  `src/styles.css`、`src/tokens.css`、`electron/main.cjs`、`electron/preload.cjs`、
  `tests/player-flow-audit.mjs`、`tests/electron-smoke.mjs`、`tests/ui/*.spec.js`、
  `tests/helpers/synthetic-video.mjs`，以及 `artifacts/player-experience/before/audit.json`。
- 实际打开查看：`docs/images/player-experience/before/{first-use,recording,report,returning,returning-1280,zero-candidates}.png`，
  `artifacts/references/aimlabs-play.png`。
- 环境：macOS 14.4 arm64，Electron 45.3.2，Playwright Chromium 159。Node 使用
  `/Users/joezhou/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`。
  本轮没有 Windows 游戏实机，不能把合成流程当作 Windows 采集、Vanguard 或帧率结论。

## 参考与取舍

已实际打开 Aimlabs 官方 Play 图
（[图片](https://clan.fastly.steamstatic.com/images/30632227/427b1222a6b90572175d155eef402bb8c502ce14.png)，
来源 [官方公告](https://steamcommunity.com/ogg/714010/announcements/detail/670628025926157118)）：
左侧固定 Recents 入口，主区域按内容任务分组，录像/训练缩略图与“进入任务”的动作相邻。

doctorgame 借鉴的两点：

1. **固定 Recents 入口**：侧栏新增“最近一局”，显示最近一局的缩略画面、时长和“查看报告/打开并分析”按钮；
   进入动作与缩略图相邻，任何页面都能直接回到上一局。
2. **内容缩略图与进入动作相邻**：回访首页把“继续上一局”作为首个内容区，视频缩略图、复盘进度
   （已确认且可量化 / 20、待确认片段数）和“继续复盘”按钮在同一张卡里。

这两点直接解决审查表 P2“回访主任务被新录制区挤出首屏、1280×720 下‘继续复盘’在 y=705.53、
按钮被截断”：现在首屏第一张卡就是上一局，1280×720 下继续按钮完整位于视口内
（`artifacts/player-experience/dsh-after/returning-1280.png`）。

保留森林绿 `#192a23`、浅绿 `#c2f279`、中文界面与既有字体/图标；没有复制 Aimlabs 的排行榜、
商城、背景插图或装饰网格，也没有新增无关功能。

## 设计决定（对应审查表玩家任务）

| 玩家任务（审查表） | 实现 | 解决的问题 |
| --- | --- | --- |
| 首次打开并用正确设置录制 | 首访在档案栏显示“默认值 · 待核对”并给出核对提示；档案页显示默认值说明；新增“保存并返回工作台”主按钮，保存后直接回到录制任务；原“保存玩家档案”按钮保留，兼容既有流程。 | P1 默认 800 / 0.35 像已确认设置；P2 保存后停在长表单底部。 |
| 完成一局并取得可回放录像 | 采集改为**获帧后才开始**：先请求窗口，再等待真实可解码帧（`videoWidth>0`、`readyState>=2`、track live），收到前不创建存储记录、不启动 MediaRecorder、不显示“正在录制”。等待期提供“取消等待 / 重新选择窗口”，8 秒超时后明确说明没有开始也没有保存空录像。停止时若 `bytes===0`，记录以 `incomplete:true`、`empty:true` 和 `status:incomplete` 保留，但首页/记录页标为“无画面”，不能进入分析。 | P1 假成功与无效重试：macOS 原生采集 live track 但 `videoWidth=0`、0 字节仍显示 ready/可分析。 |
| 取消选窗、拒绝后重试 | 保留原有窗口选择、Escape 取消焦点返回、拒绝权限重试；新增等待阶段取消/重选；回归覆盖取消、拒绝与超时恢复。 | 保持原有恢复路径，并让无帧阶段也有出路。 |
| 赛后复盘并理解建议 | 把 `recommend()` 返回的原始 `reason` 直接放在“本次建议”数字下方；新增“查看依据与复测”展开按钮，档案解释与复测任务仍在折叠区。调用仍是原 `recommend(events, profile, { demo })`，没有改任何阈值或规则。 | P1 “保持当前值 0.35”显眼但原因折叠，容易误读为已验证最优值。 |
| 零候选、取消分析仍有出路 | 分析结束无候选时，提示改为“没有找到候选片段。录像已保留；可以播放完整录像并手动标记关键事件，或导入另一段录像。”报告侧栏给出零候选恢复块，包含“标记关键事件”（滚动并聚焦手动标记表单）、“导入另一段录像”、“返回对局记录”；手动标记区在零候选时不再折叠。 | P2 空状态文案与下一步不一致、人工标记藏在折叠区。 |
| 再次打开继续上一局 | 有记录时首页首屏改为“继续上一局”卡片（缩略图、进度、继续按钮），录制/导入降为次级紧凑操作条；无记录时仍突出开始录制/导入。侧栏固定“最近一局”。1280×720 继续按钮不被截断。 | P2 回访主任务被新录制区挤出首屏。 |

其它约束：

- `src/analysis.js` 未修改：阈值、样本资格、`recommend()` 规则、存储标识与档案快照保持原样。
- `electron/main.cjs` 只改录像收尾状态：`incomplete` 时写 `status:incomplete`，不删除文件；原记录、
  报告、档案和 `sight-recordings` / `sight-profile` / `sight-report-*` 标识不变。
- 录制仍为无音频、显式选择窗口、可取消；保留 MediaRecorder 正常成功路径。
- 未做系统级采集改造：本轮没有证据定位 macOS 原生无帧根因，因此只修“无帧时不得谎报成功/不得把空文件当录像”的应用层行为。

## 实际执行与结果

命令（Node 通过上述路径提供；本机没有 `pnpm`，使用等价 npm/npx 入口）：

| 命令 | 结果 |
| --- | --- |
| `npm test`（11 项算法测试） | 通过；算法/样本资格代码未改。 |
| `npm run test:ui`（10 项浏览器测试） | 通过；含原有 5 项与新增 `tests/ui/player-experience.spec.js` 5 项。 |
| `npx playwright test tests/ui/player-experience.spec.js` | 5 项通过：首访核对/保存返回、建议原因就近、零候选恢复+回访 1280×720、无帧取消/超时/恢复、空文件不可分析。 |
| `node tests/electron-smoke.mjs` | 本机直接运行被 DSH 环境的 macOS sandbox 阻止（Chromium `sandbox initialization failed: Operation not permitted`），不是应用回归。改用仅测试用的 Electron 启动包装（`--no-sandbox`，应用代码与安全配置未改）后通过：隔离 data、导入/回放/确认/重启保留均通过，`result.json` 为 `passed:true`，产物在 `artifacts/electron/dsh-sandbox/`。 |
| `tests/player-flow-audit.mjs`（负责人脚本的未修改副本 + 同一测试用 `--no-sandbox` 包装） | 通过，三组检查全部通过；after 截图与 `audit.json` 在 `artifacts/player-experience/dsh-after/`。原脚本、`docs/player-experience-audit.md`、`before` 目录未修改。 |

新增回归覆盖：

- 无帧/空采集：等待不入录制态、取消、8 秒超时、超时后无空记录、重选后正常录制；0 字节记录保留但不可分析。
- 首访：默认值提示、核对入口、“保存并返回工作台”直接返回、旧“保存玩家档案”行为仍可用。
- 回访：上一局缩略图/进度/继续按钮首屏可见，1280×720 下按钮 `y+height <= 720` 且在视口内，侧栏最近一局可用。
- 建议原因：`recommend()` 原始原因在建议数字旁可见，“查看依据与复测”可展开。
- 零候选：提示、零候选恢复块、手动标记区直接可见、可标记事件、取消分析保留录像的既有路径由负责人脚本复核。

截图（本轮自测产物，非负责人验收）：

- `artifacts/player-experience/dsh-after/first-use.png`
- `artifacts/player-experience/dsh-after/recording.png`
- `artifacts/player-experience/dsh-after/report.png`
- `artifacts/player-experience/dsh-after/returning.png`
- `artifacts/player-experience/dsh-after/returning-1280.png`
- `artifacts/player-experience/dsh-after/zero-candidates.png`

## 未解决与限制

- 没有 Windows 游戏实机：Windows 窗口/全屏捕获、Vanguard、长录制、帧率/CPU/GPU/内存未验证；
  合成录屏和浏览器测试不能替代 Windows 采集或性能结论。
- 没有重新触发 macOS 原生采集无帧问题（系统录屏权限状态无法在测试中重建）；本轮只证明应用层在
  无帧/空文件时不再显示成功、不会把空文件送入分析，并给出取消/超时/重选恢复。
- DSH 运行环境禁止 Chromium 自带 sandbox，Electron 冒烟与负责人审计脚本的自测副本都只能加
  `--no-sandbox` 启动包装；这是测试环境限制，生产 `electron/main.cjs` 的
  `contextIsolation`、`sandbox`、`nodeIntegration` 配置未变。
- 截图中的视频均为程序生成的合成画面（带水印），不代表真实对局，也不证明检测准确率或灵敏度改善。
- 真实游戏窗口的“第一帧”等待时间、窗口最小化/恢复、托盘停止仍需 Windows/实际游戏窗口复核。
