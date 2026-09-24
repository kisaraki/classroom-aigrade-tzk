CREATE TABLE `exam_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`auth_session_id` text NOT NULL,
	`kind` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`preview_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auth_session_id`) REFERENCES `admin_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preview_id`) REFERENCES `exam_roster_previews`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exam_operation_hash" CHECK(length("exam_operations"."request_hash") = 64 AND "exam_operations"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "exam_operation_result" CHECK(json_valid("exam_operations"."result_json")),
	CONSTRAINT "exam_operation_kind" CHECK("exam_operations"."kind" IN ('CREATE_EXAM','SCHEDULE','SUBJECT','ROSTER','EXTERNAL','SCORES'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_operations_preview_id_unique` ON `exam_operations` (`preview_id`);--> statement-breakpoint
CREATE INDEX `exam_operation_actor` ON `exam_operations` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `exam_roster_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`class_id` text NOT NULL,
	`exam_version` integer NOT NULL,
	`academic_revision` integer NOT NULL,
	`roster_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exam_preview_version" CHECK(typeof("exam_roster_previews"."exam_version") = 'integer' AND "exam_roster_previews"."exam_version" > 0),
	CONSTRAINT "exam_preview_revision" CHECK(typeof("exam_roster_previews"."academic_revision") = 'integer' AND "exam_roster_previews"."academic_revision" >= 0),
	CONSTRAINT "exam_preview_roster" CHECK(json_valid("exam_roster_previews"."roster_json") AND json_type("exam_roster_previews"."roster_json") = 'array')
);
--> statement-breakpoint
CREATE INDEX `exam_preview_actor` ON `exam_roster_previews` (`actor_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER exam_roster_preview_immutable BEFORE UPDATE ON exam_roster_previews
BEGIN
  SELECT RAISE(ABORT, 'EXAM_PREVIEW_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER exam_operation_immutable BEFORE UPDATE ON exam_operations
BEGIN
  SELECT RAISE(ABORT, 'EXAM_OPERATION_IMMUTABLE');
END;
