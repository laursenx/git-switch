import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { markCommand } from "./commands/mark.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import { statusCommand } from "./commands/status.js";
import { scanCommand } from "./commands/doctor.js";
import { cloneCommand } from "./commands/clone.js";
import { globalCommand } from "./commands/global.js";
import { desktopSaveCommand } from "./commands/desktop/save.js";
import { desktopListCommand } from "./commands/desktop/list.js";
import { desktopRemoveCommand } from "./commands/desktop/remove.js";
import { desktopSwitchCommand } from "./commands/desktop/switch.js";
import { desktopLinkCommand } from "./commands/desktop/link.js";
import { undoCommand, undoListCommand } from "./commands/undo.js";

const VERSION = "0.1.0";

function wrap(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      const prompts = await import("@clack/prompts");
      prompts.cancel(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  };
}

const program = new Command();
program.name("git-switch").description("Git identity and SSH key profile switcher").version(VERSION);

program.command("add").description("Create a new profile (interactive wizard)").action(wrap(addCommand));
program.command("mark").description("Apply a profile to the current repo").argument("[profile-id]", "Profile ID").action(wrap((id?: string) => markCommand(id)));
program.command("global").description("Set global git identity (~/.gitconfig)").argument("[profile-id]", "Profile ID").action(wrap((id?: string) => globalCommand(id)));
program.command("list").description("List all profiles").action(wrap(listCommand));
program.command("remove").description("Delete a profile").argument("[profile-id]", "Profile ID").action(wrap((id?: string) => removeCommand(id)));
program.command("status").description("Show active profile in current repo").action(wrap(statusCommand));
program.command("scan").description("Scan current directory for unconfigured repos").action(wrap(scanCommand));
program.command("clone").description("Clone a repo with a profile").argument("<profile-id>", "Profile ID").argument("<url>", "Git URL").argument("[dir]", "Target directory").action(wrap((profileId: string, url: string, dir?: string) => cloneCommand(profileId, url, dir)));

const desktop = program.command("desktop").description("GitHub Desktop profile management");
desktop.command("save").description("Capture current Desktop session").action(wrap(desktopSaveCommand));
desktop.command("list").description("List saved Desktop profiles").action(wrap(desktopListCommand));
desktop.command("remove").description("Remove a saved Desktop profile").argument("[id]", "Desktop profile ID").action(wrap((id?: string) => desktopRemoveCommand(id)));
desktop.command("switch").description("Switch to a Desktop profile").argument("[id]", "Desktop profile ID").action(wrap((id?: string) => desktopSwitchCommand(id)));
desktop.command("link").description("Link Desktop profile to git-switch profile").action(wrap(desktopLinkCommand));

program.command("undo").description("Restore from snapshot").argument("[snapshot-id]", "Specific snapshot ID").option("--list", "List all snapshots for current repo").action(wrap(async (snapshotId?: string, opts?: { list?: boolean }) => {
  if (opts?.list) {
    await undoListCommand();
  } else {
    await undoCommand(snapshotId);
  }
}));

program.parse();
