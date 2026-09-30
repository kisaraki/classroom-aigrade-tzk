CREATE TABLE `public_lookup_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_hash` text NOT NULL,
	`query_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "public_lookup_hashes" CHECK(length("public_lookup_attempts"."ip_hash")=64 AND "public_lookup_attempts"."ip_hash" NOT GLOB '*[^0-9a-f]*' AND length("public_lookup_attempts"."query_hash")=64 AND "public_lookup_attempts"."query_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `public_lookup_ip_window` ON `public_lookup_attempts` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `public_lookup_query_window` ON `public_lookup_attempts` (`query_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `public_lookup_expiry` ON `public_lookup_attempts` (`created_at`);