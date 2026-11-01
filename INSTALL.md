# 给 Agent 的安装与打开步骤

[简体中文](INSTALL.md) · [English](INSTALL.en.md)

目标用户是 AI 小白。用户说“安装并打开这个项目”时，由你执行下列步骤，用户只需处理宿主或系统必须的授权。不要求用户输入命令、安装 Node、配置 MCP 或手动下载参考图。

## Windows 首次安装

1. 确认本会话可以执行本机命令。不能执行时明确说明限制，停止；不要转去用 Computer Use 长时间尝试填写 MCP 设置。
2. 根据用户提供的 GitHub 项目链接确定 `owner/repo`。读取该仓库 `scripts/install.ps1`，下载到临时目录，然后执行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File <下载的install.ps1完整路径> -Repository web3suihuiji-ctrl/character-studio
   ```

   脚本从该仓库的最新 GitHub Release 下载 `character-studio-windows-x64.zip` 和同名 `.sha256` 文件，校验后安装到当前用户的 `%LOCALAPPDATA%\CharacterStudio`。运行环境已随包提供，不执行 npm 安装，不注册 MCP，不改其他 Agent 的连接配置。
3. 发布前的本机验收，可用同一脚本的 `-PackagePath <本地发行ZIP路径>`。同目录须有 `.zip.sha256`。这是给开发测试用的参数，不让小白寻找路径。
4. 读取 `%LOCALAPPDATA%\CharacterStudio\current.json` 的 `path`，确认安装目录。读取该目录的 `skills/character-studio/SKILL.md`，按技能继续连接并等待用户在工作台提交。

如果 GitHub 发行页没有上述两个文件，说明“没有可用的自动安装发行包”，不要编造下载地址或临时让小白配置开发环境。

## 已经安装

读取上述 `current.json`，运行其中目录的 `runtime/node.exe`，参数为该目录的 `dist/cli.mjs open --executor agent`。安装包自身带运行环境，忽略用户系统是否已有 Node。

如果宿主已经接好 Character Studio MCP Apps，优先调用原生 `open_workbench(executor:"agent")` 显示内嵌页面。否则用 CLI 自动打开本机浏览器；它负责启动和复用后台服务，端口被占用时会选用其他可用端口。

## 后续生图

按安装目录中的 Skill 执行。浏览器不会凭空唤起一个已经退出的聊天，因此必须建立真实的 Agent 等待请求后，才告诉用户可以在工作台点击生成。缺少原生生图能力时在工作台写明原因，引导用户选择已配置的 RH；不要自行切换付费渠道。

进度只向用户说明“正在下载／正在启动／已打开／具体失败原因”。参考图按需下载。用户自己的图片、Key 与记录继续保存在 `~/.character-studio`，升级不覆盖这些数据。
