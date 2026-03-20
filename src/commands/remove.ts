import * as prompts from "@clack/prompts";
import { listAllProfiles, removeProfile } from "../core/profiles.js";
import {
	deletePublicKeyFile,
	updateSSHConfigForProfiles,
} from "../core/ssh-config.js";
import { abortIfCancelled, selectProfile } from "../utils/prompts.js";

export async function removeCommand(profileId?: string): Promise<void> {
	prompts.intro("git-switch remove - Delete a profile");

	const profile = await selectProfile(profileId, "Select profile to remove");

	const confirmed = abortIfCancelled(
		await prompts.confirm({
			message: `Delete profile "${profile.label}" (${profile.git.email})?`,
		}),
	);
	if (!confirmed) {
		prompts.cancel("Aborted.");
		process.exit(0);
	}

	// Remove profile
	removeProfile(profile.id);

	// Delete public key file
	deletePublicKeyFile(profile.ssh.alias);

	// Re-generate SSH config for remaining profiles (removes the deleted alias)
	const remaining = listAllProfiles();
	updateSSHConfigForProfiles(remaining);

	prompts.log.success(`Profile "${profile.label}" removed.`);
	prompts.log.info("SSH config and public key file cleaned up.");
	prompts.log.warn(
		"Note: Repos marked with this profile still have its identity in .git/config. " +
			"Run `git-switch mark` in each repo to switch to another profile.",
	);

	prompts.outro("Done!");
}
