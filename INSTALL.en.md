# Agent installation and startup

[简体中文](INSTALL.md) · [English](INSTALL.en.md)

Carry out installation for the user. Do not ask a beginner to install Node.js, enter commands, configure MCP, or download reference images. The user handles only permissions genuinely required by their host or operating system.

## Windows installation

1. Check that this session can execute programs on the user's computer. If it cannot, explain the limitation and stop. Do not spend time using Computer Use to configure an MCP connector.
2. Read `scripts/install.ps1` from the repository, save it to a temporary local path, and run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File <absolute-path-to-install.ps1> -Repository web3suihuiji-ctrl/character-studio
   ```

   The installer downloads `character-studio-windows-x64.zip` and its `.sha256` sidecar from the latest stable GitHub Release. It verifies the package and installs into `%LOCALAPPDATA%\CharacterStudio`. It includes its own runtime and does not register MCP or change other agents' settings.
3. Read `%LOCALAPPDATA%\CharacterStudio\current.json`. Its `path` points to the installed version. Read `skills/character-studio/SKILL.md` inside that directory and follow its task-handling instructions.

For local release acceptance, the same installer accepts `-PackagePath <absolute-zip-path>`. The checksum sidecar must be next to the ZIP. These are agent/developer steps, not tasks for an end user.

If no compatible release exists, say so. Do not invent a release URL or make the user configure a development environment.

## Already installed

Resolve the installed directory from `current.json`. Execute its `runtime/node.exe` with the absolute path to `dist/cli.mjs`, followed by `open --executor agent`. Use the bundled executable regardless of whether system Node.js is installed.

If a functioning native Character Studio MCP Apps connection is already present, prefer `open_workbench(executor:"agent")` for an embedded view. Otherwise the CLI starts or reuses the local server and opens the browser. `--no-browser` is available when you will open the returned URL in a host panel yourself.

## Connect the actual image tools

The installed Skill describes `wait`, `result`, `doctor`, and the other fixed commands. Verify that the session can inspect all three references, generate an image, and retrieve its real local output path or bytes. Establish a real waiting request before telling the user to click Generate.

If the host lacks these tools, report the actual limitation through `unavailable`. Let the user explicitly choose another configured provider; never silently switch to a paid API. The browser cannot wake an agent chat that has ended.

Report progress in plain language: downloading, starting, opened, or the specific failure. User data remains in `~/.character-studio`, separate from versioned program files.
