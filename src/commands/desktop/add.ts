import * as prompts from "@clack/prompts";
import {
	copyKeychainEntry,
	type DetectedCredential,
	listValidGitHubCredentials,
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
	credentials: DetectedCredential[],
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
			message: "Multiple accounts detected - select one to save",
			options: credentials.map((c) => ({
				value: c.target,
				label: c.target,
				hint: c.user || undefined,
			})),
		}),
	);
}

export async function desktopAddCommand(): Promise<void> {
	prompts.intro("git-switch desktop add - Add a GitHub Desktop account");

	prompts.note(
		"Do NOT sign out of GitHub Desktop manually.\n" +
			"git-switch manages sessions by moving credentials.\n" +
			"Signing out manually will invalidate the saved token.",
		"Important",
	);

	// Detect GitHub credentials with token validation
	const detectSpinner = prompts.spinner();
	detectSpinner.start("Checking for GitHub Desktop account...");
	let credentials = await listValidGitHubCredentials();
	detectSpinner.stop(
		credentials.length > 0
			? `Found ${credentials.length} valid account(s).`
			: "No valid account found.",
	);

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

		const retrySpinner = prompts.spinner();
		retrySpinner.start("Checking for GitHub Desktop account...");
		credentials = await listValidGitHubCredentials();
		retrySpinner.stop(
			credentials.length > 0
				? `Found ${credentials.length} valid account(s).`
				: "No valid account found.",
		);
	}

	// Credential detected - ask what to do
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
	// 1. Save and park ALL active credentials so Desktop shows sign-in screen
	const existingProfiles = listAllDesktopProfiles();
	const profilesToRestore: DesktopProfile[] = [];

	for (const cred of credentials) {
		const entry = readKeychainEntry(cred.target);
		if (!entry) continue;

		let profile = existingProfiles.find(
			(dp) => dp.keychain_label === cred.target,
		);

		if (profile) {
			prompts.log.info(
				`Account "${cred.user || cred.target}" is already saved as "${profile.id}".`,
			);
		} else {
			prompts.log.step(
				`Saving account "${cred.user || cred.target}" before parking.`,
			);
			profile = await saveCredential(cred.target);
		}

		profilesToRestore.push(profile);
	}

	// 2. Park all active credentials (move to stored labels so Desktop forgets them)
	const parkSpinner = prompts.spinner();
	parkSpinner.start(`Parking ${profilesToRestore.length} session(s)...`);
	for (const profile of profilesToRestore) {
		renameKeychainEntry(
			profile.keychain_label,
			profile.stored_label,
			profile.email,
		);
	}
	parkSpinner.stop(`${profilesToRestore.length} session(s) parked.`);

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
	const newDetectSpinner = prompts.spinner();
	newDetectSpinner.start("Checking for new GitHub Desktop account...");
	let newCredentials = await listValidGitHubCredentials();
	newDetectSpinner.stop(
		newCredentials.length > 0
			? `Found ${newCredentials.length} valid account(s).`
			: "No new account found.",
	);

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
			for (const profile of profilesToRestore) {
				renameKeychainEntry(
					profile.stored_label,
					profile.keychain_label,
					profile.email,
				);
			}
			prompts.log.info("Previous session(s) restored.");
			prompts.cancel("Aborted.");
			process.exit(0);
		}

		const retrySpinner = prompts.spinner();
		retrySpinner.start("Checking for new GitHub Desktop account...");
		newCredentials = await listValidGitHubCredentials();
		retrySpinner.stop(
			newCredentials.length > 0
				? `Found ${newCredentials.length} valid account(s).`
				: "No new account found.",
		);
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
