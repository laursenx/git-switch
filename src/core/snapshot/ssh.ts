import * as fs from "node:fs";
import * as path from "node:path";
import { sshConfigPath } from "../../utils/paths.js";
import type { SnapshotFile } from "../../providers/types.js";

export function collectSSHFiles(): SnapshotFile[] {
  const sshPath = sshConfigPath();
  if (!fs.existsSync(sshPath)) return [];
  return [{ original: sshPath, snapshot: "ssh-config" }];
}

export function copySSHFiles(
  files: SnapshotFile[],
  snapshotDir: string,
): void {
  for (const file of files) {
    const dest = path.join(snapshotDir, file.snapshot);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file.original, dest);
  }
}

export function restoreSSHFiles(
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
