import * as prompts from "@clack/prompts";
import { switchDesktopToProfile } from "../../core/desktop/index.js";
import { selectDesktopProfile } from "../../utils/prompts.js";

export async function desktopSwitchCommand(id?: string): Promise<void> {
  prompts.intro("git-switch desktop switch — Switch Desktop account");

  const target = await selectDesktopProfile(id, "Switch GitHub Desktop to:");

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
