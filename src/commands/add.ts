import * as prompts from "@clack/prompts";
import { addProfile } from "../core/profiles.js";
import { updateSSHConfigForProfiles, writePublicKeyFile } from "../core/ssh-config.js";
import { listAllProfiles } from "../core/profiles.js";
import { getAllProviders, getProvider } from "../providers/index.js";
import type { Profile } from "../providers/types.js";

function isCancel(value: unknown): value is symbol {
  return prompts.isCancel(value);
}

export async function addCommand(): Promise<void> {
  prompts.intro("git-switch add — Create a new profile");

  // 1. Profile ID
  const id = await prompts.text({
    message: "Profile ID (slug, no spaces)",
    placeholder: "work",
    validate: (val) => {
      if (!val.trim()) return "Required";
      if (/\s/.test(val)) return "No spaces allowed";
      if (!/^[a-z0-9_-]+$/i.test(val)) return "Only letters, numbers, hyphens, underscores";
      return undefined;
    },
  });
  if (isCancel(id)) { prompts.cancel("Aborted."); process.exit(0); }

  // 2. Label
  const label = await prompts.text({
    message: "Profile label (display name)",
    placeholder: "Work (GitHub)",
    validate: (val) => (!val.trim() ? "Required" : undefined),
  });
  if (isCancel(label)) { prompts.cancel("Aborted."); process.exit(0); }

  // 3. Git name
  const gitName = await prompts.text({
    message: "Git name",
    placeholder: "Jane Doe",
    validate: (val) => (!val.trim() ? "Required" : undefined),
  });
  if (isCancel(gitName)) { prompts.cancel("Aborted."); process.exit(0); }

  // 4. Git email
  const gitEmail = await prompts.text({
    message: "Git email",
    placeholder: "jane@acme.com",
    validate: (val) => {
      if (!val.trim()) return "Required";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return "Invalid email";
      return undefined;
    },
  });
  if (isCancel(gitEmail)) { prompts.cancel("Aborted."); process.exit(0); }

  // 5. SSH provider selection
  const allProviders = getAllProviders();
  const availability = await Promise.all(
    allProviders.map(async (p) => ({
      provider: p,
      available: await p.isAvailable(),
    })),
  );

  const providerChoice = await prompts.select({
    message: "SSH key provider",
    options: availability.map(({ provider, available }) => ({
      value: provider.id,
      label: available
        ? provider.name
        : `${provider.name} (not detected)`,
      hint: available ? undefined : "unavailable",
    })),
  });
  if (isCancel(providerChoice)) { prompts.cancel("Aborted."); process.exit(0); }

  const provider = getProvider(providerChoice as string);

  // 6. Key selection
  const keys = await provider.listKeys();
  let selectedRef: string;

  if (keys.length === 0) {
    const manualRef = await prompts.text({
      message: "No keys found. Enter key reference manually:",
      placeholder: provider.id === "manual" ? "~/.ssh/id_ed25519.pub" : "Key name or UUID",
      validate: (val) => (!val.trim() ? "Required" : undefined),
    });
    if (isCancel(manualRef)) { prompts.cancel("Aborted."); process.exit(0); }
    selectedRef = manualRef as string;
  } else {
    const keyChoice = await prompts.select({
      message: "Select SSH key",
      options: keys.map((k) => ({
        value: k.ref,
        label: k.label,
        hint: k.vault ? `vault: ${k.vault}` : undefined,
      })),
    });
    if (isCancel(keyChoice)) { prompts.cancel("Aborted."); process.exit(0); }
    selectedRef = keyChoice as string;
  }

  // 7. Git host
  const host = await prompts.text({
    message: "Git host",
    placeholder: "github.com",
    initialValue: "github.com",
    validate: (val) => (!val.trim() ? "Required" : undefined),
  });
  if (isCancel(host)) { prompts.cancel("Aborted."); process.exit(0); }

  // 8. SSH alias
  const defaultAlias = `github-${id}`;
  const alias = await prompts.text({
    message: "SSH alias",
    placeholder: defaultAlias,
    initialValue: defaultAlias,
    validate: (val) => (!val.trim() ? "Required" : undefined),
  });
  if (isCancel(alias)) { prompts.cancel("Aborted."); process.exit(0); }

  // 9. Write profile
  const profile: Profile = {
    id: id as string,
    label: label as string,
    git: {
      name: gitName as string,
      email: gitEmail as string,
    },
    ssh: {
      provider: providerChoice as Profile["ssh"]["provider"],
      ref: selectedRef,
      host: host as string,
      alias: alias as string,
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
      writePublicKeyFile(alias as string, pubKey);
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
