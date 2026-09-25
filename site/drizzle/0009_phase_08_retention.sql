CREATE TABLE `archive_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`academic_revision` integer NOT NULL,
	`archive_revision` integer NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "archive_preview_json" CHECK(json_valid("archive_previews"."payload_json") AND json_valid("archive_previews"."result_json"))
);
--> statement-breakpoint
CREATE INDEX `archive_preview_actor` ON `archive_previews` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `archive_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "archive_state_singleton" CHECK("archive_state"."id"=1 AND "archive_state"."revision">=0)
);
--> statement-breakpoint
CREATE TABLE `retention_events` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`kind` text NOT NULL,
	`effective_on` text NOT NULL,
	`public_until` text NOT NULL,
	`retention_until` text NOT NULL,
	`actor_id` text,
	`reason` text NOT NULL,
	`revoked_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "retention_event_dates" CHECK(length("retention_events"."effective_on") = 10 AND "retention_events"."effective_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("retention_events"."effective_on", '+0 days') IS NOT NULL AND date("retention_events"."effective_on", '+0 days') = "retention_events"."effective_on" AND length("retention_events"."public_until") = 10 AND "retention_events"."public_until" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("retention_events"."public_until", '+0 days') IS NOT NULL AND date("retention_events"."public_until", '+0 days') = "retention_events"."public_until" AND length("retention_events"."retention_until") = 10 AND "retention_events"."retention_until" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date("retention_events"."retention_until", '+0 days') IS NOT NULL AND date("retention_events"."retention_until", '+0 days') = "retention_events"."retention_until" AND "retention_events"."public_until" <= "retention_events"."retention_until"),
	CONSTRAINT "retention_event_kind" CHECK("retention_events"."kind" IN ('TRANSFER_OUT','GRADUATION','EXTENSION','LEGACY')),
	CONSTRAINT "retention_event_version" CHECK(typeof("retention_events"."version") = 'integer' AND "retention_events"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `retention_student` ON `retention_events` (`student_id`);--> statement-breakpoint
ALTER TABLE `students` ADD `archived_at` integer;--> statement-breakpoint
INSERT INTO archive_state (id,revision) VALUES (1,0);
--> statement-breakpoint
INSERT INTO retention_events (id,student_id,kind,effective_on,public_until,retention_until,reason,created_at)
SELECT 'legacy-'||id,id,'LEGACY',COALESCE(transferred_out_on,graduated_on,birth_date),COALESCE(public_query_until,retention_until),retention_until,'Migrated existing retention promise',updated_at FROM students WHERE retention_until IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER archive_preview_immutable BEFORE UPDATE ON archive_previews
WHEN NEW.id IS NOT OLD.id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.academic_revision IS NOT OLD.academic_revision OR NEW.archive_revision IS NOT OLD.archive_revision OR NEW.payload_json IS NOT OLD.payload_json OR NEW.created_at IS NOT OLD.created_at OR OLD.result_json IS NOT NULL OR NEW.result_json IS NULL
BEGIN SELECT RAISE(ABORT,'ARCHIVE_PREVIEW_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER retention_event_immutable BEFORE UPDATE ON retention_events
WHEN NEW.id IS NOT OLD.id OR NEW.student_id IS NOT OLD.student_id OR NEW.kind IS NOT OLD.kind OR NEW.effective_on IS NOT OLD.effective_on OR NEW.public_until IS NOT OLD.public_until OR NEW.retention_until IS NOT OLD.retention_until OR NEW.actor_id IS NOT OLD.actor_id OR NEW.reason IS NOT OLD.reason OR NEW.created_at IS NOT OLD.created_at OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'RETENTION_EVENT_IMMUTABLE'); END;

--> statement-breakpoint
CREATE TRIGGER score_items_archive_revision_insert AFTER INSERT ON score_items BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER score_items_archive_revision_update AFTER UPDATE ON score_items BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER score_items_archive_revision_delete AFTER DELETE ON score_items BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER ai_jobs_archive_revision_insert AFTER INSERT ON ai_jobs BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER ai_jobs_archive_revision_update AFTER UPDATE ON ai_jobs BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER ai_jobs_archive_revision_delete AFTER DELETE ON ai_jobs BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER ai_advices_archive_revision_insert AFTER INSERT ON ai_advices BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER ai_advices_archive_revision_update AFTER UPDATE ON ai_advices BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER ai_advices_archive_revision_delete AFTER DELETE ON ai_advices BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER import_jobs_archive_revision_insert AFTER INSERT ON import_jobs BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER import_jobs_archive_revision_update AFTER UPDATE ON import_jobs BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER import_jobs_archive_revision_delete AFTER DELETE ON import_jobs BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER import_job_items_archive_revision_insert AFTER INSERT ON import_job_items BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER import_job_items_archive_revision_update AFTER UPDATE ON import_job_items BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER import_job_items_archive_revision_delete AFTER DELETE ON import_job_items BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER archive_batches_archive_revision_insert AFTER INSERT ON archive_batches BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER archive_batches_archive_revision_update AFTER UPDATE ON archive_batches BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER archive_batches_archive_revision_delete AFTER DELETE ON archive_batches BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER archive_items_archive_revision_insert AFTER INSERT ON archive_items BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER archive_items_archive_revision_update AFTER UPDATE ON archive_items BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER archive_items_archive_revision_delete AFTER DELETE ON archive_items BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER retention_events_archive_revision_insert AFTER INSERT ON retention_events BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER retention_events_archive_revision_update AFTER UPDATE ON retention_events BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER retention_events_archive_revision_delete AFTER DELETE ON retention_events BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;
