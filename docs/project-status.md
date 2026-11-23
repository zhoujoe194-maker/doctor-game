# 项目当前状态

更新：2026-11-23。本文描述**当前源码协作基线**；历史验证记录只在各 `*-validation.md` 中作为当时证据保留。不要用旧安装包、旧 CI 或旧截图推断当前源码状态。

## 已验收源码

| 项 | 当前事实 |
| --- | --- |
| 已验收应用交付 | `f3ed51f2868dade6869f1fdf8fb480e9568e6ed5` |
| 应用实现提交 | `01610c1a9983a06fcaebf438e13bc31a17de3b49` |
| Windows 源码 CI | [run 45121052543](https://github.com/zhoujoe194-maker/doctor-game/actions/runs/45121052543)：27 算法、24 UI、普通与 OCR Electron 流程通过；严格 3 个合成 HUD 事件；installer skipped |
| 统一 main | 由协调窗口在独立验收后整合；实际 main SHA、PR 合并状态以 GitHub 回执为准。新窗口先核实 `origin/main` 是否包含 `f3ed51f`，见 [start-here](start-here.md) |
| 分发 | 本轮不打包、不更新安装包、不发 Release、不上传 Steam |

源码测试数量以交付验收为准：**27 项算法/纯函数测试 + 24 项浏览器 UI 测试**。协作测试端口配置另增独立单元测试，属当前 harness 检查，不改变原应用的 27/24 验收事实。

## 已实现的产品能力

- **本地优先录制/导入**：手动选择窗口，明确开始/结束，不录制音频；录像和报告保存在本机；空录像、取消、拒绝权限和中断恢复都有保留路径。
- **完整录像的瞄准候选**：原有轮廓/目标位移和低频背景运动抽样，生成可回放的击杀上下文、对枪/预瞄候选；不要求玩家先裁剪视频。
- **整段录像的击杀/死亡候选**：输入录像中显示的玩家名后，本地 OCR 扫描右上击杀信息，按参与者边界生成本人击杀/死亡候选；真实资源固定在 `assets/ocr/`，无运行时 CDN，不上传录像。
- **复盘工作区**：点击候选跳到源录像，可回放前后过程、1×/0.5×/0.25×、确认/纠正/排除和手动补标。
- **观察与量化分离**：HUD 自动候选、手动标记、合成示例、预瞄、未知和排除事件都是观察/候选；确认 HUD 不会变成量化轨迹。原有 20/65%/Wilson/±3% 规则未改。
- **档案与历史**：每次录像保存当时的 profile 快照；改当前档案或当前玩家名不会篡改旧报告。旧报告/旧录像保留，可读边界有降级保护。
- **全 UI 深灰青色顶导航**：已替换固定左栏和重复最近一局；首访、回访、录制、报告、对局记录、档案、帮助按任务布局。历史对照见 [全界面验收](full-ui-validation.md)。
- **本地存储和桌面安全**：IndexedDB/桌面文件、受限 IPC、`contextIsolation`、renderer sandbox、只读媒体/OCR 资源协议；不做 renderer Node 逃逸。

## 尚未实现或尚未验证

- 没有自动判定“对枪未击杀”的语义/交战边界；这类片段仍由玩家回放确认或手动标记。
- 没有真实游戏录像的 OCR 准确率、召回率、行级 precision/recall 或事件边界误差结论；只有合成工程验证。
- 中文/含空格名字的解析和本地语言资源路径已实现/测试，但没有真实中文游戏视频准确率结论。
- 真实 HUD 缩放/比例/皮肤/遮挡、助攻/观战/旁人和长录像吞吐未系统验证；合成 8 秒视频不能代表长局。
- Windows 游戏窗口/全屏采集、Vanguard 兼容、CPU/GPU/FPS 影响需 Windows 游戏硬件实测；Windows runner 的源码 CI 不等于游戏性能验收。
- 安装包中的 OCR 资源、协议和安装/升级尚未在“用户授权的新包”上验证。

## 历史证据与当前事实

- 当前源码/验收：[事件识别独立验收](event-detection-validation.md)、[全界面验收](full-ui-validation.md)、[玩家体验验收](player-experience-validation.md)。
- 技术边界：[HUD 事件识别设计](event-detection.md)、[全 UI 设计](full-ui-design.md)、[产品与算法](product.md)、[Windows 使用说明](windows.md)。
- 旧版安装/升级基线：[desktop-beta-validation.md](desktop-beta-validation.md)、[player-experience-validation.md](player-experience-validation.md)。这些记录描述当时版本，**不代表当前源码或当前安装包**。
- 旧的 Windows/性能描述属于历史条目；最新源码 Windows CI 以 [run 45121052543](https://github.com/zhoujoe194-maker/doctor-game/actions/runs/45121052543) 和负责人最终回执为准。

## 安装包与发布边界

此前 beta.1 安装包是历史评审产物，**不含后续的自动击杀/死亡识别与最新 UI 修正**，不可用于判断当前源码能力。用户尚未要求在最新源码上重新打包；本轮不更新安装包、Release 或 Steam。未来打包必须单独获得明确请求，并重新验证安装后的 OCR 资源、数据保留和 Windows 运行。

## 准确性的底线

以上“通过”只说明相应测试/工程路径在记录环境中通过，不代表真实玩家表现、真实识别准确率或灵敏度建议有效。用户产品决定、负责人独立验收和真实录像评估仍是发布前的必要条件。
