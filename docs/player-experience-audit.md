# 玩家流程审查与 DSH 任务基线

2026-11-21（北京时间）。负责人先操作实际 Electron，再派工；实现由 DSH 完成，最终产品决定和合并由用户确认。

## 接手与环境

GitHub PR #2 尚未合并、保持 draft；应用基线为 `14d2a0989b2953fdd0fd275e359978af26573b04`，版本 `0.2.0-beta.1`。新分支 `codex/player-experience-review` 从该提交建立。开始时已跟踪源码干净；原有 release、截图及忽略文件均保留。

已读 AGENTS、README、product、validation、desktop-beta-design、desktop-beta-validation，查看 beta 首页与报告截图。macOS 14.4 arm64，实际 Electron 45.3.2；测试数据分别在临时隔离目录，未使用玩家私人录像。上轮 Windows 安装/升级仅作历史基线，本轮不把它重新记为通过。

## 负责人亲测四条路径

| 玩家目标 | 实际操作 | 预期结果 | 实际结果 | 问题与证据 |
| --- | --- | --- | --- | --- |
| 首次打开并用正确设置录制 | 空数据启动，点编辑玩家档案，填写 800 / 0.35 并保存，再从侧栏工作台返回 | 清楚下一步及参数是否已确认，保存后容易返回 | 录制/导入明显；默认 800 / 0.35 无核对提示；保存后停留长表单底部，需自行找侧栏 | P1 默认值易被当作本人设置；P2 返回缺口。`before/first-use.png`、`profile-saved.png`、audit.json |
| 完成一局并取得可回放录像 | 真正列出窗口，选择本进程的独立合成 FPS 窗口；最小化/恢复、关闭隐藏/显示、停止 | 录制状态代表确有画面，停止后可回放；失败可恢复 | macOS 录屏权限 granted，但两次原生捕获均 live track、videoWidth=0，停止得到 0 字节；错误却建议换 MP4/WebM，首页称已保存可分析 | **P1 假成功与无效重试**。两次隔离录像 bytes=0、incomplete=false、status=ready。截图 `recording-native-1280.png`。不能推断 Windows 同样失败 |
| 取消选窗、拒绝后重试 | 原生选窗 Escape；另在实际 Electron 内注入 getDisplayMedia NotAllowedError，再恢复 canvas stream，明确为测试适配器 | 取消焦点回录制，拒绝可重试 | 两项通过；适配器真实 MediaRecorder、IPC、写盘、最小化、关闭隐藏、显示、停止到报告均通过 | 本机未撤销 OS 权限，拒绝项为合成边界，不是 Windows 权限实测。托盘显示/隐藏回调用测试驱动调用窗口，未以鼠标点原生托盘菜单 |
| 赛后复盘并理解建议 | 原生文件选择导入 6 秒带水印合成 WebM；点第 2 片段、0.5×、选对枪、确认；排除第 1 片段 | 跳到准确时间，操作不丢位置；知道为何保持原值 | 跳到约 3.15 秒，慢放保留，1/20 量化样本；“保持当前值 0.35”显眼，但原因折叠 | **P1 容易把缺证据误读为已验证最优值**。before/report.png，audit.json |
| 零候选、取消分析仍有出路 | 录制静态合成 canvas 得到 0 候选；再次导入时取消分析，再从记录重开 | 说明无候选并指向人工复盘；录像保留可重试 | 零候选仍提示“请先回放确认候选片段”，人工标记在折叠区域；取消后有保留说明，重试可完成 | P2 空状态文案与下一步不一致；取消路径通过。before/zero-candidates.png |
| 再次打开继续上一局 | 有 1 确认、1 排除的录像重启；当前 DPI 改为 1600 后重开旧报告 | 最近一局可见，进度和当局设置保留 | 字节 SHA-256、报告、确认/排除保留；旧报告仍 800 DPI；1280×720 首屏“继续复盘”在 y=705.53、高 44，按钮被截断 | **P2 回访主任务被新录制区挤出首屏**。before/returning-1280.png |

重复验证脚本：`tests/player-flow-audit.mjs`。基线运行退出 0，结果在 `artifacts/player-experience/before/audit.json`。比较状态为相同合成文件、800 DPI / 0.35、第二片段已确认且第一片段已排除；录制截图明确采用相同 canvas 适配器，不伪装游戏实机。脚本不替代上面的原生采集检查。

## 设计参考与任务映射

已实际打开 [Aimlabs 官方 Play 2.0 图](https://clan.fastly.steamstatic.com/images/30632227/427b1222a6b90572175d155eef402bb8c502ce14.png)，来源为 [官方 Play 公告](https://steamcommunity.com/ogg/714010/announcements/detail/670628025926157118)。图中左侧有固定 Recents 入口、主区域按内容任务分组、录像/训练缩略图与启动动作相邻。doctor-game 借鉴可直接进入内容的组织方式：回访把上一局和继续按钮放在首屏主要区域，首访突出录制/导入，录制时优先状态和停止。保留森林绿品牌与中文，不复制排行榜、商城、背景插图或装饰网格。

DSH 应先回报自己的目录、分支、SHA、项目级 skill 检查、实际读取文件及一条设计决定，再实施。每项主要变更对应上表玩家任务。算法阈值、样本资格、存储标识、当局档案、安全配置均不改变。无帧问题的系统根因仍需平台调查，本轮至少避免无帧时谎报录制成功及把空文件当成可分析录像。

## Skills 同步

应用 9 项与 skills 分支 `26070d3868360f183dd8b226ebdae107844b61d8` 的 12 项比较：原 9 项内容相同；新增 find-skills、grill-me、grilling，连同固定来源锁、许可证和路由说明同步。此轮优先用 frontend-design/game-ui-ux，没有明确能力缺口，不调用 find-skills 安装额外包；没有要求产品访谈，不执行 grilling。

## 仍需实机

Windows VALORANT 窗口/全屏捕获、实际拒绝权限后恢复、原生托盘菜单交互、Vanguard、长录制和帧率/CPU/GPU/内存均未在本轮验证。合成流程和视觉审查不证明检测准确率或灵敏度改善。
