param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$studioProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $studioProjectRoot
try {
    if (-not $SkipBuild) {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    }
    & codex plugin marketplace add $studioProjectRoot --json
    if ($LASTEXITCODE -ne 0) { throw 'Marketplace registration failed.' }
    & codex plugin add 'character-studio@character-studio-local' --json
    if ($LASTEXITCODE -ne 0) { throw 'Plugin installation failed.' }
    Write-Output 'Installed. Restart Codex, then invoke $character-studio in a new local chat.'
} finally {
    Pop-Location
}
