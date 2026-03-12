import * as fs from "node:fs";
import { gitDesktopAppStatePath } from "../../utils/paths.js";
import { GitSwitchError } from "../../utils/errors.js";

interface AppState {
  [key: string]: unknown;
  accounts?: unknown[];
}

export function readAppState(): AppState {
  const p = gitDesktopAppStatePath();
  if (!fs.existsSync(p)) {
    throw new GitSwitchError(
      `GitHub Desktop app-state.json not found at: ${p}`,
    );
  }
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw) as AppState;
}

export function readAppStateAccounts(): unknown[] {
  const state = readAppState();
  return (state.accounts as unknown[]) || [];
}

/**
 * Surgically update only the `accounts` array in app-state.json.
 * All other keys are preserved exactly as-is.
 */
export function writeAppStateAccounts(accounts: unknown[]): void {
  const p = gitDesktopAppStatePath();
  const state = readAppState();
  state.accounts = accounts;

  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, p);
}
