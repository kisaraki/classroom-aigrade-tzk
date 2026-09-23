-- Phase 2 preview freshness, durable receipts and session revalidation.
INSERT INTO academic_state (id, current_year_id, revision) VALUES (1, (SELECT id FROM academic_years ORDER BY created_at DESC, starts_on DESC, id DESC LIMIT 1), 0);
--> statement-breakpoint
CREATE TRIGGER academic_years_academic_revision_insert AFTER INSERT ON academic_years
BEGIN
  UPDATE academic_state SET revision = revision + 1, current_year_id = NEW.id WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER academic_years_academic_revision_update AFTER UPDATE ON academic_years
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER academic_years_academic_revision_delete AFTER DELETE ON academic_years
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER academic_terms_academic_revision_insert AFTER INSERT ON academic_terms
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER academic_terms_academic_revision_update AFTER UPDATE ON academic_terms
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER academic_terms_academic_revision_delete AFTER DELETE ON academic_terms
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER classes_academic_revision_insert AFTER INSERT ON classes
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER classes_academic_revision_update AFTER UPDATE ON classes
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER classes_academic_revision_delete AFTER DELETE ON classes
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER students_academic_revision_insert AFTER INSERT ON students
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER students_academic_revision_update AFTER UPDATE ON students
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER students_academic_revision_delete AFTER DELETE ON students
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER student_enrollments_academic_revision_insert AFTER INSERT ON student_enrollments
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER student_enrollments_academic_revision_update AFTER UPDATE ON student_enrollments
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER student_enrollments_academic_revision_delete AFTER DELETE ON student_enrollments
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER student_term_ranking_policies_academic_revision_insert AFTER INSERT ON student_term_ranking_policies
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER student_term_ranking_policies_academic_revision_update AFTER UPDATE ON student_term_ranking_policies
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER student_term_ranking_policies_academic_revision_delete AFTER DELETE ON student_term_ranking_policies
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER exams_academic_revision_insert AFTER INSERT ON exams
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER exams_academic_revision_update AFTER UPDATE ON exams
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER exams_academic_revision_delete AFTER DELETE ON exams
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER exam_participations_academic_revision_insert AFTER INSERT ON exam_participations
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER exam_participations_academic_revision_update AFTER UPDATE ON exam_participations
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER exam_participations_academic_revision_delete AFTER DELETE ON exam_participations
BEGIN
  UPDATE academic_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER academic_operation_commit_guard BEFORE INSERT ON academic_operations
BEGIN
  SELECT RAISE(ABORT, 'ACADEMIC_STALE_PREVIEW') WHERE NEW.before_revision <> (SELECT revision FROM academic_state WHERE id = 1);
  SELECT RAISE(ABORT, 'ACADEMIC_PREVIEW_MISMATCH') WHERE NEW.id <> NEW.preview_id OR NOT EXISTS (SELECT 1 FROM academic_previews p WHERE p.id = NEW.preview_id AND p.actor_id = NEW.actor_id AND p.kind = NEW.kind AND p.base_revision = NEW.before_revision AND p.payload_json <> '{}');
  SELECT RAISE(ABORT, 'ACADEMIC_SESSION_REVOKED') WHERE NOT EXISTS (SELECT 1 FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_user_id WHERE s.id = NEW.auth_session_id AND a.id = NEW.actor_id AND a.status = 'active' AND s.revoked_at IS NULL AND s.auth_version = a.auth_version AND s.expires_at > NEW.created_at);
  SELECT RAISE(ABORT, 'ACADEMIC_HISTORY_LOCKED') WHERE EXISTS (SELECT 1 FROM academic_previews p JOIN admin_users a ON a.id = NEW.actor_id WHERE p.id = NEW.preview_id AND json_array_length(p.resources_json, '$.historicalYearIds') > 0 AND (a.role <> 'super_admin' OR p.history_reason IS NULL OR length(trim(p.history_reason)) = 0));
  SELECT RAISE(ABORT, 'ACADEMIC_INVALID_TIMESTAMP') WHERE typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0;
END;
--> statement-breakpoint
CREATE TRIGGER academic_preview_immutable BEFORE UPDATE ON academic_previews
BEGIN
  SELECT RAISE(ABORT, 'ACADEMIC_PREVIEW_IMMUTABLE') WHERE NEW.payload_json <> '{}' OR NOT EXISTS (SELECT 1 FROM academic_operations o WHERE o.preview_id = OLD.id) OR NEW.id IS NOT OLD.id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.kind IS NOT OLD.kind OR NEW.base_revision IS NOT OLD.base_revision OR NEW.resources_json IS NOT OLD.resources_json OR NEW.history_reason IS NOT OLD.history_reason OR NEW.created_at IS NOT OLD.created_at;
END;
--> statement-breakpoint
CREATE TRIGGER academic_operation_immutable BEFORE UPDATE ON academic_operations
BEGIN
  SELECT RAISE(ABORT, 'ACADEMIC_OPERATION_IMMUTABLE') WHERE OLD.after_revision IS NOT NULL OR NEW.after_revision IS NULL OR NEW.id IS NOT OLD.id OR NEW.preview_id IS NOT OLD.preview_id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.auth_session_id IS NOT OLD.auth_session_id OR NEW.kind IS NOT OLD.kind OR NEW.before_revision IS NOT OLD.before_revision OR NEW.changes_json IS NOT OLD.changes_json OR NEW.undo_of IS NOT OLD.undo_of OR NEW.created_at IS NOT OLD.created_at;
END;
--> statement-breakpoint
CREATE TRIGGER academic_preview_timestamp BEFORE INSERT ON academic_previews
BEGIN
  SELECT RAISE(ABORT, 'ACADEMIC_INVALID_TIMESTAMP') WHERE typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0;
END;
