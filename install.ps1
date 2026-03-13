#!/usr/bin/env pwsh
# git-switch installer for Windows
# Usage: irm https://raw.githubusercontent.com/laursenx/git-switch/main/install.ps1 | iex

param(
  [string]$Version = "",
  [string]$LocalBinary = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "laursenx/git-switch"
$BinaryName = "git-switch.exe"
$AssetName = "git-switch-windows-x64.exe"
$InstallDir = "$env:LOCALAPPDATA\git-switch\bin"

# --- Output helpers ---
function Write-Banner {
  Write-Host ""
  Write-Host "  +---------------------------------------+" -ForegroundColor Cyan
  Write-Host "  |                                       |" -ForegroundColor Cyan
  Write-Host "  |         git-switch installer           |" -ForegroundColor Cyan
  Write-Host "  |                                       |" -ForegroundColor Cyan
  Write-Host "  +---------------------------------------+" -ForegroundColor Cyan
  Write-Host ""
}

function Write-Step([string]$Message) {
  Write-Host "  > " -ForegroundColor Cyan -NoNewline
  Write-Host $Message
}

function Write-Success([string]$Message) {
  Write-Host "  + " -ForegroundColor Green -NoNewline
  Write-Host $Message
}

function Write-Err([string]$Message) {
  Write-Host "  x " -ForegroundColor Red -NoNewline
  Write-Host $Message
}

# --- Resolve version ---
function Get-LatestVersion {
  try {
    $Response = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
    return $Response.tag_name
  } catch {
    Write-Err "Failed to fetch latest release from GitHub."
    Write-Err "Check your internet connection or specify a version: -Version v0.1.0"
    exit 1
  }
}

# --- Main ---
Write-Banner

# Determine version
if ($LocalBinary) {
  Write-Step "Using local binary: $LocalBinary"
  if (-not (Test-Path $LocalBinary)) {
    Write-Err "Local binary not found: $LocalBinary"
    exit 1
  }
} elseif ($Version) {
  if (-not $Version.StartsWith("v")) { $Version = "v$Version" }
  $Tag = $Version
  Write-Step "Installing git-switch $Tag"
} else {
  Write-Step "Fetching latest version..."
  $Tag = Get-LatestVersion
  Write-Step "Latest version: $Tag"
}

# Check existing installation
$ExistingBinary = Join-Path $InstallDir $BinaryName
if (Test-Path $ExistingBinary) {
  try {
    $OldVersion = & $ExistingBinary --version 2>$null
    Write-Step "Upgrading from $OldVersion"
  } catch {
    Write-Step "Upgrading existing installation"
  }
}

# Create install directory
Write-Step "Installing to $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$DestPath = Join-Path $InstallDir $BinaryName

if ($LocalBinary) {
  # Copy local binary instead of downloading
  Copy-Item $LocalBinary $DestPath -Force
  Write-Step "Copied local binary"
} else {
  # Download binary
  $DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/$AssetName"
  Write-Step "Downloading $AssetName..."
  try {
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $DestPath -UseBasicParsing
    $ProgressPreference = "Continue"
  } catch {
    Write-Err "Download failed: $DownloadUrl"
    Write-Err "Make sure release $Tag exists at https://github.com/$Repo/releases"
    exit 1
  }
}

# Verify
if (-not (Test-Path $DestPath) -or (Get-Item $DestPath).Length -eq 0) {
  Write-Err "Downloaded file is missing or empty."
  exit 1
}

try {
  $InstalledVersion = & $DestPath --version 2>$null
  Write-Success "Installed git-switch $InstalledVersion"
} catch {
  Write-Success "Binary downloaded"
}

# Add to PATH
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -split ";" | Where-Object { $_ -eq $InstallDir }) {
  Write-Success "Already in PATH"
} else {
  $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
  [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
  $env:Path = "$env:Path;$InstallDir"
  Write-Success "Added to PATH"
}

# Done
Write-Host ""
Write-Host "  +---------------------------------------+" -ForegroundColor Green
Write-Host "  |  Installation complete!                |" -ForegroundColor Green
Write-Host "  +---------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "  Location: " -NoNewline
Write-Host $DestPath -ForegroundColor Cyan
Write-Host ""
Write-Host "  You may need to restart your terminal, then run:" -ForegroundColor DarkGray
Write-Host "  git-switch --help" -ForegroundColor White
Write-Host ""
