import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { GitSwitchError } from "../utils/errors.js";
import type { Profile } from "../providers/types.js";

type ProfileRow = typeof schema.profiles.$inferSelect;

const VALID_PROVIDERS = new Set<string>(["1password", "proton", "manual"]);

function rowToProfile(row: ProfileRow): Profile {
  const provider = VALID_PROVIDERS.has(row.sshProvider)
    ? (row.sshProvider as Profile["ssh"]["provider"])
    : "manual";

  return {
    id: row.id,
    label: row.label,
    git: { name: row.gitName, email: row.gitEmail },
    ssh: {
      provider,
      ref: row.sshRef,
      host: row.sshHost,
      alias: row.sshAlias,
    },
    desktop_profile_id: row.desktopProfileId ?? undefined,
  };
}

function profileToRow(p: Profile): typeof schema.profiles.$inferInsert {
  return {
    id: p.id,
    label: p.label,
    gitName: p.git.name,
    gitEmail: p.git.email,
    sshProvider: p.ssh.provider,
    sshRef: p.ssh.ref,
    sshHost: p.ssh.host,
    sshAlias: p.ssh.alias,
    desktopProfileId: p.desktop_profile_id ?? null,
  };
}

export function getProfile(id: string): Profile | undefined {
  const db = getDb();
  const row = db.select().from(schema.profiles).where(eq(schema.profiles.id, id)).get();
  return row ? rowToProfile(row) : undefined;
}

export function addProfile(profile: Profile): void {
  const db = getDb();
  const existing = db.select().from(schema.profiles).where(eq(schema.profiles.id, profile.id)).get();
  if (existing) {
    throw new GitSwitchError(`Profile "${profile.id}" already exists`);
  }
  db.insert(schema.profiles).values(profileToRow(profile)).run();
}

export function removeProfile(id: string): Profile {
  const db = getDb();
  const row = db.select().from(schema.profiles).where(eq(schema.profiles.id, id)).get();
  if (!row) {
    throw new GitSwitchError(`Profile "${id}" not found`);
  }
  db.delete(schema.profiles).where(eq(schema.profiles.id, id)).run();
  return rowToProfile(row);
}

export function listAllProfiles(): Profile[] {
  const db = getDb();
  const rows = db.select().from(schema.profiles).all();
  return rows.map(rowToProfile);
}

export function updateProfileDesktopLink(profileId: string, desktopProfileId: string | null): void {
  const db = getDb();
  db.update(schema.profiles)
    .set({ desktopProfileId: desktopProfileId })
    .where(eq(schema.profiles.id, profileId))
    .run();
}
