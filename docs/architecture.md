# Architecture / 架构

Character Studio is a local-first workbench. The same business service supplies a browser UI, a fixed agent CLI, and an optional MCP Apps entry point. Users do not need a central account or a hosted database.

## Components

| Component | Responsibility |
|---|---|
| `src/store.mjs` | Local assets, task snapshots, pause/cancel, result persistence, cross-process write locking |
| `src/catalog.mjs` | Read approved gallery metadata, filter references, cache the catalog |
| `src/server.mjs` | Shared tool operations, loopback HTTP service, optional stdio MCP service |
| `src/cli.mjs` | Start/reuse the local service and expose fixed commands to agents |
| `src/agent-bridge.mjs` | An actual active-agent wait request, task handoff, connection state, timeout handling |
| `src/codex-executor.mjs` | Local Codex App Server execution using an existing login |
| `src/runninghub-client.mjs` | Personal RunningHub app/workflow upload, submission, polling, and output retrieval |
| `src/provider-credentials.mjs` | Provider-specific local key storage and redaction boundaries |
| `src/ui.mjs` / `src/workbench.html` | Selection, direct generation, progress, settings, and result history |

## Task lifecycle

The draft records the portrait, outfits, poses, prompt, ratio, and provider. Submitting creates independent outfit × pose tasks with snapshots of the chosen provider and preset. Later settings edits do not silently change a submitted batch.

Before generation, a worker receives the portrait and the selected outfit and pose references. A successful result must contain real image bytes or a readable output file. Failed tasks record their actual reason; independent later tasks can continue.

## Agent connection

An embedded MCP Apps view can send a user-initiated message to a compatible host. The browser fallback uses a running agent's CLI `wait` request. The returned task is already claimed. The agent inspects references, invokes its own image tool, and records the result through CLI `result`.

This does not create a universal background wake-up interface. A browser cannot wake an ended agent chat. Connection loss, missing tools, and timeout must remain visible rather than being treated as successful execution.

## Storage and installation

Program versions live under `%LOCALAPPDATA%\CharacterStudio`. The installer validates the ZIP checksum and file manifest, then updates a version pointer. User data stays in `~/.character-studio`, independently of program upgrades. `CHARACTER_STUDIO_HOME` can override that location for development and isolated tests.

The HTTP service accepts loopback requests with matching Host/Origin. The launcher checks service identity, build identity, and data-directory identity before reusing a daemon. An unrelated occupied port is not assumed to be this workbench.

## 中文概要

队列、缓存、存储与生图执行逻辑只维护一套，CLI 和 MCP 复用它。安装程序处理依赖和版本，用户数据独立保存。宿主原生生图、内嵌展示和消息唤起分别验证，不把安装成功当作生图已适配。
