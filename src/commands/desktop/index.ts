import { desktopSaveCommand } from "./save.js";
import { desktopListCommand } from "./list.js";
import { desktopRemoveCommand } from "./remove.js";
import { desktopSwitchCommand } from "./switch.js";
import { desktopLinkCommand } from "./link.js";

function printDesktopHelp(): void {
  console.log(`
git-switch desktop — GitHub Desktop profile management

Subcommands:
  save                   Capture current Desktop session
  list                   List saved Desktop profiles
  remove [id]            Remove a saved Desktop profile
  switch [id]            Switch to a Desktop profile
  link                   Link a Desktop profile to a git-switch profile
`);
}

export async function desktopCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "save":
      return desktopSaveCommand();
    case "list":
      return desktopListCommand();
    case "remove":
      return desktopRemoveCommand(args[1]);
    case "switch":
      return desktopSwitchCommand(args[1]);
    case "link":
      return desktopLinkCommand();
    default:
      printDesktopHelp();
  }
}
