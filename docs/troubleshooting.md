# Troubleshooting / 常见问题

## 安装后没有打开 / Nothing opened after installation

在原来的 Agent 聊天里说“打开 Character Studio 工作台”。Agent 应读取安装目录指针，运行随包 CLI 的 open 或 doctor，而不是转到 MCP 设置页面。安装包带运行环境，用户无需另装 Node。

Ask the installing agent to open Character Studio again and check `doctor`. If the host cannot execute programs on your computer, it must explain that limitation. Source downloads are for developers; ordinary users should use the prebuilt Windows release.

## 显示等待 Agent 连接 / Waiting for an agent

浏览器无法唤醒已经结束的聊天。在支持本机程序执行的 Agent 中重新说“打开人物工作台”，让它建立 wait 请求。不要把提示词或 Key 从工作台来回复制。

The CLI browser route requires an active agent wait request. Connection is separate from image-generation capability: the session must have the actual tools as well.

## 原生生图不可用 / No native image tool

安装技能不会解锁客户端没有提供的工具。查看工作台中的具体原因；可以由用户选择已配置的 RunningHub 渠道。不要把“会看图”当成“会生图”。

The agent must report unavailable tools rather than simulate success, generate a placeholder, or silently switch to a paid API.

## 有 Key 但没有可选模型 / Key saved, no model available

Key 只负责连接账户，还需要 AI 应用或工作流预设。当前版本没有附带推荐预设；高级用户可以在设置里导入自己的链接。请不要在公开 Issue 中发送 Key。

## 图库加载失败 / Gallery loading failed

点击图库刷新按钮重试。素材来自外部网站，需要网络连接。缓存清单不等于所有原图都已下载；本次生成需要的原图会自动准备。原站改变数据格式或无法访问时，应显示错误，不要求用户逐张手动补图。

## 图片生成失败或被拒绝 / Generation failed or rejected

查看当前任务或批次的具体原因。单项失败会跳过并继续下一项独立任务；不会自动改写请求绕过安全检查。账号或连接问题可能暂停整批。成功结果在“成功记录”中，默认折叠。

## 升级与数据 / Updates and data

程序版本和用户数据分开。默认数据在 `~/.character-studio`，包含主角、参考缓存、记录和设置。不要把整个目录发到 GitHub。安装包校验失败时旧版本保留，重新获取完整发行包即可。

## Still stuck? / 仍然有问题？

Open a [bug report](https://github.com/web3suihuiji-ctrl/character-studio/issues/new/choose) with the application version, host, operating system, steps, and the visible error. Remove keys, private images, and personal paths from any attached logs.
