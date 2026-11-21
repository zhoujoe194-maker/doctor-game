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
（主题截图见 `artifacts/player-experience/dsh-aimlabs-theme/08-returning-1440x900.png` / `11-returning-1280x720.png`；1280×720 边界由 `tests/ui/player-experience.spec.js:95-104` 继续覆盖）。

用户 2026-11-21 的新产品决定覆盖此前“保留森林绿”的约束：整个应用改用官方 Aimlabs Play 2.0
图（Play 页，不是结果页）的深灰/炭黑背景、青蓝强调色、浅色正文色系；不保留浅绿主按钮或森林绿底。
没有复制 Aimlabs 商标、排行榜、商城、背景插图或装饰网格，也没有新增无关功能。

### 最终配色（2026-11-21）

取自官方 Play 图的色系（深灰/炭黑为主，青蓝只给操作与选中态）：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--canvas` / `--forest` | `#0c0f12` / `#10151a` | 应用画布 / 侧栏与录制主区 |
| `--surface` / `--subtle` | `#151b20` / `#1e272e` | 卡片、表单、悬停表面 |
| `--ink` / `--muted` | `#eef4f6` / `#9aa8b0` | 正文 / 辅助文字 |
| `--accent` / `--accent-hover` | `#46d8d7` / `#6ae6e4` | 主操作、选中态、焦点、链接 |
| `--accent-ink` | `#061315` | 青蓝按钮上的深色文字 |
| `--amber` / `--amber-surface` | `#f2c56b` / `#2b2417` | 警告（如默认档案待核对） |
| `--danger` / `--error-surface` | `#ff6b66` / `#2a1517` | 危险（停止/错误），保持语义区分 |
| `--blue` / `--blue-surface` | `#7fb8ff` / `#142430` | 信息性分类（如移动不足） |
| `--stage` | `#050709` | 视频舞台；视频本身不染色、不叠滤镜 |

- 主操作、选中态、时间线选中标记、链接、焦点环统一使用青蓝色；`--green`、`--forest` 等旧变量名
  为兼容现有组件保留，但值已改为暗色/青蓝色系。
- 成功/提示、警告、危险仍分别使用青蓝、琥珀、珊瑚红语义色；disabled 降低不透明度但保持可读。
- 品牌 `assets/mark.svg`、`index.html` 的 `theme-color`、Electron 窗口初始背景与托盘色同步更新；
  品牌名称、十字准星图形结构和中文界面不变。
- 视频预览、录制预览和复盘视频不加 `filter` 或颜色叠加；只调整周边容器与控件。
- 布局与信息层级不变：前述“继续上一局”、首访开始录制/导入、录制停止入口、建议原因、零候选恢复
  仍与审查表 P1/P2 任务一一对应，具体映射见下表。

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
- `electron/main.cjs` 只改录像状态与列表读取：`incomplete` 时写 `status:incomplete`，`recording:list` 用
  `fs.stat` 返回运行时 `actualBytes`/`active`，不删除文件、不改写 JSON；原记录、报告、档案和
  `sight-recordings` / `sight-profile` / `sight-report-*` 标识不变。
- 录制仍为无音频、显式选择窗口、可取消；保留 MediaRecorder 正常成功路径。
- 未做系统级采集改造：本轮没有证据定位 macOS 原生无帧根因，因此只修“无帧时不得谎报成功/不得把空文件当录像”的应用层行为。

## P1 恢复修复（2026-11-21 追加）

负责人复现：隔离目录中的 `.webm` 实际为 268881 字节，但 `recording:append` 只更新内存、崩溃退出时 JSON 仍为
`status:"recording", bytes:0` 且没有 `duration`；此前的 `usableRecording = Number(item.bytes) > 0` 把这段
可恢复录像永久判成“无画面”。这是对“保留录像/进度”约束的回归。

修复（不改算法、不迁移数据）：

- **以实际字节为准**：desktop 在 `recording:list` 用 `fs.stat` 读取 `.webm` 真实大小；browser 在
  `storage.list()` 汇总 IndexedDB `chunks` 的 blob 大小。两者都只添加运行时字段 `actualBytes`，
  **不写回、不改写、不删除**既有 JSON/IndexedDB 元数据、报告或文件。
- **区分未知与真实零**：`usableRecording` 只把 `actualBytes === 0` 当作确定的空文件；`actualBytes`
  缺失/未知（旧元数据、统计失败）不再被当作“没有内容”，而是允许解码尝试。真正 0 字节仍显示
  “无画面”并拒绝无意义分析；实际非空的中断录像可播放、进入分析并保存报告。
- **录制中的 metadata**：desktop list 额外返回 `active`，应用把 `active` 或当前 `state.capture.id`
  对应项排除在“可恢复/可分析”之外，避免把正在写入的 JSON 误判为中断录像。
- **浏览器未 finish 的录像**：`storage.begin` 从未写过 `bytes` 的旧数据也能靠 chunks 恢复；
  回归覆盖“已写 chunks、未 finish、重载后可分析，且原 metadata 仍无 bytes/保持 recording”。
- **档案核对**：不再用“localStorage 有非空字符串”判定已保存档案；现在只有能通过
  `validateProfile()` 的已存档案才算“已确认”，损坏/越界值回退默认值并显示“待核对”，且不重写原值。
- 处理面保持窄：仍使用原 recording ID、`validId`、IPC 信任边界、`doctorgame-video://` 协议与
  安全配置；未新增迁移或重写路径。

