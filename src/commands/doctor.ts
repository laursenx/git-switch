import * as prompts from "@clack/prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import { listAllProfiles } from "../core/profiles.js";
import { detectCurrentProfile, findSubmoduleConfigs } from "../core/git-config.js";
import { run } from "../utils/shell.js";

interface RepoStatus {
  path: string;
  status: "ok" | "unmarked" | "out_of_sync";
  profileId?: string;
  email?: string;
}

function findGitRepos(dir: string, maxDepth: number): string[] {
  const repos: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;
    if (!fs.existsSync(current)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);

      if (entry.name === ".git") {
        repos.push(current);
        return; // Don't recurse into .git
      }

      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(full, depth + 1);
    }
  }

  walk(dir, 0);
  return repos;
}

export async function scanCommand(): Promise<void> {
  prompts.intro("git-switch scan — Scan for unconfigured repos");

  const profiles = listAllProfiles();
  const scanDir = process.cwd();

  const spinner = prompts.spinner();
  spinner.start(`Scanning ${scanDir} for git repos...`);

  const repos = findGitRepos(scanDir, 3);
  spinner.stop(`Found ${repos.length} git repo(s).`);

  if (repos.length === 0) {
    prompts.log.info("No git repositories found.");
    prompts.outro("");
    return;
  }

  const statuses: RepoStatus[] = [];
  let hasIssues = false;

  for (const repoPath of repos) {
    const gitDir = path.join(repoPath, ".git");
    const configPath = fs.statSync(gitDir).isDirectory()
      ? path.join(gitDir, "config")
      : gitDir; // bare repo or worktree pointer

    if (!fs.existsSync(configPath)) {
      continue;
    }

    const current = detectCurrentProfile(configPath);
    const matched = profiles.find(
      (p) => p.git.email === current.email,
    );

    if (!current.email && !current.name) {
      // Unmarked
      statuses.push({
        path: repoPath,
        status: "unmarked",
        email: run("git", ["config", "--global", "user.email"]).stdout || undefined,
      });
      hasIssues = true;
      continue;
    }

    if (matched) {
      // Check submodule sync
      let inSync = true;
      if (fs.statSync(gitDir).isDirectory()) {
        const subConfigs = findSubmoduleConfigs(gitDir);
        for (const sub of subConfigs) {
          const subEmail = run("git", [
            "config",
            "--file",
            sub,
            "user.email",
          ]).stdout;
          if (subEmail !== current.email) {
            inSync = false;
            break;
          }
        }
      }

      if (inSync) {
        statuses.push({
          path: repoPath,
          status: "ok",
          profileId: matched.id,
          email: current.email,
        });
      } else {
        statuses.push({
          path: repoPath,
          status: "out_of_sync",
          profileId: matched.id,
          email: current.email,
        });
        hasIssues = true;
      }
    } else {
      statuses.push({
        path: repoPath,
        status: "unmarked",
        email: current.email,
      });
      hasIssues = true;
    }
  }

  // Print results
  for (const status of statuses) {
    const rel = path.relative(scanDir, status.path);
    switch (status.status) {
      case "ok":
        prompts.log.success(
          `  ${rel} — ${status.profileId} (${status.email})`,
        );
        break;
      case "unmarked":
        prompts.log.warn(
          `  ${rel} — no profile (using: ${status.email || "unknown"})`,
        );
        break;
      case "out_of_sync":
        prompts.log.error(
          `  ${rel} — ${status.profileId} (submodules out of sync)`,
        );
        break;
    }
  }

  const okCount = statuses.filter((s) => s.status === "ok").length;
  const warnCount = statuses.filter((s) => s.status === "unmarked").length;
  const errorCount = statuses.filter((s) => s.status === "out_of_sync").length;

  prompts.outro(
    `${okCount} ok, ${warnCount} unmarked, ${errorCount} out of sync`,
  );

  if (hasIssues) {
    process.exit(1);
  }
}
