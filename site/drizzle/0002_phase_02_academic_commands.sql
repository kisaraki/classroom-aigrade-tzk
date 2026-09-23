CREATE TABLE `academic_operation_students` (
	`operation_id` text NOT NULL,
	`student_id` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `academic_operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academic_operation_student_unique` ON `academic_operation_students` (`operation_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `academic_operations_by_student` ON `academic_operation_students` (`student_id`);--> statement-breakpoint
CREATE TABLE `academic_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`preview_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`auth_session_id` text NOT NULL,
	`kind` text NOT NULL,
	`before_revision` integer NOT NULL,
	`after_revision` integer,
	`changes_json` text NOT NULL,
	`result_json` text NOT NULL,
	`undo_of` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`preview_id`) REFERENCES `academic_previews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auth_session_id`) REFERENCES `admin_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`undo_of`) REFERENCES `academic_operations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "academic_operation_json" CHECK(json_valid("academic_operations"."changes_json") AND json_valid("academic_operations"."result_json")),
	CONSTRAINT "academic_operation_revision" CHECK(typeof("academic_operations"."before_revision") = 'integer' AND "academic_operations"."before_revision" >= 0 AND ("academic_operations"."after_revision" IS NULL OR (typeof("academic_operations"."after_revision") = 'integer' AND "academic_operations"."after_revision" >= "academic_operations"."before_revision")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academic_operations_preview_id_unique` ON `academic_operations` (`preview_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `academic_operations_undo_of_unique` ON `academic_operations` (`undo_of`);--> statement-breakpoint
CREATE INDEX `academic_operation_actor` ON `academic_operations` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `academic_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`base_revision` integer NOT NULL,
	`payload_json` text NOT NULL,
	`resources_json` text NOT NULL,
	`history_reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "academic_preview_json" CHECK(json_valid("academic_previews"."payload_json") AND json_valid("academic_previews"."resources_json")),
	CONSTRAINT "academic_preview_revision" CHECK(typeof("academic_previews"."base_revision") = 'integer' AND "academic_previews"."base_revision" >= 0)
);
--> statement-breakpoint
CREATE INDEX `academic_preview_actor` ON `academic_previews` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `academic_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`current_year_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`current_year_id`) REFERENCES `academic_years`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "academic_state_singleton" CHECK("academic_state"."id" = 1),
	CONSTRAINT "academic_revision" CHECK(typeof("academic_state"."revision") = 'integer' AND "academic_state"."revision" >= 0)
);