## 实际执行与结果

命令（Node 通过上述路径提供；本机没有 `pnpm`，使用等价 npm/npx 入口）：

| 命令 | 结果 |
| --- | --- |
| `npm test`（11 项算法测试） | 通过；算法/样本资格代码未改。 |
| `npm run test:ui`（12 项浏览器测试） | 通过；原有 5 项 + `tests/ui/player-experience.spec.js` 7 项（含新增的浏览器 chunks 恢复与损坏档案回退）。 |
| `npx playwright test tests/ui/player-experience.spec.js` | 7 项通过：首访核对/保存返回、建议原因就近、零候选恢复+回访 1280×720、无帧取消/超时/恢复、真 0 文件不可分析、未完成 chunks 恢复、损坏档案回退待核对。 |
| 主题截图 + `AxeBuilder`（本机浏览器脚本，未入库） | 11 个状态：首访、档案、复盘示例、空记录、选窗弹窗、录制、复盘、回访、记录、390px 窄屏、1280×720 回访；最终 **0 axe violations**，截图在 `artifacts/player-experience/dsh-aimlabs-theme/`。 |
| `node tests/electron-recovery.mjs`（本机经测试用 `--no-sandbox` 包装） | 通过：真实 WebM（本次样例 268881 字节，约 268 KB）+ 陈旧 `bytes:0/status:recording/无 duration` 元数据，重启后可播放并完成分析，重启后继续复盘，原文件 SHA-256 与 JSON 逐字节不变；`artifacts/electron-recovery/dsh-sandbox/result.json`。 |
| `node tests/electron-smoke.mjs` | 本机直接运行被 DSH 环境的 macOS sandbox 阻止（Chromium `sandbox initialization failed: Operation not permitted`），不是应用回归。改用仅测试用的 Electron 启动包装（`--no-sandbox`，应用代码与安全配置未改）后通过：隔离 data、导入/回放/确认/重启保留均通过，`result.json` 为 `passed:true`，产物在 `artifacts/electron/dsh-sandbox/`。 |
| `tests/player-flow-audit.mjs`（负责人脚本的未修改副本 + 同一测试用 `--no-sandbox` 包装） | 通过，三组检查全部通过；after 截图与 `audit.json` 在 `artifacts/player-experience/dsh-after/`。原脚本、`docs/player-experience-audit.md`、`before` 目录未修改。 |

新增回归覆盖：

- 无帧/空采集：等待不入录制态、取消、8 秒超时、超时后无空记录、重选后正常录制；真 0 字节日志保留但不可分析。
- 中断恢复：desktop 真实 WebM + 陈旧 `bytes:0/status:recording` 元数据，重启后播放、分析、再次重启继续复盘，原文件/元数据不变；browser 已写 chunks、未 finish、无 `bytes` 的录像重载后可恢复分析，元数据保持 `recording` 且无 `bytes`。
- 首访：默认值提示、核对入口、“保存并返回工作台”直接返回、旧“保存玩家档案”行为仍可用。
- 档案核对：损坏 JSON 或越界 DPI 回退默认并显示待核对，原值不被重写；合法已存档案不再显示待核对。
- 回访：上一局缩略图/进度/继续按钮首屏可见，1280×720 下按钮 `y+height <= 720` 且在视口内，侧栏最近一局可用。
- 建议原因：`recommend()` 原始原因在建议数字旁可见，“查看依据与复测”可展开。
- 零候选：提示、零候选恢复块、手动标记区直接可见、可标记事件、取消分析保留录像的既有路径由负责人脚本复核。

截图（本轮自测产物，非负责人验收；`dsh-after/` 是旧森林绿配色，已被新主题截图取代）：

- `artifacts/player-experience/dsh-aimlabs-theme/01-first-use-1440x900.png`
- `artifacts/player-experience/dsh-aimlabs-theme/02-profile-1440x900.png`
- `artifacts/player-experience/dsh-aimlabs-theme/03-demo-report-1440x900.png`
- `artifacts/player-experience/dsh-aimlabs-theme/04-history-empty-1440x900.png`
- `artifacts/player-experience/dsh-aimlabs-theme/05-source-dialog-1440x900.png`
- `artifacts/player-experience/dsh-aimlabs-theme/06-recording-1440x900.png`
- `artifacts/player-experience/dsh-aimlabs-theme/07-report-recording-1440x900.png`
- `artifacts/player-experience/dsh-aimlabs-theme/08-returning-1440x900.png`
- `artifacts/player-experience/dsh-aimlabs-theme/09-history-recording-1440x900.png`
- `artifacts/player-experience/dsh-aimlabs-theme/10-returning-mobile-390x844.png`
- `artifacts/player-experience/dsh-aimlabs-theme/11-returning-1280x720.png`

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
- 本轮只做配色/可读性调整，未改变布局与信息层级；但 Electron 本机仍受 DSH sandbox 限制，窗口初始背景/托盘色未在原生 Electron 截图复核。
- 中断恢复回归使用合成 WebM + 人工写入的陈旧元数据来模拟崩溃现场，不是原生进程崩溃复现，也不能替代 Windows 实机。
- `actualBytes` 是列表时计算的运行时字段，不进入持久化元数据；因此恢复后的 JSON 仍保留 `bytes:0/status:recording` 是预期行为，不是迁移失败。
