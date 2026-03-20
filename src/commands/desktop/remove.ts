import * as prompts from "@clack/prompts";
import { removeDesktopProfile } from "../../core/desktop-profiles.js";
import {
	listAllProfiles,
	updateProfileDesktopLink,
} from "../../core/profiles.js";
import { selectDesktopProfile } from "../../utils/prompts.js";

export async function desktopRemoveCommand(id?: string): Promise<void> {
	prompts.intro("git-switch desktop remove - Delete a Desktop profile");

	const target = await selectDesktopProfile(
		id,
		"Select Desktop profile to remove",
	);

	const confirmed = await prompts.confirm({
		message: `Delete Desktop profile "${target.id}"?`,
	});
	if (prompts.isCancel(confirmed) || !confirmed) {
		prompts.cancel("Aborted.");
		process.exit(0);
	}

	// Clear desktop_profile_id on any linked git-switch profiles
	const allProfiles = listAllProfiles();
	let cleared = 0;
	for (const profile of allProfiles) {
		if (profile.desktop_profile_id === target.id) {
			updateProfileDesktopLink(profile.id, null);
			cleared++;
		}
	}
	if (cleared > 0) {
		prompts.log.info(`Cleared link from ${cleared} git-switch profile(s).`);
	}

	const removed = removeDesktopProfile(target.id);
	prompts.log.success(
		`Removed Desktop profile: ${removed.label} (${removed.email})`,
	);
	prompts.outro("Done!");
}
