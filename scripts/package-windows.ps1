param([string]$NodeVersion='24.14.0')
$ErrorActionPreference='Stop'
$studioBuildRoot=Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $studioBuildRoot
try {
  & node scripts/build.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-runtime.ps1 -NodeVersion $NodeVersion
  if ($LASTEXITCODE -ne 0) { throw 'Runtime preparation failed.' }
  $studioPackage=Join-Path $studioBuildRoot '.local\distribution\character-studio-windows-x64'
  $studioRuntime=Join-Path $studioBuildRoot ".local\runtime\node-v$NodeVersion-win-x64"
  & node scripts/package-agent.mjs $studioPackage --runtime-dir $studioRuntime
  if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
  $studioZip="$studioPackage.zip"
  # Exclude developer MCP configuration. The release installs without touching it.
  $studioFiles=@('dist','runtime','skills','character-studio.cmd','manifest.json','install.ps1','INSTALL.md','INSTALL.en.md','README.md','README.en.md','AGENT_SETUP.md','LICENSE','NOTICE.md') | ForEach-Object { Join-Path $studioPackage $_ }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Add-Type -AssemblyName System.IO.Compression
  $studioZipStream=[IO.File]::Open($studioZip,[IO.FileMode]::Create,[IO.FileAccess]::ReadWrite)
  $studioArchive=New-Object IO.Compression.ZipArchive($studioZipStream,[IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($studioInput in $studioFiles) {
      $studioEntries=if ([IO.Directory]::Exists($studioInput)) { [IO.Directory]::EnumerateFiles($studioInput,'*',[IO.SearchOption]::AllDirectories) } else { @($studioInput) }
      foreach ($studioEntry in $studioEntries) { $studioRelative=$studioEntry.Substring($studioPackage.Length+1).Replace('\','/'); $null=[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($studioArchive,$studioEntry,$studioRelative,[IO.Compression.CompressionLevel]::Optimal) }
    }
  } finally { $studioArchive.Dispose(); $studioZipStream.Dispose() }
  $studioHashStream=[IO.File]::OpenRead($studioZip); $studioHasher=[Security.Cryptography.SHA256]::Create()
  try { $studioHash=[BitConverter]::ToString($studioHasher.ComputeHash($studioHashStream)).Replace('-','').ToLowerInvariant() } finally { $studioHashStream.Dispose(); $studioHasher.Dispose() }
  [IO.File]::WriteAllText("$studioZip.sha256", "$studioHash  character-studio-windows-x64.zip`n", (New-Object Text.UTF8Encoding $false))
  Get-Item -LiteralPath $studioZip | Select-Object FullName,Length
} finally { Pop-Location }
