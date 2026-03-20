import * as fs from "node:fs";
import * as path from "node:path";
import * as prompts from "@clack/prompts";
import { configDir, sshDir } from "../utils/paths.js";
import { abortIfCancelled } from "../utils/prompts.js";
import { run } from "../utils/shell.js";

function getInstallDir(): string {
	const localAppData = process.env.LOCALAPPDATA || "";
	return path.join(localAppData, "git-switch", "bin");
}

function getBinaryPath(): string {
	return path.join(getInstallDir(), "git-switch.exe");
}

function removeFencedSSHConfig(): boolean {
	const sshConfigPath = path.join(sshDir(), "config");
	if (!fs.existsSync(sshConfigPath)) return false;

	const content = fs.readFileSync(sshConfigPath, "utf-8");
	const beginMarker = "# --- git-switch managed --- BEGIN ---";
	const endMarker = "# --- git-switch managed --- END ---";

	const beginIdx = content.indexOf(beginMarker);
	const endIdx = content.indexOf(endMarker);
	if (beginIdx === -1 || endIdx === -1) return false;

	const before = content.slice(0, beginIdx);
	const after = content.slice(endIdx + endMarker.length);
	const cleaned = `${before.trimEnd()}\n${after.trimStart()}`.trim();
	fs.writeFileSync(sshConfigPath, `${cleaned}\n`, "utf-8");
	return true;
}

function removeSSHPublicKeys(): number {
	const dir = sshDir();
	if (!fs.existsSync(dir)) return 0;

	const files = fs
		.readdirSync(dir)
		.filter((f) => f.startsWith("git-switch-") && f.endsWith(".pub"));
	for (const file of files) {
		fs.unlinkSync(path.join(dir, file));
	}
	return files.length;
}

function removeFromPath(): boolean {
	const installDir = getInstallDir();
	// Use PowerShell to read/write the user PATH registry value
	const readResult = run("powershell.exe", [
		"-NoProfile",
		"-Command",
		'[Environment]::GetEnvironmentVariable("Path", "User")',
	]);
	if (readResult.exitCode !== 0) return false;

	const userPath = readResult.stdout.trim();
	const parts = userPath.split(";").filter((p) => p !== installDir && p !== "");
	const newPath = parts.join(";");

	if (newPath === userPath) return false;

	run("powershell.exe", [
		"-NoProfile",
		"-Command",
		`[Environment]::SetEnvironmentVariable("Path", "${newPath}", "User")`,
	]);
	return true;
}

export async function uninstallCommand(): Promise<void> {
	prompts.intro("git-switch uninstall");

	const confirm = abortIfCancelled(
		await prompts.confirm({
			message: "Are you sure you want to uninstall git-switch?",
			initialValue: false,
		}),
	);

	if (!confirm) {
		prompts.cancel("Aborted.");
		process.exit(0);
	}

	// Remove SSH config fenced section
	if (removeFencedSSHConfig()) {
		prompts.log.success("Removed git-switch section from ~/.ssh/config");
	}

	// Remove SSH public key files
	const keyCount = removeSSHPublicKeys();
	if (keyCount > 0) {
		prompts.log.success(
			`Removed ${keyCount} SSH public key file(s) from ~/.ssh/`,
		);
	}

	// Ask about config directory
	const cfgDir = configDir();
	if (fs.existsSync(cfgDir)) {
		const removeConfig = abortIfCancelled(
			await prompts.confirm({
				message: `Remove configuration and database at ${cfgDir}?`,
				initialValue: false,
			}),
		);

		if (removeConfig) {
			fs.rmSync(cfgDir, { recursive: true, force: true });
			prompts.log.success("Removed configuration directory.");
		} else {
			prompts.log.info("Configuration kept.");
		}
	}

	// Remove from PATH
	if (removeFromPath()) {
		prompts.log.success("Removed from user PATH.");
	}

	// Schedule binary deletion (can't delete self while running)
	const binaryPath = getBinaryPath();
	const exePath = process.execPath;
	const isInstalled = fs.existsSync(binaryPath);

	if (isInstalled) {
		// Use cmd /c with ping for a short delay, then delete
		const deleteTarget =
			exePath.toLowerCase() === binaryPath.toLowerCase() ? exePath : binaryPath;
		const installDir = getInstallDir();
		const parentDir = path.dirname(installDir);

		run("cmd.exe", [
			"/c",
			`start /min cmd /c "ping -n 2 127.0.0.1 >nul & del /f /q "${deleteTarget}" & rmdir "${installDir}" 2>nul & rmdir "${parentDir}" 2>nul"`,
		]);
		prompts.log.success("Binary scheduled for removal.");
	}

	prompts.outro(
		isInstalled
			? "git-switch has been uninstalled. You may need to restart your terminal."
			: "git-switch cleanup complete.",
	);
}
