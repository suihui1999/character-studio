# Generation providers / 生图渠道

## Current agent / 当前 Agent

Use the tools actually exposed in the current session. The agent must be able to inspect the portrait, outfit, and pose images; generate an image; and obtain real output bytes or a local file. A skill cannot grant those capabilities.

浏览器模式需要 Agent 保持真实的等待连接。没有工具时，工作台显示原因；不使用占位图，不自行修改被拒绝的请求，也不自动切换收费渠道。

## Local Codex / 本机 Codex

The local executor uses an existing ChatGPT login through Codex App Server. It does not ask for an OpenAI API key. A successful login check does not guarantee that the account/session has an available image-generation tool.

本机需要可用的 Codex。登录、连接或生成失败会显示实际原因；当前任务完成或失败后，再领取下一项，并遵守暂停和取消。

## Image APIs / 生图 API

工作台只显示「当前 Agent 生图」和「生图 API」。选择 API 后，服务与模型已预设，Key 通过「管理 API Key」弹窗填写。每个服务独立保存 Key。主角始终是一位，服装和姿势可选其一或同时提供。

| 服务 | 预设模型 | 获取 Key |
|---|---|---|
| OpenAI | GPT Image 2、2.5 Sunburst、1.5 | [API keys](https://platform.openai.com/api-keys) |
| Google Gemini | Gemini 3.1 Flash Image、3 Pro Image、2.5 Flash Image | [Google AI Studio](https://aistudio.google.com/api-keys) |
| 火山方舟 | Seedream 4.5、5.0 Lite、4.0 | [方舟 API Key](https://ark.volcengine.com/region:cn-beijing/apikey) |
| 自定义兼容 API | 服务商提供的模型 ID | 在服务商后台创建 |

「获取 Key 教程」提供对应官方平台链接和三步说明。OpenAI 的 ChatGPT 订阅和 API 结算分开。API 生图按所选服务计费，账号地区、模型权限、额度需在对应平台确认。

Connection checks only read model metadata. They do not generate an image or verify image output. A paid test uses the first selected combination, requires an explicit fee confirmation, and leaves the user's batch and references intact. API requests send the actual selected reference images and rendered prompt; every returned PNG/JPEG/WebP is validated and saved locally, with a 12 MB output limit. No fallback images are used.

自定义 API 支持 OpenAI 图片编辑（multipart 多图上传／JSON images 列表）、Gemini generateContent 和 Seedream images/generations。接口地址填写到版本前缀，例如 `https://example.com/v1`。必须支持多图参考；只支持文生图或仅提供聊天接口的服务不适用。默认协议为 OpenAI 图片编辑多图上传。服务商需要支持相应模型信息查询才能完成免生图的连接验证。

Each task snapshots its service, model, custom endpoint and protocol. Changing settings cannot reroute an already submitted batch. Cancellation stops local waiting and subsequent requests; a request already accepted by the provider may continue and incur charges. The app never automatically retries an uncertain request or switches providers.

## Keys and output

Key 只在本机弹窗填写，不发到聊天或 GitHub。Windows 使用当前用户的 DPAPI 加密保存。开发环境可使用 `OPENAI_API_KEY`、`GEMINI_API_KEY`、`ARK_API_KEY`、`CHARACTER_STUDIO_IMAGE_API_KEY`；环境变量优先于本机保存值，不自动读取 .env。

RunningHub 已从工作台移除。旧成功图片、批次与模型名称保留；未完成的旧渠道任务不会自动迁移到收费 API。

## API contracts / 接口依据

- [OpenAI image editing](https://developers.openai.com/api/reference/resources/images/methods/edit): JSON images data URLs, multipart image inputs, PNG/base64 results.
- [Google Gemini image generation](https://ai.google.dev/gemini-api/docs/generate-content/image-generation): generateContent, inlineData, responseModalities and imageConfig.
- [Volcengine Seedream](https://docs.volcengine.com/docs/ark/image-generation-tutorial?lang=zh): images/generations, multi-image references, model IDs and sizes.
- [Volcengine models API](https://console.volcengine.com/ark/region%3Acn-beijing/docs/models-api): non-generating model-list connection check.

Protocol tests use isolated local services. This does not claim that a user's account, region or balance has been tested against live paid endpoints.
