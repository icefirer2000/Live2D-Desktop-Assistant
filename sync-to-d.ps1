$ErrorActionPreference = 'Stop'
$source = 'C:\Users\18928\Documents\ChatGPT\桌宠'
$target = 'D:\Vibe coding\live2d-desktop-assistant'

if (-not (Test-Path -LiteralPath $target)) {
  throw "目标目录不存在：$target"
}

$rootFiles = @('.gitignore', 'launcher.cs', 'main.js', 'package.json', 'preload.js', 'README.md')
foreach ($name in $rootFiles) {
  Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $target $name) -Force
}

foreach ($directory in @('src', 'runtime', 'data')) {
  $sourceDirectory = Join-Path $source $directory
  $targetDirectory = Join-Path $target $directory
  New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
  Get-ChildItem -LiteralPath $sourceDirectory -File -Recurse | ForEach-Object {
    $relative = $_.FullName.Substring($sourceDirectory.Length).TrimStart('\')
    $destination = Join-Path $targetDirectory $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
  }
}

Write-Host "同步完成：$target"
