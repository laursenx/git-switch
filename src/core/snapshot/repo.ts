import * as fs from "node:fs";
import * as path from "node:path";
import type { SnapshotFile } from "../../providers/types.js";

export function collectRepoFiles(
  gitDir: string,
  submoduleConfigs: string[],
): SnapshotFile[] {
  const files: SnapshotFile[] = [];

  const mainConfig = path.join(gitDir, "config");
  if (fs.existsSync(mainConfig)) {
    files.push({ original: mainConfig, snapshot: "git-config" });
  }

  for (const subConfig of submoduleConfigs) {
    // Create a safe snapshot filename from the submodule path
    const relative = path.relative(path.join(gitDir, "modules"), subConfig);
    const safeName = relative.replace(/[/\\]/g, "-");
    files.push({
      original: subConfig,
      snapshot: `modules/${safeName}`,
    });
  }

  return files;
}

export function copyRepoFiles(
  files: SnapshotFile[],
  snapshotDir: string,
): void {
  for (const file of files) {
    const dest = path.join(snapshotDir, file.snapshot);
    const destDir = path.dirname(dest);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(file.original, dest);
  }
}

export function restoreRepoFiles(
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
