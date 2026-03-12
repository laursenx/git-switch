import * as prompts from "@clack/prompts";
import { getProfile, listAllProfiles } from "../core/profiles.js";
import { getDesktopProfile, listAllDesktopProfiles } from "../core/desktop-profiles.js";
import { getGitDir, getRepoRoot } from "../core/git-config.js";
import type { Profile, DesktopProfile } from "../providers/types.js";

export function abortIfCancelled<T>(value: T | symbol): T {
  if (prompts.isCancel(value)) {
    prompts.cancel("Aborted.");
    process.exit(0);
  }
  return value as T;
}

/**
 * Resolve a profile by ID, or interactively select one.
 * Exits the process on cancel or not-found.
 */
export async function selectProfile(
  profileId?: string,
  message = "Select profile",
): Promise<Profile> {
  const profiles = listAllProfiles();
  if (profiles.length === 0) {
    prompts.cancel("No profiles configured. Run: git-switch add");
    process.exit(1);
  }

  if (profileId) {
    const profile = getProfile(profileId);
    if (!profile) {
      prompts.cancel(`Profile "${profileId}" not found.`);
      process.exit(1);
    }
    return profile;
  }

  if (profiles.length === 1) {
    const profile = profiles[0]!;
    const confirmed = abortIfCancelled(await prompts.confirm({
      message: `Use profile "${profile.label}" (${profile.git.email})?`,
    }));
    if (!confirmed) {
      prompts.cancel("Aborted.");
      process.exit(0);
    }
    return profile;
  }

  const choice = abortIfCancelled(await prompts.select({
    message,
    options: profiles.map((p) => ({
      value: p.id,
      label: p.label,
      hint: p.git.email,
    })),
  }));
  const profile = getProfile(choice as string);
  if (!profile) {
    prompts.cancel(`Profile "${choice}" not found.`);
    process.exit(1);
  }
  return profile;
}

/**
 * Resolve a desktop profile by ID, or interactively select one.
 * Exits the process on cancel or not-found.
 */
export async function selectDesktopProfile(
  id?: string,
  message = "Select Desktop profile",
): Promise<DesktopProfile> {
  const desktopProfiles = listAllDesktopProfiles();
  if (desktopProfiles.length === 0) {
    prompts.cancel("No Desktop profiles saved. Run: git-switch desktop save");
    process.exit(1);
  }

  if (id) {
    const found = getDesktopProfile(id);
    if (!found) {
      prompts.cancel(`Desktop profile "${id}" not found.`);
      process.exit(1);
    }
    return found;
  }

  if (desktopProfiles.length === 1) {
    const dp = desktopProfiles[0]!;
    const confirmed = abortIfCancelled(await prompts.confirm({
      message: `Use Desktop profile "${dp.label}" (${dp.email})?`,
    }));
    if (!confirmed) {
      prompts.cancel("Aborted.");
      process.exit(0);
    }
    return dp;
  }

  const choice = abortIfCancelled(await prompts.select({
    message,
    options: desktopProfiles.map((dp) => ({
      value: dp.id,
      label: dp.label,
      hint: dp.email,
    })),
  }));
  const dp = getDesktopProfile(choice as string);
  if (!dp) {
    prompts.cancel(`Desktop profile "${choice}" not found.`);
    process.exit(1);
  }
  return dp;
}

/**
 * Ensure the CWD is inside a git repository.
 * Returns { gitDir, repoRoot } or exits with an error message.
 */
export function ensureGitRepo(): { gitDir: string; repoRoot: string } {
  try {
    const gitDir = getGitDir();
    const repoRoot = getRepoRoot();
    return { gitDir, repoRoot };
  } catch {
    prompts.cancel("Not inside a git repository.");
    process.exit(1);
  }
}
