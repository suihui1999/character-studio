param([string]$NodeVersion='24.14.0')
$ErrorActionPreference='Stop'
function Get-StudioHash([string]$File) {
  $studioStream=[IO.File]::OpenRead($File); $studioHasher=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($studioHasher.ComputeHash($studioStream)).Replace('-','').ToLowerInvariant() } finally { $studioStream.Dispose(); $studioHasher.Dispose() }
}
if ($NodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid Node version.' }
$studioBuildRoot=Split-Path -Parent $PSScriptRoot
$studioRuntimeDir=Join-Path $studioBuildRoot ".local\runtime\node-v$NodeVersion-win-x64"
New-Item -ItemType Directory -Path $studioRuntimeDir -Force | Out-Null
$studioBase="https://nodejs.org/dist/v$NodeVersion"
$studioSums=(Invoke-WebRequest -UseBasicParsing -Uri "$studioBase/SHASUMS256.txt" -TimeoutSec 60).Content
function Get-StudioExpectedHash([string]$Name) {
  $studioMatches=@($studioSums -split "`n" | Where-Object { $_.Trim() -match ('^[a-f0-9]{64}\s+'+[regex]::Escape($Name)+'$') })
  if ($studioMatches.Count -ne 1) { throw "Official checksum not found: $Name" }
  return ($studioMatches[0].Trim() -split '\s+')[0]
}
$studioNodeTarget=Join-Path $studioRuntimeDir 'node.exe'
$studioExpectedExe=Get-StudioExpectedHash 'win-x64/node.exe'
if ((Test-Path -LiteralPath $studioNodeTarget) -and ((Get-StudioHash $studioNodeTarget) -ieq $studioExpectedExe) -and (Test-Path -LiteralPath (Join-Path $studioRuntimeDir 'LICENSE'))) { Write-Output $studioRuntimeDir; exit 0 }
$studioCurrentNode=(Get-Command node).Source
if ((Get-StudioHash $studioCurrentNode) -ieq $studioExpectedExe) {
  Copy-Item -LiteralPath $studioCurrentNode -Destination $studioNodeTarget -Force
  Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/v$NodeVersion/LICENSE" -OutFile (Join-Path $studioRuntimeDir 'LICENSE') -TimeoutSec 60
} else {
  $studioZipName="node-v$NodeVersion-win-x64.zip"
  $studioZip=Join-Path $studioBuildRoot ".local\runtime\$studioZipName"
  Invoke-WebRequest -UseBasicParsing -Uri "$studioBase/$studioZipName" -OutFile $studioZip -TimeoutSec 60
  if ((Get-StudioHash $studioZip) -ine (Get-StudioExpectedHash $studioZipName)) { throw 'Official Node archive checksum mismatch.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $studioArchive=[IO.Compression.ZipFile]::OpenRead($studioZip)
  try { foreach ($studioFile in @('node.exe','LICENSE')) { $studioEntry=$studioArchive.GetEntry("node-v$NodeVersion-win-x64/$studioFile"); if (-not $studioEntry) { throw "Missing $studioFile" }; [IO.Compression.ZipFileExtensions]::ExtractToFile($studioEntry,(Join-Path $studioRuntimeDir $studioFile),$true) } } finally { $studioArchive.Dispose() }
}
if ((Get-StudioHash $studioNodeTarget) -ine $studioExpectedExe) { throw 'Node executable checksum mismatch.' }
Write-Output $studioRuntimeDir
