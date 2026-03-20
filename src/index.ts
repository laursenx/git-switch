import * as prompts from "@clack/prompts";
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
import { detectCurrentProfile, getGitDir } from "./core/git-config.js";
import { listAllProfiles } from "./core/profiles.js";
import { run } from "./utils/shell.js";

const VERSION = pkg.version;

const ansi = {
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	bold: "\x1b[1m",
	reset: "\x1b[0m",
} as const;

function printHelp() {
	const count = listAllProfiles().length;
	const { dim: d, cyan: c, green: g, yellow: y, bold: b, reset: r } = ansi;

	const statusLine =
		count === 0
			? [`  ${y}No profiles configured yet.${r}`, `  Get started by creating your first profile:`, "", `    ${c}gs add${r}`, ""]
			: [`  ${g}${count} profile(s)${r} configured`, ""];

	const footer =
		count === 0
			? `  ${d}Typical workflow:  gs add  →  gs mark  →  done${r}`
			: `  ${d}Shortcut: ${b}gs${r}${d} is an alias for ${b}git-switch${r}`;

	const lines = [
		"",
		`  ${c}⇄${r} ${b}git-switch${r} ${d}v${VERSION}${r}`,
		`  ${d}Git identity & SSH key profile switcher${r}`,
		"",
		...statusLine,
		`  ${b}Getting started${r}`,
		`    ${c}add${r}          Create a new profile ${d}(interactive wizard)${r}`,
		`    ${c}list${r}         List all profiles`,
		`    ${c}remove${r}       Delete a profile`,
		"",
		`  ${b}Using profiles${r}`,
		`    ${c}mark${r}         Apply a profile to the current repo`,
		`    ${c}global${r}       Set global git identity ${d}(~/.gitconfig)${r}`,
		`    ${c}status${r}       Show active profile in current repo`,
		`    ${c}clone${r}        Clone a repo with a profile applied`,
		`    ${c}scan${r}         Find repos without a configured identity`,
		"",
		`  ${b}GitHub Desktop${r}`,
		`    ${c}desktop add${r}      Save a Desktop account`,
		`    ${c}desktop switch${r}   Switch Desktop to a saved account`,
		`    ${c}desktop list${r}     List saved Desktop profiles`,
		`    ${c}desktop remove${r}   Remove a saved Desktop profile`,
		`    ${c}desktop reauth${r}   Re-authenticate an expired profile`,
		`    ${c}desktop link${r}     Link Desktop profile to git-switch profile`,
		"",
		`  ${b}Maintenance${r}`,
		`    ${c}undo${r}         Restore from snapshot`,
		`    ${c}uninstall${r}    Uninstall git-switch`,
		"",
		footer,
		"",
	];

	console.log(lines.join("\n"));
}

// biome-ignore lint/suspicious/noExplicitAny: Commander.js action callbacks have heterogeneous argument types
type ActionFn = (...args: any[]) => Promise<void>;
function wrap(fn: ActionFn): ActionFn {
	return async (...args) => {
		try {
			await fn(...args);
		} catch (err) {
			prompts.cancel(err instanceof Error ? err.message : String(err));
			process.exit(1);
		}
	};
}

const hubActions: Record<string, () => Promise<void> | void> = {
	global: () => globalCommand(),
	mark: () => markCommand(),
	status: () => statusCommand(),
	list: () => listCommand(),
	add: () => addCommand(),
	desktop: () => desktopSwitchCommand(),
	help: () => printHelp(),
};

async function interactiveHub(): Promise<void> {
	const profiles = listAllProfiles();

	if (profiles.length === 0) {
		printHelp();
		return;
	}

	let repoProfile: string | undefined;
	let globalIdentity: string | undefined;
	try {
		const gitDir = getGitDir();
		const current = detectCurrentProfile(`${gitDir}/config`);
		if (current.email) {
			const matched = profiles.find((p) => p.git.email === current.email);
			repoProfile = matched ? `${matched.label} (${matched.id})` : `${current.name} <${current.email}>`;
		}
	} catch (_) {}

	try {
		const globalName = run("git", ["config", "--global", "user.name"]).stdout;
		const globalEmail = run("git", ["config", "--global", "user.email"]).stdout;
		if (globalEmail) {
			const matched = profiles.find((p) => p.git.email === globalEmail);
			globalIdentity = matched ? `${matched.label} (${matched.id})` : `${globalName} <${globalEmail}>`;
		}
	} catch (_) {}

	const { bold: b, dim: d, cyan: c, reset: r } = ansi;
	const header = [
		"",
		`  ${c}⇄${r} ${b}git-switch${r} ${d}v${VERSION}${r}`,
		globalIdentity ? `  ${d}Global: ${globalIdentity}${r}` : null,
		repoProfile ? `  ${d}Repo:   ${repoProfile}${r}` : null,
		"",
	]
		.filter((line) => line !== null)
		.join("\n");
	console.log(header);

	const action = await prompts.select({
		message: "What would you like to do?",
		options: [
			{ value: "global" as const, label: "Switch global identity", hint: "~/.gitconfig" },
			{ value: "mark" as const, label: "Mark this repo", hint: "set repo-level identity" },
			{ value: "status" as const, label: "View status", hint: "current repo profile" },
			{ value: "list" as const, label: "List profiles" },
			{ value: "add" as const, label: "Add a new profile" },
			{ value: "desktop" as const, label: "GitHub Desktop", hint: "switch Desktop account" },
			{ value: "help" as const, label: "Show all commands" },
		],
	});

	if (prompts.isCancel(action)) {
		console.log("");
		return;
	}

	console.log("");
	await hubActions[action]?.();
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

const rawArgs = process.argv.slice(2);
const hasHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
const hasVersion = rawArgs.includes("--version") || rawArgs.includes("-V");
const parsed = program.parseOptions(rawArgs);
const hasCommand = parsed.operands.length > 0;

if (hasHelp && !hasCommand) {
	printHelp();
	process.exit(0);
} else if (!hasCommand && !hasVersion) {
	interactiveHub().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
} else {
	program.parse();
}
