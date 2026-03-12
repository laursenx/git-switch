import * as prompts from "@clack/prompts";
import { addProfile } from "../core/profiles.js";
import { updateSSHConfigForProfiles, writePublicKeyFile } from "../core/ssh-config.js";
import { listAllProfiles, updateProfileDesktopLink } from "../core/profiles.js";
import { getAllProviders, getProvider } from "../providers/index.js";
import { validateEmail, validateProfileId, validateSSHAlias } from "../utils/validation.js";
import { abortIfCancelled } from "../utils/prompts.js";
import {
  listGitHubCredentials,
  readKeychainEntry,
  renameKeychainEntry,
} from "../core/desktop/keychain.js";
import { addDesktopProfile } from "../core/desktop-profiles.js";
import { readAppStateAccounts } from "../core/desktop/app-state.js";
import type { Profile } from "../providers/types.js";
import type { DesktopProfile } from "../providers/types.js";

export async function addCommand(): Promise<void> {
  prompts.intro("git-switch add — Create a new profile");

  // 1. Profile ID
  const id = abortIfCancelled(await prompts.text({
    message: "Profile ID (slug, no spaces)",
    placeholder: "work",
    validate: validateProfileId,
  }));

  // 2. Label
  const label = abortIfCancelled(await prompts.text({
    message: "Profile label (display name)",
    placeholder: "Work (GitHub)",
    validate: (val) => (!val.trim() ? "Required" : undefined),
  }));

  // 3. Git name
  const gitName = abortIfCancelled(await prompts.text({
    message: "Git name",
    placeholder: "Jane Doe",
    validate: (val) => (!val.trim() ? "Required" : undefined),
  }));

  // 4. Git email
  const gitEmail = abortIfCancelled(await prompts.text({
    message: "Git email",
    placeholder: "jane@acme.com",
    validate: validateEmail,
  }));

  // 5. SSH provider selection
  const allProviders = getAllProviders();
  const availability = await Promise.all(
    allProviders.map(async (p) => ({
      provider: p,
      available: await p.isAvailable(),
    })),
  );

  const providerChoice = abortIfCancelled(await prompts.select({
    message: "SSH key provider",
    options: availability.map(({ provider, available }) => ({
      value: provider.id,
      label: available
        ? provider.name
        : `${provider.name} (not detected)`,
      hint: available ? undefined : "unavailable",
    })),
  }));

  const provider = getProvider(providerChoice);

  // 6. Key selection
  const keys = await provider.listKeys();
  let selectedRef: string;

  if (keys.length === 0) {
    selectedRef = abortIfCancelled(await prompts.text({
      message: "No keys found. Enter key reference manually:",
      placeholder: provider.id === "manual" ? "~/.ssh/id_ed25519.pub" : "Key name or UUID",
      validate: (val) => (!val.trim() ? "Required" : undefined),
    }));
  } else {
    selectedRef = abortIfCancelled(await prompts.select({
      message: "Select SSH key",
      options: keys.map((k) => ({
        value: k.ref,
        label: k.label,
        hint: k.vault ? `vault: ${k.vault}` : undefined,
      })),
    }));
  }

  // 7. Git host
  const host = abortIfCancelled(await prompts.text({
    message: "Git host",
    placeholder: "github.com",
    initialValue: "github.com",
    validate: (val) => (!val.trim() ? "Required" : undefined),
  }));

  // 8. SSH alias
  const defaultAlias = `github-${id}`;
  const alias = abortIfCancelled(await prompts.text({
    message: "SSH alias",
    placeholder: defaultAlias,
    initialValue: defaultAlias,
    validate: validateSSHAlias,
  }));

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
    const credentials = listGitHubCredentials();
    if (credentials.length > 0) {
      const linkDesktop = abortIfCancelled(await prompts.confirm({
        message: "GitHub Desktop detected — save current session and link to this profile?",
        initialValue: true,
      }));

      if (linkDesktop) {
        let keychainLabel: string;
        if (credentials.length === 1) {
          keychainLabel = credentials[0]!.target;
          prompts.log.info(`Using credential: ${keychainLabel}`);
        } else {
          keychainLabel = abortIfCancelled(await prompts.select({
            message: "Select the GitHub credential to capture",
            options: credentials.map((c) => ({
              value: c.target,
              label: c.target,
              hint: c.user || undefined,
            })),
          }));
        }

        const entry = readKeychainEntry(keychainLabel);
        if (entry) {
          const storedLabel = `git-switch-desktop:${id}:${gitEmail}`;

          let appStateAccounts: unknown[] = [];
          try { appStateAccounts = readAppStateAccounts(); } catch {}

          const parkSpinner = prompts.spinner();
          parkSpinner.start("Parking keychain entry...");
          renameKeychainEntry(keychainLabel, storedLabel, gitEmail);
          parkSpinner.stop("Keychain entry parked.");

          const dp: DesktopProfile = {
            id: `${id}-desktop`,
            label,
            email: gitEmail,
            keychain_label: keychainLabel,
            stored_label: storedLabel,
            app_state_accounts: appStateAccounts,
          };

          addDesktopProfile(dp);
          updateProfileDesktopLink(id, dp.id);
          prompts.log.success(`Desktop profile saved and linked.`);
        } else {
          prompts.log.warn("Could not read credential — skipping Desktop setup.");
        }
      }
    }
  } catch {
    // Desktop detection failed (e.g., no keychain tool) — silently skip
  }

  prompts.outro(`Profile "${id}" created successfully!`);
}
