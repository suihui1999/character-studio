param([string]$Source,[string]$Zip,[switch]$Traversal)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
if ($Traversal) {
  $studioZip=[IO.Compression.ZipFile]::Open($Zip,[IO.Compression.ZipArchiveMode]::Create)
  try { $studioEntry=$studioZip.CreateEntry('../outside.txt'); $studioWriter=New-Object IO.StreamWriter($studioEntry.Open()); try { $studioWriter.Write('explicit path traversal fixture') } finally { $studioWriter.Dispose() } } finally { $studioZip.Dispose() }
} else { [IO.Compression.ZipFile]::CreateFromDirectory($Source,$Zip) }
