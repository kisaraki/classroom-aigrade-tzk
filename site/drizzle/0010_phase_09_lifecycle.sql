CREATE TABLE `lifecycle_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`academic_revision` integer NOT NULL,
	`archive_revision` integer NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purge_control` (
	`id` integer PRIMARY KEY NOT NULL,
	`executing_job` text
);
--> statement-breakpoint
CREATE TABLE `purge_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`manifest_json` text,
	`student_count` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`retention_until` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purged_exams` (
	`exam_id` text PRIMARY KEY NOT NULL,
	`frozen_at` integer NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recycle_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`actor_id` text,
	`reason` text NOT NULL,
	`deleted_at` integer NOT NULL,
	`restore_until` integer NOT NULL,
	`source_version` integer NOT NULL,
	`enrollment_json` text,
	`restored_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO purge_control (id,executing_job) VALUES (1,NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX purge_one_active ON purge_jobs ((1)) WHERE status<>'DONE';
--> statement-breakpoint
CREATE TRIGGER purge_job_guard_insert BEFORE INSERT ON purge_jobs WHEN NEW.status<>'RUNNING' OR NEW.manifest_json IS NULL OR NOT json_valid(NEW.manifest_json) OR NEW.student_count<=0 BEGIN SELECT RAISE(ABORT,'INVALID_PURGE_JOB'); END;
--> statement-breakpoint
CREATE TRIGGER purge_job_guard_update BEFORE UPDATE ON purge_jobs WHEN NEW.status NOT IN ('RUNNING','PARTIAL','DONE') OR (NEW.status='DONE')<>(NEW.manifest_json IS NULL) OR (NEW.status='DONE' AND NEW.completed_at IS NULL) OR OLD.status='DONE' BEGIN SELECT RAISE(ABORT,'INVALID_PURGE_STATE'); END;
--> statement-breakpoint
CREATE TRIGGER recycle_entry_guard BEFORE INSERT ON recycle_entries WHEN NEW.restore_until<>NEW.deleted_at+2592000000 OR NEW.source_version<=0 OR length(trim(NEW.reason))=0 OR (NEW.enrollment_json IS NOT NULL AND NOT json_valid(NEW.enrollment_json)) BEGIN SELECT RAISE(ABORT,'INVALID_RECYCLE_ENTRY'); END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_preview_immutable BEFORE UPDATE ON lifecycle_previews WHEN NEW.id IS NOT OLD.id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.kind IS NOT OLD.kind OR NEW.academic_revision IS NOT OLD.academic_revision OR NEW.archive_revision IS NOT OLD.archive_revision OR NEW.payload_json IS NOT OLD.payload_json OR NEW.created_at IS NOT OLD.created_at OR OLD.result_json IS NOT NULL OR NEW.result_json IS NULL BEGIN SELECT RAISE(ABORT,'LIFECYCLE_PREVIEW_IMMUTABLE'); END;
--> statement-breakpoint
INSERT INTO recycle_entries (id,student_id,actor_id,reason,deleted_at,restore_until,source_version)
SELECT 'legacy-'||id,id,NULL,'Migrated soft deletion',deleted_at,deleted_at+2592000000,version FROM students WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER students_purge_lock_insert BEFORE INSERT ON students WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER students_purge_lock_update BEFORE UPDATE ON students WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER students_purge_lock_delete BEFORE DELETE ON students WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER student_identity_lookup_hashes_purge_lock_insert BEFORE INSERT ON student_identity_lookup_hashes WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER student_identity_lookup_hashes_purge_lock_update BEFORE UPDATE ON student_identity_lookup_hashes WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER student_identity_lookup_hashes_purge_lock_delete BEFORE DELETE ON student_identity_lookup_hashes WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER student_term_ranking_policies_purge_lock_insert BEFORE INSERT ON student_term_ranking_policies WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER student_term_ranking_policies_purge_lock_update BEFORE UPDATE ON student_term_ranking_policies WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER student_term_ranking_policies_purge_lock_delete BEFORE DELETE ON student_term_ranking_policies WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER student_enrollments_purge_lock_insert BEFORE INSERT ON student_enrollments WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER student_enrollments_purge_lock_update BEFORE UPDATE ON student_enrollments WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER student_enrollments_purge_lock_delete BEFORE DELETE ON student_enrollments WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_participations_purge_lock_insert BEFORE INSERT ON exam_participations WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_participations_purge_lock_update BEFORE UPDATE ON exam_participations WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_participations_purge_lock_delete BEFORE DELETE ON exam_participations WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER score_items_purge_lock_insert BEFORE INSERT ON score_items WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER score_items_purge_lock_update BEFORE UPDATE ON score_items WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER score_items_purge_lock_delete BEFORE DELETE ON score_items WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER score_change_history_purge_lock_insert BEFORE INSERT ON score_change_history WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER score_change_history_purge_lock_update BEFORE UPDATE ON score_change_history WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER score_change_history_purge_lock_delete BEFORE DELETE ON score_change_history WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_results_purge_lock_insert BEFORE INSERT ON exam_results WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_results_purge_lock_update BEFORE UPDATE ON exam_results WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_results_purge_lock_delete BEFORE DELETE ON exam_results WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_result_versions_purge_lock_insert BEFORE INSERT ON exam_result_versions WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_result_versions_purge_lock_update BEFORE UPDATE ON exam_result_versions WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_result_versions_purge_lock_delete BEFORE DELETE ON exam_result_versions WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exams_purge_lock_insert BEFORE INSERT ON exams WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exams_purge_lock_update BEFORE UPDATE ON exams WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exams_purge_lock_delete BEFORE DELETE ON exams WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_subject_settings_purge_lock_insert BEFORE INSERT ON exam_subject_settings WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_subject_settings_purge_lock_update BEFORE UPDATE ON exam_subject_settings WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_subject_settings_purge_lock_delete BEFORE DELETE ON exam_subject_settings WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER classes_purge_lock_insert BEFORE INSERT ON classes WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER classes_purge_lock_update BEFORE UPDATE ON classes WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER classes_purge_lock_delete BEFORE DELETE ON classes WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_years_purge_lock_insert BEFORE INSERT ON academic_years WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_years_purge_lock_update BEFORE UPDATE ON academic_years WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_years_purge_lock_delete BEFORE DELETE ON academic_years WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_terms_purge_lock_insert BEFORE INSERT ON academic_terms WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_terms_purge_lock_update BEFORE UPDATE ON academic_terms WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_terms_purge_lock_delete BEFORE DELETE ON academic_terms WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_jobs_purge_lock_insert BEFORE INSERT ON ai_jobs WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_jobs_purge_lock_update BEFORE UPDATE ON ai_jobs WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_jobs_purge_lock_delete BEFORE DELETE ON ai_jobs WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_advices_purge_lock_insert BEFORE INSERT ON ai_advices WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_advices_purge_lock_update BEFORE UPDATE ON ai_advices WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_advices_purge_lock_delete BEFORE DELETE ON ai_advices WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_advice_references_purge_lock_insert BEFORE INSERT ON ai_advice_references WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_advice_references_purge_lock_update BEFORE UPDATE ON ai_advice_references WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_advice_references_purge_lock_delete BEFORE DELETE ON ai_advice_references WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_reference_materials_purge_lock_insert BEFORE INSERT ON ai_reference_materials WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_reference_materials_purge_lock_update BEFORE UPDATE ON ai_reference_materials WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_reference_materials_purge_lock_delete BEFORE DELETE ON ai_reference_materials WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_reference_chunks_purge_lock_insert BEFORE INSERT ON ai_reference_chunks WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_reference_chunks_purge_lock_update BEFORE UPDATE ON ai_reference_chunks WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER ai_reference_chunks_purge_lock_delete BEFORE DELETE ON ai_reference_chunks WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER import_jobs_purge_lock_insert BEFORE INSERT ON import_jobs WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER import_jobs_purge_lock_update BEFORE UPDATE ON import_jobs WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER import_jobs_purge_lock_delete BEFORE DELETE ON import_jobs WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER import_job_items_purge_lock_insert BEFORE INSERT ON import_job_items WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER import_job_items_purge_lock_update BEFORE UPDATE ON import_job_items WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER import_job_items_purge_lock_delete BEFORE DELETE ON import_job_items WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER archive_batches_purge_lock_insert BEFORE INSERT ON archive_batches WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER archive_batches_purge_lock_update BEFORE UPDATE ON archive_batches WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER archive_batches_purge_lock_delete BEFORE DELETE ON archive_batches WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER archive_items_purge_lock_insert BEFORE INSERT ON archive_items WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER archive_items_purge_lock_update BEFORE UPDATE ON archive_items WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER archive_items_purge_lock_delete BEFORE DELETE ON archive_items WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER retention_events_purge_lock_insert BEFORE INSERT ON retention_events WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER retention_events_purge_lock_update BEFORE UPDATE ON retention_events WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER retention_events_purge_lock_delete BEFORE DELETE ON retention_events WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER recycle_entries_purge_lock_insert BEFORE INSERT ON recycle_entries WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER recycle_entries_purge_lock_update BEFORE UPDATE ON recycle_entries WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER recycle_entries_purge_lock_delete BEFORE DELETE ON recycle_entries WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_operations_purge_lock_insert BEFORE INSERT ON academic_operations WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_operations_purge_lock_update BEFORE UPDATE ON academic_operations WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_operations_purge_lock_delete BEFORE DELETE ON academic_operations WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_operation_students_purge_lock_insert BEFORE INSERT ON academic_operation_students WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_operation_students_purge_lock_update BEFORE UPDATE ON academic_operation_students WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_operation_students_purge_lock_delete BEFORE DELETE ON academic_operation_students WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_previews_purge_lock_insert BEFORE INSERT ON academic_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_previews_purge_lock_update BEFORE UPDATE ON academic_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER academic_previews_purge_lock_delete BEFORE DELETE ON academic_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_operations_purge_lock_insert BEFORE INSERT ON exam_operations WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_operations_purge_lock_update BEFORE UPDATE ON exam_operations WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_operations_purge_lock_delete BEFORE DELETE ON exam_operations WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_roster_previews_purge_lock_insert BEFORE INSERT ON exam_roster_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_roster_previews_purge_lock_update BEFORE UPDATE ON exam_roster_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER exam_roster_previews_purge_lock_delete BEFORE DELETE ON exam_roster_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER publication_previews_purge_lock_insert BEFORE INSERT ON publication_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER publication_previews_purge_lock_update BEFORE UPDATE ON publication_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER publication_previews_purge_lock_delete BEFORE DELETE ON publication_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER publication_snapshots_purge_lock_insert BEFORE INSERT ON publication_snapshots WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER publication_snapshots_purge_lock_update BEFORE UPDATE ON publication_snapshots WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER publication_snapshots_purge_lock_delete BEFORE DELETE ON publication_snapshots WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER archive_previews_purge_lock_insert BEFORE INSERT ON archive_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER archive_previews_purge_lock_update BEFORE UPDATE ON archive_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER archive_previews_purge_lock_delete BEFORE DELETE ON archive_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER lifecycle_previews_purge_lock_insert BEFORE INSERT ON lifecycle_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER lifecycle_previews_purge_lock_update BEFORE UPDATE ON lifecycle_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER lifecycle_previews_purge_lock_delete BEFORE DELETE ON lifecycle_previews WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE' AND id IS NOT (SELECT executing_job FROM purge_control WHERE id=1)) BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER recycle_entries_lifecycle_revision_insert AFTER INSERT ON recycle_entries BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER recycle_entries_lifecycle_revision_update AFTER UPDATE ON recycle_entries BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER recycle_entries_lifecycle_revision_delete AFTER DELETE ON recycle_entries BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER academic_operations_lifecycle_revision_insert AFTER INSERT ON academic_operations BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER academic_operations_lifecycle_revision_update AFTER UPDATE ON academic_operations BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER academic_operations_lifecycle_revision_delete AFTER DELETE ON academic_operations BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER academic_previews_lifecycle_revision_insert AFTER INSERT ON academic_previews BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER academic_previews_lifecycle_revision_update AFTER UPDATE ON academic_previews BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER academic_previews_lifecycle_revision_delete AFTER DELETE ON academic_previews BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER exam_operations_lifecycle_revision_insert AFTER INSERT ON exam_operations BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER exam_operations_lifecycle_revision_update AFTER UPDATE ON exam_operations BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER exam_operations_lifecycle_revision_delete AFTER DELETE ON exam_operations BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER exam_roster_previews_lifecycle_revision_insert AFTER INSERT ON exam_roster_previews BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER exam_roster_previews_lifecycle_revision_update AFTER UPDATE ON exam_roster_previews BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER exam_roster_previews_lifecycle_revision_delete AFTER DELETE ON exam_roster_previews BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER publication_previews_lifecycle_revision_insert AFTER INSERT ON publication_previews BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER publication_previews_lifecycle_revision_update AFTER UPDATE ON publication_previews BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER publication_previews_lifecycle_revision_delete AFTER DELETE ON publication_previews BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER publication_snapshots_lifecycle_revision_insert AFTER INSERT ON publication_snapshots BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER publication_snapshots_lifecycle_revision_update AFTER UPDATE ON publication_snapshots BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER publication_snapshots_lifecycle_revision_delete AFTER DELETE ON publication_snapshots BEGIN UPDATE archive_state SET revision=revision+1 WHERE id=1; END;

--> statement-breakpoint
CREATE TRIGGER score_items_frozen_insert BEFORE INSERT ON score_items WHEN EXISTS(SELECT 1 FROM purged_exams WHERE exam_id=NEW.exam_id) BEGIN SELECT RAISE(ABORT,'PURGED_EXAM_FROZEN'); END;

--> statement-breakpoint
CREATE TRIGGER score_items_frozen_update BEFORE UPDATE ON score_items WHEN EXISTS(SELECT 1 FROM purged_exams WHERE exam_id=NEW.exam_id) BEGIN SELECT RAISE(ABORT,'PURGED_EXAM_FROZEN'); END;

--> statement-breakpoint
CREATE TRIGGER exam_participations_frozen_insert BEFORE INSERT ON exam_participations WHEN EXISTS(SELECT 1 FROM purged_exams WHERE exam_id=NEW.exam_id) BEGIN SELECT RAISE(ABORT,'PURGED_EXAM_FROZEN'); END;

--> statement-breakpoint
CREATE TRIGGER exam_participations_frozen_update BEFORE UPDATE ON exam_participations WHEN EXISTS(SELECT 1 FROM purged_exams WHERE exam_id=NEW.exam_id) BEGIN SELECT RAISE(ABORT,'PURGED_EXAM_FROZEN'); END;

--> statement-breakpoint
CREATE TRIGGER exam_subject_settings_frozen_insert BEFORE INSERT ON exam_subject_settings WHEN EXISTS(SELECT 1 FROM purged_exams WHERE exam_id=NEW.exam_id) BEGIN SELECT RAISE(ABORT,'PURGED_EXAM_FROZEN'); END;

--> statement-breakpoint
CREATE TRIGGER exam_subject_settings_frozen_update BEFORE UPDATE ON exam_subject_settings WHEN EXISTS(SELECT 1 FROM purged_exams WHERE exam_id=NEW.exam_id) BEGIN SELECT RAISE(ABORT,'PURGED_EXAM_FROZEN'); END;

--> statement-breakpoint
CREATE TRIGGER exam_result_versions_frozen_insert BEFORE INSERT ON exam_result_versions WHEN EXISTS(SELECT 1 FROM purged_exams WHERE exam_id=NEW.exam_id) BEGIN SELECT RAISE(ABORT,'PURGED_EXAM_FROZEN'); END;

--> statement-breakpoint
CREATE TRIGGER exam_result_versions_frozen_update BEFORE UPDATE ON exam_result_versions WHEN EXISTS(SELECT 1 FROM purged_exams WHERE exam_id=NEW.exam_id) BEGIN SELECT RAISE(ABORT,'PURGED_EXAM_FROZEN'); END;

--> statement-breakpoint
UPDATE recycle_entries SET enrollment_json=(
 SELECT json_object('id',e.id,'version',1)
 FROM import_job_items i JOIN import_jobs j ON j.id=i.job_id
 JOIN student_enrollments e ON e.id=json_extract(i.after_json,'$.enrollmentId')
 JOIN students s ON s.id=i.student_id
 WHERE i.student_id=recycle_entries.student_id AND j.status='ROLLED_BACK' AND j.kind='NEW_STUDENTS'
 AND s.version=i.committed_version+1 AND e.status='voided' AND e.version=2
 LIMIT 1
) WHERE id LIKE 'legacy-%';