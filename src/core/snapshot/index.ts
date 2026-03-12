import * as fs from "node:fs";
import * as path from "node:path";
import { snapshotsDir, ensureDir, repoHash } from "../../utils/paths.js";
import { SnapshotError } from "../../utils/errors.js";
import type { SnapshotManifest, SnapshotFile } from "../../providers/types.js";
import { collectRepoFiles, copyRepoFiles, restoreRepoFiles } from "./repo.js";
import { collectSSHFiles, copySSHFiles, restoreSSHFiles } from "./ssh.js";
import {
  collectDesktopFiles,
  copyDesktopFiles,
  restoreDesktopFiles,
  writeKeychainManifest,
} from "./desktop.js";

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

  // Copy all files before writing manifest
  if (opts.gitDir && opts.submoduleConfigs) {
    const repoFiles = collectRepoFiles(opts.gitDir, opts.submoduleConfigs);
    copyRepoFiles(repoFiles, dir);
  }
  const sshFiles = collectSSHFiles();
  copySSHFiles(sshFiles, dir);

  if (opts.operation === "desktop") {
    const desktopFiles = collectDesktopFiles();
    copyDesktopFiles(desktopFiles, dir);
    if (opts.keychainLabels) {
      writeKeychainManifest(dir, opts.keychainLabels);
    }
  }

  // Write manifest last — its presence means the snapshot is complete
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

  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );

  return manifest;
}

export function listSnapshots(filterRepoHash?: string): SnapshotManifest[] {
  const dir = snapshotsDir();
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const manifests: SnapshotManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue; // incomplete snapshot

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as SnapshotManifest;

      if (filterRepoHash && manifest.repo_hash !== filterRepoHash) continue;
      manifests.push(manifest);
    } catch {
      // Skip corrupted manifests
    }
  }

  // Sort newest first
  manifests.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return manifests;
}

export function restoreSnapshot(snapshotIdOrManifest: string | SnapshotManifest): {
  restored: string[];
  failed: string[];
} {
  let manifest: SnapshotManifest;
  let dir: string;

  if (typeof snapshotIdOrManifest === "string") {
    dir = path.join(snapshotsDir(), snapshotIdOrManifest);
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new SnapshotError(
        `Snapshot not found: ${snapshotIdOrManifest}`,
      );
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as SnapshotManifest;
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
  manifest.restored = true;
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );

  return { restored: allRestored, failed: allFailed };
}

export function pruneSnapshots(currentRepoHash?: string): void {
  const dir = snapshotsDir();
  if (!fs.existsSync(dir)) return;

  // Prune repo snapshots (keep 10 per repo_hash)
  if (currentRepoHash) {
    const repoSnapshots = listSnapshots(currentRepoHash);
    // Don't prune if most recent was restored
    if (repoSnapshots.length > 0 && repoSnapshots[0]!.restored) return;

    const toRemove = repoSnapshots.slice(10);
    for (const snap of toRemove) {
      const snapDir = path.join(dir, snap.id);
      fs.rmSync(snapDir, { recursive: true, force: true });
    }
  }

  // Prune desktop snapshots (keep 5)
  const desktopSnapshots = listSnapshots().filter(
    (s) => s.operation === "desktop",
  );
  if (
    desktopSnapshots.length > 0 &&
    desktopSnapshots[0]!.restored
  ) {
    return;
  }
  const toRemoveDesktop = desktopSnapshots.slice(5);
  for (const snap of toRemoveDesktop) {
    const snapDir = path.join(dir, snap.id);
    fs.rmSync(snapDir, { recursive: true, force: true });
  }
}
