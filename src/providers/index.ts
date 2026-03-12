import type { SSHKeyProvider } from "./types.js";
import { OnePasswordProvider } from "./onepassword.js";
import { ProtonProvider } from "./proton.js";
import { ManualProvider } from "./manual.js";
import { GitSwitchError } from "../utils/errors.js";

const providers: SSHKeyProvider[] = [
  new OnePasswordProvider(),
  new ProtonProvider(),
  new ManualProvider(),
];

export function getAllProviders(): SSHKeyProvider[] {
  return providers;
}

export function getProvider(id: string): SSHKeyProvider {
  const provider = providers.find((p) => p.id === id);
  if (!provider) {
    throw new GitSwitchError(`Unknown SSH key provider: "${id}"`);
  }
  return provider;
}

export async function getAvailableProviders(): Promise<SSHKeyProvider[]> {
  const results = await Promise.all(
    providers.map(async (p) => ({
      provider: p,
      available: await p.isAvailable(),
    })),
  );
  return results.filter((r) => r.available).map((r) => r.provider);
}
