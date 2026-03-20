# git-switch

> **Note:** This project was built with heavy use of AI (Claude). While it works well for my own workflow, expect rough edges and bugs. Issues and PRs welcome.

Git identity and SSH key profile switcher for developers who work with multiple Git accounts (e.g. personal + work GitHub) on a single machine. **Windows-only** for now - macOS/Linux support would need to come from contributors (TODO stubs are in the codebase).

## Features

- **Per-repo profiles** - identity is applied to `.git/config`, not globally. Two terminals can use different profiles simultaneously.
- **SSH key routing** - each profile maps to an SSH alias with `url.insteadOf` rewriting, so `git@github.com:` routes through the correct key.
- **Submodule support** - `mark` applies identity and URL rewrites to all submodule configs recursively.
- **Snapshot & undo** - every destructive operation snapshots all affected files before writing. Auto-restores on failure.
- **SSH key providers** - 1Password (via `op` CLI) and manual `~/.ssh` keys.
- **GitHub Desktop switching** - opt-in OS keychain rotation to switch Desktop accounts without re-signing in.

## Installation

### Windows

```powershell
irm https://raw.githubusercontent.com/laursenx/git-switch/main/install.ps1 | iex
```

### Install a specific version

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Version 0.1.0
```

### Uninstall

```powershell
irm https://raw.githubusercontent.com/laursenx/git-switch/main/uninstall.ps1 | iex
```

### Build from source

```bash
git clone https://github.com/laursenx/git-switch.git && cd git-switch
bun install
bun run compile
# Binary at dist/git-switch(.exe)
```

## Quick Start

```bash
# Create a profile
git-switch add

# Apply to a repo
cd ~/projects/my-work-repo
git-switch mark work

# Check status
git-switch status

# Clone with a profile
git-switch clone work git@github.com:acme/repo.git
```

## Commands

### `git-switch add`

Interactive wizard to create a new profile. Prompts for:
1. Profile ID and label
2. Git name and email
3. SSH key provider and key selection
4. Git host and SSH alias
5. Optional GitHub Desktop session capture

### `git-switch mark [profile-id]`

Apply a profile to the current repo. Writes `user.name`, `user.email`, and `url.insteadOf` to `.git/config` and all submodule configs.

Always takes a snapshot before writing. On failure, auto-restores.

### `git-switch global [profile-id]`

Set the global git identity in `~/.gitconfig`.

### `git-switch list`

Show all profiles in a table. Marks the active profile for the current repo with `●`.

### `git-switch status`

Show the active profile for the current repo, including identity, SSH alias, and submodule sync status.

### `git-switch remove [profile-id]`

Delete a profile and clean up its SSH config entries and public key file.

### `git-switch clone <profile-id> <url> [dir]`

Clone a repo with SSH URL rewriting, then auto-mark with the specified profile. Detects submodules and offers to initialize them.

### `git-switch scan`

Scan the current directory (max depth 3) for git repos. Reports:
- Repos with a profile marked and in sync
- Repos with no profile marked
- Repos with submodule configs out of sync

### `git-switch desktop save`

Capture the current GitHub Desktop session (keychain entry + localStorage).

### `git-switch desktop switch [id]`

Switch GitHub Desktop to a saved profile via OS keychain rotation.

### `git-switch desktop list`

List all saved Desktop profiles.

### `git-switch desktop remove [id]`

Remove a saved Desktop profile.

### `git-switch desktop link`

Link a Desktop profile to a git-switch profile.

### `git-switch undo`

Restore the most recent snapshot for the current repo.

### `git-switch undo --list`

Show all snapshots for the current repo.

### `git-switch undo <snapshot-id>`

Restore a specific snapshot by ID.

## SSH Key Providers

### 1Password

Uses the `op` CLI. Requires 1Password CLI installed and signed in (`op signin`).

- Lists SSH keys from your vault
- Writes `.pub` hint files for 1Password's SSH agent
- Private keys never touch disk

### Manual

Uses key files from `~/.ssh/`. Points `IdentityFile` to the private key directly (strips `.pub` from the selected file).

## Submodule Behaviour

When you run `git-switch mark`, the tool:
1. Writes `[user]` and `[url]` blocks to `.git/config`
2. Walks `.git/modules/**/config` recursively
3. Writes identical blocks to every submodule config

This ensures `git submodule update`, `git pull` inside submodules, and VS Code's git integration all use the correct identity and SSH key.

## Snapshot & Undo System

Every `mark` and `desktop` operation:
1. Collects all files that will be modified
2. Copies them to `~/.config/git-switch/snapshots/<id>/`
3. Writes `manifest.json` last (its presence = snapshot is valid)
4. Performs the actual writes
5. If any write fails: auto-restores from snapshot
6. Prunes old snapshots (10 per repo, 5 for desktop)

## GitHub Desktop Setup

Desktop switching is opt-in per profile. During `git-switch add`:
1. Sign into GitHub Desktop with the target account
2. The tool captures the keychain entry and localStorage data
3. The keychain entry is parked under a prefixed label

On `git-switch desktop switch <profile>`:
1. The active keychain entry is parked
2. The target profile's parked entry is activated
3. localStorage accounts data is swapped
4. GitHub Desktop is restarted

## Known Limitations

- **Mixed-account submodules**: A repo with submodules from two different GitHub accounts cannot be fully resolved - `url.insteadOf` routes one alias per host.
- **Windows-only**: macOS and Linux are not yet supported. TODO stubs exist in the codebase - contributions welcome.
- **GitHub Desktop OAuth scope**: Only Desktop's own GitHub account is managed. VS Code, JetBrains, and other editors' GitHub integrations are separate.
- **VS Code git operations**: Fully supported - VS Code calls system git directly.
- **GUI git clients** (Fork, GitKraken, Tower, Sourcetree): Identity and URL rewrites apply since they call system git. SSH key routing depends on `SSH_AUTH_SOCK` support.
- **HTTPS remotes**: `url.insteadOf` only rewrites SSH URLs. HTTPS remotes bypass this tool entirely.

## Tech Stack

- TypeScript (strict mode), Bun runtime
- `@clack/prompts` for interactive UI
- Compiled to standalone binary via `bun build --compile`
- Windows credential management via `bun:ffi` (direct advapi32.dll calls)
- No external git libraries - shells out to system `git`
- Config stored at `~/.config/git-switch/`

## License

GPL-3.0 - see [LICENSE](LICENSE)
