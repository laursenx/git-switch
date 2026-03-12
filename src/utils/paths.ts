import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import * as crypto from "node:crypto";

export function resolveHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

export function configDir(): string {
  return path.join(os.homedir(), ".config", "git-switch");
}

export function profilesPath(): string {
  return path.join(configDir(), "profiles.json");
}

export function desktopProfilesPath(): string {
  return path.join(configDir(), "desktop-profiles.json");
}

export function snapshotsDir(): string {
  return path.join(configDir(), "snapshots");
}

export function sshDir(): string {
  return path.join(os.homedir(), ".ssh");
}

export function sshConfigPath(): string {
  return path.join(sshDir(), "config");
}

export function sshPublicKeyPath(alias: string): string {
  return path.join(sshDir(), `git-switch-${alias}.pub`);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function repoHash(repoPath: string): string {
  return crypto.createHash("sha256").update(repoPath).digest("hex").slice(0, 6);
}

export function gitDesktopAppStatePath(): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "GitHub Desktop",
      "app-state.json",
    );
  }
  if (platform === "win32") {
    return path.join(
      process.env["APPDATA"] || path.join(home, "AppData", "Roaming"),
      "GitHub Desktop",
      "app-state.json",
    );
  }
  // Linux
  return path.join(home, ".config", "GitHub Desktop", "app-state.json");
}

export function gitDesktopLocalStorageDir(): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "GitHub Desktop",
      "Local Storage",
      "leveldb",
    );
  }
  if (platform === "win32") {
    return path.join(
      process.env["APPDATA"] || path.join(home, "AppData", "Roaming"),
      "GitHub Desktop",
      "Local Storage",
      "leveldb",
    );
  }
  // Linux
  return path.join(home, ".config", "GitHub Desktop", "Local Storage", "leveldb");
}

export function globalGitConfigPath(): string {
  return path.join(os.homedir(), ".gitconfig");
}

export function projectsDir(): string {
  return path.join(os.homedir(), "projects");
}
