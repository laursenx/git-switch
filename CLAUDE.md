# CLAUDE.md — git-switch

## Project Overview

**git-switch** is a CLI tool for managing multiple Git identities (name, email, SSH key) on a single machine. It handles per-repo Git config, SSH key routing via URL rewriting, submodule support, snapshot/undo for safe operations, and GitHub Desktop account switching.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun
- **Package Manager:** Bun (`bun install`, lockfile: `bun.lock`)
- **CLI Framework:** `@clack/prompts` for interactive UI
- **Git Integration:** System `git` binary via `spawnSync` (no git libraries)
- **Config Storage:** `~/.config/git-switch/` (JSON files)

## Commands

```bash
bun run dev              # Run in watch mode
bun run build            # Bundle to dist/index.js
bun run compile          # Compile standalone binary
bun run typecheck        # tsc --noEmit (type checking only)
```

There are no tests, linter, or CI/CD pipeline configured.

## Project Structure

```
src/
├── index.ts              # CLI entry point & command dispatcher
├── commands/             # Command handlers (one file per command)
│   ├── add.ts            # Create new profile (interactive wizard)
│   ├── mark.ts           # Apply profile to current repo
│   ├── list.ts           # List all profiles
│   ├── remove.ts         # Delete a profile
│   ├── status.ts         # Show active profile for current repo
│   ├── doctor.ts         # Diagnose repo config issues
│   ├── clone.ts          # Clone repo with a profile applied
│   ├── desktop.ts        # GitHub Desktop account switching
│   └── undo.ts           # Restore from snapshots
├── core/                 # Core logic modules
│   ├── profiles.ts       # Profile CRUD (reads/writes profiles.json)
│   ├── git-config.ts     # Git config manipulation
│   ├── ssh-config.ts     # ~/.ssh/config management (fenced sections)
│   ├── desktop/          # GitHub Desktop integration
│   └── snapshot/         # Snapshot & restore system
├── providers/            # SSH key provider implementations
│   ├── types.ts          # SSHKeyProvider interface
│   ├── index.ts          # Provider registry
│   ├── onepassword.ts    # 1Password (via `op` CLI)
│   ├── manual.ts         # Manual ~/.ssh keys
│   └── proton.ts         # Proton Pass (stub/TODO)
└── utils/                # Shared utilities
    ├── paths.ts          # Path resolution helpers
    ├── shell.ts          # Shell command execution (run/runOrThrow)
    └── errors.ts         # Custom error class hierarchy
```

## Key Conventions

### Naming
- **Files/folders:** kebab-case (`git-config.ts`, `ssh-config.ts`)
- **Functions/variables:** camelCase (`markCommand`, `getProfile`)
- **Classes:** PascalCase (`OnePasswordProvider`, `GitSwitchError`)

### Architecture Patterns

**Command pattern:** Each command is an async function exported from `src/commands/<name>.ts`. The dispatcher in `index.ts` routes CLI args to the appropriate handler.

**Provider pattern:** SSH key providers implement the `SSHKeyProvider` interface from `providers/types.ts`. New providers register in `providers/index.ts`.

**Snapshot pattern:** Destructive operations snapshot affected files before writing. Snapshots live in `~/.config/git-switch/snapshots/<id>/`. The manifest is written last — its presence indicates a valid snapshot. On failure, auto-restore runs from the snapshot.

**Atomic writes:** All JSON/config files are written atomically (write to `.tmp`, then `fs.renameSync`).

### CLI UI Pattern

All commands follow this structure using `@clack/prompts`:
```typescript
export async function fooCommand(): Promise<void> {
  prompts.intro("git-switch foo — description");
  // ... interactive prompts (text, select, confirm, spinner)
  // ... perform operations
  prompts.outro("Done!");
}
```

### Error Handling
- Custom errors extend `GitSwitchError` (in `utils/errors.ts`)
- Subtypes: `ProviderError`, `SnapshotError`, `NotInGitRepoError`, `DesktopKeychainError`
- Commands catch errors, log via `prompts.cancel()`, and `process.exit(1)`

### Shell Execution
- All shell commands run synchronously via `spawnSync` with a 30-second timeout
- `run()` returns `{ ok, stdout, stderr }`; `runOrThrow()` throws on failure
- Git operations use `git config --file <path>` for direct config manipulation

### Data Storage
- Profiles: `~/.config/git-switch/profiles.json` (versioned JSON)
- Snapshots: `~/.config/git-switch/snapshots/`
- SSH public keys: `~/.ssh/git-switch-{alias}.pub`
