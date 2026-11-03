# Generation providers / 生图渠道

## Current agent / 当前 Agent

Use the tools actually exposed in the current session. The agent must be able to inspect the portrait, outfit, and pose images; generate an image; and obtain real output bytes or a local file. A skill cannot grant those capabilities.

浏览器模式需要 Agent 保持真实的等待连接。没有工具时，工作台显示原因；不使用占位图，不自行修改被拒绝的请求，也不自动切换收费渠道。

## Local Codex / 本机 Codex

The local executor uses an existing ChatGPT login through Codex App Server. It does not ask for an OpenAI API key. A successful login check does not guarantee that the account/session has an available image-generation tool.

本机需要可用的 Codex。登录、连接或生成失败会显示实际原因；当前任务完成或失败后，再领取下一项，并遵守暂停和取消。

## RunningHub China and Global / 国内站与国际站

The two sites have separate keys and model presets. This integration uses personal AI application and ComfyUI workflow APIs, not enterprise model APIs.

1. 选择国内站或国际站，点「获取 Key 教程」，按图解注册并登录。
2. 登录后点击右上角头像，进入「控制台」，在左侧打开「消费级-会员」。获取完整 API Key 后回到工作台验证并保存。
3. 工作台自动选择内置的 Qwen 2.1 换装与姿势工作流。选好主角、服装和姿势后即可生成。

The bundled Qwen 2.1 workflow IDs are `2117565399293321218` for China and `2117590622597468162` for Global. Both require a portrait, outfit, and pose. Available aspect ratios are 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, and 21:9.

Each submitted task keeps its original provider and preset snapshot. A remote task ID is retained when available. Cancellation stops local work and polling, but a task already submitted to RunningHub may still run; manage that task on the provider's site if necessary.

## Keys and output

Enter keys in the local settings, not in chat or GitHub issues. Windows storage uses the current user's DPAPI protection. The optional development environment variables are `RUNNINGHUB_CN_API_KEY` and `RUNNINGHUB_GLOBAL_API_KEY`; no `.env` file is loaded automatically.

The current version has no general adapter for arbitrary image APIs. Adding a key from an unrelated service does not make it a supported provider.
