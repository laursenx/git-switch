# Manual Test Plan

Run these tests after any code changes. All commands use `bun src/index.ts` for dev or `./dist/git-switch.exe` for compiled binary.

## Build Pipeline

```bash
bun run lint          # Biome check — 0 errors
bun run typecheck     # tsc --noEmit — 0 errors
bun run build         # Bundle to dist/index.js
bun run compile       # Compile standalone binary
```

## CLI Basics

```bash
git-switch --version  # Prints version from package.json
git-switch --help     # Lists all commands
```

## Profile Commands

```bash
git-switch list               # Shows all profiles with ID, label, email, provider, alias, desktop link
git-switch status             # Shows active profile for current repo (must be inside a git repo)
git-switch mark <profile-id>  # Applies profile to current repo, prompts for Desktop switch if linked
git-switch global --help      # Shows usage for global identity command
git-switch remove --help      # Shows usage for remove command
git-switch clone --help       # Shows usage for clone command
```

## Scan

```bash
git-switch scan  # Scans current directory for git repos, reports ok/unmarked/out-of-sync counts
```

## Undo / Snapshots

```bash
git-switch undo --list  # Lists all snapshots for current repo with ID, timestamp, operation, restored status
```

## Desktop Commands

```bash
git-switch desktop --help   # Lists all desktop subcommands (save, list, remove, switch, link)
git-switch desktop list     # Shows saved Desktop profiles with linked profile info
```

## Compiled Binary

After `bun run compile`, repeat these with `./dist/git-switch.exe`:

```bash
./dist/git-switch.exe --version
./dist/git-switch.exe list
./dist/git-switch.exe status
./dist/git-switch.exe scan
./dist/git-switch.exe desktop list
./dist/git-switch.exe undo --list
```

## Expected Results

- All build pipeline steps exit 0 with no errors
- `--version` matches `version` field in package.json
- `--help` lists all 10 commands: add, mark, global, list, remove, status, scan, clone, desktop, undo
- `list` shows profiles with correct columns
- `status` shows the applied profile for the current repo
- `scan` finds repos and reports correct counts
- `undo --list` shows snapshots (may be empty if none taken)
- `desktop list` shows saved Desktop profiles (may be empty)
- `desktop --help` lists 6 subcommands: save, list, remove, switch, link
- Compiled binary produces identical output to `bun src/index.ts`
