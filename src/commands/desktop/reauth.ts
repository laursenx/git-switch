import * as prompts from "@clack/prompts";
import {
	copyKeychainEntry,
	fetchDesktopUsersJson,
	listValidGitHubCredentials,
	readKeychainEntry,
	validateStoredToken,
} from "../../core/desktop/keychain.js";
import { tryReadDesktopUsers } from "../../core/desktop/local-storage.js";
import { updateDesktopProfileUsersJson } from "../../core/desktop-profiles.js";
import { abortIfCancelled, selectDesktopProfile } from "../../utils/prompts.js";

export async function desktopReauthCommand(id?: string): Promise<void> {
	prompts.intro(
		"git-switch desktop reauth - Re-authenticate a Desktop profile",
	);

	const profile = await selectDesktopProfile(
		id,
		"Select Desktop profile to re-authenticate",
	);

	// Check if the stored token is still valid
	const checkSpinner = prompts.spinner();
	checkSpinner.start("Validating stored token...");
	const storedToken = await validateStoredToken(profile.stored_label);
	checkSpinner.stop(
		storedToken ? "Token is still valid." : "Token is expired or missing.",
	);

	if (storedToken) {
		prompts.log.success(
			`Profile "${profile.label}" is already authenticated (${storedToken.login}).`,
		);
		prompts.outro("No action needed.");
		return;
	}

	prompts.log.warn(
		"The saved token for this profile has expired or been revoked.\n" +
			"  Please sign in to GitHub Desktop with this account, then come back here.",
	);

	// Wait for the user to sign in
	let credentials = await listValidGitHubCredentials();

	while (credentials.length === 0) {
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

	// Select which credential to use
	let keychainLabel: string;
	if (credentials.length === 1) {
		keychainLabel = credentials[0]?.target;
		prompts.log.success(
			`Detected GitHub Desktop account: ${credentials[0]?.user || keychainLabel}`,
		);
	} else {
		keychainLabel = abortIfCancelled(
			await prompts.select({
				message: "Multiple accounts detected - select the one to use",
				options: credentials.map((c) => ({
					value: c.target,
					label: c.target,
					hint: c.user || undefined,
				})),
			}),
		);
	}

	const entry = readKeychainEntry(keychainLabel);
	if (!entry) {
		prompts.cancel(
			`Could not read credential: "${keychainLabel}"\n` +
				"Make sure GitHub Desktop is signed in with this account.",
		);
		process.exit(1);
	}

	// Overwrite the stored credential with the fresh one
	const spinner = prompts.spinner();
	spinner.start("Updating stored credential...");
	copyKeychainEntry(keychainLabel, profile.stored_label, profile.email);
	spinner.stop("Credential updated.");

	// Refresh users_json from the GitHub API
	const usersSpinner = prompts.spinner();
	usersSpinner.start("Fetching account data...");
	const usersJson =
		tryReadDesktopUsers() ??
		(await fetchDesktopUsersJson(profile.stored_label));
	if (usersJson) {
		updateDesktopProfileUsersJson(profile.id, usersJson);
	}
	usersSpinner.stop("Account data updated.");

	prompts.log.success(`Profile "${profile.label}" has been re-authenticated.`);
	prompts.outro("Done! You can now switch to this profile.");
}
