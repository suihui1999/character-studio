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
  $studioLauncher=Join-Path $studioBuildRoot '.local/distribution/portable-launcher.exe'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-launcher.ps1 -Output $studioLauncher
  if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
  & node scripts/package-agent.mjs $studioPackage --runtime-dir $studioRuntime --launcher $studioLauncher
  if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
  $studioZip="$studioPackage.zip"
  # Exclude developer MCP configuration. The release installs without touching it.
  $studioFiles=@('dist','runtime','skills','Character Studio.exe','character-studio.cmd','manifest.json','install.ps1','INSTALL.md','INSTALL.en.md','README.md','README.en.md','AGENT_SETUP.md','LICENSE','NOTICE.md') | ForEach-Object { Join-Path $studioPackage $_ }
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
  $studioExe=Join-Path $studioBuildRoot '.local/distribution/Character-Studio-Windows-x64.exe'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-launcher.ps1 -Output $studioExe -PackagePath $studioZip
  if ($LASTEXITCODE -ne 0) { throw 'Single-file EXE compilation failed.' }
  $studioExeStream=[IO.File]::OpenRead($studioExe);$studioExeHasher=[Security.Cryptography.SHA256]::Create()
  try {$studioExeHash=[BitConverter]::ToString($studioExeHasher.ComputeHash($studioExeStream)).Replace('-','').ToLowerInvariant()} finally {$studioExeStream.Dispose();$studioExeHasher.Dispose()}
  [IO.File]::WriteAllText("$studioExe.sha256", "$studioExeHash  Character-Studio-Windows-x64.exe`n", (New-Object Text.UTF8Encoding $false))
  Get-Item -LiteralPath $studioZip,$studioExe | Select-Object FullName,Length
} finally { Pop-Location }
