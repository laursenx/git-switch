import * as log from "@clack/prompts";
import type { DesktopProfile } from "../../providers/types.js";
import {
	DesktopTokenExpiredError,
	GitSwitchError,
} from "../../utils/errors.js";
import { listAllDesktopProfiles } from "../desktop-profiles.js";
import { pruneSnapshots, takeSnapshot } from "../snapshot/index.js";
import {
	readKeychainEntry,
	renameKeychainEntry,
	validateStoredToken,
} from "./keychain.js";
import { writeLocalStorageKey } from "./local-storage.js";
import { isDesktopRunning, killDesktop, launchDesktop } from "./process.js";

export function findActiveDesktopProfiles(): DesktopProfile[] {
	const profiles = listAllDesktopProfiles();
	return profiles.filter((dp) => readKeychainEntry(dp.keychain_label) !== null);
}

export async function switchDesktopToProfile(
	target: DesktopProfile,
): Promise<void> {
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
			throw new DesktopTokenExpiredError(target.id, target.label);
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
		renameKeychainEntry(
			target.stored_label,
			target.keychain_label,
			target.email,
		);
	}

	// Kill Desktop before writing to LevelDB (it holds a lock on the files)
	if (isDesktopRunning()) {
		killDesktop();
	}

	// Update LevelDB users data (Desktop 3.x)
	if (target.users_json) {
		try {
			writeLocalStorageKey("users", target.users_json);
		} catch (err) {
			log.log.warn(
				`Could not update localStorage: ${err instanceof Error ? err.message : err}`,
			);
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
