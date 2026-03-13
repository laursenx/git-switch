import * as prompts from "@clack/prompts";
import {
	copyKeychainEntry,
	listGitHubCredentials,
	readKeychainEntry,
	renameKeychainEntry,
} from "../../core/desktop/keychain.js";
import { tryReadDesktopUsers } from "../../core/desktop/local-storage.js";
import {
	isDesktopRunning,
	killDesktop,
	launchDesktop,
} from "../../core/desktop/process.js";
import {
	addDesktopProfile,
	listAllDesktopProfiles,
} from "../../core/desktop-profiles.js";
import type { DesktopProfile } from "../../providers/types.js";
import { abortIfCancelled } from "../../utils/prompts.js";
import {
	makeStoredLabel,
	validateEmail,
	validateProfileId,
	validateRequired,
} from "../../utils/validation.js";

/**
 * Prompt for profile details, copy the credential, and save the desktop profile.
 * Returns the saved profile.
 */
async function saveCredential(keychainLabel: string): Promise<DesktopProfile> {
	const id = abortIfCancelled(
		await prompts.text({
			message: "Desktop profile ID (slug, no spaces)",
			placeholder: "work-desktop",
			validate: validateProfileId,
		}),
	);

	const label = abortIfCancelled(
		await prompts.text({
			message: "Desktop profile label (display name)",
			placeholder: "Work GitHub",
			validate: validateRequired,
		}),
	);

	const email = abortIfCancelled(
		await prompts.text({
			message: "GitHub account email",
			placeholder: "user@example.com",
			validate: validateEmail,
		}),
	);

	const storedLabel = makeStoredLabel(id, email);

	const usersJson = tryReadDesktopUsers();

	// Copy credential to stored label (keeps user signed in)
	const spinner = prompts.spinner();
	spinner.start("Saving credential...");
	copyKeychainEntry(keychainLabel, storedLabel, email);
	spinner.stop("Credential saved.");

	const profile: DesktopProfile = {
		id,
		label,
		email,
		keychain_label: keychainLabel,
		stored_label: storedLabel,
		users_json: usersJson,
	};

	addDesktopProfile(profile);
	prompts.log.success(`Desktop profile "${id}" saved.`);

	return profile;
}

/**
 * Select which credential to use when one or more are detected.
 */
async function selectCredentialLabel(
	credentials: ReturnType<typeof listGitHubCredentials>,
): Promise<string> {
	if (credentials.length === 1) {
		const label = credentials[0]?.target;
		prompts.log.success(
			`Detected GitHub Desktop account: ${credentials[0]?.user || label}`,
		);
		return label;
	}
	return abortIfCancelled(
		await prompts.select({
			message: "Multiple accounts detected — select one to save",
			options: credentials.map((c) => ({
				value: c.target,
				label: c.target,
				hint: c.user || undefined,
			})),
		}),
	);
}

export async function desktopAddCommand(): Promise<void> {
	prompts.intro("git-switch desktop add — Add a GitHub Desktop account");

	prompts.note(
		"Do NOT sign out of GitHub Desktop manually.\n" +
			"git-switch manages sessions by moving credentials.\n" +
			"Signing out manually will invalidate the saved token.",
		"Important",
	);

	// Detect GitHub credentials with retry loop
	let credentials = listGitHubCredentials();

	while (credentials.length === 0) {
		prompts.log.warn(
			"No GitHub Desktop account detected.\n" +
				"  Please sign in to GitHub Desktop, then come back here.",
		);

		const action = abortIfCancelled(
			await prompts.select({
				message: "What would you like to do?",
				options: [
					{
						value: "retry",
						label: "Check again",
						hint: "after signing in to GitHub Desktop",
					},
					{ value: "cancel", label: "Cancel" },
				],
			}),
		);

		if (action === "cancel") {
			prompts.cancel("Aborted.");
			process.exit(0);
		}

		credentials = listGitHubCredentials();
	}

	// Credential detected — ask what to do
	const intent = abortIfCancelled(
		await prompts.select({
			message: "GitHub Desktop account detected",
			options: [
				{
					value: "current",
					label: "Use current account",
					hint: "save the currently signed-in account",
				},
				{
					value: "another",
					label: "Sign in to another account",
					hint: "parks current session, relaunches Desktop",
				},
			],
		}),
	);

	if (intent === "current") {
		const keychainLabel = await selectCredentialLabel(credentials);

		const entry = readKeychainEntry(keychainLabel);
		if (!entry) {
			prompts.cancel(
				`Could not read credential: "${keychainLabel}"\n` +
					"Make sure GitHub Desktop is signed in with this account.",
			);
			process.exit(1);
		}

		await saveCredential(keychainLabel);
		prompts.outro("Done! GitHub Desktop remains signed in.");
		return;
	}

	// "Sign in to another" flow:
	// 1. Check if current credential is already saved as a desktop profile
	const currentLabel = await selectCredentialLabel(credentials);

	const currentEntry = readKeychainEntry(currentLabel);
	if (!currentEntry) {
		prompts.cancel(
			`Could not read credential: "${currentLabel}"\n` +
				"Make sure GitHub Desktop is signed in with this account.",
		);
		process.exit(1);
	}

	const existingProfiles = listAllDesktopProfiles();
	let profileToPark = existingProfiles.find(
		(dp) => dp.keychain_label === currentLabel,
	);

	if (profileToPark) {
		prompts.log.info(
			`Current account is already saved as "${profileToPark.id}".`,
		);
	} else {
		// Not saved yet — save it first so the credential isn't lost
		prompts.log.step("First, let's save the current account.");
		profileToPark = await saveCredential(currentLabel);
	}

	// 2. Park the active credential (move it to stored label so Desktop forgets it)
	const parkSpinner = prompts.spinner();
	parkSpinner.start("Parking current session...");
	renameKeychainEntry(
		profileToPark.keychain_label,
		profileToPark.stored_label,
		profileToPark.email,
	);
	parkSpinner.stop("Current session parked.");

	// 3. Kill & relaunch Desktop so user can sign in with another account
	if (isDesktopRunning()) {
		killDesktop();
	}
	launchDesktop();

	prompts.log.info(
		"GitHub Desktop has been relaunched.\n" +
			"  Please sign in with another account, then come back here.",
	);

	// 4. Wait for new credential
	let newCredentials = listGitHubCredentials();

	while (newCredentials.length === 0) {
		const action = abortIfCancelled(
			await prompts.select({
				message: "What would you like to do?",
				options: [
					{
						value: "retry",
						label: "Check again",
						hint: "after signing in to GitHub Desktop",
					},
					{ value: "cancel", label: "Cancel" },
				],
			}),
		);

		if (action === "cancel") {
			// Restore the parked credential before exiting
			renameKeychainEntry(
				profileToPark.stored_label,
				profileToPark.keychain_label,
				profileToPark.email,
			);
			prompts.cancel("Aborted. Previous session restored.");
			process.exit(0);
		}

		newCredentials = listGitHubCredentials();

		if (newCredentials.length === 0) {
			prompts.log.warn("No new GitHub Desktop account detected yet.");
		}
	}

	// 5. Save the new account
	const newLabel = await selectCredentialLabel(newCredentials);

	const newEntry = readKeychainEntry(newLabel);
	if (!newEntry) {
		prompts.cancel(
			`Could not read credential: "${newLabel}"\n` +
				"Make sure GitHub Desktop is signed in with this account.",
		);
		process.exit(1);
	}

	await saveCredential(newLabel);
	prompts.outro("Done! GitHub Desktop remains signed in with the new account.");
}
