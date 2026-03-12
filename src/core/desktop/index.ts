import * as log from "@clack/prompts";
import { loadProfiles } from "../profiles.js";
import { takeSnapshot, pruneSnapshots } from "../snapshot/index.js";
import { readAppStateAccounts, writeAppStateAccounts } from "./app-state.js";
import { rotateKeychainEntries, readKeychainEntry } from "./keychain.js";
import { restartDesktop } from "./process.js";
import { GitSwitchError } from "../../utils/errors.js";
import type { Profile } from "../../providers/types.js";

function findActiveDesktopProfile(
  profiles: Profile[],
): Profile | undefined {
  for (const profile of profiles) {
    if (!profile.github_desktop?.enabled || !profile.github_desktop.keychain_label) {
      continue;
    }
    const entry = readKeychainEntry(profile.github_desktop.keychain_label);
    if (entry) return profile;
  }
  return undefined;
}

export async function switchDesktop(targetProfileId: string): Promise<void> {
  const config = loadProfiles();
  const targetProfile = config.profiles.find((p) => p.id === targetProfileId);

  if (!targetProfile) {
    throw new GitSwitchError(`Profile "${targetProfileId}" not found`);
  }
  if (!targetProfile.github_desktop?.enabled) {
    throw new GitSwitchError(
      `Profile "${targetProfileId}" does not have GitHub Desktop enabled`,
    );
  }

  const currentProfile = findActiveDesktopProfile(config.profiles);
  if (!currentProfile) {
    throw new GitSwitchError(
      "No currently active GitHub Desktop profile found. Is GitHub Desktop signed in?",
    );
  }

  if (currentProfile.id === targetProfile.id) {
    log.log.info("GitHub Desktop is already using this profile.");
    return;
  }

  // Take snapshot before any changes
  const keychainLabels = {
    before: currentProfile.github_desktop!.keychain_label!,
    after: targetProfile.github_desktop!.stored_label!,
  };

  takeSnapshot({
    operation: "desktop",
    profileBefore: currentProfile.id,
    profileAfter: targetProfile.id,
    keychainLabels,
  });

  // Rotate keychain entries
  rotateKeychainEntries({
    currentKeychainLabel: currentProfile.github_desktop!.keychain_label!,
    currentStoredLabel: currentProfile.github_desktop!.stored_label!,
    currentAccount: currentProfile.git.email,
    targetKeychainLabel: targetProfile.github_desktop!.keychain_label!,
    targetStoredLabel: targetProfile.github_desktop!.stored_label!,
    targetAccount: targetProfile.git.email,
  });

  // Update app-state.json accounts
  if (targetProfile.github_desktop!.app_state_accounts) {
    writeAppStateAccounts(targetProfile.github_desktop!.app_state_accounts);
  }

  // Restart GitHub Desktop
  restartDesktop();

  // Prune old desktop snapshots
  pruneSnapshots();

  log.log.success(
    `Switched GitHub Desktop to: ${targetProfile.label} (${targetProfile.git.email})`,
  );
}

export async function captureDesktopSetup(
  profileId: string,
): Promise<{
  keychain_label: string;
  stored_label: string;
  app_state_accounts: unknown[];
}> {
  // Find the currently active keychain entry
  // Common label patterns for GitHub Desktop
  const config = loadProfiles();
  const profile = config.profiles.find((p) => p.id === profileId);
  if (!profile) {
    throw new GitSwitchError(`Profile "${profileId}" not found`);
  }

  // Try to read accounts from app-state.json
  let accounts: unknown[] = [];
  try {
    accounts = readAppStateAccounts();
  } catch {
    log.log.warn("Could not read GitHub Desktop app-state.json");
  }

  // The user needs to tell us the keychain label, since it varies
  // For now we use a standard pattern
  const keychainLabel = `GitHub Desktop — ${profile.git.email}`;
  const storedLabel = `git-switch: ${profileId} — ${profile.git.email}`;

  // Verify the entry exists
  const entry = readKeychainEntry(keychainLabel);
  if (!entry) {
    throw new GitSwitchError(
      `No keychain entry found with label: "${keychainLabel}"\n` +
        "Make sure GitHub Desktop is signed in with this account.",
    );
  }

  return {
    keychain_label: keychainLabel,
    stored_label: storedLabel,
    app_state_accounts: accounts,
  };
}
