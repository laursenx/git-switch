#!/usr/bin/env bash
# git-switch installer for macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/laursenx/git-switch/main/install.sh | bash

set -euo pipefail

REPO="laursenx/git-switch"
INSTALL_DIR="${GIT_SWITCH_INSTALL_DIR:-$HOME/.local/bin}"

# --- Colors (only when interactive) ---
if [ -t 1 ]; then
  CYAN='\033[0;36m'
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  DIM='\033[0;90m'
  RESET='\033[0m'
  BOLD='\033[1m'
else
  CYAN='' GREEN='' RED='' DIM='' RESET='' BOLD=''
fi

banner() {
  printf "\n"
  printf "  ${CYAN}┌─────────────────────────────────────┐${RESET}\n"
  printf "  ${CYAN}│                                     │${RESET}\n"
  printf "  ${CYAN}│         git-switch installer         │${RESET}\n"
  printf "  ${CYAN}│                                     │${RESET}\n"
  printf "  ${CYAN}└─────────────────────────────────────┘${RESET}\n"
  printf "\n"
}

step()    { printf "  ${CYAN}►${RESET} %s\n" "$1"; }
success() { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
err()     { printf "  ${RED}✗${RESET} %s\n" "$1"; }

# --- Detect platform ---
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)      err "Unsupported OS: $os"; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)             err "Unsupported architecture: $arch"; exit 1 ;;
  esac

  # Linux ARM64 not supported yet
  if [ "$os" = "linux" ] && [ "$arch" = "arm64" ]; then
    err "Linux ARM64 is not yet supported."
    exit 1
  fi

  PLATFORM="${os}-${arch}"
  ASSET_NAME="git-switch-${PLATFORM}"
}

# --- Resolve version ---
get_latest_version() {
  local response
  response=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null) || {
    err "Failed to fetch latest release from GitHub."
    err "Check your internet connection or set GIT_SWITCH_VERSION=v0.1.0"
    exit 1
  }
  echo "$response" | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/'
}

# --- Main ---
banner

detect_platform
step "Detected: $(uname -s) $(uname -m) → $PLATFORM"

# Determine version
VERSION="${GIT_SWITCH_VERSION:-}"
if [ -n "$VERSION" ]; then
  case "$VERSION" in
    v*) TAG="$VERSION" ;;
    *)  TAG="v$VERSION" ;;
  esac
  step "Installing git-switch $TAG"
else
  step "Fetching latest version..."
  TAG=$(get_latest_version)
  step "Latest version: $TAG"
fi

# Check existing installation
if [ -f "$INSTALL_DIR/git-switch" ]; then
  OLD_VERSION=$("$INSTALL_DIR/git-switch" --version 2>/dev/null || echo "unknown")
  step "Upgrading from $OLD_VERSION"
fi

# Create install directory
step "Installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download binary
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$ASSET_NAME"
step "Downloading $ASSET_NAME..."

if ! curl -fSL --progress-bar -o "$INSTALL_DIR/git-switch" "$DOWNLOAD_URL"; then
  err "Download failed: $DOWNLOAD_URL"
  err "Make sure release $TAG exists at https://github.com/$REPO/releases"
  exit 1
fi

chmod +x "$INSTALL_DIR/git-switch"

# Remove macOS quarantine
if [ "$(uname -s)" = "Darwin" ]; then
  xattr -d com.apple.quarantine "$INSTALL_DIR/git-switch" 2>/dev/null || true
fi

# Verify
if INSTALLED_VERSION=$("$INSTALL_DIR/git-switch" --version 2>/dev/null); then
  success "Installed git-switch $INSTALLED_VERSION"
else
  success "Binary downloaded"
fi

# Add to PATH
add_to_path() {
  local profile="$1"
  local fence="# git-switch"

  [ -f "$profile" ] || touch "$profile"

  if grep -qF "$fence" "$profile" 2>/dev/null; then
    return 0  # already present
  fi

  printf '\n%s\nexport PATH="%s:$PATH"\n' "$fence" "$INSTALL_DIR" >> "$profile"
  return 1  # added
}

if echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  success "Already in PATH"
else
  ADDED=false
  case "${SHELL:-}" in
    */zsh)
      add_to_path "$HOME/.zshrc" && true || ADDED=true
      ;;
    */bash)
      add_to_path "$HOME/.bashrc" && true || ADDED=true
      ;;
    *)
      # Try both
      add_to_path "$HOME/.bashrc" && true || ADDED=true
      add_to_path "$HOME/.zshrc" && true || ADDED=true
      ;;
  esac

  if [ "$ADDED" = true ]; then
    success "Added to PATH"
  else
    success "Already in PATH"
  fi
fi

# Done
printf "\n"
printf "  ${GREEN}┌─────────────────────────────────────┐${RESET}\n"
printf "  ${GREEN}│  Installation complete!              │${RESET}\n"
printf "  ${GREEN}└─────────────────────────────────────┘${RESET}\n"
printf "\n"
printf "  Location: ${CYAN}%s/git-switch${RESET}\n" "$INSTALL_DIR"
printf "\n"
printf "  ${DIM}You may need to restart your terminal, then run:${RESET}\n"
printf "  ${BOLD}git-switch --help${RESET}\n"
printf "\n"
