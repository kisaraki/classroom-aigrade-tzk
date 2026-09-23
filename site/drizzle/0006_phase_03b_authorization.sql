CREATE TABLE `auth_identity_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`target_admin_id` text NOT NULL,
	`authorized_email` text NOT NULL,
	`approval_hash` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`expires_at` integer NOT NULL,
	`approved_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`kind` text NOT NULL,
	`target_auth_version` integer NOT NULL,
	`actor_session_id` text,
	`approved_by` text NOT NULL,
	`evidence_reference` text NOT NULL,
	FOREIGN KEY (`target_admin_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_session_id`) REFERENCES `admin_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recovery_approval_hash" CHECK(length("auth_identity_requests"."approval_hash") = 64 AND "auth_identity_requests"."approval_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "identity_request_version" CHECK(typeof("auth_identity_requests"."target_auth_version") = 'integer' AND "auth_identity_requests"."target_auth_version" > 0),
	CONSTRAINT "identity_request_kind" CHECK(("auth_identity_requests"."kind" = 'rebind' AND "auth_identity_requests"."actor_session_id" IS NOT NULL) OR ("auth_identity_requests"."kind" = 'recovery' AND "auth_identity_requests"."actor_session_id" IS NULL)),
	CONSTRAINT "recovery_status" CHECK("auth_identity_requests"."status" IN ('approved', 'consumed', 'expired', 'rejected')),
	CONSTRAINT "recovery_times" CHECK("auth_identity_requests"."expires_at" > "auth_identity_requests"."approved_at" AND ("auth_identity_requests"."consumed_at" IS NULL OR "auth_identity_requests"."consumed_at" >= "auth_identity_requests"."approved_at"))
);
--> statement-breakpoint
CREATE INDEX `recovery_target_status` ON `auth_identity_requests` (`target_admin_id`,`status`);--> statement-breakpoint
CREATE INDEX `recovery_expiry` ON `auth_identity_requests` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `identity_request_token` ON `auth_identity_requests` (`approval_hash`);--> statement-breakpoint
ALTER TABLE auth_oauth_states ADD COLUMN admin_session_id text;
--> statement-breakpoint
ALTER TABLE auth_oauth_states ADD COLUMN identity_request_id text;
--> statement-breakpoint
DROP TRIGGER auth_oauth_state_purpose_insert;
--> statement-breakpoint
DROP TRIGGER auth_oauth_state_purpose_update;
--> statement-breakpoint
CREATE TRIGGER auth_oauth_state_purpose_insert BEFORE INSERT ON auth_oauth_states
BEGIN
  SELECT RAISE(ABORT, 'INVALID_OAUTH_STATE_PURPOSE') WHERE NOT (
    (NEW.purpose IN ('login','bootstrap') AND NEW.admin_session_id IS NULL AND NEW.identity_request_id IS NULL)
    OR (NEW.purpose = 'reauth' AND NEW.identity_request_id IS NULL AND EXISTS (SELECT 1 FROM admin_sessions WHERE id = NEW.admin_session_id))
    OR (NEW.purpose = 'identity' AND NEW.admin_session_id IS NULL AND EXISTS (SELECT 1 FROM auth_identity_requests WHERE id = NEW.identity_request_id))
  );
END;
--> statement-breakpoint
CREATE TRIGGER auth_oauth_state_purpose_update BEFORE UPDATE ON auth_oauth_states
BEGIN
  SELECT RAISE(ABORT, 'INVALID_OAUTH_STATE_PURPOSE') WHERE NEW.purpose IS NOT OLD.purpose OR NEW.admin_session_id IS NOT OLD.admin_session_id OR NEW.identity_request_id IS NOT OLD.identity_request_id;
END;
--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD `recent_auth_at` integer DEFAULT 0 NOT NULL;