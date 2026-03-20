import { Command } from "commander";
import pkg from "../package.json";
import { addCommand } from "./commands/add.js";
import { cloneCommand } from "./commands/clone.js";
import { desktopAddCommand } from "./commands/desktop/add.js";
import { desktopLinkCommand } from "./commands/desktop/link.js";
import { desktopListCommand } from "./commands/desktop/list.js";
import { desktopReauthCommand } from "./commands/desktop/reauth.js";
import { desktopRemoveCommand } from "./commands/desktop/remove.js";
import { desktopSwitchCommand } from "./commands/desktop/switch.js";
import { globalCommand } from "./commands/global.js";
import { listCommand } from "./commands/list.js";
import { markCommand } from "./commands/mark.js";
import { removeCommand } from "./commands/remove.js";
import { scanCommand } from "./commands/scan.js";
import { statusCommand } from "./commands/status.js";
import { undoCommand, undoListCommand } from "./commands/undo.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { listAllProfiles } from "./core/profiles.js";

const VERSION = pkg.version;

const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const R = "\x1b[0m";

function printHelp() {
	const profiles = listAllProfiles();
	const count = profiles.length;

	console.log("");
	console.log(`  ${BOLD}git-switch${R} ${DIM}v${VERSION}${R}`);
	console.log(`  ${DIM}Git identity & SSH key profile switcher${R}`);
	console.log("");

	if (count === 0) {
		console.log(`  ${YELLOW}No profiles configured yet.${R}`);
		console.log(`  Get started by creating your first profile:`);
		console.log("");
		console.log(`    ${CYAN}gs add${R}`);
		console.log("");
	} else {
		console.log(`  ${GREEN}${count} profile(s)${R} configured`);
		console.log("");
	}

	console.log(`  ${BOLD}Getting started${R}`);
	console.log(`    ${CYAN}add${R}          Create a new profile ${DIM}(interactive wizard)${R}`);
	console.log(`    ${CYAN}list${R}         List all profiles`);
	console.log(`    ${CYAN}remove${R}       Delete a profile`);
	console.log("");

	console.log(`  ${BOLD}Using profiles${R}`);
	console.log(`    ${CYAN}mark${R}         Apply a profile to the current repo`);
	console.log(`    ${CYAN}global${R}       Set global git identity ${DIM}(~/.gitconfig)${R}`);
	console.log(`    ${CYAN}status${R}       Show active profile in current repo`);
	console.log(`    ${CYAN}clone${R}        Clone a repo with a profile applied`);
	console.log(`    ${CYAN}scan${R}         Find repos without a configured identity`);
	console.log("");

	console.log(`  ${BOLD}GitHub Desktop${R}`);
	console.log(`    ${CYAN}desktop add${R}      Save a Desktop account`);
	console.log(`    ${CYAN}desktop switch${R}   Switch Desktop to a saved account`);
	console.log(`    ${CYAN}desktop list${R}     List saved Desktop profiles`);
	console.log(`    ${CYAN}desktop remove${R}   Remove a saved Desktop profile`);
	console.log(`    ${CYAN}desktop reauth${R}   Re-authenticate an expired profile`);
	console.log(`    ${CYAN}desktop link${R}     Link Desktop profile to git-switch profile`);
	console.log("");

	console.log(`  ${BOLD}Maintenance${R}`);
	console.log(`    ${CYAN}undo${R}         Restore from snapshot`);
	console.log(`    ${CYAN}uninstall${R}    Uninstall git-switch`);
	console.log("");

	if (count === 0) {
		console.log(`  ${DIM}Typical workflow:  gs add  →  gs mark  →  done${R}`);
	} else {
		console.log(`  ${DIM}Shortcut: ${BOLD}gs${R}${DIM} is an alias for ${BOLD}git-switch${R}`);
	}
	console.log("");
}

// biome-ignore lint/suspicious/noExplicitAny: Commander.js action callbacks have heterogeneous argument types
type ActionFn = (...args: any[]) => Promise<void>;
function wrap(fn: ActionFn): ActionFn {
	return async (...args) => {
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
program
	.name("git-switch")
	.description("Git identity and SSH key profile switcher")
	.version(VERSION)
	.configureHelp({ showGlobalOptions: false })
	.helpCommand(false)
	.addHelpCommand(false);

program
	.command("add")
	.description("Create a new profile (interactive wizard)")
	.action(wrap(addCommand));
program
	.command("mark")
	.description("Apply a profile to the current repo")
	.argument("[profile-id]", "Profile ID")
	.action(wrap((id?: string) => markCommand(id)));
program
	.command("global")
	.description("Set global git identity (~/.gitconfig)")
	.argument("[profile-id]", "Profile ID")
	.action(wrap((id?: string) => globalCommand(id)));
program
	.command("list")
	.description("List all profiles")
	.action(wrap(listCommand));
program
	.command("remove")
	.description("Delete a profile")
	.argument("[profile-id]", "Profile ID")
	.action(wrap((id?: string) => removeCommand(id)));
program
	.command("status")
	.description("Show active profile in current repo")
	.action(wrap(statusCommand));
program
	.command("scan")
	.description("Scan current directory for unconfigured repos")
	.action(wrap(scanCommand));
program
	.command("clone")
	.description("Clone a repo with a profile")
	.argument("<profile-id>", "Profile ID")
	.argument("<url>", "Git URL")
	.argument("[dir]", "Target directory")
	.action(
		wrap((profileId: string, url: string, dir?: string) =>
			cloneCommand(profileId, url, dir),
		),
	);

const desktop = program
	.command("desktop")
	.description("GitHub Desktop profile management");
desktop
	.command("add")
	.description("Add a GitHub Desktop account")
	.action(wrap(desktopAddCommand));
desktop
	.command("list")
	.description("List saved Desktop profiles")
	.action(wrap(desktopListCommand));
desktop
	.command("remove")
	.description("Remove a saved Desktop profile")
	.argument("[id]", "Desktop profile ID")
	.action(wrap((id?: string) => desktopRemoveCommand(id)));
desktop
	.command("switch")
	.description("Switch to a Desktop profile")
	.argument("[id]", "Desktop profile ID")
	.action(wrap((id?: string) => desktopSwitchCommand(id)));
desktop
	.command("reauth")
	.description("Re-authenticate an expired Desktop profile")
	.argument("[id]", "Desktop profile ID")
	.action(wrap((id?: string) => desktopReauthCommand(id)));
desktop
	.command("link")
	.description("Link Desktop profile to git-switch profile")
	.action(wrap(desktopLinkCommand));

program
	.command("uninstall")
	.description("Uninstall git-switch from this machine")
	.action(wrap(uninstallCommand));
program
	.command("undo")
	.description("Restore from snapshot")
	.argument("[snapshot-id]", "Specific snapshot ID")
	.option("--list", "List all snapshots for current repo")
	.action(
		wrap(async (snapshotId?: string, opts?: { list?: boolean }) => {
			if (opts?.list) {
				await undoListCommand();
			} else {
				await undoCommand(snapshotId);
			}
		}),
	);

program.on("option:help", () => {
	printHelp();
	process.exit(0);
});

const parsed = program.parseOptions(process.argv.slice(2));
if (parsed.operands.length === 0 && !parsed.unknown.includes("--version") && !parsed.unknown.includes("-V")) {
	printHelp();
	process.exit(0);
}

program.parse();
