# Generation providers / 生图渠道

## Current agent / 当前 Agent

Use the tools actually exposed in the current session. The agent must be able to inspect the portrait, outfit, and pose images; generate an image; and obtain real output bytes or a local file. A skill cannot grant those capabilities.

浏览器模式需要 Agent 保持真实的等待连接。没有工具时，工作台显示原因；不使用占位图，不自行修改被拒绝的请求，也不自动切换收费渠道。

## Local Codex / 本机 Codex

The local executor uses an existing ChatGPT login through Codex App Server. It does not ask for an OpenAI API key. A successful login check does not guarantee that the account/session has an available image-generation tool.

本机需要可用的 Codex。登录、连接或生成失败会显示实际原因；当前任务完成或失败后，再领取下一项，并遵守样图确认、暂停和取消。

## RunningHub China and Global / 国内站与国际站

The two sites have separate keys and model presets. This integration uses personal AI application and ComfyUI workflow APIs, not enterprise model APIs.

1. 在“生图设置”中选择国内站或国际站，填写自己的个人版 Key 并测试连接。
2. 添加 AI 应用或工作流链接／ID，读取输入字段。
3. 高级配置将主角、服装、姿势、提示词和比例对应到应用输入。也支持明确配置三图列表输入。
4. 保存后在主界面选择该模型，再提交生成。

Recommended presets are not yet bundled. Advanced users can import their own link and field mappings; future recommended presets will reduce this setup. A JSON/cURL example is parsed as data, never executed. Provide the target link/ID as well when importing an example.

Each submitted task keeps its original provider and preset snapshot. A remote task ID is retained when available. Cancellation stops local work and polling, but a task already submitted to RunningHub may still run; manage that task on the provider's site if necessary.

## Keys and output

Enter keys in the local settings, not in chat or GitHub issues. Windows storage uses the current user's DPAPI protection. The optional development environment variables are `RUNNINGHUB_CN_API_KEY` and `RUNNINGHUB_GLOBAL_API_KEY`; no `.env` file is loaded automatically.

The current version has no general adapter for arbitrary image APIs. Adding a key from an unrelated service does not make it a supported provider.
