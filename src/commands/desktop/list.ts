import * as prompts from "@clack/prompts";
import { listAllDesktopProfiles } from "../../core/desktop-profiles.js";
import { listAllProfiles } from "../../core/profiles.js";

export async function desktopListCommand(): Promise<void> {
	prompts.intro("git-switch desktop list - Saved Desktop profiles");

	const desktopProfiles = listAllDesktopProfiles();
	if (desktopProfiles.length === 0) {
		prompts.log.info("No Desktop profiles saved. Run: git-switch desktop save");
		prompts.outro("");
		return;
	}

	// Build a map of desktop profile ID → linked git-switch profile ID
	const gitProfiles = listAllProfiles();
	const linkMap = new Map<string, string>();
	for (const gp of gitProfiles) {
		if (gp.desktop_profile_id) {
			linkMap.set(gp.desktop_profile_id, gp.id);
		}
	}

	const header = [
		"ID".padEnd(20),
		"Label".padEnd(24),
		"Email".padEnd(32),
		"Linked to",
	].join("");

	prompts.log.info(header);
	prompts.log.info("-".repeat(header.length));

	for (const dp of desktopProfiles) {
		const linked = linkMap.get(dp.id) || "-";
		const line = [
			dp.id.padEnd(20),
			dp.label.padEnd(24),
			dp.email.padEnd(32),
			linked,
		].join("");
		prompts.log.info(line);
	}

	prompts.outro(`${desktopProfiles.length} Desktop profile(s)`);
}
