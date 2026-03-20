import * as prompts from "@clack/prompts";
import { captureCurrentSession } from "../../core/desktop/capture.js";
import {
	getDesktopProfile,
	listAllDesktopProfiles,
} from "../../core/desktop-profiles.js";
import {
	listAllProfiles,
	updateProfileDesktopLink,
} from "../../core/profiles.js";
import { abortIfCancelled } from "../../utils/prompts.js";

export async function desktopLinkCommand(): Promise<void> {
	prompts.intro(
		"git-switch desktop link - Link Desktop profile to git-switch profile",
	);

	const gitProfiles = listAllProfiles();
	if (gitProfiles.length === 0) {
		prompts.cancel("No git-switch profiles configured. Run: git-switch add");
		process.exit(1);
	}

	// Choose source: current session or existing saved profile
	const source = abortIfCancelled(
		await prompts.select({
			message: "Link from:",
			options: [
				{
					value: "current",
					label: "Currently signed-in Desktop account",
					hint: "captures and saves the current session",
				},
				{
					value: "saved",
					label: "Existing saved Desktop profile",
				},
			],
		}),
	);

	let desktopProfileId: string;

	if (source === "current") {
		const captured = await captureCurrentSession();
		desktopProfileId = captured.id;
	} else {
		const desktopProfiles = listAllDesktopProfiles();
		if (desktopProfiles.length === 0) {
			prompts.cancel("No Desktop profiles saved. Run: git-switch desktop save");
			process.exit(1);
		}

		desktopProfileId = abortIfCancelled(
			await prompts.select({
				message: "Select Desktop profile",
				options: desktopProfiles.map((dp) => ({
					value: dp.id,
					label: dp.label,
					hint: dp.email,
				})),
			}),
		);
	}

	// Select which git-switch profile to link to
	const profileChoice = abortIfCancelled(
		await prompts.select({
			message: "Link to git-switch profile:",
			options: gitProfiles.map((p) => ({
				value: p.id,
				label: p.label,
				hint: p.git.email,
			})),
		}),
	);

	// Update the git-switch profile
	updateProfileDesktopLink(profileChoice, desktopProfileId);

	const dp = getDesktopProfile(desktopProfileId);
	const linkedProfile = gitProfiles.find((p) => p.id === profileChoice);
	if (!dp || !linkedProfile) {
		prompts.cancel("Profile not found.");
		process.exit(1);
	}
	prompts.log.success(
		`Linked "${dp.label}" (${dp.email}) → "${linkedProfile.label}" (${linkedProfile.id})`,
	);
	prompts.outro("Done!");
}
