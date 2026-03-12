import * as fs from "node:fs";
import * as path from "node:path";
import { eq, desc } from "drizzle-orm";
import { snapshotsDir, ensureDir, repoHash } from "../../utils/paths.js";
import { SnapshotError } from "../../utils/errors.js";
import { getDb, schema } from "../../db/index.js";
import type { SnapshotManifest, SnapshotFile } from "../../providers/types.js";
import { collectRepoFiles, copyRepoFiles, restoreRepoFiles } from "./repo.js";
import { collectSSHFiles, copySSHFiles, restoreSSHFiles } from "./ssh.js";
import {
  collectDesktopFiles,
  copyDesktopFiles,
  restoreDesktopFiles,
  writeKeychainManifest,
} from "./desktop.js";

function safeParseJSON<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface TakeSnapshotOptions {
  operation: SnapshotManifest["operation"];
  repoPath?: string;
  gitDir?: string;
  submoduleConfigs?: string[];
  profileBefore?: string;
  profileAfter?: string;
  keychainLabels?: { before: string; after: string };
}

function snapshotId(hash: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${hash}-${ts}`;
}

export function takeSnapshot(opts: TakeSnapshotOptions): SnapshotManifest {
  const allFiles: SnapshotFile[] = [];

  // Collect files based on operation type
  if (opts.operation === "mark" || opts.operation === "remove") {
    if (opts.gitDir && opts.submoduleConfigs) {
      allFiles.push(
        ...collectRepoFiles(opts.gitDir, opts.submoduleConfigs),
      );
    }
    allFiles.push(...collectSSHFiles());
  }

  if (opts.operation === "desktop") {
    allFiles.push(...collectDesktopFiles());
  }

  // Verify all source files are readable
  for (const file of allFiles) {
    if (!fs.existsSync(file.original)) {
      throw new SnapshotError(
        `Cannot snapshot: file not found: ${file.original}`,
      );
    }
    try {
      fs.accessSync(file.original, fs.constants.R_OK);
    } catch {
      throw new SnapshotError(
        `Cannot snapshot: file not readable: ${file.original}`,
      );
    }
  }

  const hash = opts.repoPath
    ? repoHash(opts.repoPath)
    : "desktop";
  const id = snapshotId(hash);
  const dir = path.join(snapshotsDir(), id);
  ensureDir(dir);

  // Copy files using the already-collected list
  const repoFiles = allFiles.filter(
    (f) => f.snapshot.startsWith("git-config") || f.snapshot.startsWith("modules/"),
  );
  if (repoFiles.length > 0) copyRepoFiles(repoFiles, dir);

  const sshFiles = allFiles.filter((f) => f.snapshot === "ssh-config");
  if (sshFiles.length > 0) copySSHFiles(sshFiles, dir);

  const desktopFiles = allFiles.filter((f) => f.snapshot === "app-state.json");
  if (desktopFiles.length > 0) {
    copyDesktopFiles(desktopFiles, dir);
    if (opts.keychainLabels) {
      writeKeychainManifest(dir, opts.keychainLabels);
    }
  }

  // Write manifest to database
  const manifest: SnapshotManifest = {
    id,
    repo: opts.repoPath,
    repo_hash: opts.repoPath ? repoHash(opts.repoPath) : undefined,
    timestamp: new Date().toISOString(),
    operation: opts.operation,
    profile_before: opts.profileBefore,
    profile_after: opts.profileAfter,
    restored: false,
    files: allFiles,
  };

  const db = getDb();
  db.insert(schema.snapshots).values({
    id: manifest.id,
    timestamp: manifest.timestamp,
    operation: manifest.operation,
    repoPath: manifest.repo ?? null,
    repoHash: manifest.repo_hash ?? null,
    profileBefore: manifest.profile_before ?? null,
    profileAfter: manifest.profile_after ?? null,
    filesDir: dir,
    files: JSON.stringify(manifest.files),
    restored: false,
  }).run();

  return manifest;
}

function rowToManifest(row: typeof schema.snapshots.$inferSelect): SnapshotManifest {
  return {
    id: row.id,
    repo: row.repoPath ?? undefined,
    repo_hash: row.repoHash ?? undefined,
    timestamp: row.timestamp,
    operation: row.operation as SnapshotManifest["operation"],
    profile_before: row.profileBefore ?? undefined,
    profile_after: row.profileAfter ?? undefined,
    restored: row.restored,
    files: safeParseJSON<SnapshotFile[]>(row.files, []),
  };
}

export function listSnapshots(filterRepoHash?: string): SnapshotManifest[] {
  const db = getDb();

  const condition = filterRepoHash
    ? eq(schema.snapshots.repoHash, filterRepoHash)
    : undefined;

  const rows = condition
    ? db.select().from(schema.snapshots).where(condition).orderBy(desc(schema.snapshots.timestamp)).all()
    : db.select().from(schema.snapshots).orderBy(desc(schema.snapshots.timestamp)).all();

  return rows.map(rowToManifest);
}

export function restoreSnapshot(snapshotIdOrManifest: string | SnapshotManifest): {
  restored: string[];
  failed: string[];
} {
  let manifest: SnapshotManifest;
  let dir: string;

  if (typeof snapshotIdOrManifest === "string") {
    const db = getDb();
    const row = db.select().from(schema.snapshots)
      .where(eq(schema.snapshots.id, snapshotIdOrManifest)).get();
    if (!row) {
      throw new SnapshotError(
        `Snapshot not found: ${snapshotIdOrManifest}`,
      );
    }
    manifest = rowToManifest(row);
    dir = row.filesDir;
  } else {
    manifest = snapshotIdOrManifest;
    dir = path.join(snapshotsDir(), manifest.id);
  }

  const allRestored: string[] = [];
  const allFailed: string[] = [];

  // Separate files by type and restore
  const repoFiles = manifest.files.filter(
    (f) => f.snapshot.startsWith("git-config") || f.snapshot.startsWith("modules/"),
  );
  const sshFiles = manifest.files.filter((f) => f.snapshot === "ssh-config");
  const desktopFiles = manifest.files.filter(
    (f) => f.snapshot === "app-state.json",
  );

  if (repoFiles.length > 0) {
    const { restored, failed } = restoreRepoFiles(repoFiles, dir);
    allRestored.push(...restored);
    allFailed.push(...failed);
  }
  if (sshFiles.length > 0) {
    const { restored, failed } = restoreSSHFiles(sshFiles, dir);
    allRestored.push(...restored);
    allFailed.push(...failed);
  }
  if (desktopFiles.length > 0) {
    const { restored, failed } = restoreDesktopFiles(desktopFiles, dir);
    allRestored.push(...restored);
    allFailed.push(...failed);
  }

  // Mark snapshot as restored
  const db = getDb();
  db.update(schema.snapshots)
    .set({ restored: true })
    .where(eq(schema.snapshots.id, manifest.id))
    .run();

  return { restored: allRestored, failed: allFailed };
}

export function pruneSnapshots(currentRepoHash?: string): void {
  const db = getDb();

  // Prune repo snapshots (keep 10 per repo_hash)
  if (currentRepoHash) {
    const repoSnapshots = listSnapshots(currentRepoHash);
    if (repoSnapshots.length > 0 && repoSnapshots[0].restored) return;

    const toRemove = repoSnapshots.slice(10);
    for (const snap of toRemove) {
      const snapDir = path.join(snapshotsDir(), snap.id);
      fs.rmSync(snapDir, { recursive: true, force: true });
      db.delete(schema.snapshots).where(eq(schema.snapshots.id, snap.id)).run();
    }
  }

  // Prune desktop snapshots (keep 5)
  const desktopSnapshots = listSnapshots().filter(
    (s) => s.operation === "desktop",
  );
  if (desktopSnapshots.length > 0 && desktopSnapshots[0].restored) {
    return;
  }
  const toRemoveDesktop = desktopSnapshots.slice(5);
  for (const snap of toRemoveDesktop) {
    const snapDir = path.join(snapshotsDir(), snap.id);
    fs.rmSync(snapDir, { recursive: true, force: true });
    db.delete(schema.snapshots).where(eq(schema.snapshots.id, snap.id)).run();
  }
}
