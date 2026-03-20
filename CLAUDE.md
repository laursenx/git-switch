# CLAUDE.md - git-switch

## Project Overview

**git-switch** is a CLI tool for managing multiple Git identities (name, email, SSH key) on a single machine. It handles per-repo Git config, SSH key routing via URL rewriting, submodule support, snapshot/undo for safe operations, and GitHub Desktop account switching.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun
- **Package Manager:** Bun (`bun install`, lockfile: `bun.lock`)
- **CLI Framework:** `@clack/prompts` for interactive UI
- **CLI Argument Parsing:** `commander`
- **Database:** SQLite via `drizzle-orm` + `bun:sqlite`
- **Git Integration:** System `git` binary via `spawnSync` (no git libraries)
- **Windows Credentials:** `bun:ffi` calling `advapi32.dll` directly (no PowerShell)
- **Platform:** Windows-only (macOS/Linux have TODO stubs for future support)
- **Config Storage:** `~/.config/git-switch/` (SQLite DB + snapshots)

## Commands

```bash
bun run dev                # Run in watch mode
bun run build              # Bundle to dist/index.js
bun run compile            # Compile standalone binary
bun run typecheck          # tsc --noEmit (type checking only)
bun run test:installer     # Full install/uninstall test cycle
bun run test:installer:keep # Test install without uninstalling
```

CI/CD: `.github/workflows/release.yml` builds 4-platform binaries on tag push (`v*`).

## Project Structure

```
src/
├── index.ts              # CLI entry point & command dispatcher (version from package.json)
├── commands/             # Command handlers (one file per command)
│   ├── add.ts            # Create new profile (interactive wizard + Desktop capture)
│   ├── mark.ts           # Apply profile to current repo
│   ├── list.ts           # List all profiles
│   ├── remove.ts         # Delete a profile
│   ├── status.ts         # Show active profile for current repo
│   ├── scan.ts           # Scan repos for unconfigured identities
│   ├── clone.ts          # Clone repo with a profile applied
│   ├── global.ts         # Set global git identity
│   ├── desktop/          # GitHub Desktop subcommands (save, list, remove, switch, link)
│   └── undo.ts           # Restore from snapshots
├── core/                 # Core logic modules
│   ├── profiles.ts       # Profile CRUD (SQLite via drizzle-orm)
│   ├── desktop-profiles.ts # Desktop profile CRUD
│   ├── git-config.ts     # Git config manipulation
│   ├── ssh-config.ts     # ~/.ssh/config management (fenced sections)
│   ├── desktop/          # GitHub Desktop integration
│   │   ├── keychain.ts   # Windows Credential Manager via bun:ffi (advapi32.dll)
│   │   ├── process.ts    # GitHub Desktop process management (Windows-only)
│   │   └── local-storage.ts # LevelDB reader for Desktop's localStorage
│   └── snapshot/         # Snapshot & restore system
├── db/                   # Database layer
│   ├── schema.ts         # Drizzle table definitions (single source of truth)
│   ├── index.ts          # DB connection + embedded migrator
│   └── migrations/       # SQL migrations (embedded via Bun text imports)
├── providers/            # SSH key provider implementations
│   ├── types.ts          # SSHKeyProvider interface + Profile/DesktopProfile types
│   ├── index.ts          # Provider registry
│   ├── onepassword.ts    # 1Password (via `op` CLI)
│   └── manual.ts         # Manual ~/.ssh keys
└── utils/                # Shared utilities
    ├── paths.ts          # Path resolution helpers
    ├── shell.ts          # Shell command execution (run/runOrThrow)
    ├── prompts.ts        # Shared prompt helpers (abortIfCancelled, selectProfile)
    ├── validation.ts     # Input validation (email, profileId, sshAlias)
    └── errors.ts         # Custom error class hierarchy

scripts/
└── test-installer.ps1    # Installer test suite (build → install → verify → uninstall)

install.ps1               # Windows installer (irm ... | iex)
install.sh                # macOS/Linux installer (curl ... | bash)
uninstall.ps1             # Windows uninstaller
uninstall.sh              # macOS/Linux uninstaller
.github/workflows/
└── release.yml           # CI: builds 4-platform binaries on tag push
```

