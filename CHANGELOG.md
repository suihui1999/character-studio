# Changelog / 版本记录

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
