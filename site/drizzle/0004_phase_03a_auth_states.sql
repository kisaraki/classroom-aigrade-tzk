CREATE TABLE `auth_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`state_hash` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`code_verifier_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "oauth_state_hash" CHECK(length("auth_oauth_states"."state_hash") = 64 AND "auth_oauth_states"."state_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "oauth_nonce_hash" CHECK(length("auth_oauth_states"."nonce_hash") = 64 AND "auth_oauth_states"."nonce_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "oauth_verifier_hash" CHECK(length("auth_oauth_states"."code_verifier_hash") = 64 AND "auth_oauth_states"."code_verifier_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "oauth_state_times" CHECK("auth_oauth_states"."expires_at" > "auth_oauth_states"."created_at" AND ("auth_oauth_states"."used_at" IS NULL OR "auth_oauth_states"."used_at" >= "auth_oauth_states"."created_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_oauth_states_state_hash_unique` ON `auth_oauth_states` (`state_hash`);--> statement-breakpoint
CREATE INDEX `oauth_state_expiry` ON `auth_oauth_states` (`expires_at`);