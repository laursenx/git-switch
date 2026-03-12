CREATE TABLE `desktop_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`email` text NOT NULL,
	`keychain_label` text NOT NULL,
	`stored_label` text NOT NULL,
	`app_state_accounts` text DEFAULT '[]' NOT NULL,
	`users_json` text
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`git_name` text NOT NULL,
	`git_email` text NOT NULL,
	`ssh_provider` text NOT NULL,
	`ssh_ref` text NOT NULL,
	`ssh_host` text NOT NULL,
	`ssh_alias` text NOT NULL,
	`desktop_profile_id` text
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` text NOT NULL,
	`operation` text NOT NULL,
	`repo_path` text,
	`repo_hash` text,
	`profile_before` text,
	`profile_after` text,
	`files_dir` text NOT NULL,
	`files` text DEFAULT '[]' NOT NULL,
	`restored` integer DEFAULT false NOT NULL
);
