# Agent installation and startup

[简体中文](INSTALL.md) · [English](INSTALL.en.md)

Windows users can also double-click the release EXE, or extract the ZIP and double-click `Character Studio.exe`. The commands below are the agent installation path; users do not need to type them.

Carry out installation for the user. Do not ask a beginner to install Node.js, enter commands, configure MCP, or download reference images. The user handles only permissions genuinely required by their host or operating system.

## Windows installation

1. Check that this session can execute programs on the user's computer. If it cannot, explain the limitation and stop. Do not spend time using Computer Use to configure an MCP connector.
2. Read `scripts/install.ps1` from the repository, save it to a temporary local path, and run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File <absolute-path-to-install.ps1> -Repository web3suihuiji-ctrl/character-studio -NoBrowser
   ```

   The installer verifies the Windows release package and installs it into `%LOCALAPPDATA%\CharacterStudio`. With `-NoBrowser` it starts the local service and returns its `url` in the final JSON line so the agent can open it in its own browser.
3. Read `%LOCALAPPDATA%\CharacterStudio\current.json`. Its `path` points to the installed version. Read `skills/character-studio/SKILL.md` inside that directory and follow its task-handling instructions.

For local release acceptance, the same installer accepts `-PackagePath <absolute-zip-path>`. The checksum sidecar must be next to the ZIP. These are agent/developer steps, not tasks for an end user.

If no compatible release exists, say so. Do not invent a release URL or make the user configure a development environment.

## Already installed

Resolve the installed directory from `current.json`. Execute its `runtime/node.exe` with the absolute path to `dist/cli.mjs`, followed by `open --executor keep --no-browser`. If the installer just returned a URL, use it directly.

## Display the workbench

1. In the **Doubao Work desktop app**, run `open --executor keep --no-browser --host doubao` with the bundled CLI. Open the exact returned URL in the built-in browser and confirm that the page is interactive.
2. Other hosts can use an existing Character Studio MCP Apps connection via `open_workbench(executor:"agent")`, or display the returned URL in a local browser panel.
3. If the host cannot display the local page, run `open --executor keep` with the bundled CLI to open it in the system browser. Add `--host doubao` for Doubao Work to keep its handoff instructions.

## Connect the actual image tools

The installed Skill describes the connection and batch workflow. Doubao Work users can submit first, then send “处理工作台里待生成的图片” in Doubao to hand off the whole batch. Other hosts can establish a waiting connection as described in the Skill. Verify that the session can inspect the supplied references, generate an image, and retrieve its real local output path or bytes.

If the host lacks these tools, report the actual limitation through `unavailable`. Let the user explicitly choose another configured provider; never silently switch to a paid API. The browser cannot wake an agent chat that has ended.

Report progress in plain language: downloading, starting, opened, or the specific failure. User data remains in `~/.character-studio`, separate from versioned program files.
