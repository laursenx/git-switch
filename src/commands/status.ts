import * as prompts from "@clack/prompts";
import { listAllProfiles } from "../core/profiles.js";
import {
  getGitDir,
  getRepoRoot,
  detectCurrentProfile,
  findSubmoduleConfigs,
  readGitConfig,
} from "../core/git-config.js";
import { run } from "../utils/shell.js";

export async function statusCommand(): Promise<void> {
  prompts.intro("git-switch status — Current repo profile");

  let gitDir: string;
  let repoRoot: string;
  try {
    gitDir = getGitDir();
    repoRoot = getRepoRoot();
  } catch {
    prompts.cancel("Not inside a git repository.");
    process.exit(1);
  }

  const mainConfigPath = `${gitDir}/config`;
  const current = detectCurrentProfile(mainConfigPath);
  const profiles = listAllProfiles();

  // Match to a known profile
  const matchedProfile = profiles.find(
    (p) => p.git.email === current.email && p.git.name === current.name,
  );

  if (matchedProfile) {
    prompts.log.success(`Profile: ${matchedProfile.label} (${matchedProfile.id})`);
  } else if (current.email) {
    prompts.log.warn("No git-switch profile matches this repo's identity.");
  } else {
    prompts.log.warn("No profile is marked for this repo.");
    // Show global fallback
    const globalName = run("git", ["config", "--global", "user.name"]).stdout;
    const globalEmail = run("git", ["config", "--global", "user.email"]).stdout;
    if (globalName || globalEmail) {
      prompts.log.info(`Global fallback: ${globalName} <${globalEmail}>`);
    }
    prompts.outro("");
    return;
  }

  prompts.log.info(`Name:  ${current.name || "(not set)"}`);
  prompts.log.info(`Email: ${current.email || "(not set)"}`);
  if (current.alias) {
    prompts.log.info(`SSH alias: ${current.alias}`);
  }

  // Check submodules
  const submoduleConfigs = findSubmoduleConfigs(gitDir);
  if (submoduleConfigs.length > 0) {
    let allInSync = true;
    for (const subConfig of submoduleConfigs) {
      const subEmail = readGitConfig(subConfig, "user.email");
      if (subEmail !== current.email) {
        allInSync = false;
        break;
      }
    }

    prompts.log.info(`Submodules: ${submoduleConfigs.length}`);
    if (allInSync) {
      prompts.log.success("All submodules in sync with parent config.");
    } else {
      prompts.log.warn(
        "Some submodule configs are out of sync! Run: git-switch mark",
      );
    }
  }

  prompts.log.info(`Repo: ${repoRoot}`);
  prompts.outro("");
}
