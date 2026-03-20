#!/usr/bin/env bash
# git-switch uninstaller for macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/laursenx/git-switch/main/uninstall.sh | bash

set -euo pipefail

INSTALL_DIR="${GIT_SWITCH_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="$HOME/.config/git-switch"

# --- Colors ---
if [ -t 1 ]; then
  CYAN='\033[0;36m' GREEN='\033[0;32m' RED='\033[0;31m' RESET='\033[0m'
else
  CYAN='' GREEN='' RED='' RESET=''
fi

step()    { printf "  ${CYAN}►${RESET} %s\n" "$1"; }
success() { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }

# --- Banner ---
printf "\n"
printf "  ${CYAN}┌─────────────────────────────────────┐${RESET}\n"
printf "  ${CYAN}│       git-switch uninstaller         │${RESET}\n"
printf "  ${CYAN}└─────────────────────────────────────┘${RESET}\n"
printf "\n"

# Remove binary
if [ -f "$INSTALL_DIR/git-switch" ]; then
  rm -f "$INSTALL_DIR/git-switch"
  success "Removed $INSTALL_DIR/git-switch"
else
  step "Binary not found at $INSTALL_DIR/git-switch"
fi

# Remove gs alias
if [ -f "$INSTALL_DIR/gs" ] || [ -L "$INSTALL_DIR/gs" ]; then
  rm -f "$INSTALL_DIR/gs"
  success "Removed gs shortcut"
fi

# Remove PATH entries from shell profiles
remove_from_profile() {
  local profile="$1"
  [ -f "$profile" ] || return 0

  if grep -qF "# git-switch" "$profile" 2>/dev/null; then
    # Remove the fenced block (comment line + export line)
    sed -i.bak '/# git-switch/,+1d' "$profile"
    rm -f "${profile}.bak"
    success "Cleaned PATH from $(basename "$profile")"
  fi
}

remove_from_profile "$HOME/.bashrc"
remove_from_profile "$HOME/.zshrc"

# Prompt about config
if [ -d "$CONFIG_DIR" ]; then
  printf "\n"
  printf "  Remove configuration at %s? [y/N] " "$CONFIG_DIR"
  read -r response
  if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
    rm -rf "$CONFIG_DIR"
    success "Removed configuration"
  else
    step "Configuration kept at $CONFIG_DIR"
  fi
fi

printf "\n"
success "git-switch has been uninstalled."
printf "\n"
