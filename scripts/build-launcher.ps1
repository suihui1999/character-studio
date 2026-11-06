param([Parameter(Mandatory=$true)][string]$Output,[string]$PackagePath)
$ErrorActionPreference='Stop'
$studioSourceRoot=Split-Path -Parent $PSScriptRoot
$studioCompiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $studioCompiler)) { throw 'Windows .NET Framework C# compiler was not found.' }
$studioOutputPath=[IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $studioOutputPath) | Out-Null
$studioArguments=@('/nologo','/target:winexe','/platform:x64','/codepage:65001','/optimize+','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll',('/out:'+$studioOutputPath),(Join-Path $studioSourceRoot 'src/launcher/LauncherCommon.cs'))
$studioVersion=(Get-Content -LiteralPath (Join-Path $studioSourceRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($studioVersion -notmatch '^\d+\.\d+\.\d+$') {throw 'EXE version requires a three-part release version.'}
$studioAssembly=Join-Path (Split-Path -Parent $studioOutputPath) 'LauncherAssemblyInfo.cs'
[IO.File]::WriteAllText($studioAssembly,('[assembly:System.Reflection.AssemblyTitle("Character Studio")][assembly:System.Reflection.AssemblyProduct("Character Studio")][assembly:System.Reflection.AssemblyVersion("'+$studioVersion+'.0")][assembly:System.Reflection.AssemblyFileVersion("'+$studioVersion+'.0")]'),(New-Object Text.UTF8Encoding $false))
$studioArguments+=$studioAssembly
if ($PackagePath) {
  $studioZip=[IO.Path]::GetFullPath($PackagePath)
  $studioStream=[IO.File]::OpenRead($studioZip);$studioHasher=[Security.Cryptography.SHA256]::Create()
  try {$studioHash=[BitConverter]::ToString($studioHasher.ComputeHash($studioStream)).Replace('-','').ToLowerInvariant()} finally {$studioStream.Dispose();$studioHasher.Dispose()}
  $studioInfo=Join-Path (Split-Path -Parent $studioOutputPath) 'PayloadInfo.cs'
  [IO.File]::WriteAllText($studioInfo,('internal static class PayloadInfo { public const string Hash = "'+$studioHash+'"; }'),(New-Object Text.UTF8Encoding $false))
  $studioArguments+=@((Join-Path $studioSourceRoot 'src/launcher/SingleFileLauncher.cs'),$studioInfo,('/resource:'+$studioZip+',studio-package'),('/resource:'+(Join-Path $studioSourceRoot 'scripts/install.ps1')+',studio-installer'))
} else {$studioArguments+=(Join-Path $studioSourceRoot 'src/launcher/PortableLauncher.cs')}
& $studioCompiler @studioArguments
if ($LASTEXITCODE -ne 0) {throw 'Launcher compilation failed.'}
Get-Item -LiteralPath $studioOutputPath | Select-Object FullName,Length
