CREATE TABLE `auth_rate_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_hash` text NOT NULL,
	`restricted_start` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "auth_rate_hash" CHECK(length("auth_rate_attempts"."ip_hash")=64 AND "auth_rate_attempts"."ip_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "auth_rate_restricted" CHECK("auth_rate_attempts"."restricted_start" IN (0,1)),
	CONSTRAINT "auth_rate_time" CHECK(typeof("auth_rate_attempts"."created_at")='integer' AND "auth_rate_attempts"."created_at">=0)
);
--> statement-breakpoint
CREATE INDEX `auth_rate_ip_window` ON `auth_rate_attempts` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_rate_restricted_window` ON `auth_rate_attempts` (`ip_hash`,`restricted_start`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_rate_expiry` ON `auth_rate_attempts` (`created_at`);