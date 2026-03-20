import * as fs from "node:fs";
import * as path from "node:path";
import type { SnapshotFile } from "../../providers/types.js";
import { sshConfigPath } from "../../utils/paths.js";

export function collectSSHFiles(): SnapshotFile[] {
	const sshPath = sshConfigPath();
	if (!fs.existsSync(sshPath)) return [];
	return [{ original: sshPath, snapshot: "ssh-config" }];
}

export function copySSHFiles(files: SnapshotFile[], snapshotDir: string): void {
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
		const src = path.resolve(snapshotDir, file.snapshot);
		// Guard against path traversal from corrupted manifests
		if (!src.startsWith(path.resolve(snapshotDir))) {
			failed.push(file.original);
			continue;
		}
		try {
			// Refuse to overwrite symlinks to prevent symlink attacks
			try {
				if (fs.lstatSync(file.original).isSymbolicLink()) {
					failed.push(file.original);
					continue;
				}
			} catch {
				// File doesn't exist yet - safe to write
			}
			fs.copyFileSync(src, file.original);
			restored.push(file.original);
		} catch {
			failed.push(file.original);
		}
	}

	return { restored, failed };
}
