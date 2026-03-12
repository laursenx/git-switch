#!/usr/bin/env pwsh
# Test the full install -> verify -> uninstall cycle using a local build.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/test-installer.ps1

param(
  [switch]$SkipBuild,
  [switch]$KeepInstall
)

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Binary = Join-Path $ProjectRoot "dist\git-switch.exe"
$InstallDir = "$env:LOCALAPPDATA\git-switch\bin"
$InstalledBinary = Join-Path $InstallDir "git-switch.exe"

$script:Pass = 0
$script:Fail = 0

function Run-Test {
  param([string]$Name, [scriptblock]$Code)
  Write-Host "  TEST  " -ForegroundColor Black -BackgroundColor Yellow -NoNewline
  Write-Host " $Name" -NoNewline
  try {
    $result = & $Code
    Write-Host " $([char]0x2713)" -ForegroundColor Green
    $script:Pass++
    return $true
  } catch {
    Write-Host " $([char]0x2717)" -ForegroundColor Red
    Write-Host "         $($_.Exception.Message)" -ForegroundColor Red
    $script:Fail++
    return $false
  }
}

function Fail([string]$msg) { throw $msg }

# =============================================
Write-Host ""
Write-Host "  +-------------------------------------+" -ForegroundColor Yellow
Write-Host "  |     Installer Test Suite             |" -ForegroundColor Yellow
Write-Host "  +-------------------------------------+" -ForegroundColor Yellow
Write-Host ""

# -- Phase 1: Build --
Write-Host "  Phase 1: Build" -ForegroundColor Cyan
Write-Host "  -------------------------------------" -ForegroundColor DarkGray

if ($SkipBuild -and (Test-Path $Binary)) {
  Write-Host "  Skipping build (using existing binary)" -ForegroundColor DarkGray
} else {
  Run-Test -Name "Typecheck" -Code {
    $r = & bun run typecheck 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "Typecheck failed: $r" }
  }

  Run-Test -Name "Compile binary" -Code {
    $r = & bun run compile 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "Compile failed: $r" }
    if (-not (Test-Path $Binary)) { Fail "Binary not found" }
  }
}

Run-Test -Name "Binary runs" -Code {
  $ver = & $Binary --version 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "Binary failed to run" }
  Write-Host " ($ver)" -ForegroundColor DarkGray -NoNewline
}

# -- Phase 2: Install --
Write-Host ""
Write-Host "  Phase 2: Install" -ForegroundColor Cyan
Write-Host "  -------------------------------------" -ForegroundColor DarkGray

# Clean previous test install
if (Test-Path $InstalledBinary) {
  Remove-Item $InstalledBinary -Force
  Write-Host "  Cleaned previous test install" -ForegroundColor DarkGray
}

Run-Test -Name "Installer runs" -Code {
  $out = & powershell -ExecutionPolicy Bypass -File "$ProjectRoot\install.ps1" -LocalBinary $Binary 2>&1
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { Fail "Installer exited $LASTEXITCODE" }
}

Run-Test -Name "Binary at correct location" -Code {
  if (-not (Test-Path $InstalledBinary)) { Fail "Not found at $InstalledBinary" }
}

Run-Test -Name "Installed binary works" -Code {
  $ver = & $InstalledBinary --version 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "Failed to run" }
}

Run-Test -Name "Binary size matches source" -Code {
  $src = (Get-Item $Binary).Length
  $dst = (Get-Item $InstalledBinary).Length
  if ($src -ne $dst) { Fail "Size mismatch: source=$src installed=$dst" }
}

Run-Test -Name "PATH contains install dir" -Code {
  $p = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $p.Contains($InstallDir)) { Fail "Not in user PATH" }
}

# -- Phase 3: Commands --
Write-Host ""
Write-Host "  Phase 3: Commands" -ForegroundColor Cyan
Write-Host "  -------------------------------------" -ForegroundColor DarkGray

Run-Test -Name "git-switch list" -Code {
  $null = & $InstalledBinary list 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "Exit code $LASTEXITCODE" }
}

Run-Test -Name "git-switch status" -Code {
  $null = & $InstalledBinary status 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "Exit code $LASTEXITCODE" }
}

Run-Test -Name "git-switch --help" -Code {
  $out = (& $InstalledBinary --help 2>&1) -join " "
  if ($LASTEXITCODE -ne 0) { Fail "Exit code $LASTEXITCODE" }
  if (-not $out.Contains("git-switch")) { Fail "Missing expected output" }
}

# -- Phase 4: Upgrade --
Write-Host ""
Write-Host "  Phase 4: Upgrade" -ForegroundColor Cyan
Write-Host "  -------------------------------------" -ForegroundColor DarkGray

Run-Test -Name "Re-install (upgrade) works" -Code {
  $null = & powershell -ExecutionPolicy Bypass -File "$ProjectRoot\install.ps1" -LocalBinary $Binary 2>&1
  if (-not (Test-Path $InstalledBinary)) { Fail "Binary missing after upgrade" }
}

Run-Test -Name "PATH not duplicated" -Code {
  $p = [Environment]::GetEnvironmentVariable("Path", "User")
  $n = ($p -split ";" | Where-Object { $_ -eq $InstallDir }).Count
  if ($n -gt 1) { Fail "Appears $n times in PATH" }
}

# -- Phase 5: Uninstall --
if (-not $KeepInstall) {
  Write-Host ""
  Write-Host "  Phase 5: Uninstall" -ForegroundColor Cyan
  Write-Host "  -------------------------------------" -ForegroundColor DarkGray

  Run-Test -Name "Uninstaller runs" -Code {
    $null = "N" | & powershell -ExecutionPolicy Bypass -File "$ProjectRoot\uninstall.ps1" 2>&1
  }

  Run-Test -Name "Binary removed" -Code {
    if (Test-Path $InstalledBinary) { Fail "Still exists" }
  }

  Run-Test -Name "PATH cleaned" -Code {
    $p = [Environment]::GetEnvironmentVariable("Path", "User")
    $parts = @($p -split ";" | Where-Object { $_ -eq $InstallDir })
    if ($parts.Count -gt 0) { Fail "Still in PATH" }
  }
} else {
  Write-Host ""
  Write-Host "  Skipping uninstall (-KeepInstall)" -ForegroundColor DarkGray
}

# =============================================
Write-Host ""
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
$Total = $script:Pass + $script:Fail
if ($script:Fail -eq 0) {
  Write-Host "  $($script:Pass)/$Total tests passed" -ForegroundColor Green
} else {
  Write-Host "  $($script:Pass)/$Total passed, $($script:Fail) failed" -ForegroundColor Red
}
Write-Host ""

if ($script:Fail -gt 0) { exit 1 }
