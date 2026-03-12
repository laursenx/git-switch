import * as fs from "node:fs";
import * as path from "node:path";
import { gitDesktopAppStatePath } from "../../utils/paths.js";
import type { SnapshotFile } from "../../providers/types.js";

export function collectDesktopFiles(): SnapshotFile[] {
  const files: SnapshotFile[] = [];

  const appStatePath = gitDesktopAppStatePath();
  if (fs.existsSync(appStatePath)) {
    files.push({ original: appStatePath, snapshot: "app-state.json" });
  }

  return files;
}

export function copyDesktopFiles(
  files: SnapshotFile[],
  snapshotDir: string,
): void {
  for (const file of files) {
    const dest = path.join(snapshotDir, file.snapshot);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file.original, dest);
  }
}

export function writeKeychainManifest(
  snapshotDir: string,
  labels: { before: string; after: string },
): void {
  const manifest = {
    before_label: labels.before,
    after_label: labels.after,
    note: "No tokens stored — labels only for reference",
  };
  const dest = path.join(snapshotDir, "keychain-manifest.json");
  fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

export function restoreDesktopFiles(
  files: SnapshotFile[],
  snapshotDir: string,
): { restored: string[]; failed: string[] } {
  const restored: string[] = [];
  const failed: string[] = [];

  for (const file of files) {
    const src = path.join(snapshotDir, file.snapshot);
    try {
      fs.copyFileSync(src, file.original);
      restored.push(file.original);
    } catch {
      failed.push(file.original);
    }
  }

  return { restored, failed };
}
