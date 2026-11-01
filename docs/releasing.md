# Release process / 发布流程

The main branch contains source, the prebuilt native-plugin entry point, and public documentation. End-user Windows binaries are release assets, not Git blobs.

## Validate

```powershell
npm ci
npm run build
npm test
python -X utf8 tests/browser.py
python -X utf8 tests/browser_auto.py
python -X utf8 tests/browser_personal.py
python -X utf8 tests/browser_cli.py
npm run package:windows
```

Windows packaging verifies the official pinned Node runtime before bundling it, includes its license, and creates:

- `.local/distribution/character-studio-windows-x64.zip`
- `.local/distribution/character-studio-windows-x64.zip.sha256`

Test the final ZIP with `scripts/install.ps1 -PackagePath <zip> -InstallRoot <isolated-test-folder> -NoOpen`. Run the installed bundled runtime, rather than relying on development dependencies. Confirm repeat open reuses the same daemon and preserves user data.

## Publish

Update the package/plugin version, changelog, and bilingual documentation. Commit the reviewed source, build output, and documentation. Tag that commit and publish both assets on the same stable GitHub Release; the installer uses the latest stable release endpoint.

When using GitHub CLI, write release notes into a UTF-8 file and pass `--notes-file`. Verify the published asset names, sizes, and SHA-256. Then test installation through the public repository URL in an isolated application directory.

The Windows workflow runs tests and uploads a build artifact. It does not automatically publish a release or include local portraits, keys, generated images, or internal planning notes.

## Acceptance boundaries

Separate transport/storage tests from real native generation. A protocol fixture cannot certify Doubao or another host's image tool. Only mark a host as verified after it opens the workbench, receives a submitted task, generates a real image from all three references, and returns a readable output file or bytes.

Do not publish personal screenshots as demo assets. Use purpose-made, non-private samples and describe whether they show actual generation or a UI-only example.
