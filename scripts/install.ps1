param(
  [string]$Repository,
  [string]$PackagePath,
  [string]$ChecksumPath,
  [string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'CharacterStudio'),
  [switch]$NoOpen,
  [switch]$NoBrowser
)
$ErrorActionPreference='Stop'
function Get-StudioHash([string]$File) {
  $studioStream=[IO.File]::OpenRead($File); $studioHasher=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($studioHasher.ComputeHash($studioStream)).Replace('-','').ToLowerInvariant() } finally { $studioStream.Dispose(); $studioHasher.Dispose() }
}
$studioInstall=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($studioInstall -eq [IO.Path]::GetPathRoot($studioInstall).TrimEnd('\')) { throw 'InstallRoot must be a dedicated application directory.' }
New-Item -ItemType Directory -Path $studioInstall -Force | Out-Null
function Assert-StudioChild([string]$Candidate) {
  $studioResolved=[IO.Path]::GetFullPath($Candidate)
  if (-not $studioResolved.StartsWith($studioInstall+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped the installation directory.' }
  return $studioResolved
}
function Test-StudioPackage([string]$Directory) {
  $studioManifest=Get-Content -LiteralPath (Join-Path $Directory 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($studioManifest.name -ne 'character-studio' -or $studioManifest.platform -ne 'windows-x64' -or $studioManifest.runtimeIncluded -ne $true -or $studioManifest.version -notmatch '^[0-9A-Za-z.+-]{1,80}$') { throw 'This is not a self-contained Windows package.' }
  foreach ($studioRequired in @('runtime/node.exe','runtime/LICENSE','dist/server.mjs','dist/cli.mjs','dist/workbench.html','skills/character-studio/SKILL.md')) { if (-not $studioManifest.files.PSObject.Properties[$studioRequired]) { throw "Missing package entry: $studioRequired" } }
  foreach ($studioProperty in $studioManifest.files.PSObject.Properties) {
    $studioFile=[IO.Path]::GetFullPath((Join-Path $Directory $studioProperty.Name))
    if (-not $studioFile.StartsWith([IO.Path]::GetFullPath($Directory).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path.' }
    if ($studioProperty.Value -notmatch '^[a-f0-9]{64}$' -or (Get-StudioHash $studioFile) -ine $studioProperty.Value) { throw "Package file checksum mismatch: $($studioProperty.Name)" }
  }
  return $studioManifest
}
if (-not $PackagePath) {
  if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Pass -Repository owner/name from the GitHub project URL, or a local -PackagePath.' }
  Write-Output '[1/4] Checking the published Windows release...'
  $studioRelease=Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers @{'User-Agent'='CharacterStudio-Installer'} -TimeoutSec 30
  $studioDownload=Assert-StudioChild (Join-Path $studioInstall ('.downloads\'+[guid]::NewGuid().ToString('N')))
  New-Item -ItemType Directory -Path $studioDownload -Force | Out-Null
  foreach ($studioAssetName in @('character-studio-windows-x64.zip','character-studio-windows-x64.zip.sha256')) {
    $studioAssets=@($studioRelease.assets | Where-Object name -eq $studioAssetName)
    if ($studioAssets.Count -ne 1 -or -not $studioAssets[0].browser_download_url.StartsWith("https://github.com/$Repository/releases/download/",[StringComparison]::OrdinalIgnoreCase)) { throw "Published release is missing $studioAssetName" }
    Write-Output "[2/4] Downloading $studioAssetName..."
    Invoke-WebRequest -UseBasicParsing -Uri $studioAssets[0].browser_download_url -OutFile (Join-Path $studioDownload $studioAssetName) -TimeoutSec 60
  }
  $PackagePath=Join-Path $studioDownload 'character-studio-windows-x64.zip'
  $ChecksumPath="$PackagePath.sha256"
}
$PackagePath=[IO.Path]::GetFullPath($PackagePath)
if (-not $ChecksumPath) { $ChecksumPath="$PackagePath.sha256" }
$studioExpected=((Get-Content -LiteralPath $ChecksumPath -Raw -Encoding UTF8).Trim() -split '\s+')[0]
if ($studioExpected -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid archive checksum.' }
$studioHash=Get-StudioHash $PackagePath
if ($studioHash -ine $studioExpected) { throw 'Download checksum mismatch. Existing installation has not been changed.' }
$studioCurrentFile=Join-Path $studioInstall 'current.json'
$studioDestination=$null
if (Test-Path -LiteralPath $studioCurrentFile) {
  try {
    $studioCurrent=Get-Content -LiteralPath $studioCurrentFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($studioCurrent.packageHash -eq $studioHash) { $studioCandidate=Assert-StudioChild $studioCurrent.path; $null=Test-StudioPackage $studioCandidate; $studioDestination=$studioCandidate }
  } catch { Write-Output 'Previous version needs repair; installing a fresh copy.' }
}
if (-not $studioDestination) {
  Write-Output '[3/4] Verifying and preparing the workbench...'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $studioStage=Assert-StudioChild (Join-Path $studioInstall ('staging\'+[guid]::NewGuid().ToString('N')))
  New-Item -ItemType Directory -Path $studioStage -Force | Out-Null
  $studioArchive=[IO.Compression.ZipFile]::OpenRead($PackagePath)
  try {
    if ($studioArchive.Entries.Count -gt 5000 -or ($studioArchive.Entries | Measure-Object Length -Sum).Sum -gt 512MB) { throw 'Archive exceeds the application size limit.' }
    foreach ($studioEntry in $studioArchive.Entries) { $studioEntryPath=[IO.Path]::GetFullPath((Join-Path $studioStage $studioEntry.FullName)); if (-not $studioEntryPath.StartsWith($studioStage+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe path in downloaded archive.' } }
  } finally { $studioArchive.Dispose() }
  [IO.Compression.ZipFile]::ExtractToDirectory($PackagePath,$studioStage)
  $studioManifest=Test-StudioPackage $studioStage
  $studioDestination=Assert-StudioChild (Join-Path $studioInstall ('versions\'+$studioManifest.version+'-'+$studioHash.Substring(0,12)+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)))
  New-Item -ItemType Directory -Path (Split-Path -Parent $studioDestination) -Force | Out-Null
  # Both resolved paths were checked under the dedicated installation directory.
  Move-Item -LiteralPath $studioStage -Destination $studioDestination
  $studioPointer=@{version=$studioManifest.version;packageHash=$studioHash;path=$studioDestination;installedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json
  $studioPointerTmp=Assert-StudioChild (Join-Path $studioInstall ('current.'+[guid]::NewGuid().ToString('N')+'.tmp'))
  [IO.File]::WriteAllText($studioPointerTmp,$studioPointer,(New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $studioPointerTmp -Destination $studioCurrentFile -Force
}
Write-Output '[4/4] Workbench is installed. No MCP settings were changed.'
if (-not $NoOpen) {
  $studioOpenArgs=@((Join-Path $studioDestination 'dist\cli.mjs'),'open','--executor','keep')
  if ($NoBrowser) { $studioOpenArgs+='--no-browser' }
  & (Join-Path $studioDestination 'runtime\node.exe') @studioOpenArgs
  if ($LASTEXITCODE -ne 0) { throw 'Installed, but the workbench could not start. Run its doctor command.' }
} else { Write-Output $studioDestination }
