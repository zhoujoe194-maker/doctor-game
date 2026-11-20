# SteamPipe 发布准备

这里只准备 Windows x64 文件映射；没有登录 Steam、运行 steamcmd、上传构建、付费或设置 SetLive。

## 内容与启动项

先运行 `pnpm run dist:win`。独立 NSIS 安装器与 Steam 使用同一份
`release/0.2.0-beta.1/doctorgame-win32-x64/` 内容目录。整个目录包含 Electron、
Chromium 资源与白名单应用代码。Steam 安装后启动项相对安装根为 **`doctorgame.exe`**，
不需要 Node、pnpm、网页服务器或另外执行 NSIS 安装器。

不要把 `release` 总目录或 `installer` 子目录设为 ContentRoot。
不要加入玩家录像、登录凭证、签名材料、测试代码或开发依赖。
安装器与 depot 的文件清单由 `runtime-manifest.json` 和离线检查进行比对。

## 离线检查（本次范围）

```sh
python3 scripts/verify-steam.py
```

该命令读取两个 `.vdf.in` 模板，用临时数字 ID 与临时路径生成 VDF，调用项目
`steam-publish` skill 的校验器，按严格模式拒绝错误或警告。先用合成目录验证排除规则，
再列出真实打包目录的路径、字节数和 SHA-256，与安装器使用的运行目录逐文件对照。
输出在 `artifacts/steam-offline.json`；生产模板的占位符不会被改写。
只检查合成目录可加 `--synthetic-only`。这是文件映射检查，**不等于 Steam Preview 构建**。

## 将来由发布者执行

1. 取得 AppID、Windows DepotID 与 SDK 后，把 `.vdf.in` 复制为 `.vdf`，填入自己的 ID、
   版本、上述内容目录的绝对路径，以及内容目录之外的 BuildOutput。
2. 将 `depot_build_windows.vdf` 与 `app_build.vdf` 放在一起。
   在 Steamworks 设置 Windows 启动项 `doctorgame.exe`，并把 depot 加入相关 package。
3. 先运行 skill 的 `check_steam_build.py app_build.vdf --strict`。
   发布者另行决定何时登录构建账户，保留 `Preview 1` 进行 Steam 本身的 Preview。
4. Preview 日志及 manifest 验证通过后，实际上传和分支上线另行人工操作。
   模板不包含 SetLive。不要把密码、Steam Guard 验证码或 `config.vdf` 放进仓库或命令行。

Valve 的软件类别列出了 **Player Tools**；这可作为申请类别的参考，不代表本项目已获资格。
商店及构建审核、入驻资料和正式发布决定由发布者与 Valve 完成。
参见 [Valve 入驻与软件类别](https://partner.steamgames.com/doc/gettingstarted/onboarding)
和 [SteamPipe 构建上传说明](https://partner.steamgames.com/doc/sdk/uploading)。
