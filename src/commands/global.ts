import * as prompts from "@clack/prompts";
import { getProfile, listAllProfiles } from "../core/profiles.js";
import { applyProfileToConfig } from "../core/git-config.js";
import { updateSSHConfigForProfiles } from "../core/ssh-config.js";
import { globalGitConfigPath } from "../utils/paths.js";
import type { Profile } from "../providers/types.js";

export async function globalCommand(profileId?: string): Promise<void> {
  prompts.intro("git-switch global — Set global git identity");

  const profiles = listAllProfiles();
  if (profiles.length === 0) {
    prompts.cancel("No profiles configured. Run: git-switch add");
    process.exit(1);
  }

  let profile: Profile | undefined;

  if (profileId) {
    profile = getProfile(profileId);
    if (!profile) {
      prompts.cancel(`Profile "${profileId}" not found.`);
      process.exit(1);
    }
  } else if (profiles.length === 1) {
    profile = profiles[0]!;
    const confirmed = await prompts.confirm({
      message: `Set global profile to "${profile.label}" (${profile.git.email})?`,
    });
    if (prompts.isCancel(confirmed) || !confirmed) {
      prompts.cancel("Aborted.");
      process.exit(0);
    }
  } else {
    const choice = await prompts.select({
      message: "Select profile to set globally",
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
    profile = getProfile(choice as string)!;
  }

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

  prompts.outro("Done!");
}