## Key Conventions

### Naming
- **Files/folders:** kebab-case (`git-config.ts`, `ssh-config.ts`)
- **Functions/variables:** camelCase (`markCommand`, `getProfile`)
- **Classes:** PascalCase (`OnePasswordProvider`, `GitSwitchError`)

### Architecture Patterns

**Command pattern:** Each command is an async function exported from `src/commands/<name>.ts`. The dispatcher in `index.ts` routes CLI args to the appropriate handler. All interactive prompts use `abortIfCancelled()` to handle user cancellation.

**Provider pattern:** SSH key providers implement the `SSHKeyProvider` interface from `providers/types.ts`. New providers register in `providers/index.ts`.

**Snapshot pattern:** Destructive operations snapshot affected files before writing. Snapshots live in `~/.config/git-switch/snapshots/<id>/`. The manifest is written last - its presence indicates a valid snapshot. On failure, auto-restore runs from the snapshot.

**Atomic writes:** All JSON/config files are written atomically (write to `.tmp`, then `fs.renameSync`).

**Embedded migrations:** Database migrations are generated by `drizzle-kit` and embedded as string imports (`with { type: "text" }`). A custom migrator in `db/index.ts` tracks applied migrations in a `_migrations` table. This works inside `bun build --compile` binaries where filesystem-based migration files aren't available.

### CLI Aliases
- `gs` is a shortcut alias for `git-switch` (registered in `package.json` bin + installers)
- Running `gs` with no args shows an interactive action menu (when profiles exist) or the help screen (when no profiles)
- `gs --help` shows a custom grouped help screen (not commander's default)

### CLI UI Pattern

All commands follow this structure using `@clack/prompts`:
```typescript
export async function fooCommand(): Promise<void> {
  prompts.intro("git-switch foo - description");
  // ... interactive prompts (text, select, confirm, spinner)
  // ... perform operations
  prompts.outro("Done!");
}
```

### @clack/prompts Limitations
- **Do NOT loop clack prompts.** Cancelling a clack prompt (Escape/Ctrl+C) and then creating a new one in the same process can freeze stdin. Clack's readline cleanup is incompatible with re-entry. The hub is intentionally one-shot: pick action → run → exit.
- `abortIfCancelled()` calls `process.exit(0)` — do NOT change this to throw. Clack expects the process to end after cancel.
- `prompts.cancel()` only renders text — it does NOT clean up stdin/readline state. That happens inside the prompt's own close handler.

### Error Handling
- Custom errors extend `GitSwitchError` (in `utils/errors.ts`)
- Subtypes: `ProviderError`, `SnapshotError`, `NotInGitRepoError`, `DesktopKeychainError`
- Commands catch errors, log via `prompts.cancel()`, and `process.exit(1)`

### Shell Execution
- All shell commands run synchronously via `spawnSync` with a 30-second timeout
- `run()` returns `{ stdout, stderr, exitCode }`; `runOrThrow()` throws on failure
- Git operations use `git config --file <path>` for direct config manipulation

### Data Storage
- Database: `~/.config/git-switch/git-switch.db` (SQLite, WAL mode)
- Snapshots: `~/.config/git-switch/snapshots/`
- SSH public keys: `~/.ssh/git-switch-{alias}.pub`

### Installer Gotchas
- PowerShell scripts cannot contain em dashes (`—`) or other non-ASCII — use plain dashes (`-`)
- `gs.exe` may be locked by a running terminal; `install.ps1` handles this gracefully with try/catch
- `test:installer:keep` leaves the install in place for manual testing; use when iterating on CLI changes

### Release Process
```bash
# Update version in package.json, commit, then:
git tag v0.2.0
git push origin main --tags
# GitHub Actions builds and publishes release automatically
```
