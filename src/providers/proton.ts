import { ProtonNotImplementedError } from "../utils/errors.js";
import type { SSHKeyItem, SSHKeyProvider } from "./types.js";

// TODO: implement when Proton Pass SSH agent CLI is released
export class ProtonProvider implements SSHKeyProvider {
  id = "proton";
  name = "Proton Pass";

  // TODO: implement when Proton Pass SSH agent CLI is released
  async isAvailable(): Promise<boolean> {
    return false;
  }

  // TODO: implement when Proton Pass SSH agent CLI is released
  async listKeys(): Promise<SSHKeyItem[]> {
    throw new ProtonNotImplementedError();
  }

  // TODO: implement when Proton Pass SSH agent CLI is released
  async getPublicKey(_ref: string): Promise<string> {
    throw new ProtonNotImplementedError();
  }

  // TODO: implement when Proton Pass SSH agent CLI is released
  getAgentSocket(): string | null {
    throw new ProtonNotImplementedError();
  }
}
