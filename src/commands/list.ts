import * as prompts from "@clack/prompts";
import { listAllProfiles } from "../core/profiles.js";
import { detectCurrentProfile, getGitDir } from "../core/git-config.js";

export async function listCommand(): Promise<void> {
  prompts.intro("git-switch list — All profiles");

  const profiles = listAllProfiles();
  if (profiles.length === 0) {
    prompts.log.info("No profiles configured. Run: git-switch add");
    prompts.outro("");
    return;
  }

  // Try to detect current repo's profile
  let activeEmail: string | undefined;
  try {
    const gitDir = getGitDir();
    const current = detectCurrentProfile(`${gitDir}/config`);
    activeEmail = current.email;
  } catch {
    // Not in a git repo, that's fine
  }

  const header = [
    "  ",
    "ID".padEnd(16),
    "Label".padEnd(24),
    "Email".padEnd(32),
    "Provider".padEnd(12),
    "SSH Alias".padEnd(20),
    "Desktop",
  ].join("");

  prompts.log.info(header);
  prompts.log.info("-".repeat(header.length));

  for (const p of profiles) {
    const active = activeEmail && p.git.email === activeEmail ? "● " : "  ";
    const desktop = p.desktop_profile_id ? "yes" : "no";
    const line = [
      active,
      p.id.padEnd(16),
      p.label.padEnd(24),
      p.git.email.padEnd(32),
      p.ssh.provider.padEnd(12),
      p.ssh.alias.padEnd(20),
      desktop,
    ].join("");
    prompts.log.info(line);
  }

  prompts.outro(`${profiles.length} profile(s)`);
}
