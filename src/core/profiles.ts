import * as fs from "node:fs";
import { profilesPath, ensureDir, configDir } from "../utils/paths.js";
import type { Profile, ProfilesConfig } from "../providers/types.js";
import { GitSwitchError } from "../utils/errors.js";

function defaultConfig(): ProfilesConfig {
  return { version: 1, profiles: [] };
}

export function loadProfiles(): ProfilesConfig {
  const p = profilesPath();
  if (!fs.existsSync(p)) {
    return defaultConfig();
  }
  const raw = fs.readFileSync(p, "utf-8");
  const parsed = JSON.parse(raw) as ProfilesConfig;
  if (parsed.version !== 1) {
    throw new GitSwitchError(
      `Unsupported profiles.json version: ${parsed.version}`,
    );
  }
  return parsed;
}

export function saveProfiles(config: ProfilesConfig): void {
  const dir = configDir();
  ensureDir(dir);
  const p = profilesPath();
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, p);
}

export function getProfile(id: string): Profile | undefined {
  const config = loadProfiles();
  return config.profiles.find((p) => p.id === id);
}

export function addProfile(profile: Profile): void {
  const config = loadProfiles();
  if (config.profiles.some((p) => p.id === profile.id)) {
    throw new GitSwitchError(`Profile "${profile.id}" already exists`);
  }
  config.profiles.push(profile);
  saveProfiles(config);
}

export function removeProfile(id: string): Profile {
  const config = loadProfiles();
  const index = config.profiles.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new GitSwitchError(`Profile "${id}" not found`);
  }
  const [removed] = config.profiles.splice(index, 1);
  saveProfiles(config);
  return removed!;
}

export function listAllProfiles(): Profile[] {
  return loadProfiles().profiles;
}
