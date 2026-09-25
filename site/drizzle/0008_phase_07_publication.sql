CREATE TABLE `publication_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`source_version` integer NOT NULL,
	`academic_revision` integer NOT NULL,
	`payload_json` text NOT NULL,
	`result_version_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`result_version_id`) REFERENCES `exam_result_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "publication_preview_payload" CHECK(json_valid("publication_previews"."payload_json")),
	CONSTRAINT "publication_preview_version" CHECK(typeof("publication_previews"."source_version") = 'integer' AND "publication_previews"."source_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `publication_preview_actor` ON `publication_previews` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `publication_snapshots` (
	`result_version_id` text PRIMARY KEY NOT NULL,
	`snapshot_json` text NOT NULL,
	FOREIGN KEY (`result_version_id`) REFERENCES `exam_result_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "publication_snapshot_json" CHECK(json_valid("publication_snapshots"."snapshot_json"))
);
--> statement-breakpoint
CREATE TRIGGER publication_snapshot_immutable BEFORE UPDATE ON publication_snapshots
BEGIN SELECT RAISE(ABORT, 'PUBLICATION_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER publication_preview_immutable BEFORE UPDATE ON publication_previews
WHEN NEW.id IS NOT OLD.id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.exam_id IS NOT OLD.exam_id OR NEW.source_version IS NOT OLD.source_version OR NEW.academic_revision IS NOT OLD.academic_revision OR NEW.payload_json IS NOT OLD.payload_json OR NEW.created_at IS NOT OLD.created_at OR OLD.result_version_id IS NOT NULL OR NEW.result_version_id IS NULL
BEGIN SELECT RAISE(ABORT, 'PUBLICATION_PREVIEW_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER publication_preview_result_guard BEFORE UPDATE ON publication_previews
WHEN NOT EXISTS (SELECT 1 FROM exam_result_versions WHERE id=NEW.result_version_id AND exam_id=NEW.exam_id AND source_version=NEW.source_version+1)
BEGIN SELECT RAISE(ABORT, 'PUBLICATION_PREVIEW_RESULT_MISMATCH'); END;
