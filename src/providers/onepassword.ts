import { ProviderError } from "../utils/errors.js";
import { run } from "../utils/shell.js";
import type { SSHKeyItem, SSHKeyProvider } from "./types.js";

interface OPItem {
	id: string;
	title: string;
	vault?: { name: string };
}

export class OnePasswordProvider implements SSHKeyProvider {
	id = "1password";
	name = "1Password";

	getDiagnostic(): { installed: boolean; signedIn: boolean } {
		const versionCheck = run("op", ["--version"]);
		if (versionCheck.exitCode !== 0) {
			return { installed: false, signedIn: false };
		}

		const accountCheck = run("op", ["account", "list", "--format", "json"]);
		if (accountCheck.exitCode !== 0) {
			return { installed: true, signedIn: false };
		}

		try {
			const accounts = JSON.parse(accountCheck.stdout) as unknown[];
			return { installed: true, signedIn: accounts.length > 0 };
		} catch {
			return { installed: true, signedIn: false };
		}
	}

	async isAvailable(): Promise<boolean> {
		const diag = this.getDiagnostic();
		return diag.installed && diag.signedIn;
	}

	async listKeys(): Promise<SSHKeyItem[]> {
		// Try both category formats: newer CLI uses "SSH Key", older uses "SSH_KEY"
		let result = run("op", [
			"item",
			"list",
			"--categories",
			"SSH Key",
			"--format",
			"json",
		]);

		if (
			result.exitCode !== 0 &&
			result.stderr.includes("Unknown item category")
		) {
			result = run("op", [
				"item",
				"list",
				"--categories",
				"SSH_KEY",
				"--format",
				"json",
			]);
		}

		if (result.exitCode !== 0) {
			if (result.stderr.includes("not signed in")) {
				throw new ProviderError(
					this.id,
					"1Password CLI is not signed in. Run: op signin",
				);
			}
			throw new ProviderError(
				this.id,
				`Failed to list SSH keys: ${result.stderr}`,
			);
		}

		let items: OPItem[];
		try {
			items = JSON.parse(result.stdout) as OPItem[];
		} catch {
			throw new ProviderError(this.id, "Failed to parse 1Password item list");
		}

		return items.map((item) => ({
			ref: item.id,
			label: item.title,
			vault: item.vault?.name,
		}));
	}

	async getPublicKey(ref: string): Promise<string> {
		const result = run("op", ["item", "get", ref, "--fields", "public key"]);

		if (result.exitCode !== 0) {
			if (result.stderr.includes("not found")) {
				throw new ProviderError(
					this.id,
					`SSH key "${ref}" not found in 1Password. ` +
						'Run: op item list --categories "SSH Key" — to see available keys.',
				);
			}
			throw new ProviderError(
				this.id,
				`Failed to get public key for "${ref}": ${result.stderr}`,
			);
		}

		return result.stdout;
	}

	getAgentSocket(): string | null {
		// 1Password sets SSH_AUTH_SOCK at the system level
		return null;
	}
}
