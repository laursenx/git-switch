import * as prompts from "@clack/prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import { getProfile, listAllProfiles } from "../core/profiles.js";
import { run, runOrThrow } from "../utils/shell.js";
import {
  applyProfileToConfig,
  findSubmoduleConfigs,
} from "../core/git-config.js";
import { updateSSHConfigForProfiles } from "../core/ssh-config.js";
import { takeSnapshot, pruneSnapshots } from "../core/snapshot/index.js";
import { repoHash } from "../utils/paths.js";
import type { Profile } from "../providers/types.js";

function rewriteSSHUrl(url: string, alias: string, host: string): string {
  // git@github.com:org/repo.git → git@github-work:org/repo.git
  const sshPattern = new RegExp(`^git@${host.replace(/\./g, "\\.")}:`);
  if (sshPattern.test(url)) {
    return url.replace(sshPattern, `git@${alias}:`);
  }
  return url;
}

function isHTTPS(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

export async function cloneCommand(
  profileId?: string,
  gitUrl?: string,
  targetDir?: string,
): Promise<void> {
  prompts.intro("git-switch clone — Clone with profile");

  const profiles = listAllProfiles();
  if (profiles.length === 0) {
    prompts.cancel("No profiles configured. Run: git-switch add");
    process.exit(1);
  }

  // Resolve profile
  let profile: Profile | undefined;
  if (profileId) {
    profile = getProfile(profileId);
    if (!profile) {
      prompts.cancel(`Profile "${profileId}" not found.`);
      process.exit(1);
    }
  } else {
    const choice = await prompts.select({
      message: "Select profile for this clone",
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

  // Get URL if not provided
  if (!gitUrl) {
    const urlInput = await prompts.text({
      message: "Git URL to clone",
      placeholder: "git@github.com:org/repo.git",
      validate: (val) => (!val.trim() ? "Required" : undefined),
    });
    if (prompts.isCancel(urlInput)) {
      prompts.cancel("Aborted.");
      process.exit(0);
    }
    gitUrl = urlInput as string;
  }

  // Rewrite URL
  let cloneUrl = gitUrl;
  if (isHTTPS(gitUrl)) {
    prompts.log.warn(
      "HTTPS remotes cannot be rewritten for SSH alias routing. Cloning as-is.",
    );
  } else {
    cloneUrl = rewriteSSHUrl(gitUrl, profile.ssh.alias, profile.ssh.host);
    if (cloneUrl !== gitUrl) {
      prompts.log.info(`Rewritten URL: ${cloneUrl}`);
    }
  }

  // Clone
  const spinner = prompts.spinner();
  spinner.start("Cloning repository...");

  const cloneArgs = ["clone", cloneUrl];
  if (targetDir) {
    cloneArgs.push(targetDir);
  }

  const result = run("git", cloneArgs, { timeout: 120_000 });
  if (result.exitCode !== 0) {
    spinner.stop("Clone failed.");
    prompts.cancel(`git clone failed:\n${result.stderr}`);
    process.exit(1);
  }

  spinner.stop("Repository cloned.");

  // Determine the cloned directory
  const clonedDir =
    targetDir ||
    path.basename(gitUrl.replace(/\.git$/, "").replace(/\/$/, ""));
  const fullClonedDir = path.resolve(clonedDir);

  if (!fs.existsSync(fullClonedDir)) {
    prompts.cancel(`Cloned directory not found: ${fullClonedDir}`);
    process.exit(1);
  }

  // Auto-mark
  const gitDir = path.join(fullClonedDir, ".git");
  const mainConfigPath = `${gitDir}/config`;

  // Take snapshot
  const submoduleConfigs = findSubmoduleConfigs(gitDir);
  takeSnapshot({
    operation: "mark",
    repoPath: fullClonedDir,
    gitDir,
    submoduleConfigs,
    profileAfter: profile.id,
  });

  // Apply profile
  applyProfileToConfig(mainConfigPath, profile);
  for (const subConfig of submoduleConfigs) {
    applyProfileToConfig(subConfig, profile);
  }

  // Update SSH config
  updateSSHConfigForProfiles(listAllProfiles());

  prompts.log.success(
    `Marked with profile: ${profile.label} (${profile.git.email})`,
  );

  // Check for submodules
  const gitmodulesPath = path.join(fullClonedDir, ".gitmodules");
  if (fs.existsSync(gitmodulesPath)) {
    const initSubs = await prompts.confirm({
      message: "This repo has submodules. Initialize them now?",
      initialValue: true,
    });

    if (!prompts.isCancel(initSubs) && initSubs) {
      const subSpinner = prompts.spinner();
      subSpinner.start("Initializing submodules...");
      const subResult = run(
        "git",
        ["submodule", "update", "--init", "--recursive"],
        { cwd: fullClonedDir, timeout: 120_000 },
      );
      if (subResult.exitCode === 0) {
        subSpinner.stop("Submodules initialized.");
        // Re-apply profile to new submodule configs
        const newSubConfigs = findSubmoduleConfigs(gitDir);
        for (const subConfig of newSubConfigs) {
          applyProfileToConfig(subConfig, profile);
        }
        prompts.log.info(
          `Applied profile to ${newSubConfigs.length} submodule config(s).`,
        );
      } else {
        subSpinner.stop("Submodule init failed.");
        prompts.log.warn(subResult.stderr);
      }
    }
  }

  pruneSnapshots(repoHash(fullClonedDir));
  prompts.outro(`Cloned to: ${fullClonedDir}`);
}
