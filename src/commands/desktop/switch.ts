import * as prompts from "@clack/prompts";
import { captureCurrentSession } from "../../core/desktop/capture.js";
import { switchDesktopToProfile } from "../../core/desktop/index.js";
import { listAllDesktopProfiles } from "../../core/desktop-profiles.js";
import type { DesktopProfile } from "../../providers/types.js";
import { DesktopTokenExpiredError } from "../../utils/errors.js";
import { abortIfCancelled, selectDesktopProfile } from "../../utils/prompts.js";

export async function desktopSwitchCommand(id?: string): Promise<void> {
	prompts.intro("git-switch desktop switch - Switch Desktop account");

	const target = await selectDesktopProfile(id, "Switch GitHub Desktop to:");

	const spinner = prompts.spinner();
	spinner.start("Switching GitHub Desktop...");

	try {
		await switchDesktopToProfile(target);
		spinner.stop("GitHub Desktop switched.");
	} catch (err) {
		spinner.stop("Switch failed.");

		if (err instanceof DesktopTokenExpiredError) {
			prompts.log.warn(
				`Token for "${target.label}" has expired or been revoked.\n` +
					"This usually happens when you sign out of GitHub Desktop manually.",
			);

			const recovery = abortIfCancelled(
				await prompts.select({
					message: "How would you like to proceed?",
					options: [
						{
							value: "capture",
							label: "Re-capture current Desktop session",
							hint: "sign into Desktop first, then choose this",
						},
						{
							value: "other",
							label: "Use a different saved Desktop profile",
						},
						{ value: "cancel", label: "Cancel" },
					],
				}),
			);

			if (recovery === "cancel") {
				prompts.cancel("Aborted.");
				process.exit(0);
			}

			if (recovery === "capture") {
				const captured = await captureCurrentSession();
				const switchNow = abortIfCancelled(
					await prompts.confirm({
						message: `Switch Desktop to "${captured.label}" now?`,
						initialValue: true,
					}),
				);
				if (switchNow) {
					const retrySpinner = prompts.spinner();
					retrySpinner.start("Switching GitHub Desktop...");
					try {
						await switchDesktopToProfile(captured);
						retrySpinner.stop("GitHub Desktop switched.");
					} catch (retryErr) {
						retrySpinner.stop("Switch failed.");
						throw retryErr;
					}
					prompts.outro(
						`GitHub Desktop is now using: ${captured.label} (${captured.email})`,
					);
				} else {
					prompts.outro(
						"Desktop profile saved. Switch later with: git-switch desktop switch",
					);
				}
				return;
			}

			if (recovery === "other") {
				const otherProfiles = listAllDesktopProfiles().filter(
					(dp) => dp.id !== target.id,
				);
				if (otherProfiles.length === 0) {
					prompts.cancel("No other Desktop profiles available.");
					process.exit(1);
				}

				const altProfile = abortIfCancelled(
					await prompts.select({
						message: "Select Desktop profile",
						options: otherProfiles.map((dp) => ({
							value: dp as DesktopProfile,
							label: dp.label,
							hint: dp.email,
						})),
					}),
				);

				const retrySpinner = prompts.spinner();
				retrySpinner.start("Switching GitHub Desktop...");
				try {
					await switchDesktopToProfile(altProfile);
					retrySpinner.stop("GitHub Desktop switched.");
				} catch (retryErr) {
					retrySpinner.stop("Switch failed.");
					throw retryErr;
				}
				prompts.outro(
					`GitHub Desktop is now using: ${altProfile.label} (${altProfile.email})`,
				);
				return;
			}
		}

		prompts.cancel(
			`Failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}

	prompts.outro(
		`GitHub Desktop is now using: ${target.label} (${target.email})`,
	);
}
