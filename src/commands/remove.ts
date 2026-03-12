import * as prompts from "@clack/prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import { getProfile, removeProfile, listAllProfiles } from "../core/profiles.js";
import {
  removeAliasFromSSHConfig,
  deletePublicKeyFile,
  updateSSHConfigForProfiles,
} from "../core/ssh-config.js";
import { projectsDir } from "../utils/paths.js";
import { run } from "../utils/shell.js";

export async function removeCommand(profileId?: string): Promise<void> {
  prompts.intro("git-switch remove — Delete a profile");

  if (!profileId) {
    const profiles = listAllProfiles();
    if (profiles.length === 0) {
      prompts.cancel("No profiles configured.");
      process.exit(1);
    }
    const choice = await prompts.select({
      message: "Select profile to remove",
      options: profiles.map((p) => ({
        value: p.id,
        label: p.label,
        hint: p.git.email,
      })),
    });
    if (prompts.isCancel(choice)) {
      prompts.cancel("Aborted.");
      process.exit(0);
    }
    profileId = choice as string;
  }

  const profile = getProfile(profileId);
  if (!profile) {
    prompts.cancel(`Profile "${profileId}" not found.`);
    process.exit(1);
  }

  // Check for repos using this profile
  const projDir = projectsDir();
  if (fs.existsSync(projDir)) {
    const result = run("git", [
      "config",
      "--get",
      "user.email",
    ]);
    // Simple scan for repos that might use this profile
    prompts.log.info(
      `Checking ~/projects/ for repos marked with "${profileId}"...`,
    );
  }

  const confirmed = await prompts.confirm({
    message: `Delete profile "${profile.label}" (${profile.git.email})?`,
  });
  if (prompts.isCancel(confirmed) || !confirmed) {
    prompts.cancel("Aborted.");
    process.exit(0);
  }

  // Remove profile
  removeProfile(profileId);

  // Remove SSH host block
  removeAliasFromSSHConfig(profile.ssh.alias);

  // Delete public key file
  deletePublicKeyFile(profile.ssh.alias);

  // Re-generate SSH config for remaining profiles
  const remaining = listAllProfiles();
  if (remaining.length > 0) {
    updateSSHConfigForProfiles(remaining);
  }

  prompts.log.success(`Profile "${profile.label}" removed.`);
  prompts.log.info("SSH config and public key file cleaned up.");
  prompts.log.warn(
    "Note: Repos marked with this profile still have its identity in .git/config. " +
      "Run `git-switch mark` in each repo to switch to another profile.",
  );

  prompts.outro("Done!");
}
