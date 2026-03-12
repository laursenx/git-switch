import * as prompts from "@clack/prompts";
import { getDesktopProfile, listAllDesktopProfiles } from "../../core/desktop-profiles.js";
import { switchDesktopToProfile } from "../../core/desktop/index.js";

export async function desktopSwitchCommand(id?: string): Promise<void> {
  prompts.intro("git-switch desktop switch — Switch Desktop account");

  const desktopProfiles = listAllDesktopProfiles();
  if (desktopProfiles.length === 0) {
    prompts.cancel("No Desktop profiles saved. Run: git-switch desktop save");
    process.exit(1);
  }

  let targetId: string;

  if (id) {
    const found = getDesktopProfile(id);
    if (!found) {
      prompts.cancel(`Desktop profile "${id}" not found.`);
      process.exit(1);
    }
    targetId = id;
  } else {
    const choice = await prompts.select({
      message: "Switch GitHub Desktop to:",
      options: desktopProfiles.map((dp) => ({
        value: dp.id,
        label: dp.label,
        hint: dp.email,
      })),
    });
    if (prompts.isCancel(choice)) { prompts.cancel("Aborted."); process.exit(0); }
    targetId = choice as string;
  }

  const target = getDesktopProfile(targetId)!;

  const spinner = prompts.spinner();
  spinner.start("Switching GitHub Desktop...");

  try {
    await switchDesktopToProfile(target);
    spinner.stop("GitHub Desktop switched.");
  } catch (err) {
    spinner.stop("Switch failed.");
    prompts.cancel(
      `Failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  prompts.outro(
    `GitHub Desktop is now using: ${target.label} (${target.email})`,
  );
}
