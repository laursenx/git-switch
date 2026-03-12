import * as prompts from "@clack/prompts";
import { addCommand } from "./commands/add.js";
import { markCommand } from "./commands/mark.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import { statusCommand } from "./commands/status.js";
import { doctorCommand } from "./commands/doctor.js";
import { cloneCommand } from "./commands/clone.js";
import { globalCommand } from "./commands/global.js";
import { desktopCommand } from "./commands/desktop/index.js";
import { undoCommand, undoListCommand } from "./commands/undo.js";
import { migrateEmbeddedDesktopProfiles } from "./core/desktop-profiles.js";

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`
git-switch v${VERSION}
Git identity and SSH key profile switcher

Usage: git-switch <command> [options]

Commands:
  add                    Create a new profile (interactive wizard)
  mark [profile-id]      Apply a profile to the current repo
  global [profile-id]    Set global git identity (~/.gitconfig)
  list                   List all profiles
  remove [profile-id]    Delete a profile
  status                 Show active profile in current repo
  doctor                 Scan ~/projects/ and report unmarked repos
  clone <profile-id> <url> [dir]   Clone a repo with a profile
  desktop save             Capture current Desktop session
  desktop list             List saved Desktop profiles
  desktop remove [id]      Remove a saved Desktop profile
  desktop switch [id]      Switch to a Desktop profile
  desktop link             Link Desktop profile to git-switch profile
  undo                   Restore the most recent snapshot
  undo --list            List all snapshots for current repo
  undo <snapshot-id>     Restore a specific snapshot

Options:
  --help, -h             Show this help message
  --version, -v          Show version
`);
}

async function main(): Promise<void> {
  // Migrate old embedded desktop profiles to separate storage
  migrateEmbeddedDesktopProfiles();

  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }

  try {
    switch (command) {
      case "add":
        await addCommand();
        break;

      case "mark":
        await markCommand(args[1]);
        break;

      case "global":
        await globalCommand(args[1]);
        break;

      case "list":
        await listCommand();
        break;

      case "remove":
        await removeCommand(args[1]);
        break;

      case "status":
        await statusCommand();
        break;

      case "doctor":
        await doctorCommand();
        break;

      case "clone":
        await cloneCommand(args[1], args[2], args[3]);
        break;

      case "desktop":
        await desktopCommand(args.slice(1));
        break;

      case "undo":
        if (args[1] === "--list") {
          await undoListCommand();
        } else {
          await undoCommand(args[1]);
        }
        break;

      default:
        prompts.log.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    prompts.cancel(
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

main();
