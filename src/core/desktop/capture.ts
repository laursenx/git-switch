import * as prompts from "@clack/prompts";
import type { DesktopProfile } from "../../providers/types.js";
import { abortIfCancelled } from "../../utils/prompts.js";
import {
	makeStoredLabel,
	validateEmail,
	validateProfileId,
	validateRequired,
} from "../../utils/validation.js";
import { addDesktopProfile } from "../desktop-profiles.js";
import {
	copyKeychainEntry,
	listGitHubCredentials,
	readKeychainEntry,
} from "./keychain.js";
import { tryReadDesktopUsers } from "./local-storage.js";

export async function captureCurrentSession(): Promise<DesktopProfile> {
	prompts.note(
		"Do NOT sign out of GitHub Desktop manually.\n" +
			"git-switch manages sessions by moving credentials.\n" +
			"Signing out manually will invalidate the saved token.",
		"Important",
	);

	const id = abortIfCancelled(
		await prompts.text({
			message: "Desktop profile ID (slug, no spaces)",
			placeholder: "work-desktop",
			validate: validateProfileId,
		}),
	);

	const label = abortIfCancelled(
		await prompts.text({
			message: "Desktop profile label",
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

	// Detect GitHub credentials
	const credentials = listGitHubCredentials();
	let keychainLabel: string;

	if (credentials.length === 0) {
		keychainLabel = abortIfCancelled(
			await prompts.text({
				message:
					"No GitHub credentials detected. Enter the credential target/label manually:",
				placeholder: "git:https://github.com",
				validate: validateRequired,
			}),
		);
	} else if (credentials.length === 1) {
		keychainLabel = credentials[0]?.target;
		prompts.log.info(`Using credential: ${keychainLabel}`);
	} else {
		keychainLabel = abortIfCancelled(
			await prompts.select({
				message: "Select the GitHub credential to capture",
				options: credentials.map((c) => ({
					value: c.target,
					label: c.target,
					hint: c.user || undefined,
				})),
			}),
		);
	}

	const storedLabel = makeStoredLabel(id, email);

	const entry = readKeychainEntry(keychainLabel);
	if (!entry) {
		prompts.cancel(
			`Could not read credential: "${keychainLabel}"\n` +
				"Make sure GitHub Desktop is signed in with this account.",
		);
		process.exit(1);
	}

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
