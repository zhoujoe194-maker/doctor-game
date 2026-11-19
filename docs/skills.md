# doctorgame 开发 skills

这套配置面向当前的 Electron + 原生 JavaScript 桌面原型。Skills 为开发时
的 Codex 提供工作方法；产品的检测算法仍由 `src/analysis.js` 和
`src/media.js` 实现。算法开发与真实数据验证以 `docs/product.md` 为依据。

## 已选择的能力

| Skill | 来源 | 在本项目中的用途 |
| --- | --- | --- |
| `find-skills` | `vercel-labs/skills` | 新任务出现能力缺口时搜索候选，与已安装项比较并核对来源 |
| `grill-me`、`grilling` | `mattpocock/skills` | 主动发起产品评审时使用。前者是入口，后者实现提问，可用来确定首测玩家和一次复盘的成功标准 |
| `frontend-design` | Anthropic / `anthropics/skills` | 把工作台、回放和报告设计成统一的桌面工具，按本项目方向使用颜色、字体和间距 |
| `game-ui-ux` | `gamedev-skills/awesome-gamedev-agent-skills` | 让录制、回放与片段确认顺手，检查窗口缩放和键盘焦点 |
| `web-design-guidelines` | Vercel / `vercel-labs/agent-skills` | 检查键盘操作、表单、焦点、错误提示与可访问性 |
| `playwright-cli` | Microsoft / `microsoft/playwright-cli` | 探索浏览器预览、定位交互问题，并辅助维护现有 Playwright 测试 |
| `electron` | Vercel Labs / `vercel-labs/agent-browser` | 在本地开发会话中连接 Electron，查看桌面窗口与渲染器交互 |
| `electron-builder` | `pedronauck/skills` | 在现有 Windows x64 打包链上制作可下载安装的 NSIS 测试包 |
| `steam-publish` | `gamedev-skills/awesome-gamedev-agent-skills` | 准备 SteamPipe 构建模板、验证内容清单与 Windows 启动项 |
| `systematic-debugging` | 社区项目 `obra/superpowers` | 复现问题、收集证据、定位原因后再修改 |
| `verification-before-completion` | 社区项目 `obra/superpowers` | 完成前运行相应检查，报告实际结果与未验证范围 |

项目工作约定和视觉算法验证流程在根目录 `AGENTS.md`。通用 skill 的设计
示例应结合本项目的界面、代码与数据边界使用。

桌面改版的完整 Codex 指令见 [桌面测试版开发任务](desktop-beta-prompt.md)。
这批 skills 是开发说明。应用的安装器、Steam depot 和 Windows 验收由后续开发任务交付。

## 本地使用

这些 skill 的完整文件随分支保存在 `.agents/skills/`，`skills-lock.json`
记录来源提交和内容哈希。拉取包含本次配置的分支后，可在项目根目录查看：

```sh
npx --yes skills@1.9.0 list -a codex
```

在 Codex CLI 或 IDE 插件里输入 `/skills`，确认项目 skills 已被发现。
也可以在任务中明确提及，例如：

```text
请先阅读 AGENTS.md、README.md 和 docs/product.md。
使用 $systematic-debugging 排查我提供的录像分析问题。
完成时使用 $verification-before-completion，说明实际运行的检查与结果。
```

Skills 文件安装与工具依赖是两个步骤。项目已有 `@playwright/test`，日常
回归沿用 `npm test` 和 `npm run test:ui`。执行浏览器测试前需要可用的
Chromium；运行 Electron 测试前需要 `npm run setup:desktop` 与可用的桌面
运行环境。

探索式 CLI 由其发布方单独提供；实际需要时可使用以下入口，先查看帮助：

```sh
npx --yes --package=@playwright/cli playwright-cli --help
npx --yes agent-browser --help
```

这两个命令会获取相应 CLI。浏览器、桌面会话和系统权限仍需由实际测试
环境提供。CLI 的 Electron 示例只用于开发测试，生产启动保持现有配置。

## 来源与固定版本

安装器版本：`skills@1.9.0`。以下来源均固定到明确提交；更换上游版本时，
先查看差异，再有选择地重新安装并提交新的 lock 文件。

| 来源 | 提交 |
| --- | --- |
| [anthropics/skills](https://github.com/anthropics/skills) | `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` |
| [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | `99c4eb2566153f37fb104e5dbf894fb9c785e17d` |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | `deda8eff5e29bcc3b4a9f10aafd1412dbe91745a` |
| [obra/superpowers](https://github.com/obra/superpowers) | `22f0b463e7a5e579904dd6211a520321035526f7` |
| [gamedev-skills/awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) | `c6ca6c41c839b68319ffc08430b99ab768debc32` |
| [pedronauck/skills](https://github.com/pedronauck/skills) | `93655db210f1860822215d5a9bd86f580ffb1239` |

第三方声明及可取得的许可证副本在 `.agents/THIRD_PARTY_NOTICES.md` 与
`.agents/licenses/`。Skill 文件不属于 Windows 运行包的打包白名单。

## 桌面改版 skills 核验

安装器识别出全部 9 项项目级 Codex skills，状态均为 `tracked`。内容哈希与
来源提交已核对。新增 3 项中的 12 个文件与固定版本的上游 Git 文件一致。
SteamPipe 检查脚本通过离线样例，能接受含测试文件的映射，也能拒绝空内容目录。

## 首批 6 项核验（2026-11-19，北京时间）

读取的应用基线提交：`e9fe7584710ed04d6de48198636235754877840f`。

- `pnpm install --frozen-lockfile --ignore-scripts` 成功。
- `npm test`：11 项通过。
- Playwright 官方 Chromium 下载返回无效压缩包；随后仅用临时配置尝试
  系统 Chromium，启动被当前运行环境的 socket 权限限制阻断，3 项 UI
  测试均未进入页面。临时配置没有写入项目。
- 本次未运行 Electron 桌面冒烟或 Windows 实机游戏捕获测试。

已有验收记录继续保存在 `docs/validation.md`。下一步优先按
`docs/product.md` 建立真实录像标注与评估，再决定事件识别模型、OCR 或
视频解码方案；视觉效果、检测准确率和灵敏度改善效果分别验收。
