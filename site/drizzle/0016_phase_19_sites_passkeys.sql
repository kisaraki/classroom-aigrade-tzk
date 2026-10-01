CREATE TABLE `admin_passkeys` (
	`admin_user_id` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`transports_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "passkey_counter" CHECK("admin_passkeys"."counter" >= 0),
	CONSTRAINT "passkey_version" CHECK(typeof("admin_passkeys"."version") = 'integer' AND "admin_passkeys"."version" > 0),
	CONSTRAINT "passkey_transports" CHECK(json_valid("admin_passkeys"."transports_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_passkeys_credential_id_unique` ON `admin_passkeys` (`credential_id`);--> statement-breakpoint
CREATE TABLE `admin_sites_bindings` (
	`admin_user_id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sites_subject_bounded" CHECK(length("admin_sites_bindings"."subject") BETWEEN 1 AND 512)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sites_bindings_subject_unique` ON `admin_sites_bindings` (`subject`);--> statement-breakpoint
CREATE TABLE `auth_sites_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge_hash` text NOT NULL,
	`admin_user_id` text NOT NULL,
	`session_id` text,
	`subject` text NOT NULL,
	`purpose` text NOT NULL,
	`identity_request_id` text,
	`auth_version` integer NOT NULL,
	`credential_version` integer,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `admin_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sites_challenge_hash" CHECK(length("auth_sites_challenges"."challenge_hash") = 64 AND "auth_sites_challenges"."challenge_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "sites_challenge_purpose" CHECK("auth_sites_challenges"."purpose" IN ('register','reauth','identity')),
	CONSTRAINT "sites_challenge_expiry" CHECK("auth_sites_challenges"."expires_at" > "auth_sites_challenges"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sites_challenges_challenge_hash_unique` ON `auth_sites_challenges` (`challenge_hash`);--> statement-breakpoint
CREATE INDEX `sites_challenge_expiry_idx` ON `auth_sites_challenges` (`expires_at`);--> statement-breakpoint
ALTER TABLE `auth_identity_requests` ADD `sites_subject` text;
--> statement-breakpoint
-- Deployment-time revocation only; old identities are never automatically mapped to Sites.
UPDATE admin_users SET auth_version = auth_version + 1;
--> statement-breakpoint
UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, unixepoch() * 1000), recent_auth_at = 0;
--> statement-breakpoint
UPDATE auth_oauth_states SET used_at = COALESCE(used_at, unixepoch() * 1000);
--> statement-breakpoint
UPDATE auth_identity_requests SET status = 'expired' WHERE status = 'approved';
--> statement-breakpoint
CREATE TRIGGER sites_binding_invalidation AFTER UPDATE OF subject ON admin_sites_bindings WHEN NEW.subject IS NOT OLD.subject BEGIN
 UPDATE admin_users SET auth_version=auth_version+1 WHERE id=NEW.admin_user_id;
 UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, unixepoch() * 1000), recent_auth_at = 0 WHERE admin_user_id = NEW.admin_user_id;
 UPDATE auth_sites_challenges SET used_at = COALESCE(used_at, unixepoch() * 1000) WHERE admin_user_id = NEW.admin_user_id;
END;
--> statement-breakpoint
CREATE TRIGGER sites_binding_delete_invalidation AFTER DELETE ON admin_sites_bindings BEGIN
 UPDATE admin_users SET auth_version=auth_version+1 WHERE id=OLD.admin_user_id;
 UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, unixepoch() * 1000), recent_auth_at = 0 WHERE admin_user_id = OLD.admin_user_id;
 UPDATE auth_sites_challenges SET used_at = COALESCE(used_at, unixepoch() * 1000) WHERE admin_user_id = OLD.admin_user_id;
END;
