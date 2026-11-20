# doctorgame Windows 桌面测试版

## 给测试者

取得 `doctorgame-0.2.0-beta.1-win-x64-setup.exe` 和旁边的 `.sha256` 文件。
安装包包含 Electron 和全部运行代码；玩家不需要安装 Node.js、pnpm 或启动服务器。
这次是**未签名的测试版**，没有可信发布者签名。

1. 在 PowerShell 中运行 `Get-FileHash .\doctorgame-0.2.0-beta.1-win-x64-setup.exe -Algorithm SHA256`，
   与提供的校验值比较。
2. 双击安装包，按向导安装到当前用户目录。完成后从开始菜单的 **doctorgame** 启动。
   若系统拦截，先核对来源与校验值；不需要关闭系统保护。
3. 在首页检查 DPI、游戏内灵敏度与玩家档案。点击「导入录像」选择 MP4（H.264）或 WebM。
   单个文件最多 2 GB；导入后保留本地副本并分析。
4. 在「赛后复盘」点击右侧片段或时间线标记，直接跳到该片段。
   用「回放前后过程」、0.5× / 0.25× 慢放检查，再选择场景、确认或排除。
   排除后可以恢复；手动标记不会成为量化推荐样本。
5. 退出并重新打开，从「最近一局 → 继续复盘」回到已保存的录像。

录制实战时，启动无畏契约后点击「开始录制」，明确选择游戏窗口。
录制期间显示时长与「结束并分析」；关闭桌面窗口仍会在托盘录制。
托盘菜单可结束录制。不录制麦克风或系统音频，不在对枪时提示调整灵敏度。

## 升级、卸载与数据

- 应用名 `doctorgame`、AppID `io.github.zhoujoe194maker.doctorgame` 与存储标识固定。
- 录像位于 Electron 用户数据目录的 `recordings`。通常是 `%APPDATA%\doctorgame\recordings`；
  早期原型继续沿用已存在的 `Sight` 或 `sight-sensitivity-lab` 目录。
  可从「对局记录 → 打开录像文件夹」查看实际位置。
- 档案与报告保留在同一用户目录的本地存储中。备份时请先退出程序，再备份完整用户目录。
- 安装新版本使用同一个安装位置。安装器不迁移或清空录像、档案、历史；卸载配置也保留应用数据。
  Windows 安装、升级与卸载的实际测试结果以本次验收记录为准。
- 卸载在 Windows「已安装的应用」中选择 doctorgame。独立安装器与 Steam 版不可同时运行。

## 开发者构建

依赖安装：`pnpm install --frozen-lockfile`。生成目录包、NSIS 安装器与校验文件的一条命令：

```sh
pnpm run dist:win
```

网络受限时，可把 `DOCTORGAME_ELECTRON_ZIP_DIR` 指向已下载且可信的 Electron
release ZIP 所在目录；文件名必须与固定版本和目标架构一致。默认仍从官方地址下载。
该设置仅影响构建，不影响玩家安装或运行。

npm 用户可使用 `npm install` 后执行 `npm run dist:win`。
源码仓库提供 pnpm 锁文件，不使用 `npm ci`。

产物位于 `release/0.2.0-beta.1/installer/`，包含安装器、SHA-256 和运行文件清单。
`release/0.2.0-beta.1/doctorgame-win32-x64/` 是它使用的完整运行目录，SteamPipe 复用该目录。
只需要目录包时运行 `pnpm run pack:win`。不要单独复制 `doctorgame.exe`。

仅凭打包成功不能认定 Windows 游戏捕获、全屏、Vanguard、长时间录制和帧率影响通过。
当前识别与灵敏度规则仍属实验方案，没有真实录像准确率或提升效果保证。
