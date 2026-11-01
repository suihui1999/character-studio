# Character Studio

[简体中文](README.md) · [English](README.en.md)

[![Windows](https://img.shields.io/badge/Windows-x64-0078D4)](https://github.com/web3suihuiji-ctrl/character-studio/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://github.com/web3suihuiji-ctrl/character-studio/actions/workflows/windows.yml/badge.svg)](https://github.com/web3suihuiji-ctrl/character-studio/actions/workflows/windows.yml)

A local character image workbench for people new to AI. Upload a character, select outfits and poses, and generate images using an agent's existing image tools or your own RunningHub account.

## Install and open

Send this message to an agent that can run programs on your Windows computer:

> Install and open https://github.com/web3suihuiji-ctrl/character-studio . Follow INSTALL.en.md, connect your existing image-generation tools, and wait for me to submit a task in the workbench.

The agent downloads a prebuilt Windows package and starts the workbench. The runtime is included: users do not need to install Node.js, configure an MCP connector, or download reference images individually. Compatible hosts can display the workbench inside the chat; otherwise it opens in the local browser.

[Download the Windows release](https://github.com/web3suihuiji-ctrl/character-studio/releases/latest). The download is approximately 35 MB and does not include the full external image libraries.

**Version 0.3.0 is an early release. Local Windows installation, task handoff, and result persistence are tested. Doubao Work's native image generation and output-file compatibility still require testing in the target client. Installing a skill does not grant an agent new image-generation capabilities.** The current workbench UI is in Simplified Chinese.

## Create an image

1. Upload your character reference.
2. Select one or more outfits and poses.
3. Click Generate. By default, review the first sample before continuing the batch.

You can pause, cancel, retry an individual image, or expand the saved success history. Prompt editing and combination previews are available under expandable generation options.

The browser route requires a connected, running agent. It cannot wake a chat that has already ended. If native generation is unavailable, you can explicitly choose RunningHub China or Global and enter your personal API key in the local workbench. Automatic switching to paid providers is disabled.

## Compatibility

| Component | Status |
|---|---|
| Windows x64 | Bundled runtime; local installation, repair, startup, and reuse tested |
| Codex | Local executor and MCP Apps entry point; generation depends on the account and available tools |
| Doubao Work | CLI entry point without MCP registration; native image output still needs client acceptance |
| RunningHub China / Global | Personal AI application and workflow APIs; requires your key and a model preset |
| macOS / Linux | No end-user distribution yet |

Recommended RunningHub model presets are not bundled with this version. Advanced users can import their own applications or workflows. See [providers](docs/providers.md) and [troubleshooting](docs/troubleshooting.md).

## Local data and external libraries

Character references, cached assets, tasks, results, and settings live in `~/.character-studio`. Upgrading the application does not replace this directory. Do not send API keys in chat; enter them in the local settings. Generation failures are reported rather than replaced with placeholder images.

Pose references come from the [depth pose gallery](https://ai-pose-depth-gallery.pages.dev/), and outfits from the [costume gallery](https://ai-costume-gallery.pages.dev/). Catalog metadata is cached locally; thumbnails load while browsing, and full references download when needed. This project does not bundle those image collections.

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
