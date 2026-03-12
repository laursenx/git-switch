# git-switch

Git identity and SSH key profile switcher for developers who work with multiple Git accounts (e.g. personal + work GitHub) on a single machine.

## Features

- **Per-repo profiles** — identity is applied to `.git/config`, not globally. Two terminals can use different profiles simultaneously.
- **SSH key routing** — each profile maps to an SSH alias with `url.insteadOf` rewriting, so `git@github.com:` routes through the correct key.
- **Submodule support** — `mark` applies identity and URL rewrites to all submodule configs recursively.
- **Snapshot & undo** — every destructive operation snapshots all affected files before writing. Auto-restores on failure.
- **SSH key providers** — 1Password (via `op` CLI), manual `~/.ssh` keys, and Proton Pass (stub for future).
- **GitHub Desktop switching** — opt-in OS keychain rotation to switch Desktop accounts without re-signing in.

## Installation

```bash
# Clone and build
git clone <repo-url> && cd git-switch
bun install
bun run build

# Link globally
bun link
```

The `git-switch` command will be available system-wide.

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
5. Optional GitHub Desktop setup

### `git-switch mark [profile-id]`

Apply a profile to the current repo. Writes `user.name`, `user.email`, and `url.insteadOf` to `.git/config` and all submodule configs.

Always takes a snapshot before writing. On failure, auto-restores.

### `git-switch list`

Show all profiles in a table. Marks the active profile for the current repo with `●`.

### `git-switch status`

Show the active profile for the current repo, including identity, SSH alias, and submodule sync status.

### `git-switch remove [profile-id]`

Delete a profile and clean up its SSH config entries and public key file.

### `git-switch clone <profile-id> <url> [dir]`

Clone a repo with SSH URL rewriting, then auto-mark with the specified profile. Detects submodules and offers to initialize them.

### `git-switch doctor`

Scan `~/projects/` (max depth 3) for git repos. Reports:
- `✓` — profile marked and in sync
- `⚠` — no profile marked
- `✗` — submodule configs out of sync

Exits with code 1 if any issues found.

### `git-switch desktop [profile-id]`

Switch GitHub Desktop to a specific profile via OS keychain rotation. Does not touch repo configs.

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

### Proton Pass

Forward-compatible stub. Will be implemented when Proton Pass exposes an SSH agent CLI.

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
2. The tool captures the keychain entry and `app-state.json` snapshot
3. The keychain entry is parked under a prefixed label

On `git-switch desktop <profile>`:
1. The active keychain entry is parked
2. The target profile's parked entry is activated
3. `app-state.json` accounts are swapped
4. GitHub Desktop is restarted

## Known Limitations

- **Mixed-account submodules**: A repo with submodules from two different GitHub accounts cannot be fully resolved — `url.insteadOf` routes one alias per host.
- **GitHub Desktop format stability**: `app-state.json` is an undocumented internal format. Desktop updates may break the accounts snapshot.
- **GitHub Desktop OAuth scope**: Only Desktop's own GitHub account is managed. VS Code, JetBrains, and other editors' GitHub integrations are separate.
- **VS Code git operations**: Fully supported — VS Code calls system git directly.
- **GUI git clients** (Fork, GitKraken, Tower, Sourcetree): Identity and URL rewrites apply since they call system git. SSH key routing depends on `SSH_AUTH_SOCK` support.
- **HTTPS remotes**: `url.insteadOf` only rewrites SSH URLs. HTTPS remotes bypass this tool entirely.

## Tech Stack

- TypeScript (strict mode)
- `@clack/prompts` for interactive UI
- `tsup` for single-file CJS build
- No external git libraries — shells out to system `git`
- Config stored at `~/.config/git-switch/`
