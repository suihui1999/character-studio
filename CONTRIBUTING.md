# Contributing / 贡献指南

感谢帮助 Character Studio 变得更容易使用。中文和英文问题反馈、文档改进、代码贡献都欢迎。

Our audience is new to AI. Keep installation and everyday use simple; put developer configuration behind appropriate advanced entry points. Chinese and English contributions are welcome.

## Local setup

Use Node.js 22.12+; the Windows release currently bundles a pinned Node 24 runtime. Python and Playwright are needed only for browser checks.

```powershell
npm ci
npm run build
npm test
python -m pip install playwright==1.61.0
python -m playwright install chromium
```

Execution-flow changes must pass the applicable browser tests:

```powershell
python -X utf8 tests/browser.py
python -X utf8 tests/browser_auto.py
python -X utf8 tests/browser_cli.py
python -X utf8 tests/browser_personal.py
```

The last command covers RunningHub. Tests use isolated temporary data, synthetic catalogs, and explicit image-byte fixtures. They do not require a real API key or perform real image generation. Do not make tests depend on a contributor's private data or downloaded catalog cache.

## Pull requests

- Explain the user-visible problem and resulting behavior.
- Include relevant validation; for UI changes, attach a screenshot made with non-private sample data.
- Keep prompt and reference data separate from executable instructions.
- Keep MCP and CLI entry points on the same queue, storage, and provider logic.
- Do not claim host compatibility based only on successful installation or a mocked test.
- Do not commit `.local/`, real portraits, generated images, credentials, or provider keys.

Small documentation changes do not need unrelated test runs. For substantial behavior changes, open an issue describing the intended outcome before undertaking a large rewrite.

## Packaging

On Windows, `npm run package:windows` builds the precompiled package, prepares the pinned official runtime, and writes a ZIP plus checksum sidecar. See [release instructions](docs/releasing.md).

By contributing, you agree that your contribution is distributed under this repository's [MIT license](LICENSE). External gallery images retain their own terms.
