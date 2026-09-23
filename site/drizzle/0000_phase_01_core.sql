CREATE TABLE `academic_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`academic_year_id` text NOT NULL,
	`term_number` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "term_number" CHECK("academic_terms"."term_number" IN (1, 2)),
	CONSTRAINT "term_dates" CHECK(length("academic_terms"."starts_on") = 10 AND "academic_terms"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("academic_terms"."starts_on", '+0 days') IS NOT NULL AND date("academic_terms"."starts_on", '+0 days') = "academic_terms"."starts_on" AND length("academic_terms"."ends_on") = 10 AND "academic_terms"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("academic_terms"."ends_on", '+0 days') IS NOT NULL AND date("academic_terms"."ends_on", '+0 days') = "academic_terms"."ends_on" AND "academic_terms"."starts_on" < "academic_terms"."ends_on")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `term_number_unique` ON `academic_terms` (`academic_year_id`,`term_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `term_year_unique` ON `academic_terms` (`id`,`academic_year_id`);--> statement-breakpoint
CREATE TABLE `academic_years` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "year_dates" CHECK(length("academic_years"."starts_on") = 10 AND "academic_years"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("academic_years"."starts_on", '+0 days') IS NOT NULL AND date("academic_years"."starts_on", '+0 days') = "academic_years"."starts_on" AND length("academic_years"."ends_on") = 10 AND "academic_years"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("academic_years"."ends_on", '+0 days') IS NOT NULL AND date("academic_years"."ends_on", '+0 days') = "academic_years"."ends_on" AND "academic_years"."starts_on" < "academic_years"."ends_on")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academic_years_code_unique` ON `academic_years` (`code`);--> statement-breakpoint
CREATE TABLE `admin_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`academic_term_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`grade` integer,
	`class_id` text,
	`subject` text,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academic_term_id`) REFERENCES `academic_terms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assignment_shape" CHECK(("admin_assignments"."scope_type" = 'school' AND "admin_assignments"."grade" IS NULL AND "admin_assignments"."class_id" IS NULL AND "admin_assignments"."subject" IS NULL) OR ("admin_assignments"."scope_type" = 'grade' AND "admin_assignments"."grade" IS NOT NULL AND "admin_assignments"."grade" IN (7,8,9) AND "admin_assignments"."class_id" IS NULL AND "admin_assignments"."subject" IS NULL) OR ("admin_assignments"."scope_type" IN ('class', 'homeroom') AND "admin_assignments"."class_id" IS NOT NULL AND "admin_assignments"."grade" IS NULL AND "admin_assignments"."subject" IS NULL) OR ("admin_assignments"."scope_type" = 'teaching_subject' AND "admin_assignments"."class_id" IS NOT NULL AND "admin_assignments"."grade" IS NULL AND "admin_assignments"."subject" IS NOT NULL AND "admin_assignments"."subject" IN ('CHINESE','ENGLISH','MATH','SCIENCE','GEOGRAPHY','HISTORY','CIVICS'))),
	CONSTRAINT "assignment_dates" CHECK(length("admin_assignments"."starts_on") = 10 AND "admin_assignments"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("admin_assignments"."starts_on", '+0 days') IS NOT NULL AND date("admin_assignments"."starts_on", '+0 days') = "admin_assignments"."starts_on" AND ("admin_assignments"."ends_on" IS NULL OR (length("admin_assignments"."ends_on") = 10 AND "admin_assignments"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("admin_assignments"."ends_on", '+0 days') IS NOT NULL AND date("admin_assignments"."ends_on", '+0 days') = "admin_assignments"."ends_on" AND "admin_assignments"."ends_on" > "admin_assignments"."starts_on")))
);
--> statement-breakpoint
CREATE INDEX `assignments_admin_term` ON `admin_assignments` (`admin_user_id`,`academic_term_id`);--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`auth_version` integer NOT NULL,
	`authenticated_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_hash" CHECK(length("admin_sessions"."token_hash") = 64 AND "admin_sessions"."token_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "session_times" CHECK("admin_sessions"."expires_at" > "admin_sessions"."authenticated_at" AND "admin_sessions"."last_seen_at" >= "admin_sessions"."authenticated_at"),
	CONSTRAINT "session_auth_version" CHECK(typeof("admin_sessions"."auth_version") = 'integer' AND "admin_sessions"."auth_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_hash_unique` ON `admin_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_admin_expiry` ON `admin_sessions` (`admin_user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`authorized_email` text NOT NULL,
	`google_subject_id` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'pending_identity_binding' NOT NULL,
	`identity_bound_at` integer,
	`last_login_at` integer,
	`auth_version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "admin_role" CHECK("admin_users"."role" IN ('super_admin', 'system_admin', 'academic_admin', 'score_admin', 'ai_admin', 'archive_admin', 'viewer')),
	CONSTRAINT "admin_status" CHECK("admin_users"."status" IN ('pending_identity_binding', 'active', 'disabled', 'locked', 'identity_rebind_required')),
	CONSTRAINT "admin_active_binding" CHECK("admin_users"."status" <> 'active' OR ("admin_users"."google_subject_id" IS NOT NULL AND length("admin_users"."google_subject_id") > 0 AND "admin_users"."identity_bound_at" IS NOT NULL)),
	CONSTRAINT "admin_auth_version" CHECK(typeof("admin_users"."auth_version") = 'integer' AND "admin_users"."auth_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_unique` ON `admin_users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_authorized_email_unique` ON `admin_users` (`authorized_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_google_subject_id_unique` ON `admin_users` (`google_subject_id`);--> statement-breakpoint
CREATE TABLE `ai_advice_references` (
	`id` text PRIMARY KEY NOT NULL,
	`advice_id` text NOT NULL,
	`chunk_id` integer NOT NULL,
	`material_version` integer NOT NULL,
	`title_snapshot` text NOT NULL,
	`content_hash_snapshot` text NOT NULL,
	FOREIGN KEY (`advice_id`) REFERENCES `ai_advices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chunk_id`) REFERENCES `ai_reference_chunks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "citation_hash" CHECK(length("ai_advice_references"."content_hash_snapshot") = 64 AND "ai_advice_references"."content_hash_snapshot" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "citation_version" CHECK(typeof("ai_advice_references"."material_version") = 'integer' AND "ai_advice_references"."material_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `advice_reference_unique` ON `ai_advice_references` (`advice_id`,`chunk_id`);--> statement-breakpoint
CREATE TABLE `ai_advices` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`student_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`audience` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source_version` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`content` text NOT NULL,
	`stale_at` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "advice_audience" CHECK("ai_advices"."audience" IN ('parent', 'student')),
	CONSTRAINT "advice_provider" CHECK("ai_advices"."provider" IN ('openai', 'gemini')),
	CONSTRAINT "advice_versions" CHECK(typeof("ai_advices"."version") = 'integer' AND "ai_advices"."version" > 0 AND typeof("ai_advices"."source_version") = 'integer' AND "ai_advices"."source_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_advices_job_id_unique` ON `ai_advices` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `advice_version_unique` ON `ai_advices` (`student_id`,`exam_id`,`audience`,`version`);--> statement-breakpoint
CREATE TABLE `ai_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`result_version_id` text,
	`audience` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`source_version` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`lease_token_hash` text,
	`lease_expires_at` integer,
	`next_attempt_at` integer,
	`error_code` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`result_version_id`) REFERENCES `exam_result_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_job_status" CHECK("ai_jobs"."status" IN ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "ai_job_audience" CHECK("ai_jobs"."audience" IN ('parent', 'student')),
	CONSTRAINT "ai_job_attempt" CHECK(typeof("ai_jobs"."attempt_count") = 'integer' AND "ai_jobs"."attempt_count" >= 0),
	CONSTRAINT "ai_job_source" CHECK(typeof("ai_jobs"."source_version") = 'integer' AND "ai_jobs"."source_version" > 0),
	CONSTRAINT "ai_job_lease" CHECK(("ai_jobs"."lease_token_hash" IS NULL AND "ai_jobs"."lease_expires_at" IS NULL) OR ("ai_jobs"."lease_token_hash" IS NOT NULL AND length("ai_jobs"."lease_token_hash") = 64 AND "ai_jobs"."lease_token_hash" NOT GLOB '*[^0-9a-f]*' AND "ai_jobs"."lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_jobs_dedupe_key_unique` ON `ai_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `ai_jobs_queue` ON `ai_jobs` (`status`,`next_attempt_at`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `ai_jobs_student_version` ON `ai_jobs` (`student_id`,`exam_id`,`source_version`);--> statement-breakpoint
CREATE TABLE `ai_reference_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` text NOT NULL,
	`material_version` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `ai_reference_materials`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chunk_ordinal" CHECK(typeof("ai_reference_chunks"."ordinal") = 'integer' AND "ai_reference_chunks"."ordinal" >= 0),
	CONSTRAINT "chunk_hash" CHECK(length("ai_reference_chunks"."content_hash") = 64 AND "ai_reference_chunks"."content_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chunk_version" CHECK(typeof("ai_reference_chunks"."material_version") = 'integer' AND "ai_reference_chunks"."material_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chunk_material_ordinal` ON `ai_reference_chunks` (`material_id`,`material_version`,`ordinal`);--> statement-breakpoint
CREATE TABLE `ai_reference_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`object_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`subject` text,
	`grade` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_hash" CHECK(length("ai_reference_materials"."content_hash") = 64 AND "ai_reference_materials"."content_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "material_status" CHECK("ai_reference_materials"."status" IN ('draft', 'active', 'archived')),
	CONSTRAINT "material_grade" CHECK("ai_reference_materials"."grade" IN (7,8,9)),
	CONSTRAINT "material_dates" CHECK(("ai_reference_materials"."valid_from" IS NULL OR length("ai_reference_materials"."valid_from") = 10 AND "ai_reference_materials"."valid_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("ai_reference_materials"."valid_from", '+0 days') IS NOT NULL AND date("ai_reference_materials"."valid_from", '+0 days') = "ai_reference_materials"."valid_from") AND ("ai_reference_materials"."valid_to" IS NULL OR length("ai_reference_materials"."valid_to") = 10 AND "ai_reference_materials"."valid_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("ai_reference_materials"."valid_to", '+0 days') IS NOT NULL AND date("ai_reference_materials"."valid_to", '+0 days') = "ai_reference_materials"."valid_to") AND ("ai_reference_materials"."valid_from" IS NULL OR "ai_reference_materials"."valid_to" IS NULL OR "ai_reference_materials"."valid_to" > "ai_reference_materials"."valid_from")),
	CONSTRAINT "material_version" CHECK(typeof("ai_reference_materials"."version") = 'integer' AND "ai_reference_materials"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_reference_materials_object_key_unique` ON `ai_reference_materials` (`object_key`);--> statement-breakpoint
CREATE TABLE `archive_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`manifest_json` text NOT NULL,
	`undo_until` integer NOT NULL,
	`restored_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "archive_manifest" CHECK(json_valid("archive_batches"."manifest_json")),
	CONSTRAINT "archive_reason" CHECK(length(trim("archive_batches"."reason")) > 0),
	CONSTRAINT "archive_undo_window" CHECK("archive_batches"."undo_until" > "archive_batches"."created_at")
);
--> statement-breakpoint
CREATE TABLE `archive_items` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`student_id` text,
	`source_version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`status` text NOT NULL,
	`purge_eligible_on` text,
	`purged_at` integer,
	`error_code` text,
	FOREIGN KEY (`batch_id`) REFERENCES `archive_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "archive_snapshot" CHECK(json_valid("archive_items"."snapshot_json")),
	CONSTRAINT "archive_source_version" CHECK(typeof("archive_items"."source_version") = 'integer' AND "archive_items"."source_version" > 0),
	CONSTRAINT "archive_purge_date" CHECK("archive_items"."purge_eligible_on" IS NULL OR length("archive_items"."purge_eligible_on") = 10 AND "archive_items"."purge_eligible_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("archive_items"."purge_eligible_on", '+0 days') IS NOT NULL AND date("archive_items"."purge_eligible_on", '+0 days') = "archive_items"."purge_eligible_on")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `archive_item_unique` ON `archive_items` (`batch_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `archive_student` ON `archive_items` (`student_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`operation_id` text NOT NULL,
	`outcome` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`retention_until` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_metadata" CHECK(json_valid("audit_logs"."metadata_json")),
	CONSTRAINT "audit_retention_date" CHECK(length("audit_logs"."retention_until") = 10 AND "audit_logs"."retention_until" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("audit_logs"."retention_until", '+0 days') IS NOT NULL AND date("audit_logs"."retention_until", '+0 days') = "audit_logs"."retention_until")
);
--> statement-breakpoint
CREATE INDEX `audit_operation` ON `audit_logs` (`operation_id`);--> statement-breakpoint
CREATE INDEX `audit_retention` ON `audit_logs` (`retention_until`);--> statement-breakpoint
CREATE TABLE `bootstrap_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`initialized_by` text NOT NULL,
	`initialized_at` integer NOT NULL,
	FOREIGN KEY (`initialized_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bootstrap_singleton" CHECK("bootstrap_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`academic_year_id` text NOT NULL,
	`grade` integer NOT NULL,
	`code` text NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "class_grade_code" CHECK("classes"."grade" IN (7, 8, 9) AND length("classes"."code") = 3 AND "classes"."code" GLOB '[7-9][0-9][0-9]' AND substr("classes"."code", 1, 1) = CAST("classes"."grade" AS TEXT))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_code_unique` ON `classes` (`academic_year_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `class_year_unique` ON `classes` (`id`,`academic_year_id`);--> statement-breakpoint
CREATE TABLE `exam_participations` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`academic_term_id` text NOT NULL,
	`student_id` text NOT NULL,
	`enrollment_id` text,
	`class_id_snapshot` text,
	`class_code_snapshot` text,
	`grade_snapshot` integer,
	`seat_number_snapshot` integer,
	`origin` text DEFAULT 'LOCAL' NOT NULL,
	`external_school_label` text,
	`student_eligibility_snapshot` integer NOT NULL,
	`term_eligibility_snapshot` integer,
	`exam_eligibility_override` integer,
	`ranking_eligible` integer NOT NULL,
	`confirmed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id_snapshot`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exam_id`,`academic_term_id`) REFERENCES `exams`(`id`,`academic_term_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_id`,`student_id`,`academic_term_id`,`class_id_snapshot`) REFERENCES `student_enrollments`(`id`,`student_id`,`academic_term_id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "participation_flags" CHECK("exam_participations"."student_eligibility_snapshot" IN (0, 1) AND "exam_participations"."term_eligibility_snapshot" IN (0, 1) AND "exam_participations"."exam_eligibility_override" IN (0, 1) AND "exam_participations"."ranking_eligible" IN (0, 1)),
	CONSTRAINT "participation_source" CHECK(("exam_participations"."origin" = 'LOCAL' AND "exam_participations"."enrollment_id" IS NOT NULL AND "exam_participations"."class_id_snapshot" IS NOT NULL AND "exam_participations"."class_code_snapshot" IS NOT NULL AND "exam_participations"."grade_snapshot" IN (7,8,9) AND "exam_participations"."grade_snapshot" IS NOT NULL AND "exam_participations"."seat_number_snapshot" > 0 AND "exam_participations"."seat_number_snapshot" IS NOT NULL AND "exam_participations"."external_school_label" IS NULL AND "exam_participations"."ranking_eligible" = coalesce("exam_participations"."exam_eligibility_override", "exam_participations"."term_eligibility_snapshot", "exam_participations"."student_eligibility_snapshot")) OR ("exam_participations"."origin" = 'EXTERNAL_TRANSFER' AND "exam_participations"."ranking_eligible" = 0 AND "exam_participations"."enrollment_id" IS NULL AND "exam_participations"."class_id_snapshot" IS NULL AND "exam_participations"."class_code_snapshot" IS NULL AND "exam_participations"."grade_snapshot" IS NULL AND "exam_participations"."seat_number_snapshot" IS NULL AND "exam_participations"."external_school_label" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participation_unique` ON `exam_participations` (`exam_id`,`student_id`,`origin`);--> statement-breakpoint
CREATE UNIQUE INDEX `participation_score_parent` ON `exam_participations` (`id`,`exam_id`,`student_id`,`origin`);--> statement-breakpoint
CREATE INDEX `participation_class_lookup` ON `exam_participations` (`exam_id`,`class_id_snapshot`);--> statement-breakpoint
CREATE TABLE `exam_result_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source_version` integer NOT NULL,
	`calculation_version` text NOT NULL,
	`provisional` integer NOT NULL,
	`published_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "result_version_number" CHECK(typeof("exam_result_versions"."version") = 'integer' AND "exam_result_versions"."version" > 0 AND typeof("exam_result_versions"."source_version") = 'integer' AND "exam_result_versions"."source_version" > 0),
	CONSTRAINT "result_provisional" CHECK("exam_result_versions"."provisional" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_result_version_unique` ON `exam_result_versions` (`exam_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `result_version_exam_parent` ON `exam_result_versions` (`id`,`exam_id`);--> statement-breakpoint
CREATE TABLE `exam_results` (
	`id` text PRIMARY KEY NOT NULL,
	`result_version_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`participation_id` text NOT NULL,
	`average_hundredths` integer,
	`total_hundredths` integer,
	`class_rank` integer,
	`grade_rank` integer,
	`computed_json` text NOT NULL,
	FOREIGN KEY (`participation_id`) REFERENCES `exam_participations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`result_version_id`,`exam_id`) REFERENCES `exam_result_versions`(`id`,`exam_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "result_json" CHECK(json_valid("exam_results"."computed_json")),
	CONSTRAINT "result_numbers" CHECK(("exam_results"."average_hundredths" IS NULL OR (typeof("exam_results"."average_hundredths") = 'integer' AND "exam_results"."average_hundredths" BETWEEN 0 AND 10000)) AND ("exam_results"."total_hundredths" IS NULL OR (typeof("exam_results"."total_hundredths") = 'integer' AND "exam_results"."total_hundredths" >= 0)) AND ("exam_results"."class_rank" IS NULL OR typeof("exam_results"."class_rank") = 'integer' AND "exam_results"."class_rank" > 0) AND ("exam_results"."grade_rank" IS NULL OR typeof("exam_results"."grade_rank") = 'integer' AND "exam_results"."grade_rank" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_participation_unique` ON `exam_results` (`result_version_id`,`participation_id`);--> statement-breakpoint
CREATE TABLE `exam_subject_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`exam_type` text NOT NULL,
	`subject` text NOT NULL,
	`held` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exam_subject_types" CHECK(("exam_subject_settings"."exam_type" = 'QUIZ' AND "exam_subject_settings"."subject" IN ('CHINESE', 'ENGLISH', 'MATH')) OR ("exam_subject_settings"."exam_type" = 'MIDTERM' AND "exam_subject_settings"."subject" IN ('CHINESE', 'ENGLISH', 'MATH', 'SCIENCE', 'GEOGRAPHY', 'HISTORY', 'CIVICS'))),
	CONSTRAINT "exam_held" CHECK("exam_subject_settings"."held" IN (0, 1)),
	CONSTRAINT "setting_version" CHECK(typeof("exam_subject_settings"."version") = 'integer' AND "exam_subject_settings"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_subject_unique` ON `exam_subject_settings` (`exam_id`,`exam_type`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `exam_setting_parent` ON `exam_subject_settings` (`id`,`exam_id`,`exam_type`,`subject`);--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`academic_term_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`published_at` integer,
	`locked_at` integer,
	`archived_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`academic_term_id`) REFERENCES `academic_terms`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exam_sequence" CHECK("exams"."sequence" IN (1, 2, 3)),
	CONSTRAINT "exam_dates" CHECK(length("exams"."starts_on") = 10 AND "exams"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("exams"."starts_on", '+0 days') IS NOT NULL AND date("exams"."starts_on", '+0 days') = "exams"."starts_on" AND length("exams"."ends_on") = 10 AND "exams"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("exams"."ends_on", '+0 days') IS NOT NULL AND date("exams"."ends_on", '+0 days') = "exams"."ends_on" AND "exams"."ends_on" > "exams"."starts_on"),
	CONSTRAINT "exam_version" CHECK(typeof("exams"."version") = 'integer' AND "exams"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_term_sequence_unique` ON `exams` (`academic_term_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `exam_term_unique` ON `exams` (`id`,`academic_term_id`);--> statement-breakpoint
CREATE TABLE `import_job_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`student_id` text,
	`status` text NOT NULL,
	`source_version` integer,
	`committed_version` integer,
	`before_json` text,
	`after_json` text,
	`error_code` text,
	FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_row_number" CHECK(typeof("import_job_items"."row_number") = 'integer' AND "import_job_items"."row_number" > 0),
	CONSTRAINT "import_item_snapshots" CHECK(json_valid("import_job_items"."before_json") AND json_valid("import_job_items"."after_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_unique` ON `import_job_items` (`job_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `import_item_student` ON `import_job_items` (`student_id`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`object_key` text NOT NULL,
	`file_hash` text NOT NULL,
	`mapping_json` text,
	`preview_version` integer DEFAULT 1 NOT NULL,
	`confirmed_at` integer,
	`committed_at` integer,
	`rollback_until` integer,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_file_hash" CHECK(length("import_jobs"."file_hash") = 64 AND "import_jobs"."file_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "import_mapping" CHECK(json_valid("import_jobs"."mapping_json")),
	CONSTRAINT "import_preview_version" CHECK(typeof("import_jobs"."preview_version") = 'integer' AND "import_jobs"."preview_version" > 0),
	CONSTRAINT "import_rollback_window" CHECK("import_jobs"."rollback_until" IS NULL OR ("import_jobs"."committed_at" IS NOT NULL AND "import_jobs"."rollback_until" > "import_jobs"."committed_at"))
);
--> statement-breakpoint
CREATE INDEX `import_actor_created` ON `import_jobs` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `score_change_history` (
	`id` text PRIMARY KEY NOT NULL,
	`score_item_id` text NOT NULL,
	`student_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`from_version` integer NOT NULL,
	`to_version` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`score_item_id`) REFERENCES `score_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "score_history_values" CHECK(json_valid("score_change_history"."before_json") AND json_valid("score_change_history"."after_json") AND length(trim("score_change_history"."reason")) > 0 AND "score_change_history"."to_version" = "score_change_history"."from_version" + 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_history_version` ON `score_change_history` (`score_item_id`,`to_version`);--> statement-breakpoint
CREATE INDEX `score_history_student` ON `score_change_history` (`student_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `score_items` (
	`id` text PRIMARY KEY NOT NULL,
	`participation_id` text NOT NULL,
	`setting_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`student_id` text NOT NULL,
	`exam_type` text NOT NULL,
	`subject` text NOT NULL,
	`origin` text NOT NULL,
	`class_id_snapshot` text,
	`score_value` integer,
	`score_status` text DEFAULT 'UNENTERED' NOT NULL,
	`include_in_average` integer DEFAULT 0 NOT NULL,
	`include_in_ranking` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`class_id_snapshot`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participation_id`,`exam_id`,`student_id`,`origin`) REFERENCES `exam_participations`(`id`,`exam_id`,`student_id`,`origin`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`setting_id`,`exam_id`,`exam_type`,`subject`) REFERENCES `exam_subject_settings`(`id`,`exam_id`,`exam_type`,`subject`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "score_value_status" CHECK(("score_items"."score_status" = 'NORMAL' AND "score_items"."score_value" IS NOT NULL AND typeof("score_items"."score_value") = 'integer' AND "score_items"."score_value" BETWEEN 0 AND 10000 AND "score_items"."include_in_average" = 1) OR ("score_items"."score_status" IN ('UNENTERED', 'ABSENT', 'OFFICIAL_LEAVE', 'SICK_LEAVE', 'EXEMPT', 'NOT_HELD') AND "score_items"."score_value" IS NULL AND "score_items"."include_in_average" = 0)),
	CONSTRAINT "score_ranking_flag" CHECK("score_items"."include_in_ranking" IN (0, 1)),
	CONSTRAINT "score_origin_ranking" CHECK("score_items"."origin" <> 'EXTERNAL_TRANSFER' OR "score_items"."include_in_ranking" = 0),
	CONSTRAINT "score_version" CHECK(typeof("score_items"."version") = 'integer' AND "score_items"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_participation_setting_unique` ON `score_items` (`participation_id`,`setting_id`);--> statement-breakpoint
CREATE INDEX `scores_exam_class` ON `score_items` (`exam_id`,`class_id_snapshot`,`exam_type`);--> statement-breakpoint
CREATE TABLE `student_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`academic_year_id` text NOT NULL,
	`academic_term_id` text NOT NULL,
	`class_id` text NOT NULL,
	`seat_number` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`status` text DEFAULT 'valid' NOT NULL,
	`ranking_eligible` integer,
	`change_source` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academic_term_id`,`academic_year_id`) REFERENCES `academic_terms`(`id`,`academic_year_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`,`academic_year_id`) REFERENCES `classes`(`id`,`academic_year_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "enrollment_dates" CHECK(length("student_enrollments"."effective_from") = 10 AND "student_enrollments"."effective_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("student_enrollments"."effective_from", '+0 days') IS NOT NULL AND date("student_enrollments"."effective_from", '+0 days') = "student_enrollments"."effective_from" AND ("student_enrollments"."effective_to" IS NULL OR (length("student_enrollments"."effective_to") = 10 AND "student_enrollments"."effective_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("student_enrollments"."effective_to", '+0 days') IS NOT NULL AND date("student_enrollments"."effective_to", '+0 days') = "student_enrollments"."effective_to" AND "student_enrollments"."effective_to" > "student_enrollments"."effective_from"))),
	CONSTRAINT "enrollment_seat" CHECK(typeof("student_enrollments"."seat_number") = 'integer' AND "student_enrollments"."seat_number" > 0),
	CONSTRAINT "enrollment_status" CHECK("student_enrollments"."status" IN ('valid', 'voided')),
	CONSTRAINT "enrollment_ranking" CHECK("student_enrollments"."ranking_eligible" IN (0, 1)),
	CONSTRAINT "enrollment_version" CHECK(typeof("student_enrollments"."version") = 'integer' AND "student_enrollments"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollment_snapshot_parent` ON `student_enrollments` (`id`,`student_id`,`academic_term_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `enrollment_student_period` ON `student_enrollments` (`student_id`,`effective_from`,`effective_to`);--> statement-breakpoint
CREATE INDEX `enrollment_seat_period` ON `student_enrollments` (`class_id`,`seat_number`,`effective_from`);--> statement-breakpoint
CREATE TABLE `student_identity_lookup_hashes` (
	`student_id` text NOT NULL,
	`key_version` integer NOT NULL,
	`identity_number_lookup_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "identity_hash_format" CHECK(length("student_identity_lookup_hashes"."identity_number_lookup_hash") = 64 AND "student_identity_lookup_hashes"."identity_number_lookup_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "identity_hash_version" CHECK(typeof("student_identity_lookup_hashes"."key_version") = 'integer' AND "student_identity_lookup_hashes"."key_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_student_version_unique` ON `student_identity_lookup_hashes` (`student_id`,`key_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `identity_hash_version_unique` ON `student_identity_lookup_hashes` (`key_version`,`identity_number_lookup_hash`);--> statement-breakpoint
CREATE TABLE `student_term_ranking_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`academic_term_id` text NOT NULL,
	`ranking_eligible` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academic_term_id`) REFERENCES `academic_terms`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "term_ranking_flag" CHECK("student_term_ranking_policies"."ranking_eligible" IN (0, 1)),
	CONSTRAINT "term_policy_version" CHECK(typeof("student_term_ranking_policies"."version") = 'integer' AND "student_term_ranking_policies"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_term_policy_unique` ON `student_term_ranking_policies` (`student_id`,`academic_term_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`student_number` text NOT NULL,
	`name` text NOT NULL,
	`birth_date` text NOT NULL,
	`identity_number_encrypted` text NOT NULL,
	`identity_encryption_key_version` integer NOT NULL,
	`ranking_eligible_default` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`transferred_out_on` text,
	`graduated_on` text,
	`retention_until` text,
	`public_query_until` text,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "student_birth_date" CHECK(length("students"."birth_date") = 10 AND "students"."birth_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("students"."birth_date", '+0 days') IS NOT NULL AND date("students"."birth_date", '+0 days') = "students"."birth_date"),
	CONSTRAINT "student_ranking_default" CHECK("students"."ranking_eligible_default" IN (0, 1)),
	CONSTRAINT "student_status" CHECK("students"."status" IN ('active', 'transferred_out', 'graduated')),
	CONSTRAINT "student_ciphertext" CHECK(json_valid("students"."identity_number_encrypted") AND json_extract("students"."identity_number_encrypted", '$.algorithm') IS 'AES-256-GCM' AND json_type("students"."identity_number_encrypted", '$.iv') IS 'text' AND json_type("students"."identity_number_encrypted", '$.ciphertext') IS 'text'),
	CONSTRAINT "student_key_version" CHECK(typeof("students"."identity_encryption_key_version") = 'integer' AND "students"."identity_encryption_key_version" > 0),
	CONSTRAINT "student_version" CHECK(typeof("students"."version") = 'integer' AND "students"."version" > 0),
	CONSTRAINT "student_retention_dates" CHECK(("students"."retention_until" IS NULL OR length("students"."retention_until") = 10 AND "students"."retention_until" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("students"."retention_until", '+0 days') IS NOT NULL AND date("students"."retention_until", '+0 days') = "students"."retention_until") AND ("students"."public_query_until" IS NULL OR (length("students"."public_query_until") = 10 AND "students"."public_query_until" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("students"."public_query_until", '+0 days') IS NOT NULL AND date("students"."public_query_until", '+0 days') = "students"."public_query_until" AND "students"."retention_until" IS NOT NULL AND "students"."public_query_until" <= "students"."retention_until")) AND ("students"."transferred_out_on" IS NULL OR length("students"."transferred_out_on") = 10 AND "students"."transferred_out_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("students"."transferred_out_on", '+0 days') IS NOT NULL AND date("students"."transferred_out_on", '+0 days') = "students"."transferred_out_on") AND ("students"."graduated_on" IS NULL OR length("students"."graduated_on") = 10 AND "students"."graduated_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("students"."graduated_on", '+0 days') IS NOT NULL AND date("students"."graduated_on", '+0 days') = "students"."graduated_on"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_student_number_unique` ON `students` (`student_number`);--> statement-breakpoint
CREATE INDEX `student_public_lookup` ON `students` (`name`,`birth_date`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settings_key_allowlist" CHECK("system_settings"."key" IN ('ai_provider', 'ai_model', 'ai_prompt', 'rag_config')),
	CONSTRAINT "settings_json" CHECK(json_valid("system_settings"."value_json")),
	CONSTRAINT "settings_version" CHECK(typeof("system_settings"."version") = 'integer' AND "system_settings"."version" > 0)
);
