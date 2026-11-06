# 给 Agent 的安装与打开步骤

[简体中文](INSTALL.md) · [English](INSTALL.en.md)

普通 Windows 用户也可直接下载发行版 EXE，双击打开；或解压 ZIP 后双击 `Character Studio.exe`。下面的命令是给 Agent 执行的安装入口，用户不需要输入。

目标用户是 AI 小白。用户说“安装并打开这个项目”时，由你执行下列步骤，用户只需处理宿主或系统必须的授权。不要求用户输入命令、安装 Node、配置 MCP 或手动下载参考图。

## Windows 首次安装

1. 确认本会话可以执行本机命令。不能执行时明确说明限制，停止；不要转去用 Computer Use 长时间尝试填写 MCP 设置。
2. 根据用户提供的 GitHub 项目链接确定 `owner/repo`。读取该仓库 `scripts/install.ps1`，下载到临时目录，然后执行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File <下载的install.ps1完整路径> -Repository suihui1999/character-studio -NoBrowser
   ```

   脚本下载并校验 Windows 发行包，安装到当前用户的 `%LOCALAPPDATA%\CharacterStudio`，启动本机服务并在最后一行 JSON 返回 `url`。使用这个地址按下文打开页面。`-NoBrowser` 让 Agent 可以先在自己的浏览器中打开。运行环境已随包提供。
3. 发布前的本机验收，可用同一脚本的 `-PackagePath <本地发行ZIP路径>`。同目录须有 `.zip.sha256`。这是给开发测试用的参数，不让小白寻找路径。
4. 读取 `%LOCALAPPDATA%\CharacterStudio\current.json` 的 `path`，确认安装目录。读取该目录的 `skills/character-studio/SKILL.md`，按技能继续连接并等待用户在工作台提交。

如果 GitHub 发行页没有上述两个文件，说明“没有可用的自动安装发行包”，不要编造下载地址或临时让小白配置开发环境。

## 已经安装

读取上述 `current.json`，运行其中目录的 `runtime/node.exe`，参数为该目录的 `dist/cli.mjs open --executor keep --no-browser`。使用程序返回的 `url`。如果刚安装时已经取得该地址，直接使用即可。

## 打开工作台

1. **豆包工作桌面端**：运行随包 CLI 的 `open --executor keep --no-browser --host doubao`，用内置浏览器打开返回的完整 `url`，把可交互的页面展示给用户。
2. **其他宿主**：已有可用的 Character Studio MCP Apps 时，可调用原生 `open_workbench(executor:"agent")` 内嵌显示。也可用宿主提供的本地浏览器或页面面板打开返回的地址。
3. 当前宿主无法在内置浏览器显示本机页面时，运行随包 CLI 的 `open --executor keep`，自动用系统默认浏览器打开。豆包运行时附加 `--host doubao`，保留豆包引导。

## 后续生图

按安装目录中的 Skill 执行。豆包用户可先提交，再回豆包发送「处理工作台里待生成的图片」，一次接手整批。其他宿主按技能建立真实等待。缺少原生生图能力时在工作台写明原因，由用户选择「生图 API」并在本机弹窗配置。

进度只向用户说明“正在下载／正在启动／已打开／具体失败原因”。参考图按需下载。用户自己的图片、Key 与记录继续保存在 `~/.character-studio`，升级不覆盖这些数据。
