# Changelog / 版本记录

## 0.4.2 — 2026-11-07

- GitHub 项目地址更新为 `suihui1999/character-studio`，同步中英文安装指令、下载按钮、状态徽章、项目元数据和反馈入口。
- Windows EXE 和 ZIP 随包说明同步使用新地址。
- Update all installation instructions, download links, badges, metadata and support links to `suihui1999/character-studio`, including the Windows package documentation.

## 0.4.1 — 2026-11-06

- 下载按钮立即显示简短浮层提示，约 2 秒自动消失；下载失败显示具体原因，停留 5 秒。
- 人像、服装、姿势详情页、成功记录和批次 ZIP 下载共用反馈。下载提示注明由浏览器设置的下载文件夹保存。
- Show compact download feedback immediately, dismiss it automatically, and report preparation failures. Cover all three galleries, generated images and batch ZIP downloads. Indicate that the browser's download settings control the save location.

## 0.4.0 — 2026-11-06

- 新增可独立下载、双击自动准备并打开工作台的 Windows EXE，以及内含启动 EXE 的解压即用 ZIP。
- 成功记录按批次管理，可命名、打包下载；三库详情页和成功记录提供统一的单张原图下载图标。
- 区分账号登录、执行器连接与生图能力，首次使用提供可切换的图解指南。
- Add a self-contained double-click Windows EXE and a portable ZIP with its own GUI launcher. Add batch histories, original-image downloads, capability checks and beginner guides.

- 移除工作台 RunningHub 入口与内置工作流，保留旧成功记录。
- 新增「生图 API」，预设 OpenAI、Google Gemini、火山方舟 Seedream，支持自定义兼容接口与多图参考。
- 沿用小按钮与弹窗管理 Key，教程按服务显示官方链接；启动指南改为 Agent／API 图解。
- Replace RunningHub with image API presets and custom compatible endpoints; preserve historical results. Add per-service key dialogs and guides, multi-reference requests, non-generating connection checks, and real image persistence.

## 0.3.1 — 2026-11-03

- 内置 RunningHub 国内站和国际站的 Qwen 2.1 换装与姿势工作流。添加消费级 Key 获取图解和图片比例选择。
- 增加人像库选角，支持上传替换唯一主角。上传入口显示在预览图上方。
- 简化生成区与组合预览。默认提示词使用浅灰色无缝影棚背景。

- Bundle the Qwen 2.1 outfit and pose workflows for RunningHub China and Global. Add a personal API key guide and aspect ratio controls.
- Add portrait selection from the gallery and keep one active character. The upload button sits above the preview.
- Simplify the generation panel and combination preview. Use a light gray seamless studio backdrop by default.

## 0.3.0 — 2026-11-02

### 中文

- 增加 Windows 自带运行环境的发行包与校验文件；安装、重复安装和损坏修复无需配置 MCP。
- 增加 CLI 自动启动、连接诊断、等待任务、领取与回填接口。
- 浏览器提交可由真实 Agent 等待请求接收；退出、缺少工具或超时会显示状态。
- 主流程改为选好参考图后直接生成；组合预览和提示词放在展开选项中。
- 保留样图确认、暂停、取消、单项失败跳过、成功记录与原有用户数据。
- 增加中文与英文项目说明及 GitHub 测试打包流程。

### English

- Ship a Windows package with its own runtime, checksum verification, repeat-install reuse, and repair without MCP configuration.
- Add CLI startup, diagnostics, task waiting, claiming, and result recording.
- Connect browser submissions to an active agent waiter; report unavailable tools, disconnection, and timeout honestly.
- Generate directly from selected references; move combination previews and prompt editing into expandable options.
- Preserve sample approval, pause/cancel, failure skipping, success history, and existing local data.
- Add Chinese/English documentation and Windows CI packaging.

### Known limitations / 已知边界

Doubao native image-tool output still needs target-client acceptance. A running agent connection is required; the browser cannot wake an ended chat. Recommended RunningHub model presets are not included yet. No end-user macOS/Linux package is provided.
