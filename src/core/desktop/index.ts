import * as log from "@clack/prompts";
import { listAllDesktopProfiles } from "../desktop-profiles.js";
import { takeSnapshot, pruneSnapshots } from "../snapshot/index.js";
import { writeAppStateAccounts } from "./app-state.js";
import { renameKeychainEntry, readKeychainEntry, validateStoredToken } from "./keychain.js";
import { writeLocalStorageKey } from "./local-storage.js";
import { killDesktop, isDesktopRunning, launchDesktop } from "./process.js";
import { GitSwitchError } from "../../utils/errors.js";
import type { DesktopProfile } from "../../providers/types.js";

export function findActiveDesktopProfiles(): DesktopProfile[] {
  const profiles = listAllDesktopProfiles();
  return profiles.filter((dp) => readKeychainEntry(dp.keychain_label) !== null);
}

export async function switchDesktopToProfile(target: DesktopProfile): Promise<void> {
  const activeProfiles = findActiveDesktopProfiles();
  const othersActive = activeProfiles.filter((dp) => dp.id !== target.id);
  const targetAlreadyActive = activeProfiles.some((dp) => dp.id === target.id);

  if (othersActive.length === 0 && targetAlreadyActive) {
    log.log.info("GitHub Desktop is already using this profile.");
    return;
  }

  // Pre-flight: verify the target credential exists and token is valid
  if (!targetAlreadyActive) {
    const targetEntry = readKeychainEntry(target.stored_label);
    if (!targetEntry) {
      throw new GitSwitchError(
        `Target credential not found: "${target.stored_label}"\n` +
          `Sign into this account in GitHub Desktop and re-run: git-switch desktop save`,
      );
    }

    const validUser = await validateStoredToken(target.stored_label);
    if (validUser === null) {
      throw new GitSwitchError(
        `Token for "${target.label}" has expired or been revoked.\n` +
          `Sign into this account in GitHub Desktop and re-run: git-switch desktop save`,
      );
    }
  }

  // Take snapshot before any changes
  takeSnapshot({
    operation: "desktop",
    profileBefore: othersActive[0]?.id,
    profileAfter: target.id,
  });

  // Park ALL other active profiles
  for (const other of othersActive) {
    renameKeychainEntry(other.keychain_label, other.stored_label, other.email);
  }

  // Activate the target if not already active
  if (!targetAlreadyActive) {
    renameKeychainEntry(target.stored_label, target.keychain_label, target.email);
  }

  // Kill Desktop before writing to LevelDB (it holds a lock on the files)
  if (isDesktopRunning()) {
    killDesktop();
  }

  // Update app-state.json accounts (Desktop 2.x)
  if (target.app_state_accounts) {
    writeAppStateAccounts(target.app_state_accounts);
  }

  // Update LevelDB users data (Desktop 3.x)
  if (target.users_json) {
    try {
      writeLocalStorageKey("users", target.users_json);
    } catch (err) {
      log.log.warn(`Could not update localStorage: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Launch GitHub Desktop
  launchDesktop();

  // Prune old desktop snapshots
  pruneSnapshots();

  log.log.success(
    `Switched GitHub Desktop to: ${target.label} (${target.email})`,
  );
}
