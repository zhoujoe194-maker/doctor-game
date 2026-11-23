# 新窗口从这里开始

本文件是多模型、多窗口的统一入口。它不替代任务 Issue、负责人验收或
`AGENTS.md` 中的产品不变量；当它们有冲突时，以用户当前明确决定和任务单为准。

## 1. 目标基线

统一协作基线是 **`origin/main`**，不是任何旧评审分支、旧安装包或本地长期工作区。

本轮已由用户授权把已验收源码整合到 main；实际 GitHub merge、PR 状态和最终
main SHA 由协调窗口（Codex）执行并确认。当前已验收应用交付为：

- 应用交付：`f3ed51f2868dade6869f1fdf8fb480e9568e6ed5`
- 应用实现：`01610c1a9983a06fcaebf438e13bc31a17de3b49`
- Windows 源码 CI：[run 45121052543](https://github.com/zhoujoe194-maker/doctor-game/actions/runs/45121052543)
  （27 算法、24 UI、普通与 OCR Electron 流程通过；严格 3 个合成 HUD 事件；installer skipped）
- 统一主线由协调窗口合并后确认；不要把“已授权合并”误读为“GitHub 已经合并”。

## 2. 每次新窗口先做这些

在独立 clone 或 worktree 中执行；不要先改文件，也不要直接切共享目录的分支。

```sh
pwd
git status --short
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git merge-base --is-ancestor f3ed51f2868dade6869f1fdf8fb480e9568e6ed5 origin/main && echo "main contains accepted delivery" || echo "main baseline not ready"
```

然后读取：

1. `AGENTS.md`
2. `README.md`
3. `docs/start-here.md`（本文件）
4. `docs/project-status.md`
5. `docs/collaboration.md`
6. 自己的任务 Issue、相关设计/验收文档和必要的 `.agents/skills/` 文件

回报给协调窗口：cwd、branch、HEAD、`git status --short`、任务 Issue、计划使用的
base SHA、允许写的文件。**如果 `origin/main` 尚未包含已验收交付，停止从旧 main
实现，到 Issue 中说明并找协调窗口核对整合进度。** 不要从旧基线盲目开始。

## 3. 冲突和隔离

- 一个写入窗口使用一个独立 clone/worktree、一个任务分支，例如
  `codex/<issue>-<scope>`。
- 一个目录同一时刻只有一个写入窗口；不要在同一个 dirty 工作区切分支。
- 原有 dirty 工作先保留。不要自动 `git stash`、`git stash pop`、`git reset`、
  `git checkout -- .` 或强制清理；先报告并让协调窗口决定。
- 共享热点 `src/app.js`、`src/styles.css`、`src/media.js`、`src/events.js`、
  `src/analysis.js`、`src/storage.js`、`electron/` 和锁文件必须先在 Issue 中
  确认 owner 与文件范围。
- Issue 是认领入口，不是原子锁。先评论认领 proposal，得到协调窗口确认后再写。
- 独立 review 窗口默认只读，不要同时改代码。

具体流程见 [协作约定](collaboration.md)。

## 4. 可直接粘贴给任意模型的启动提示

把尖括号部分替换成真实值。不要预填未核实的 SHA、分支或“工具肯定可用”。

```text
你是 doctorgame 的<实现/审查/协调>窗口。任务 Issue：<Issue URL>。
先阅读仓库根目录 AGENTS.md、README.md、docs/start-here.md、
docs/project-status.md、docs/collaboration.md，并按任务需要阅读相关 docs/
和 .agents/skills/，不要一次性加载全部 skills。

工作目录：<独立 clone 或 worktree 的路径>；不要使用共享 dirty 目录。
先执行 git fetch origin，报告 cwd、branch、HEAD、git status --short、origin/main SHA。
确认 origin/main 已包含已验收交付 f3ed51f2868dade6869f1fdf8fb480e9568e6ed5；
如果未包含，停止并请协调窗口核对整合进度，不要从旧 main 开始。

基线 SHA：<git rev-parse origin/main>。
任务分支：codex/<issue>-<scope>。
允许修改的文件：<明确文件列表/目录>。共享热点文件：<是/否及文件>。
先在该 Issue 评论认领 proposal（owner、角色、base SHA、分支、范围、共享文件、
依赖、计划验收），得到协调窗口确认后再写。一个窗口只负责一个写入范围。

要求：遵守现有产品/数据/安全不变量；不改未授权文件；保留原 dirty 工作；
不自动 stash/reset；需要依赖或共享文件时先协调。实现后运行任务适用的实际检查
（例如 npm test、npm run test:ui、Electron smoke）；使用独立
DOCTORGAME_UI_PORT、独立测试产物和 user-data，不自称历史 CI 通过。

交付：冻结 commit SHA、完整 diff 概要、实际命令/结果、未验证项、阻塞项、
风险和建议。不要 merge/push GitHub，不要打包、发 Release 或 Steam；由协调窗口
独立验收后按用户当前授权整合。
```

## 5. 不要虚构

- 只有实际执行并读到结果的命令才算通过。
- 不把历史 CI、旧安装包或另一个窗口的报告当作本任务证据。
- 不声称某个客户端一定会自动发现 skills；见 [skills 说明](skills.md)。
- 不把 Issue/文档当作实时锁；最终状态以 Issue 评论和协调窗口确认为准。
