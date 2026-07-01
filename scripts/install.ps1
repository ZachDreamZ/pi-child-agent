<#
.SYNOPSIS
    Install pi-child-agent extension for Pi.
.DESCRIPTION
    Copies the extension to the global Pi extensions directory and installs dependencies.
#>

param(
    [string]$SourcePath = (Split-Path -Parent $PSScriptRoot),
    [switch]$Local
)

$ErrorActionPreference = "Stop"

# Determine destination
if ($Local) {
    $DestDir = Join-Path $env:USERPROFILE ".pi\agent\extensions\pi-child-agent"
} else {
    $DestDir = Join-Path $env:USERPROFILE ".pi\agent\extensions\pi-child-agent"
}

Write-Host "Installing pi-child-agent..." -ForegroundColor Cyan
Write-Host "  Source: $SourcePath"
Write-Host "  Destination: $DestDir"

# Create destination
New-Item -ItemType Directory -Path $DestDir -Force | Out-Null

# Copy files (exclude node_modules, .git, dist)
$exclude = @('node_modules', '.git', 'dist')
Get-ChildItem -Path $SourcePath -Exclude $exclude | Copy-Item -Destination $DestDir -Recurse -Force

# Install npm dependencies
Push-Location $DestDir
try {
    npm install --omit=dev
    Write-Host "  Dependencies installed." -ForegroundColor Green
} finally {
    Pop-Location
}

Write-Host "`npi-child-agent installed successfully!" -ForegroundColor Green
Write-Host "Restart Pi or run /reload to load the extension." -ForegroundColor Yellow
