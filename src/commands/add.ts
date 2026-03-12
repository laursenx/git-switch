import * as prompts from "@clack/prompts";
import { addProfile } from "../core/profiles.js";
import { updateSSHConfigForProfiles, writePublicKeyFile } from "../core/ssh-config.js";
import { listAllProfiles } from "../core/profiles.js";
import { getAllProviders, getProvider } from "../providers/index.js";
import { validateEmail, validateProfileId, validateSSHAlias } from "../utils/validation.js";
import { abortIfCancelled } from "../utils/prompts.js";
import type { Profile } from "../providers/types.js";

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

  prompts.log.info("To link GitHub Desktop: git-switch desktop link");
  prompts.outro(`Profile "${id}" created successfully!`);
}
