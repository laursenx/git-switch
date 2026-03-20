import * as prompts from "@clack/prompts";
import { listSnapshots, restoreSnapshot } from "../core/snapshot/index.js";
import type { SnapshotManifest } from "../providers/types.js";
import { repoHash } from "../utils/paths.js";
import { abortIfCancelled, ensureGitRepo } from "../utils/prompts.js";

function formatTimestamp(ts: string): string {
	try {
		return new Date(ts).toLocaleString();
	} catch {
		return ts;
	}
}

function formatTransition(snap: SnapshotManifest): string {
	const parts: string[] = [snap.operation];
	if (snap.profile_after) parts.push(snap.profile_after);
	if (snap.profile_before) parts.push(`(was: ${snap.profile_before})`);
	return parts.join(" ");
}

export async function undoListCommand(): Promise<void> {
	prompts.intro("git-switch undo --list - Snapshots for current repo");

	const repoRoot = ensureGitRepo().repoRoot;
	const hash = repoHash(repoRoot);

	const snapshots = listSnapshots(hash);
	if (snapshots.length === 0) {
		prompts.log.info("No snapshots found for this repo.");
		prompts.outro("");
		return;
	}

	const header = [
		"ID".padEnd(36),
		"Timestamp".padEnd(24),
		"Operation".padEnd(28),
		"Restored",
	].join("");

	prompts.log.info(header);
	prompts.log.info("-".repeat(header.length));

	for (const snap of snapshots) {
		const line = [
			snap.id.padEnd(36),
			formatTimestamp(snap.timestamp).padEnd(24),
			formatTransition(snap).padEnd(28),
			snap.restored ? "yes" : "no",
		].join("");
		prompts.log.info(line);
	}

	prompts.outro(`${snapshots.length} snapshot(s)`);
}

export async function undoCommand(snapshotId?: string): Promise<void> {
	prompts.intro("git-switch undo - Restore from snapshot");

	const repoRoot = ensureGitRepo().repoRoot;
	const hash = repoHash(repoRoot);

	let snapshot: SnapshotManifest;

	if (snapshotId) {
		// Restore specific snapshot
		const all = listSnapshots(hash);
		const found = all.find((s) => s.id === snapshotId);
		if (!found) {
			prompts.cancel(
				`Snapshot "${snapshotId}" not found. Run: git-switch undo --list`,
			);
			process.exit(1);
		}
		snapshot = found;
	} else {
		// Find most recent
		const snapshots = listSnapshots(hash);
		if (snapshots.length === 0) {
			prompts.cancel("No snapshots found for this repo. Nothing to undo.");
			process.exit(1);
		}
		const first = snapshots[0];
		if (!first) {
			prompts.cancel("No snapshots found for this repo. Nothing to undo.");
			process.exit(1);
		}
		snapshot = first;
	}

	// Show summary
	prompts.log.info(
		`Most recent snapshot: ${formatTimestamp(snapshot.timestamp)}`,
	);
	prompts.log.info(`Operation: ${formatTransition(snapshot)}`);
	prompts.log.info(
		`Files to restore: ${snapshot.files.map((f) => f.original).join(", ")}`,
	);

	const confirmed = abortIfCancelled(
		await prompts.confirm({
			message: "Restore?",
			initialValue: false,
		}),
	);
	if (!confirmed) {
		prompts.cancel("Aborted.");
		process.exit(0);
	}

	// Restore
	const result = restoreSnapshot(snapshot);

	for (const restored of result.restored) {
		prompts.log.success(`Restored: ${restored}`);
	}
	for (const failed of result.failed) {
		prompts.log.error(`Failed to restore: ${failed}`);
	}

	if (result.failed.length > 0) {
		prompts.log.error(
			`Some files could not be restored. Manual restore from: ~/.config/git-switch/snapshots/${snapshot.id}`,
		);
		process.exit(1);
	}

	if (snapshot.profile_before) {
		prompts.log.info(`Repo is back to: ${snapshot.profile_before}`);
	}

	prompts.outro("Restored successfully.");
}
