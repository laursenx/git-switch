#!/usr/bin/env pwsh
# git-switch uninstaller for Windows
# Usage: powershell -ExecutionPolicy Bypass -File uninstall.ps1

$ErrorActionPreference = "Stop"

$BinaryName = "git-switch.exe"
$InstallDir = "$env:LOCALAPPDATA\git-switch\bin"
$ConfigDir = Join-Path $HOME ".config\git-switch"

function Write-Step([string]$Message) {
  Write-Host "  > " -ForegroundColor Cyan -NoNewline
  Write-Host $Message
}

function Write-Success([string]$Message) {
  Write-Host "  + " -ForegroundColor Green -NoNewline
  Write-Host $Message
}

# --- Banner ---
Write-Host ""
Write-Host "  +---------------------------------------+" -ForegroundColor Cyan
Write-Host "  |       git-switch uninstaller           |" -ForegroundColor Cyan
Write-Host "  +---------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# Remove binary
$BinaryPath = Join-Path $InstallDir $BinaryName
if (Test-Path $BinaryPath) {
  Remove-Item $BinaryPath -Force
  Write-Success "Removed $BinaryPath"
} else {
  Write-Step "Binary not found at $BinaryPath"
}

# Remove gs alias
$AliasPath = Join-Path $InstallDir "gs.exe"
if (Test-Path $AliasPath) {
  Remove-Item $AliasPath -Force
  Write-Success "Removed gs shortcut"
}

# Remove install directory if empty
if ((Test-Path $InstallDir) -and @(Get-ChildItem $InstallDir).Count -eq 0) {
  Remove-Item $InstallDir -Force
  $ParentDir = Split-Path $InstallDir
  if ((Test-Path $ParentDir) -and @(Get-ChildItem $ParentDir).Count -eq 0) {
    Remove-Item $ParentDir -Force
  }
}

# Remove from user PATH
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath) {
  $Parts = $UserPath -split ";" | Where-Object { $_ -ne $InstallDir -and $_ -ne "" }
  $NewPath = $Parts -join ";"
  if ($NewPath -ne $UserPath) {
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    Write-Success "Removed from PATH"
  } else {
    Write-Step "Not in PATH"
  }
}

# Prompt about config
if (Test-Path $ConfigDir) {
  Write-Host ""
  $Response = Read-Host "  Remove configuration at $ConfigDir? [y/N]"
  if ($Response -eq "y" -or $Response -eq "Y") {
    Remove-Item $ConfigDir -Recurse -Force
    Write-Success "Removed configuration"
  } else {
    Write-Step "Configuration kept at $ConfigDir"
  }
}

Write-Host ""
Write-Success "git-switch has been uninstalled."
Write-Host ""
