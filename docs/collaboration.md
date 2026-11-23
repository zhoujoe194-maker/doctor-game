# 多窗口与多模型协作约定

本约定适用于 DSH、Codex、Claude、Gemini 及其他模型/窗口。它是工作协议，不是权限锁；最终产品决定属于用户，独立验收和 main 集成由协调窗口负责。

## 角色

| 角色 | 职责 |
| --- | --- |
| 用户 | 产品方向、优先级、打包/发布/合并等最终决定 |
| 协调窗口（当前 Codex） | 维护总 Issue/任务单、确认 owner 与范围、独立验收、在获得当前授权后整合 main、回报最终 main SHA |
| 实现窗口（DSH 或其他模型） | 在独立目录和任务分支完成明确任务；交付冻结 SHA、diff、实际命令/结果和未验证项 |
| 独立 review 窗口 | 默认只读审查；不改代码、不合并、不发布 |

## 一个写入窗口，一个目录

- 一个任务只指定一个 owner。每个写入窗口使用**独立 clone 或 worktree**，以及
  `codex/<issue>-<scope>` 分支。
- 不在同一个目录同时切分支、改文件、安装依赖或运行会共享产物的测试。
- 已有 dirty 工作必须保留。不得自动 `git stash`/`pop`、`git reset --hard`、
  `git checkout -- .` 或覆盖别人的文件；先报告，由协调窗口决定。
- 不同目录使用独立 `node_modules`、测试产物、Electron user-data 和端口，见下文。

## GitHub Issue 是认领入口，不是原子锁

1. 在对应 Issue 评论 proposal：
   - 角色与 owner；
   - 任务目标；
   - base SHA（`git rev-parse origin/main` 或任务指定基线）；
   - 计划分支与独立目录/worktree；
   - 允许写的文件/目录；
   - 共享热点文件及是否需要协调；
   - 计划运行的检查。
2. 协调窗口确认一个 owner、范围、依赖和验收条件后才能写。
3. 已有人负责同一文件/范围时，等待或做只读 review；不要用“Issue 已存在”当锁。
4. 任务状态在 Issue 评论更新；本文和模板不是实时锁，也不替代协调确认。

## 共享热点

以下文件/目录需要显式协调，一个范围只允许一个 owner 写：

- `src/app.js`
- `src/styles.css`
- `src/media.js`
- `src/events.js`
- `src/analysis.js`
- `src/storage.js`
- `electron/`
- `package.json`、`pnpm-lock.yaml`、`package-lock.json` 及其他锁文件
- 根入口 `AGENTS.md`、`README.md`、`docs/start-here.md`、`docs/collaboration.md`、CI 模板

跨模块改动应在 Issue 中列出依赖顺序；依赖变更/锁文件必须单独标明，不能用其他窗口的未提交安装结果冒充。

## 基线与分支

```sh
git fetch origin
git rev-parse origin/main
git status --short
git switch -c codex/<issue>-<scope>
```

- base SHA 记录在 Issue 和交付回执中。
- 不从旧 main、旧评审分支或过期本地分支盲开始；先核实 main 已包含已验收交付，见 [start-here](start-here.md)。
- 不用 force-push 覆盖他人分支；不在共享主线上直接提交。
- 只有协调窗口负责主线集成；其他窗口不擅自 merge main、改 README 入口或发布。

## 测试与数据隔离

每个目录使用自己的端口、测试输出和 user-data；不要共用 Electron 默认真实数据，也不要复用其他窗口的 HTTP 服务。

POSIX（bash/zsh）：

```sh
DOCTORGAME_UI_PORT=4271 npm run test:ui
```

PowerShell：

```powershell
$env:DOCTORGAME_UI_PORT = "4271"
npm run test:ui
```

`PLAYWRIGHT_UI_PORT` 不是本项目变量；使用 `DOCTORGAME_UI_PORT`。默认端口为 4173，必须为 1024–65535 的整数。`reuseExistingServer` 固定为 false：端口被占用时应失败并换用独立端口，而不是复用别人可能正在运行旧代码的服务。第二个窗口使用 4272、4273 等不同端口。

根因不是 Playwright 本身“随机选错端口”，而是旧配置的 `baseURL` 固定 4173、`webServer.url` 固定 4173 且 `reuseExistingServer:true`；只要 4173 上有任何可响应服务，Playwright 就把它当作本项目服务，`PORT` 环境变量也没有进入 `webServer.env`。现在三项由同一个 `resolveUiPort` 派生，端口被占用时明确失败。

`npm test`、`npm run test:ui` 和适用的 Electron smoke 需在任务交付前实际运行；命令、退出码和未验证项写入交付。Desktop 测试使用隔离 user-data；不要指向用户真实录像/档案。每个独立目录保留自己的 `node_modules`、Playwright test-results/artifacts 和 Electron user-data，不共享其他窗口的依赖或服务。

## 交付与集成

实现窗口交付：

- 冻结 commit SHA（不再改文件后）；
- 完整 diff 概要；
- 实际执行命令和结果；
- 未验证项、阻塞项、风险；
- 受影响文件/共享范围；
- 对应 Issue 链接。

协调窗口独立复核（不是相信实现者声称）后，才在用户当前授权范围内整合 main/合并 PR。**本轮“统一协作基线”授权只适用于本轮已验收的整合，不能推导未来 PR 自动合并；后续合并仍需用户明确授权。** 发布、安装包、Release、Steam 上传始终需要单独明确请求。

## 当前状态

应用交付和 Windows CI 证据见 [项目状态](project-status.md) 与 [事件识别验收](event-detection-validation.md)。main 的实际合并 SHA、PR 状态和任务分配以协调窗口的 GitHub 回执为准。
