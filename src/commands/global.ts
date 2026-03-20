import * as prompts from "@clack/prompts";
import { getDesktopProfile } from "../core/desktop-profiles.js";
import { applyProfileToConfig } from "../core/git-config.js";
import { listAllProfiles } from "../core/profiles.js";
import { updateSSHConfigForProfiles } from "../core/ssh-config.js";
import { globalGitConfigPath } from "../utils/paths.js";
import { selectProfile, switchDesktopWithRecovery } from "../utils/prompts.js";

export async function globalCommand(profileId?: string): Promise<void> {
	prompts.intro("git-switch global - Set global git identity");

	const profile = await selectProfile(
		profileId,
		"Select profile to set globally",
	);

	const configPath = globalGitConfigPath();

	const spinner = prompts.spinner();
	spinner.start("Applying global profile...");

	applyProfileToConfig(configPath, profile);

	const allProfiles = listAllProfiles();
	updateSSHConfigForProfiles(allProfiles);

	spinner.stop("Global profile applied.");

	prompts.log.success(`Profile: ${profile.label} (${profile.id})`);
	prompts.log.info(`Identity: ${profile.git.name} <${profile.git.email}>`);
	prompts.log.info(`SSH alias: ${profile.ssh.alias} → ${profile.ssh.host}`);

	// Switch GitHub Desktop if this profile has a linked desktop profile
	if (profile.desktop_profile_id) {
		const desktopProfile = getDesktopProfile(profile.desktop_profile_id);
		if (desktopProfile) {
			await switchDesktopWithRecovery(desktopProfile);
		}
	}

	prompts.outro("Done!");
}
