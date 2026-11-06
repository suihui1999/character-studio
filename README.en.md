# Character Studio

[简体中文](README.md) · [English](README.en.md)

[![Windows](https://img.shields.io/badge/Windows-x64-0078D4)](https://github.com/web3suihuiji-ctrl/character-studio/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://github.com/web3suihuiji-ctrl/character-studio/actions/workflows/windows.yml/badge.svg)](https://github.com/web3suihuiji-ctrl/character-studio/actions/workflows/windows.yml)

A local character image workbench for people new to AI. Pick a character from the portrait gallery or upload one, select outfits and poses, and generate images using an agent's existing image tools or a supported image API.

## Install and open

**Open directly on your Windows computer:**

- [Download the EXE](https://github.com/web3suihuiji-ctrl/character-studio/releases/latest/download/Character-Studio-Windows-x64.exe) and double-click it. The first launch prepares the application and opens the workbench in your browser.
- [Download the ZIP](https://github.com/web3suihuiji-ctrl/character-studio/releases/latest/download/character-studio-windows-x64.zip), extract everything, and double-click **Character Studio.exe**. Keep the adjacent `runtime`, `dist`, and other folders together.

Both downloads are approximately 40 MB and include the runtime. Node.js installation and administrator access are not required. Images and settings stay in the same local data directory. The EXE is currently unsigned. API generation uses the selected service's key; native agent generation still requires the relevant agent and executor.

**Open through an agent:**

Send this message to an agent that can run programs on your Windows computer:

> Install and open https://github.com/web3suihuiji-ctrl/character-studio . Follow INSTALL.en.md, connect your existing image-generation tools, and wait for me to submit a task in the workbench.

The agent downloads a prebuilt Windows package and starts the workbench. The runtime is included: users do not need to install Node.js, configure an MCP connector, or download reference images individually. Doubao Work on desktop tries Doubao’s built-in browser first. Other compatible hosts can display the workbench inside the chat. If the built-in option cannot open the page, the agent uses the system browser.

[Download the Windows release](https://github.com/web3suihuiji-ctrl/character-studio/releases/latest). The download is approximately 40 MB and does not include the full external image libraries.

**Local Windows installation, task handoff, and result persistence are tested. Doubao Work's native image generation and output file compatibility still require testing in the target client.** The workbench UI is in Simplified Chinese.

## Create an image

1. Pick a portrait or upload a character reference.
2. Open an outfit or pose to preview it, then confirm your selection. You can select multiple references and show 6, 9, or 12 images per page.
3. Choose a generation provider and aspect ratio, then click Generate to submit the whole batch. You can preview the combinations first.

You can pause, cancel, or retry an individual image. The successful results dialog groups images by batch, with names, counts and ZIP downloads. Each result has a download icon in its lower-right corner for saving the original image. The generation panel lets you edit the default prompt.

The browser route requires an active agent. Alternatively, select Image API and choose OpenAI, Google Gemini, Volcengine Seedream, or a custom compatible endpoint. Use the small Key guide and Manage API Key buttons to configure the selected service in a dialog. The app never switches to a paid API automatically.

## Compatibility

| Component | Status |
|---|---|
| Windows x64 | Bundled runtime; local installation, repair, startup, and reuse tested |
| Codex | Local executor and MCP Apps entry point; generation depends on the account and available tools |
| Doubao Work | CLI entry point without MCP registration; native image output still needs client acceptance |
| Image APIs | Three built-in services and model presets, plus custom OpenAI image-edit, Gemini, and Seedream endpoints. Protocols and UI are tested against isolated fixtures; live access and quotas depend on the provider account. |
| macOS / Linux | No end-user distribution yet |

Choose one character, then an outfit, a pose, or both. Generated images return to the local successful results history. See [providers](docs/providers.md) and [troubleshooting](docs/troubleshooting.md).

## Local data and external libraries

Character references, cached assets, tasks, results, and settings live in `~/.character-studio`. Upgrading the application does not replace this directory. Do not send API keys in chat; enter them in the local settings. Generation failures are reported rather than replaced with placeholder images.

References come from the [portrait gallery](https://ai-portrait-gallery.pages.dev/), [depth pose gallery](https://ai-pose-depth-gallery.pages.dev/), and [costume gallery](https://ai-costume-gallery.pages.dev/). Thumbnails load while browsing, and full references download when needed.

The code is licensed under [MIT](LICENSE). External images and metadata are not covered by the project's MIT license; see [NOTICE](NOTICE.md).

## Development

Node.js 22.12+ is required for source development. End users use the bundled runtime instead.

```powershell
npm ci
npm run build
npm test
python -m pip install playwright==1.61.0
python -m playwright install chromium
python -X utf8 tests/browser.py
python -X utf8 tests/browser_auto.py
python -X utf8 tests/browser_personal.py
python -X utf8 tests/browser_cli.py
npm run package:windows
```

Windows packaging produces a ZIP and SHA-256 sidecar under `.local/distribution/`. Both files must be uploaded to the same GitHub Release for automatic installation.

[Contributing](CONTRIBUTING.md) · [Architecture](docs/architecture.md) · [Changelog](CHANGELOG.md) · [Releasing](docs/releasing.md) · [Report an issue](https://github.com/web3suihuiji-ctrl/character-studio/issues/new/choose) · [Security](SECURITY.md)
