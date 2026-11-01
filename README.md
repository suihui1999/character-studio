# Character Studio

[简体中文](README.md) · [English](README.en.md)

[![Windows](https://img.shields.io/badge/Windows-x64-0078D4)](https://github.com/web3suihuiji-ctrl/character-studio/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://github.com/web3suihuiji-ctrl/character-studio/actions/workflows/windows.yml/badge.svg)](https://github.com/web3suihuiji-ctrl/character-studio/actions/workflows/windows.yml)

给 AI 小白的人物生图工作台：上传主角，挑选衣服和姿势，点击生成。多套服装、多种姿势可以一起选择，图片和历史记录保存在自己的电脑。

## 安装并打开

在支持运行本机程序的豆包工作、Codex 等 Agent 中，发送本仓库的 GitHub 链接，并说：

> 安装并打开 https://github.com/web3suihuiji-ctrl/character-studio ，按 INSTALL.md 执行，连接你当前已有的生图能力，等待我在工作台提交。

Agent 会下载提前打包的 Windows 程序，启动工作台。运行环境随包提供，用户无需安装 Node、填写 MCP 参数或逐张下载图库素材。已有原生内嵌支持时显示在聊天里，否则自动打开本机浏览器。

也可以获取 [Windows 发行包](https://github.com/web3suihuiji-ctrl/character-studio/releases/latest)。包内带运行环境，下载约 35 MB，不包含整套图库。

**0.3.0 是早期版本。Windows 的本机安装、任务交接和结果回填已通过测试；豆包原生生图仍需目标客户端实机验收。安装技能不会为 Agent 增加它原本没有的生图能力。**

给执行安装的 Agent：[安装步骤](INSTALL.md)。请直接使用程序入口，不用 Computer Use 反复操作 MCP 设置页面。

## 开始创作

1. 上传一张主角图片。
2. 选择服装和姿势，可以多选。
3. 点击生成。默认先生成一张样图，满意后确认继续。

可以暂停后续任务、取消批次、重做单张；成功记录默认折叠。生成选项、组合预览和提示词编辑放在展开选项中。

当前 Agent 能实际调用生图工具时，使用它的原生能力。Agent 必须保持连接，退出或超时会显示原因；浏览器不会自行唤醒已经结束的聊天。没有原生能力时，可由用户选择 RunningHub 国内站／国际站个人消费级渠道，在工作台填写自己的 Key。推荐模型和工作流由项目作者后续提供；自行导入入口保留在生图设置中。

## 当前支持范围

| 项目 | 当前状态 |
|---|---|
| Windows x64 | 自带运行环境；本机安装、修复、启动与重复打开已测试 |
| Codex | 提供本机执行器和原生 MCP Apps 入口，实际生图取决于账号与当前工具 |
| 豆包工作 | 提供免配 MCP 的 CLI 接入；原生生图、真实文件输出仍待实机验收 |
| RunningHub 国内站／国际站 | 个人版 AI 应用和工作流接口；需自己的 Key 与模型预设 |
| macOS／Linux | 尚未提供面向普通用户的发行包 |

本版本暂未附带推荐 RH 模型预设。更多说明见[生图渠道](docs/providers.md)和[常见问题](docs/troubleshooting.md)。

## 数据与素材

主角、原图缓存、任务、生成结果和个人设置保存在本机 `~/.character-studio`。升级安装程序不会覆盖这些内容。Key 不需要发到聊天里，失败不会用占位图冒充生成结果。

姿势来自 [深度姿势图库](https://ai-pose-depth-gallery.pages.dev/)，服装来自 [服装图库](https://ai-costume-gallery.pages.dev/)。首次读取清单，浏览时加载缩略图，生成前自动下载需要的原图。安装包不打包整套第三方图库素材。

软件代码使用 [MIT](LICENSE) 许可；第三方图片与元数据不属于本项目的 MIT 授权，参见 [NOTICE](NOTICE.md)。

## 开发与验证

需要 Node.js 22.12+。开发者执行：

```powershell
npm ci
npm run build
npm test
python -X utf8 tests/browser.py
python -X utf8 tests/browser_auto.py
python -X utf8 tests/browser_personal.py
python -X utf8 tests/browser_cli.py
npm run package:windows
```

最后一个命令生成带独立运行环境的 Windows ZIP 和 `.sha256`，位于 `.local/distribution/`。发布者上传这两个文件到 GitHub Release 后，安装脚本才可通过项目链接下载它们。用户无需执行这些开发命令。

原生 Codex 插件的开发安装脚本为 `scripts/install-codex-dev.ps1`。欢迎提交问题与改进：

- [贡献指南](CONTRIBUTING.md) · [架构说明](docs/architecture.md)
- [版本记录](CHANGELOG.md) · [发布流程](docs/releasing.md)
- [问题反馈](https://github.com/web3suihuiji-ctrl/character-studio/issues/new/choose) · [安全问题](SECURITY.md)
