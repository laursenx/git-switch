import * as prompts from "@clack/prompts";
import { getProfile, listAllProfiles } from "../core/profiles.js";
import { switchDesktop } from "../core/desktop/index.js";
import type { Profile } from "../providers/types.js";

export async function desktopCommand(profileId?: string): Promise<void> {
  prompts.intro("git-switch desktop — Switch GitHub Desktop account");

  const profiles = listAllProfiles().filter(
    (p) => p.github_desktop?.enabled,
  );

  if (profiles.length === 0) {
    prompts.cancel(
      "No profiles have GitHub Desktop enabled. " +
        "Run: git-switch add — and enable Desktop during setup.",
    );
    process.exit(1);
  }

  let profile: Profile | undefined;

  if (profileId) {
    profile = getProfile(profileId);
    if (!profile) {
      prompts.cancel(`Profile "${profileId}" not found.`);
      process.exit(1);
    }
    if (!profile.github_desktop?.enabled) {
      prompts.cancel(
        `Profile "${profileId}" does not have GitHub Desktop enabled.`,
      );
      process.exit(1);
    }
  } else {
    const choice = await prompts.select({
      message: "Switch GitHub Desktop to:",
      options: profiles.map((p) => ({
        value: p.id,
        label: p.label,
        hint: p.git.email,
      })),
    });
    if (prompts.isCancel(choice)) {
      prompts.cancel("Aborted.");
      process.exit(0);
    }
    profile = getProfile(choice as string)!;
  }

  const spinner = prompts.spinner();
  spinner.start("Switching GitHub Desktop...");

  try {
    await switchDesktop(profile.id);
    spinner.stop("GitHub Desktop switched.");
  } catch (err) {
    spinner.stop("Switch failed.");
    prompts.cancel(
      `Failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  prompts.outro(
    `GitHub Desktop is now using: ${profile.label} (${profile.git.email})`,
  );
}
