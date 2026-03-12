import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  gitName: text("git_name").notNull(),
  gitEmail: text("git_email").notNull(),
  sshProvider: text("ssh_provider").notNull(),
  sshRef: text("ssh_ref").notNull(),
  sshHost: text("ssh_host").notNull(),
  sshAlias: text("ssh_alias").notNull(),
  desktopProfileId: text("desktop_profile_id"),
});

export const desktopProfiles = sqliteTable("desktop_profiles", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  email: text("email").notNull(),
  keychainLabel: text("keychain_label").notNull(),
  storedLabel: text("stored_label").notNull(),
  appStateAccounts: text("app_state_accounts").notNull().default("[]"),
  usersJson: text("users_json"),
});

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  operation: text("operation").notNull(),
  repoPath: text("repo_path"),
  repoHash: text("repo_hash"),
  profileBefore: text("profile_before"),
  profileAfter: text("profile_after"),
  filesDir: text("files_dir").notNull(),
  files: text("files").notNull().default("[]"),
  restored: integer("restored", { mode: "boolean" }).notNull().default(false),
});
