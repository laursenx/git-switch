import * as fs from "node:fs";
import * as path from "node:path";
import { run, runOrThrow } from "../utils/shell.js";
import { NotInGitRepoError } from "../utils/errors.js";
import type { Profile } from "../providers/types.js";

export function getGitDir(cwd?: string): string {
  const result = run("git", ["rev-parse", "--git-dir"], {
    cwd: cwd || process.cwd(),
  });
  if (result.exitCode !== 0) {
    throw new NotInGitRepoError();
  }
  const gitDir = result.stdout;
  if (path.isAbsolute(gitDir)) {
    return gitDir;
  }
  return path.resolve(cwd || process.cwd(), gitDir);
}

export function getRepoRoot(cwd?: string): string {
  const result = run("git", ["rev-parse", "--show-toplevel"], {
    cwd: cwd || process.cwd(),
  });
  if (result.exitCode !== 0) {
    throw new NotInGitRepoError();
  }
  return result.stdout;
}

export function readGitConfig(
  configPath: string,
  key: string,
): string | undefined {
  const result = run("git", ["config", "--file", configPath, key]);
  if (result.exitCode !== 0) return undefined;
  return result.stdout;
}

export function writeGitConfig(
  configPath: string,
  key: string,
  value: string,
): void {
  runOrThrow("git", ["config", "--file", configPath, key, value]);
}

export function unsetGitConfig(configPath: string, key: string): void {
  // --unset may fail if key doesn't exist, that's fine
  run("git", ["config", "--file", configPath, "--unset", key]);
}

export function unsetAllGitConfig(configPath: string, key: string): void {
  run("git", ["config", "--file", configPath, "--unset-all", key]);
}

export function removeGitConfigSection(
  configPath: string,
  section: string,
): void {
  run("git", ["config", "--file", configPath, "--remove-section", section]);
}

/**
 * Remove any existing url.*.insteadOf entries that were set by git-switch.
 * We look for url entries that rewrite git@<host>: patterns.
 */
export function clearInsteadOfRules(configPath: string, host: string): void {
  // Get all url sections and remove those with insteadOf pointing to git@<host>:
  const result = run("git", [
    "config",
    "--file",
    configPath,
    "--get-regexp",
    "^url\\..*\\.insteadof$",
  ]);
  if (result.exitCode !== 0 || !result.stdout) return;

  const lines = result.stdout.split("\n");
  for (const line of lines) {
    const match = line.match(/^(url\.(.+)\.insteadof)\s+git@(.+):$/i);
    if (match && match[3] === host) {
      // Section name for --remove-section uses the url.<base> format
      removeGitConfigSection(configPath, `url.${match[2]}`);
    }
  }
}

export function applyProfileToConfig(
  configPath: string,
  profile: Profile,
): void {
  // Set user identity
  writeGitConfig(configPath, "user.name", profile.git.name);
  writeGitConfig(configPath, "user.email", profile.git.email);

  // Clear old insteadOf rules for this host
  clearInsteadOfRules(configPath, profile.ssh.host);

  // Set new insteadOf rule
  // git config uses dotted key: url.<base>.insteadOf
  const key = `url.git@${profile.ssh.alias}:.insteadOf`;
  writeGitConfig(
    configPath,
    key,
    `git@${profile.ssh.host}:`,
  );
}

/**
 * Find all submodule git config paths by walking .git/modules/
 */
export function findSubmoduleConfigs(gitDir: string): string[] {
  const modulesDir = path.join(gitDir, "modules");
  if (!fs.existsSync(modulesDir)) return [];

  const configs: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const configFile = path.join(dir, "config");
    if (fs.existsSync(configFile)) {
      configs.push(configFile);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "." && entry.name !== "..") {
        walk(path.join(dir, entry.name));
      }
    }
  }

  walk(modulesDir);
  return configs;
}

export function detectCurrentProfile(
  configPath: string,
): { name?: string; email?: string; alias?: string } {
  const name = readGitConfig(configPath, "user.name");
  const email = readGitConfig(configPath, "user.email");

  // Try to find the insteadOf alias
  const result = run("git", [
    "config",
    "--file",
    configPath,
    "--get-regexp",
    "^url\\..*\\.insteadof$",
  ]);

  let alias: string | undefined;
  if (result.exitCode === 0 && result.stdout) {
    const match = result.stdout.match(/^url\.git@(.+):\./m);
    if (match) {
      alias = match[1];
    }
  }

  return { name, email, alias };
}
