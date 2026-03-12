import * as fs from "node:fs";
import * as path from "node:path";
import { sshDir, resolveHome } from "../utils/paths.js";
import { ProviderError } from "../utils/errors.js";
import type { SSHKeyItem, SSHKeyProvider } from "./types.js";

export class ManualProvider implements SSHKeyProvider {
  id = "manual";
  name = "Manual (~/.ssh)";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async listKeys(): Promise<SSHKeyItem[]> {
    const dir = sshDir();
    if (!fs.existsSync(dir)) return [];

    const entries = fs.readdirSync(dir);
    const pubFiles = entries.filter((e) => e.endsWith(".pub"));

    return pubFiles.map((file) => ({
      ref: path.join(dir, file),
      label: file,
    }));
  }

  async getPublicKey(ref: string): Promise<string> {
    const resolved = resolveHome(ref);
    if (!fs.existsSync(resolved)) {
      throw new ProviderError(
        this.id,
        `Public key file not found: ${resolved}`,
      );
    }
    return fs.readFileSync(resolved, "utf-8").trim();
  }

  getAgentSocket(): string | null {
    return null;
  }
}
