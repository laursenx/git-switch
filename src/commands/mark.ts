import * as prompts from "@clack/prompts";
import { getProfile, listAllProfiles } from "../core/profiles.js";
import {
  getGitDir,
  getRepoRoot,
  applyProfileToConfig,
  findSubmoduleConfigs,
} from "../core/git-config.js";
import { updateSSHConfigForProfiles } from "../core/ssh-config.js";
import { takeSnapshot, pruneSnapshots } from "../core/snapshot/index.js";
import { repoHash } from "../utils/paths.js";
import { detectCurrentProfile } from "../core/git-config.js";
import { switchDesktop } from "../core/desktop/index.js";
import type { Profile } from "../providers/types.js";

export async function markCommand(profileId?: string): Promise<void> {
  prompts.intro("git-switch mark — Apply profile to current repo");

  const profiles = listAllProfiles();
  if (profiles.length === 0) {
    prompts.cancel("No profiles configured. Run: git-switch add");
    process.exit(1);
  }

  // Resolve profile
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
      message: `Apply profile "${profile.label}" (${profile.git.email})?`,
    });
    if (prompts.isCancel(confirmed) || !confirmed) {
      prompts.cancel("Aborted.");
      process.exit(0);
    }
  } else {
    const choice = await prompts.select({
      message: "Select profile to apply",
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

  // Resolve git directory
  let gitDir: string;
  let repoRoot: string;
  try {
    gitDir = getGitDir();
    repoRoot = getRepoRoot();
  } catch {
    prompts.cancel("Not inside a git repository.");
    process.exit(1);
  }

  const mainConfigPath = `${gitDir}/config`;
  const submoduleConfigs = findSubmoduleConfigs(gitDir);

  // Detect current profile for snapshot metadata
  const current = detectCurrentProfile(mainConfigPath);
  const currentProfileId = profiles.find(
    (p) => p.git.email === current.email,
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
    const allProfiles = listAllProfiles();
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
  if (profile.github_desktop?.enabled) {
    try {
      await switchDesktop(profile.id);
    } catch (err) {
      prompts.log.warn(
        `GitHub Desktop switch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Prune old snapshots
  pruneSnapshots(repoHash(repoRoot));

  // Summary
  prompts.log.success(`Profile: ${profile.label} (${profile.id})`);
  prompts.log.info(`Identity: ${profile.git.name} <${profile.git.email}>`);
  prompts.log.info(`SSH alias: ${profile.ssh.alias} → ${profile.ssh.host}`);
  if (submoduleConfigs.length > 0) {
    prompts.log.info(
      `Submodule configs updated: ${submoduleConfigs.length}`,
    );
  }
  prompts.log.info(`Snapshot: ${snapshot.id}`);

  prompts.outro("Done!");
}
