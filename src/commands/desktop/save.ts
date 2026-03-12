import * as prompts from "@clack/prompts";
import { addDesktopProfile } from "../../core/desktop-profiles.js";
import { readAppStateAccounts } from "../../core/desktop/app-state.js";
import {
  readKeychainEntry,
  renameKeychainEntry,
  listGitHubCredentials,
} from "../../core/desktop/keychain.js";
import { readLocalStorageKey } from "../../core/desktop/local-storage.js";
import type { DesktopProfile } from "../../providers/types.js";

export async function desktopSaveCommand(): Promise<void> {
  prompts.intro("git-switch desktop save — Capture current Desktop session");

  const id = await prompts.text({
    message: "Desktop profile ID (slug, no spaces)",
    placeholder: "work-desktop",
    validate: (val) => {
      if (!val.trim()) return "Required";
      if (/\s/.test(val)) return "No spaces allowed";
      if (!/^[a-z0-9_-]+$/i.test(val)) return "Only letters, numbers, hyphens, underscores";
      return undefined;
    },
  });
  if (prompts.isCancel(id)) { prompts.cancel("Aborted."); process.exit(0); }

  const label = await prompts.text({
    message: "Desktop profile label (display name)",
    placeholder: "Work GitHub",
    validate: (val) => (!val.trim() ? "Required" : undefined),
  });
  if (prompts.isCancel(label)) { prompts.cancel("Aborted."); process.exit(0); }

  const email = await prompts.text({
    message: "GitHub account email",
    placeholder: "user@example.com",
    validate: (val) => {
      if (!val.trim()) return "Required";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return "Invalid email";
      return undefined;
    },
  });
  if (prompts.isCancel(email)) { prompts.cancel("Aborted."); process.exit(0); }

  // Detect GitHub credentials from keychain
  const spinner = prompts.spinner();
  spinner.start("Scanning keychain for GitHub credentials...");
  const credentials = listGitHubCredentials();
  spinner.stop(`Found ${credentials.length} GitHub credential(s).`);

  let keychainLabel: string;

  if (credentials.length === 0) {
    // Fall back to manual entry
    const manualLabel = await prompts.text({
      message: "No GitHub credentials detected. Enter the credential target/label manually:",
      placeholder: "git:https://github.com",
      validate: (val) => (!val.trim() ? "Required" : undefined),
    });
    if (prompts.isCancel(manualLabel)) { prompts.cancel("Aborted."); process.exit(0); }
    keychainLabel = manualLabel as string;
  } else if (credentials.length === 1) {
    keychainLabel = credentials[0]!.target;
    prompts.log.info(`Using credential: ${keychainLabel} (${credentials[0]!.user || "no user"})`);
  } else {
    const choice = await prompts.select({
      message: "Select the GitHub credential to capture",
      options: credentials.map((c) => ({
        value: c.target,
        label: c.target,
        hint: c.user || undefined,
      })),
    });
    if (prompts.isCancel(choice)) { prompts.cancel("Aborted."); process.exit(0); }
    keychainLabel = choice as string;
  }

  const storedLabel = `git-switch-desktop:${id}:${email}`;

  // Verify the credential is readable
  const entry = readKeychainEntry(keychainLabel);
  if (!entry) {
    prompts.cancel(
      `Could not read credential: "${keychainLabel}"\n` +
        "Make sure GitHub Desktop is signed in with this account.",
    );
    process.exit(1);
  }

  // Read app-state accounts
  let appStateAccounts: unknown[] = [];
  try {
    appStateAccounts = readAppStateAccounts();
  } catch {
    // Desktop 3.x doesn't use app-state.json — that's fine
  }

  // Capture LevelDB users data (Desktop 3.x stores account info here)
  let usersJson: string | undefined;
  try {
    const users = readLocalStorageKey("users");
    if (users) usersJson = users;
  } catch {
    prompts.log.warn("Could not read GitHub Desktop localStorage (LevelDB)");
  }

  // Park the keychain entry
  const parkSpinner = prompts.spinner();
  parkSpinner.start("Parking keychain entry...");
  renameKeychainEntry(keychainLabel, storedLabel, email as string);
  parkSpinner.stop("Keychain entry parked.");

  // Save desktop profile
  const profile: DesktopProfile = {
    id: id as string,
    label: label as string,
    email: email as string,
    keychain_label: keychainLabel,
    stored_label: storedLabel,
    app_state_accounts: appStateAccounts,
    users_json: usersJson,
  };

  addDesktopProfile(profile);

  prompts.log.success(`Desktop profile "${id}" saved.`);
  prompts.log.info(
    "GitHub Desktop is now signed out. Run `git-switch desktop switch " +
      id +
      "` to switch back.",
  );
  prompts.outro("Done!");
}
