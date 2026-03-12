import * as prompts from "@clack/prompts";
import { listAllDesktopProfiles, removeDesktopProfile } from "../../core/desktop-profiles.js";
import { loadProfiles, saveProfiles } from "../../core/profiles.js";

export async function desktopRemoveCommand(id?: string): Promise<void> {
  prompts.intro("git-switch desktop remove — Delete a Desktop profile");

  const desktopProfiles = listAllDesktopProfiles();
  if (desktopProfiles.length === 0) {
    prompts.cancel("No Desktop profiles saved.");
    process.exit(1);
  }

  let targetId: string;

  if (id) {
    const found = desktopProfiles.find((dp) => dp.id === id);
    if (!found) {
      prompts.cancel(`Desktop profile "${id}" not found.`);
      process.exit(1);
    }
    targetId = id;
  } else {
    const choice = await prompts.select({
      message: "Select Desktop profile to remove",
      options: desktopProfiles.map((dp) => ({
        value: dp.id,
        label: dp.label,
        hint: dp.email,
      })),
    });
    if (prompts.isCancel(choice)) { prompts.cancel("Aborted."); process.exit(0); }
    targetId = choice as string;
  }

  const confirmed = await prompts.confirm({
    message: `Delete Desktop profile "${targetId}"?`,
  });
  if (prompts.isCancel(confirmed) || !confirmed) {
    prompts.cancel("Aborted.");
    process.exit(0);
  }

  // Clear desktop_profile_id on any linked git-switch profiles
  const config = loadProfiles();
  let cleared = 0;
  for (const profile of config.profiles) {
    if (profile.desktop_profile_id === targetId) {
      profile.desktop_profile_id = undefined;
      cleared++;
    }
  }
  if (cleared > 0) {
    saveProfiles(config);
    prompts.log.info(`Cleared link from ${cleared} git-switch profile(s).`);
  }

  const removed = removeDesktopProfile(targetId);
  prompts.log.success(`Removed Desktop profile: ${removed.label} (${removed.email})`);
  prompts.outro("Done!");
}
