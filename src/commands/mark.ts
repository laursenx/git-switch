import * as prompts from "@clack/prompts";
import { getDesktopProfile } from "../core/desktop-profiles.js";
import {
	applyProfileToConfig,
	detectCurrentProfile,
	findSubmoduleConfigs,
} from "../core/git-config.js";
import { listAllProfiles } from "../core/profiles.js";
import { pruneSnapshots, takeSnapshot } from "../core/snapshot/index.js";
import { updateSSHConfigForProfiles } from "../core/ssh-config.js";
import { repoHash } from "../utils/paths.js";
import {
	ensureGitRepo,
	selectProfile,
	switchDesktopWithRecovery,
} from "../utils/prompts.js";

export async function markCommand(profileId?: string): Promise<void> {
	prompts.intro("git-switch mark - Apply profile to current repo");

	const profile = await selectProfile(profileId, "Select profile to apply");

	const { gitDir, repoRoot } = ensureGitRepo();

	const mainConfigPath = `${gitDir}/config`;
	const submoduleConfigs = findSubmoduleConfigs(gitDir);

	// Detect current profile for snapshot metadata
	const current = detectCurrentProfile(mainConfigPath);
	const allProfiles = listAllProfiles();
	const currentProfileId = allProfiles.find(
		(p: { git: { email: string } }) => p.git.email === current.email,
	)?.id;

	// Take snapshot before any writes
	const snapshot = takeSnapshot({
		operation: "mark",
		repoPath: repoRoot,
		gitDir,
		submoduleConfigs,
		profileBefore: currentProfileId,
		profileAfter: profile.id,
	});

	const spinner = prompts.spinner();
	spinner.start("Applying profile...");

	try {
		// Apply to main .git/config
		applyProfileToConfig(mainConfigPath, profile);

		// Apply to all submodule configs
		for (const subConfig of submoduleConfigs) {
			applyProfileToConfig(subConfig, profile);
		}

		// Update SSH config
		updateSSHConfigForProfiles(allProfiles);

		spinner.stop("Profile applied.");
	} catch (err) {
		spinner.stop("Failed to apply profile.");

		// Auto-restore from snapshot
		prompts.log.error(
			`Failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		prompts.log.info("Restoring previous state from snapshot...");

		const { restoreSnapshot } = await import("../core/snapshot/index.js");
		const result = restoreSnapshot(snapshot);

		for (const restored of result.restored) {
			prompts.log.success(`Restored: ${restored}`);
		}
		for (const failed of result.failed) {
			prompts.log.error(`Failed to restore: ${failed}`);
		}

		if (result.failed.length > 0) {
			prompts.log.error(
				`Manual restore needed from: ~/.config/git-switch/snapshots/${snapshot.id}`,
			);
		} else if (currentProfileId) {
			prompts.log.info(
				`Your repo is back to its previous state (${currentProfileId}).`,
			);
		}

		process.exit(1);
	}

	// Handle GitHub Desktop switching
	if (profile.desktop_profile_id) {
		const dp = getDesktopProfile(profile.desktop_profile_id);
		if (dp) {
			const shouldSwitch = await prompts.confirm({
				message: `Switch GitHub Desktop to "${dp.label}"?`,
				initialValue: true,
			});
			if (!prompts.isCancel(shouldSwitch) && shouldSwitch) {
				await switchDesktopWithRecovery(dp);
			}
		}
	}

	// Prune old snapshots
	pruneSnapshots(repoHash(repoRoot));

	// Summary
	prompts.log.success(`Profile: ${profile.label} (${profile.id})`);
	prompts.log.info(`Identity: ${profile.git.name} <${profile.git.email}>`);
	prompts.log.info(`SSH alias: ${profile.ssh.alias} → ${profile.ssh.host}`);
	if (submoduleConfigs.length > 0) {
		prompts.log.info(`Submodule configs updated: ${submoduleConfigs.length}`);
	}
	prompts.log.info(`Snapshot: ${snapshot.id}`);

	prompts.outro("Done!");
}
