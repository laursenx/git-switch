import * as fs from "node:fs";
import { desktopProfilesPath, profilesPath, ensureDir, configDir } from "../utils/paths.js";
import type { DesktopProfile, DesktopProfilesConfig } from "../providers/types.js";
import { GitSwitchError } from "../utils/errors.js";

function defaultConfig(): DesktopProfilesConfig {
  return { version: 1, profiles: [] };
}

export function loadDesktopProfiles(): DesktopProfilesConfig {
  const p = desktopProfilesPath();
  if (!fs.existsSync(p)) {
    return defaultConfig();
  }
  const raw = fs.readFileSync(p, "utf-8");
  const parsed = JSON.parse(raw) as DesktopProfilesConfig;
  if (parsed.version !== 1) {
    throw new GitSwitchError(
      `Unsupported desktop-profiles.json version: ${parsed.version}`,
    );
  }
  return parsed;
}

export function saveDesktopProfiles(config: DesktopProfilesConfig): void {
  const dir = configDir();
  ensureDir(dir);
  const p = desktopProfilesPath();
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, p);
}

export function getDesktopProfile(id: string): DesktopProfile | undefined {
  const config = loadDesktopProfiles();
  return config.profiles.find((p) => p.id === id);
}

export function addDesktopProfile(profile: DesktopProfile): void {
  const config = loadDesktopProfiles();
  if (config.profiles.some((p) => p.id === profile.id)) {
    throw new GitSwitchError(`Desktop profile "${profile.id}" already exists`);
  }
  config.profiles.push(profile);
  saveDesktopProfiles(config);
}

export function removeDesktopProfile(id: string): DesktopProfile {
  const config = loadDesktopProfiles();
  const index = config.profiles.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new GitSwitchError(`Desktop profile "${id}" not found`);
  }
  const [removed] = config.profiles.splice(index, 1);
  saveDesktopProfiles(config);
  return removed!;
}

export function listAllDesktopProfiles(): DesktopProfile[] {
  return loadDesktopProfiles().profiles;
}

interface LegacyGitHubDesktop {
  enabled: boolean;
  keychain_label?: string;
  stored_label?: string;
  app_state_accounts?: unknown[];
}

interface LegacyProfile {
  id: string;
  label: string;
  git: { name: string; email: string };
  ssh: { provider: string; ref: string; host: string; alias: string };
  github_desktop?: LegacyGitHubDesktop;
  desktop_profile_id?: string;
}

interface LegacyProfilesConfig {
  version: number;
  profiles: LegacyProfile[];
}

export function migrateEmbeddedDesktopProfiles(): void {
  const p = profilesPath();
  if (!fs.existsSync(p)) return;

  const raw = fs.readFileSync(p, "utf-8");
  const config = JSON.parse(raw) as LegacyProfilesConfig;

  const needsMigration = config.profiles.some(
    (prof) => prof.github_desktop?.enabled,
  );
  if (!needsMigration) return;

  const desktopConfig = loadDesktopProfiles();
  let changed = false;

  for (const prof of config.profiles) {
    const gd = prof.github_desktop;
    if (!gd?.enabled || !gd.keychain_label || !gd.stored_label) continue;

    const desktopId = `migrated-${prof.id}`;

    // Skip if already migrated
    if (desktopConfig.profiles.some((dp) => dp.id === desktopId)) continue;

    desktopConfig.profiles.push({
      id: desktopId,
      label: prof.label,
      email: prof.git.email,
      keychain_label: gd.keychain_label,
      stored_label: gd.stored_label,
      app_state_accounts: gd.app_state_accounts || [],
    });

    prof.desktop_profile_id = desktopId;
    delete prof.github_desktop;
    changed = true;
  }

  if (changed) {
    saveDesktopProfiles(desktopConfig);

    // Save updated profiles.json
    const dir = configDir();
    ensureDir(dir);
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, p);
  }
}
