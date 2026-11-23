# 参与 doctorgame

这是一个本地优先的桌面原型。开始前请阅读：

- [新窗口入口](docs/start-here.md)
- [协作约定](docs/collaboration.md)
- [项目当前状态](docs/project-status.md)
- [AGENTS.md](AGENTS.md)

## 最短流程

1. 从协调窗口取得任务 Issue；在 Issue 评论认领 owner、角色、base SHA、分支、范围和共享文件。
2. 在独立 clone/worktree 中创建 `codex/<issue>-<scope>`；保留原有 dirty 工作，不自动 stash/reset。
3. 只改确认范围内的文件。共享热点（`src/app.js`、`src/styles.css`、`src/media.js`、`src/events.js`、`src/analysis.js`、`src/storage.js`、`electron/`、锁文件）必须先协调。
4. 运行任务适用的检查；UI 使用独立端口和独立产物，例如
   `DOCTORGAME_UI_PORT=4271 npm run test:ui`（PowerShell 用 `$env:DOCTORGAME_UI_PORT="4271"`），不要复用其他窗口的服务。
5. 交付冻结 SHA、diff、实际命令/结果、未验证项；由协调窗口独立验收后整合 main。

不要自行 merge/push main、打包、发 Release 或上传 Steam。产品决定和后续合并授权属于用户；详见 [协作约定](docs/collaboration.md)。
