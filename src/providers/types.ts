export interface SSHKeyItem {
  /** Provider-specific identifier */
  ref: string;
  /** Human-readable name shown in wizard */
  label: string;
  /** Optional vault/group name (1Password, Proton) */
  vault?: string;
  /** Optional fingerprint for display */
  fingerprint?: string;
}

export interface SSHKeyProvider {
  id: string;
  name: string;
  isAvailable(): Promise<boolean>;
  listKeys(): Promise<SSHKeyItem[]>;
  /** Returns the raw public key string */
  getPublicKey(ref: string): Promise<string>;
  /** Returns SSH_AUTH_SOCK path or null */
  getAgentSocket(): string | null;
}

export interface ProfileGit {
  name: string;
  email: string;
}

export interface ProfileSSH {
  provider: "1password" | "proton" | "manual";
  ref: string;
  host: string;
  alias: string;
}

export interface DesktopProfile {
  id: string;
  label: string;
  email: string;
  keychain_label: string;
  stored_label: string;
  app_state_accounts: unknown[];
  users_json?: string;
}

export interface Profile {
  id: string;
  label: string;
  git: ProfileGit;
  ssh: ProfileSSH;
  desktop_profile_id?: string;
}

export interface SnapshotFile {
  original: string;
  snapshot: string;
}

export interface SnapshotManifest {
  id: string;
  repo?: string;
  repo_hash?: string;
  timestamp: string;
  operation: "mark" | "desktop" | "remove";
  profile_before?: string;
  profile_after?: string;
  restored: boolean;
  files: SnapshotFile[];
}
