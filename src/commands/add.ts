import * as prompts from "@clack/prompts";
import {
	copyKeychainEntry,
	listValidGitHubCredentials,
	readKeychainEntry,
	renameKeychainEntry,
} from "../core/desktop/keychain.js";
import { tryReadDesktopUsers } from "../core/desktop/local-storage.js";
import {
	isDesktopRunning,
	killDesktop,
	launchDesktop,
} from "../core/desktop/process.js";
import { addDesktopProfile } from "../core/desktop-profiles.js";
import {
	addProfile,
	listAllProfiles,
	updateProfileDesktopLink,
} from "../core/profiles.js";
import {
	updateSSHConfigForProfiles,
	writePublicKeyFile,
} from "../core/ssh-config.js";
import { getAllProviders, getProvider } from "../providers/index.js";
import { OnePasswordProvider } from "../providers/onepassword.js";
import type { DesktopProfile, Profile } from "../providers/types.js";
import { abortIfCancelled } from "../utils/prompts.js";
import {
	makeStoredLabel,
	validateEmail,
	validateProfileId,
	validateRequired,
	validateSSHAlias,
} from "../utils/validation.js";

export async function addCommand(): Promise<void> {
	prompts.intro("git-switch add - Create a new profile");

	// 1. Profile ID
	const id = abortIfCancelled(
		await prompts.text({
			message: "Profile ID (slug, no spaces)",
			placeholder: "work",
			validate: validateProfileId,
		}),
	);

	// 2. Label
	const label = abortIfCancelled(
		await prompts.text({
			message: "Profile label (display name)",
			placeholder: "Work (GitHub)",
			validate: validateRequired,
		}),
	);

	// 3. Git name
	const gitName = abortIfCancelled(
		await prompts.text({
			message: "Git name",
			placeholder: "Jane Doe",
			validate: validateRequired,
		}),
	);

	// 4. Git email
	const gitEmail = abortIfCancelled(
		await prompts.text({
			message: "Git email",
			placeholder: "jane@acme.com",
			validate: validateEmail,
		}),
	);

	// 5. SSH provider selection
	const allProviders = getAllProviders();
	const availability = await Promise.all(
		allProviders.map(async (p) => {
			try {
				return { provider: p, available: await p.isAvailable() };
			} catch {
				return { provider: p, available: false };
			}
		}),
	);

	const providerChoice = abortIfCancelled(
		await prompts.select({
			message: "SSH key provider",
			options: availability.map(({ provider, available }) => ({
				value: provider.id,
				label: available ? provider.name : `${provider.name} (not detected)`,
				hint: available ? undefined : "unavailable",
			})),
		}),
	);

	const provider = getProvider(providerChoice);

	// 5b. 1Password availability check with retry
	if (provider instanceof OnePasswordProvider) {
		let diag = provider.getDiagnostic();
		while (!diag.installed || !diag.signedIn) {
			if (!diag.installed) {
				prompts.log.error(
					"1Password CLI (op) is not installed.\n" +
						"  Install it from: https://developer.1password.com/docs/cli/get-started/",
				);
			} else if (!diag.signedIn) {
				prompts.log.error(
					"1Password CLI is installed but not signed in.\n" +
						"  Run: op signin\n" +
						"  Docs: https://developer.1password.com/docs/cli/get-started/",
				);
			}

			const action = abortIfCancelled(
				await prompts.select({
					message: "What would you like to do?",
					options: [
						{
							value: "retry",
							label: "Try again",
							hint: "after installing or signing in",
						},
						{ value: "cancel", label: "Cancel" },
					],
				}),
			);

			if (action === "cancel") {
				prompts.cancel("Aborted.");
			process.exit(0);
			}

			diag = provider.getDiagnostic();
		}
	}

	// 6. Key selection
	const listSpinner = prompts.spinner();
	listSpinner.start(
		provider instanceof OnePasswordProvider
			? "Fetching SSH keys from 1Password..."
			: "Fetching SSH keys...",
	);
	let keys: Awaited<ReturnType<typeof provider.listKeys>>;
	try {
		keys = await provider.listKeys();
		listSpinner.stop(`Found ${keys.length} SSH key(s).`);
	} catch (err) {
		listSpinner.stop("Failed to fetch SSH keys.");
		prompts.cancel(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
	let selectedRef: string;

	if (keys.length === 0) {
		selectedRef = abortIfCancelled(
			await prompts.text({
				message: "No keys found. Enter key reference manually:",
				placeholder:
					provider.id === "manual"
						? "~/.ssh/id_ed25519.pub"
						: "Key name or UUID",
				validate: validateRequired,
			}),
		);
	} else {
		selectedRef = abortIfCancelled(
			await prompts.select({
				message: "Select SSH key",
				options: keys.map((k) => ({
					value: k.ref,
					label: k.label,
					hint: k.vault ? `vault: ${k.vault}` : undefined,
				})),
			}),
		);
	}

	// 7. Git host
	const host = abortIfCancelled(
		await prompts.text({
			message: "Git host",
			placeholder: "github.com",
			initialValue: "github.com",
			validate: validateRequired,
		}),
	);

	// 8. SSH alias
	const defaultAlias = `github-${id}`;
	const alias = abortIfCancelled(
		await prompts.text({
			message: "SSH alias",
			placeholder: defaultAlias,
			initialValue: defaultAlias,
			validate: validateSSHAlias,
		}),
	);

	// 9. Write profile
	const profile: Profile = {
		id,
		label,
		git: { name: gitName, email: gitEmail },
		ssh: {
			provider: providerChoice as Profile["ssh"]["provider"],
			ref: selectedRef,
			host,
			alias,
		},
	};

	addProfile(profile);

	// 11. Update ~/.ssh/config
	const allProfiles = listAllProfiles();
	updateSSHConfigForProfiles(allProfiles);

	// 12. Fetch and write public key file (for non-manual providers)
	if (provider.id !== "manual") {
		const spinner = prompts.spinner();
		spinner.start("Fetching public key...");
		try {
			const pubKey = await provider.getPublicKey(selectedRef);
			writePublicKeyFile(alias, pubKey);
			spinner.stop("Public key written.");
		} catch (err) {
			spinner.stop("Failed to fetch public key.");
			prompts.log.warn(
				`Could not fetch public key: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	// 13. Offer to capture GitHub Desktop session
	try {
		const detectSpinner = prompts.spinner();
		detectSpinner.start("Checking for GitHub Desktop account...");
		let credentials = await listValidGitHubCredentials();
		detectSpinner.stop(
			credentials.length > 0
				? `Found ${credentials.length} valid account(s).`
				: "No valid account found.",
		);

		if (credentials.length === 0) {
			// No Desktop account detected - ask if they want to link one
			const wantDesktop = abortIfCancelled(
				await prompts.confirm({
					message:
						"No GitHub Desktop account detected - would you like to link one?",
					initialValue: false,
				}),
			);

			if (wantDesktop) {
				prompts.log.info(
					"Please sign in to GitHub Desktop, then come back here.",
				);

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
								{ value: "skip", label: "Skip" },
							],
						}),
					);

					if (action === "skip") break;

					const retrySpinner = prompts.spinner();
					retrySpinner.start("Checking for GitHub Desktop account...");
					credentials = await listValidGitHubCredentials();
					retrySpinner.stop(
						credentials.length > 0
							? `Found ${credentials.length} valid account(s).`
							: "No valid account found.",
					);

					if (credentials.length === 0) {
						prompts.log.warn("Still no GitHub Desktop account detected.");
					}
				}
			}
		}

		if (credentials.length > 0) {
			const intent = abortIfCancelled(
				await prompts.select({
					message: "GitHub Desktop account detected",
					options: [
						{
							value: "current",
							label: "Use current account",
							hint: "save and link to this profile",
						},
						{
							value: "another",
							label: "Sign in to another account",
							hint: "parks current session, relaunches Desktop",
						},
						{ value: "skip", label: "Skip Desktop setup" },
					],
				}),
			);

			if (intent !== "skip") {
				prompts.note(
					"Do NOT sign out of GitHub Desktop manually.\n" +
						"git-switch manages sessions by moving credentials.\n" +
						"Signing out manually will invalidate the saved token.",
					"Important",
				);

				if (intent === "another") {
					// Save current account first so it's not lost
					prompts.log.step("First, let's save the current account.");
				}

				// Select and save the current credential
				let keychainLabel: string;
				if (credentials.length === 1) {
					keychainLabel = credentials[0]?.target;
					prompts.log.info(
						`Using credential: ${credentials[0]?.user || keychainLabel}`,
					);
				} else {
					keychainLabel = abortIfCancelled(
						await prompts.select({
							message: "Select the GitHub credential to capture",
							options: credentials.map(
								(c: { target: string; user: string }) => ({
									value: c.target,
									label: c.target,
									hint: c.user || undefined,
								}),
							),
						}),
					);
				}

				const entry = readKeychainEntry(keychainLabel);
				if (!entry) {
					prompts.log.warn(
						"Could not read credential - skipping Desktop setup.",
					);
				} else {
					const desktopId = `${id}-desktop`;
					const storedLabel = makeStoredLabel(desktopId, gitEmail);

					const usersJson = tryReadDesktopUsers();

					const saveSpinner = prompts.spinner();
					saveSpinner.start("Saving credential...");
					copyKeychainEntry(keychainLabel, storedLabel, gitEmail);
					saveSpinner.stop("Credential saved.");

					const dp: DesktopProfile = {
						id: desktopId,
						label,
						email: gitEmail,
						keychain_label: keychainLabel,
						stored_label: storedLabel,
						users_json: usersJson,
					};

					addDesktopProfile(dp);
					updateProfileDesktopLink(id, dp.id);
					prompts.log.success("Desktop profile saved and linked.");

					// "Sign in to another" - park, relaunch, wait for new credential
					if (intent === "another") {
						const parkSpinner = prompts.spinner();
						parkSpinner.start("Parking current session...");
						renameKeychainEntry(dp.keychain_label, dp.stored_label, dp.email);
						parkSpinner.stop("Current session parked.");

						if (isDesktopRunning()) {
							killDesktop();
						}
						launchDesktop();

						prompts.log.info(
							"GitHub Desktop has been relaunched.\n" +
								"  Please sign in with another account, then come back here.",
						);

						const newDetectSpinner = prompts.spinner();
						newDetectSpinner.start(
							"Checking for new GitHub Desktop account...",
						);
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
										{ value: "skip", label: "Skip" },
									],
								}),
							);

							if (action === "skip") {
								// Restore the parked credential
								renameKeychainEntry(
									dp.stored_label,
									dp.keychain_label,
									dp.email,
								);
								prompts.log.info("Previous session restored.");
								break;
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

						if (newCredentials.length > 0) {
							const newLabel =
								newCredentials.length === 1
									? newCredentials[0]?.target
									: abortIfCancelled(
											await prompts.select({
												message: "Select the new GitHub credential to save",
												options: newCredentials.map(
													(c: { target: string; user: string }) => ({
														value: c.target,
														label: c.target,
														hint: c.user || undefined,
													}),
												),
											}),
										);

							const newEntry = readKeychainEntry(newLabel);
							if (newEntry) {
								const newDesktopId = abortIfCancelled(
									await prompts.text({
										message:
											"Desktop profile ID for the new account (slug, no spaces)",
										placeholder: `${id}-desktop-2`,
										validate: validateProfileId,
									}),
								);
								const newEmail = abortIfCancelled(
									await prompts.text({
										message: "GitHub account email for the new account",
										placeholder: "user@example.com",
										validate: validateEmail,
									}),
								);
								const newStoredLabel = makeStoredLabel(newDesktopId, newEmail);

								const newUsersJson = tryReadDesktopUsers();

								const newSaveSpinner = prompts.spinner();
								newSaveSpinner.start("Saving new credential...");
								copyKeychainEntry(newLabel, newStoredLabel, newEmail);
								newSaveSpinner.stop("New credential saved.");

								const newDp: DesktopProfile = {
									id: newDesktopId,
									label: `${label} (2)`,
									email: newEmail,
									keychain_label: newLabel,
									stored_label: newStoredLabel,
									users_json: newUsersJson,
								};

								addDesktopProfile(newDp);
								// Link the NEW profile to the git-switch profile
								updateProfileDesktopLink(id, newDp.id);
								prompts.log.success("New Desktop profile saved and linked.");
							}
						}
					}
				}
			}
		}
	} catch {
		// Desktop detection failed (e.g., no keychain tool) - silently skip
	}

	prompts.outro(`Profile "${id}" created successfully!`);
}
