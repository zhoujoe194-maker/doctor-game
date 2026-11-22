# HUD 击杀/死亡事件识别

日期：2026-11-22。状态：**实验性本地候选层**，不是已验证的击杀识别模型。

## 目标与边界

用户导入整段录像并填写「录像中显示的玩家名」后，程序在本地定位右上角击杀信息中的本人行：

- 玩家名在行左端 → 本人击杀候选（`kill`）。
- 玩家名在行右端 → 本人死亡候选（`death`）。
- 队友、助攻、名字只出现在中间、名字无法确认、低置信度行和同一行两侧都出现玩家名，全部拒绝。
- 自动候选只用于回放定位。它没有轨迹、命中结果或对枪证据；确认/纠正/排除后仍是 `kind: observation`，不进入灵敏度量化样本。

不做：真实游戏准确率评估、击杀/死亡画面理解、助攻归属、赛事 API、分数板 OCR、自动判定对枪胜负、无 HUD 模式、游戏内存读取、输入模拟、录像上传。

## 参考与 HUD 依据

- Riot 官方补丁 12.05 说明：击杀信息（killfeed）会显示助攻特工图标。因此不能把击杀信息里的任意中间图形/文字当作本人事件；本实现只按参与者文字在行的左右边缘匹配玩家名。[Riot Patch Notes 12.05](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-12-05/)
- Tesseract.js 本地安装/API：`workerPath`、`corePath`、`langPath` 可指向本地文件；`worker.recognize` 支持矩形和 blocks 输出。[Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)、[local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)
- Riot 没有公开可依赖的实时击杀信息 API；本项目只读取用户已有录像的像素，不做屏幕抓取之外的游戏集成。

## 检测流程

1. **低频定位（1 Hz）**：对录像按 1 秒间隔 seek，裁剪归一化右上区域（`x=0.68, y=0.07, w=0.31, h=0.42`），灰度+对比度增强并放大到约 1100 px 宽。不会在原来的 20 fps 分析循环里逐帧 OCR。
2. **本地 OCR**：Tesseract.js 7.0.0，LSTM OEM；英文名使用 `eng`，含中日韩字符的名字使用 `chi_sim + eng`。模型、worker、WASM 和 traineddata 全部来自 `assets/ocr/`，没有运行时 CDN。
3. **行解析**：取 OCR 的 `lines/words`，只在玩家名**精确**作为行首或行尾参与者时建立候选；记录左右文字、文字识别分、行文本和扫描时间。`Alex` 不会匹配 `AlexB`、`Alex1`、`Alexll` 或 `AlexBB`。如果图标/文字重叠导致名字与相邻字符无法从几何上分离，选择拒绝而不是裁掉后缀伪造精确身份；合成 fixture 已把武器方块与玩家名分开。
4. **跨帧去重**：以 `side + 归一化整行` 作为行签名。击杀信息行在连续扫描/向上移动时合并为一个候选；行消失超过 8 秒后同名行再次出现才创建新候选。同一扫描里重复行只算一次。
5. **候选附近细读**：新候选首次出现附近以约 0.4 秒步长补扫最多约 1.6 秒。细读针对指定 episode 局部匹配（`rowKey` 相同才更新时间），不经过全局 active/expire，也不会把早期 episode 合并到 20 秒后重新出现的同名 episode。
6. **时间段**：候选默认保留首次出现前 1.5 秒、最后出现后 1 秒，截断到录像时长；记录 `firstSeen/lastSeen/at/start/end`。
7. **轨迹上下文**：与已有轨迹候选时间邻近时只写 `relatedEventId` 和 `relatedDeltaSeconds` 供导航，绝不复制轨迹、不标记 reviewed、不把邻近当作证据。
8. **错误/取消**：模型加载失败、单帧 OCR 超时、零候选、缺少名字都返回报告可读状态；取消会终止 worker，录像和已有报告保留。

## 资源、许可与安全

`scripts/prepare-ocr-assets.mjs` 是可重复准备脚本。它只下载以下 pinned npm tarball，校验 tarball SHA-256，再把需要的文件复制到 `assets/ocr/`：

| 包 | 版本 | 用途 | 许可证 |
| --- | --- | --- | --- |
| `tesseract.js` | 7.0.0 | ESM API、worker.min.js | Apache-2.0 |
| `tesseract.js-core` | 7.0.0 | CPU/SIMD/LSTM/relaxed-SIMD WASM JS | Apache-2.0 |
| `@tesseract.js-data/eng` | 1.0.0 | 英文 traineddata（4.0.0_best_int） | MIT |
| `@tesseract.js-data/chi_sim` | 1.0.0 | 简体中文 traineddata（4.0.0_best_int） | MIT |

`assets/ocr/resource-manifest.json` 记录每个文件的大小、SHA-256、来源 tarball、版本和许可证；`assets/ocr/licenses/` 保存完整许可证。运行时从本地路径加载，不存在 CDN fallback。`assets/` 已在 `scripts/verify-package.mjs` 的 `runtimeSources` 中，未来授权打包会一并包含。

CSP 只为本地 WASM 增加 `'wasm-unsafe-eval'`，并允许 `worker-src 'self' blob:` 和只读 `doctorgame-asset:` 资源（Electron 使用 blob worker 间接加载本地 worker/core）；Electron 的 `contextIsolation`/`sandbox`/受限 preload 不变，OCR 不经过 renderer Node，也不新增任意 IPC。桌面版通过只读协议 `doctorgame-asset://ocr/` 提供资源，路径限制在 `assets/ocr`。

## 身份快照与旧报告

- `playerName` 在录制/导入开始时写入该录像元数据，并写入报告 `hud.identity`；改名不会改旧报告。
- 没有名字不阻断录制/导入；报告会显示“未运行 · 缺少玩家名”，底部「击杀与死亡自动识别」可补填后重试。
- 旧报告没有 `hud` 字段时仍可打开；补填名字会只替换 `source: hud-ocr` 的事件，保留原 profile 快照、轨迹事件、确认/排除状态和录像。
- 不给旧录像静默套用当前玩家名；必须在该报告里明确输入。

## 界面语义

主流程使用「自动识别 / 击杀与死亡自动识别 / 确认事件」而不是把 HUD 术语放在首要位置；识别依据和 OCR 文字识别分折叠在「识别依据」中。列表卡片不再显示百分比；详情明确写「文字识别分 N/100，不是事件准确率」。确认后候选标签显示「已确认」，瞄准分类显示「自动识别 · 不量化」。1440×900 和 1280×720 下选中 HUD 候选时，播放器、慢放、确认/排除仍在首屏。

## 事件字段

每个 HUD 候选至少有：

```json
{
  "kind": "observation",
  "context": "kill",
  "source": "hud-ocr",
  "reviewed": false,
  "included": true,
  "start": 1.1,
  "end": 4.5,
  "firstSeen": 2.6,
  "lastSeen": 3.6,
  "ocrConfidence": 77,
  "confidence": 0.77,
  "evidence": {
    "detector": "hud-feed-ocr-0.1",
    "model": "tesseract.js@7.0.0 · eng+chi_sim · 4.0.0_best_int",
    "participantSide": "left",
    "rowText": "PlayerOnelll EnemyOne",
    "leftText": "PlayerOnelll",
    "rightText": "EnemyOne",
    "rowsInSample": 1,
    "region": { "x": 0.68, "y": 0.07, "width": 0.31, "height": 0.42 }
  }
}
```

`recommend()` 和确认按钮都有第二道保护：`source === 'hud-ocr'` 的事件即使被错误标成 reviewed/overshoot 也不会成为量化样本。原有阈值 20、65%、Wilson 下界 > 50%、±3% 未改。

## 可重复命令与当前合成证据

```sh
node scripts/prepare-ocr-assets.mjs
npm test
npx playwright install chromium
npm run test:ui
```

- 当前 `npm test` 26 项、`npm run test:ui` 24 项；HUD UI 回归 5 项。
- `tests/events.test.mjs`：持续行/行上移去重、同名重新出现、`AlexB/Alex1/Alexll` 等非精确身份拒绝、队友/助攻/缺少边缘/歧义名字拒绝、低置信度、中文名、关联轨迹不伪造证据、HUD 确认仍 0 量化、采样频率、超 8 秒多轮 episode 的 coarse→refine 不合并。
- `tests/ui/hud-events.spec.js`：真实画布 WebM → 导入 → seek 解码 → **真实本地 Tesseract OCR** → kill/death 候选 → 0.5× 跳转/确认/排除 → 重启保留；模型失败、零候选、取消保留、旧报告补填身份。
- 合成 8 秒 HUD 视频的实际测试曾产生 **23 次 OCR 扫描、3 个 HUD 候选（kill/death/kill）**，OCR 阶段约 **2.5 秒**（报告 `hud.elapsedMs`），原视频约 166 个分析帧；具体数字会写入报告。该数字只证明管线非 stub，不是召回率或准确率。报告截图见 `artifacts/full-ui/dsh/16-hud-report-1440x900.png`。
- 进度使用阶段单调映射：轨迹 0–55%，自动识别 55–100%；worker 日志不再把每帧识别重置为低进度；结束显示 100%。取消测试会等到自动识别初始化/扫描阶段再取消，并在 finally 终止 worker；报告字段 `hud.workerTerminated` 仅在确实取得 worker 且 `terminate()` 成功后为 `true`，否则为 `false`（不是外部清理证明）。被 abort/timeout 抢先的 `createWorker` 晚完成时也会 terminate。
- 重扫失败/取消/缺名**不写持久化报告**：保留原报告字节、原 reviewed/included 和录像，只在当前界面显示本次失败。成功重扫同一身份时按行签名和 8 秒内时间邻近保留匹配事件的确认/排除/场景纠正；身份改变或未匹配的旧候选不静默删除，而是 `retained: true` 保留在报告中供审查/排除。合并时保留旧事件 ID；同身份匹配候选沿用旧 ID；新未匹配事件使用不碰撞的稳定后缀 ID。多次改变身份再扫回原身份可恢复原确认，且不会产生两个相同 `hud-1` 或吞掉旧确认。
- DSH 本机的 plain Electron 仍受环境限制；负责人 normal-sandbox Electron 已实际运行真实 OCR 并得到 3 个 kill/death/kill、无外部请求，source smoke 通过。该结果属于负责人环境；真实游戏 HUD、中文真实样本、不同 HUD 缩放/语言/分辨率、长局吞吐和误检率仍未系统验证。
- 当前 Chromium 工程验证只用合成视频；不能由合成 8 秒视频推导任何真实准确率或召回率。

## 评估缺口

需要经同意的真实录像和逐行标注，按玩家/分辨率/语言/HUD 缩放划分，报告：

- 行级 precision/recall、本人 kill/death 事件 precision/recall、时间边界误差；
- 队友/助攻/观战/死亡界面/皮肤/遮挡导致的误检；
- OCR 低置信度阈值与拒绝率、人工复核负担；
- 长局 OCR 时间、CPU/功耗和取消后资源释放。

在此之前不能把该功能描述为准确、可靠或已经验证的自动事件识别。
