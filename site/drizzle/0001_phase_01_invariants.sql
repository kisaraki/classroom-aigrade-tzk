-- Cross-row invariants and external-content FTS5. Never split trigger bodies at semicolons.
CREATE TRIGGER term_boundary_insert BEFORE INSERT ON academic_terms
BEGIN
  SELECT RAISE(ABORT, 'TERM_OUTSIDE_YEAR') WHERE NOT EXISTS (SELECT 1 FROM academic_years y WHERE y.id = NEW.academic_year_id AND NEW.starts_on >= y.starts_on AND NEW.ends_on <= y.ends_on);
  SELECT RAISE(ABORT, 'TERM_OVERLAP') WHERE EXISTS (SELECT 1 FROM academic_terms t WHERE t.id <> NEW.id AND t.academic_year_id = NEW.academic_year_id AND NEW.starts_on < t.ends_on AND NEW.ends_on > t.starts_on);
END;
--> statement-breakpoint
CREATE TRIGGER term_boundary_update BEFORE UPDATE ON academic_terms
BEGIN
  SELECT RAISE(ABORT, 'TERM_OUTSIDE_YEAR') WHERE NOT EXISTS (SELECT 1 FROM academic_years y WHERE y.id = NEW.academic_year_id AND NEW.starts_on >= y.starts_on AND NEW.ends_on <= y.ends_on);
  SELECT RAISE(ABORT, 'TERM_OVERLAP') WHERE EXISTS (SELECT 1 FROM academic_terms t WHERE t.id <> NEW.id AND t.academic_year_id = NEW.academic_year_id AND NEW.starts_on < t.ends_on AND NEW.ends_on > t.starts_on);
END;
--> statement-breakpoint
CREATE TRIGGER year_boundary_update BEFORE UPDATE ON academic_years
BEGIN
  SELECT RAISE(ABORT, 'YEAR_EXCLUDES_TERM') WHERE EXISTS (SELECT 1 FROM academic_terms t WHERE t.academic_year_id = OLD.id AND (t.starts_on < NEW.starts_on OR t.ends_on > NEW.ends_on));
END;
--> statement-breakpoint
CREATE TRIGGER term_children_update BEFORE UPDATE ON academic_terms
BEGIN
  SELECT RAISE(ABORT, 'TERM_EXCLUDES_CHILD') WHERE EXISTS (SELECT 1 FROM student_enrollments e WHERE e.academic_term_id = OLD.id AND (e.effective_from < NEW.starts_on OR e.effective_from >= NEW.ends_on OR e.effective_to > NEW.ends_on)) OR EXISTS (SELECT 1 FROM exams e WHERE e.academic_term_id = OLD.id AND (e.starts_on < NEW.starts_on OR e.ends_on > NEW.ends_on));
END;
--> statement-breakpoint
CREATE TRIGGER enrollment_guard_insert BEFORE INSERT ON student_enrollments
BEGIN
  SELECT RAISE(ABORT, 'ENROLLMENT_OUTSIDE_TERM') WHERE NOT EXISTS (SELECT 1 FROM academic_terms t WHERE t.id = NEW.academic_term_id AND NEW.effective_from >= t.starts_on AND NEW.effective_from < t.ends_on AND (NEW.effective_to IS NULL OR NEW.effective_to <= t.ends_on));
  SELECT RAISE(ABORT, 'STUDENT_ENROLLMENT_OVERLAP') WHERE NEW.status = 'valid' AND EXISTS (SELECT 1 FROM student_enrollments e WHERE e.id <> NEW.id AND e.status = 'valid' AND e.student_id = NEW.student_id AND NEW.effective_from < coalesce(e.effective_to, '9999-12-31') AND coalesce(NEW.effective_to, '9999-12-31') > e.effective_from);
  SELECT RAISE(ABORT, 'CLASS_SEAT_OVERLAP') WHERE NEW.status = 'valid' AND EXISTS (SELECT 1 FROM student_enrollments e WHERE e.id <> NEW.id AND e.status = 'valid' AND e.class_id = NEW.class_id AND e.seat_number = NEW.seat_number AND NEW.effective_from < coalesce(e.effective_to, '9999-12-31') AND coalesce(NEW.effective_to, '9999-12-31') > e.effective_from);
END;
--> statement-breakpoint
CREATE TRIGGER enrollment_guard_update BEFORE UPDATE ON student_enrollments
BEGIN
  SELECT RAISE(ABORT, 'ENROLLMENT_OUTSIDE_TERM') WHERE NOT EXISTS (SELECT 1 FROM academic_terms t WHERE t.id = NEW.academic_term_id AND NEW.effective_from >= t.starts_on AND NEW.effective_from < t.ends_on AND (NEW.effective_to IS NULL OR NEW.effective_to <= t.ends_on));
  SELECT RAISE(ABORT, 'STUDENT_ENROLLMENT_OVERLAP') WHERE NEW.status = 'valid' AND EXISTS (SELECT 1 FROM student_enrollments e WHERE e.id <> NEW.id AND e.status = 'valid' AND e.student_id = NEW.student_id AND NEW.effective_from < coalesce(e.effective_to, '9999-12-31') AND coalesce(NEW.effective_to, '9999-12-31') > e.effective_from);
  SELECT RAISE(ABORT, 'CLASS_SEAT_OVERLAP') WHERE NEW.status = 'valid' AND EXISTS (SELECT 1 FROM student_enrollments e WHERE e.id <> NEW.id AND e.status = 'valid' AND e.class_id = NEW.class_id AND e.seat_number = NEW.seat_number AND NEW.effective_from < coalesce(e.effective_to, '9999-12-31') AND coalesce(NEW.effective_to, '9999-12-31') > e.effective_from);
END;
--> statement-breakpoint
CREATE TRIGGER enrollment_snapshot_guard BEFORE UPDATE ON student_enrollments
BEGIN
  SELECT RAISE(ABORT, 'ENROLLMENT_HAS_FROZEN_SNAPSHOT') WHERE EXISTS (SELECT 1 FROM exam_participations p JOIN exams x ON x.id = p.exam_id WHERE p.enrollment_id = OLD.id AND (NEW.student_id <> OLD.student_id OR NEW.academic_term_id <> OLD.academic_term_id OR NEW.class_id <> OLD.class_id OR NEW.seat_number <> OLD.seat_number OR NEW.effective_from > x.starts_on OR (NEW.effective_to IS NOT NULL AND NEW.effective_to <= x.starts_on)));
END;
--> statement-breakpoint
CREATE TRIGGER student_number_immutable BEFORE UPDATE OF student_number ON students
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_NUMBER_IMMUTABLE') WHERE NEW.student_number <> OLD.student_number;
END;
--> statement-breakpoint
CREATE TRIGGER exam_boundary_insert BEFORE INSERT ON exams
BEGIN
  SELECT RAISE(ABORT, 'EXAM_OUTSIDE_TERM') WHERE NOT EXISTS (SELECT 1 FROM academic_terms t WHERE t.id = NEW.academic_term_id AND NEW.starts_on >= t.starts_on AND NEW.ends_on <= t.ends_on);
END;
--> statement-breakpoint
CREATE TRIGGER exam_boundary_update BEFORE UPDATE ON exams
BEGIN
  SELECT RAISE(ABORT, 'EXAM_OUTSIDE_TERM') WHERE NOT EXISTS (SELECT 1 FROM academic_terms t WHERE t.id = NEW.academic_term_id AND NEW.starts_on >= t.starts_on AND NEW.ends_on <= t.ends_on);
END;
--> statement-breakpoint
CREATE TRIGGER exam_roster_dates_immutable BEFORE UPDATE ON exams
BEGIN
  SELECT RAISE(ABORT, 'EXAM_HAS_FROZEN_ROSTER') WHERE (NEW.starts_on <> OLD.starts_on OR NEW.ends_on <> OLD.ends_on OR NEW.academic_term_id <> OLD.academic_term_id) AND EXISTS (SELECT 1 FROM exam_participations p WHERE p.exam_id = OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER participation_snapshot_insert BEFORE INSERT ON exam_participations
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PARTICIPATION_SNAPSHOT') WHERE NEW.origin = 'LOCAL' AND NOT EXISTS (SELECT 1 FROM student_enrollments e JOIN exams x ON x.id = NEW.exam_id JOIN classes c ON c.id = e.class_id JOIN students s ON s.id = e.student_id WHERE e.id = NEW.enrollment_id AND e.status = 'valid' AND s.status = 'active' AND s.deleted_at IS NULL AND e.effective_from <= x.starts_on AND (e.effective_to IS NULL OR e.effective_to > x.starts_on) AND c.code = NEW.class_code_snapshot AND c.grade = NEW.grade_snapshot AND e.seat_number = NEW.seat_number_snapshot);
  SELECT RAISE(ABORT, 'STALE_ELIGIBILITY_SNAPSHOT') WHERE NEW.student_eligibility_snapshot IS NOT (SELECT ranking_eligible_default FROM students WHERE id = NEW.student_id) OR NEW.term_eligibility_snapshot IS NOT (SELECT ranking_eligible FROM student_term_ranking_policies WHERE student_id = NEW.student_id AND academic_term_id = NEW.academic_term_id);
END;
--> statement-breakpoint
CREATE TRIGGER participation_snapshot_immutable BEFORE UPDATE ON exam_participations
BEGIN
  SELECT RAISE(ABORT, 'PARTICIPATION_SNAPSHOT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER score_guard_insert BEFORE INSERT ON score_items
BEGIN
  SELECT RAISE(ABORT, 'SCORE_SNAPSHOT_OR_ELIGIBILITY_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM exam_participations p WHERE p.id = NEW.participation_id AND p.class_id_snapshot IS NEW.class_id_snapshot AND (NEW.include_in_ranking = 0 OR p.ranking_eligible = 1));
  SELECT RAISE(ABORT, 'SCORE_HELD_MISMATCH') WHERE NEW.origin = 'LOCAL' AND EXISTS (SELECT 1 FROM exam_subject_settings s WHERE s.id = NEW.setting_id AND ((s.held = 0 AND NEW.score_status <> 'NOT_HELD') OR (s.held = 1 AND NEW.score_status = 'NOT_HELD')));
END;
--> statement-breakpoint
CREATE TRIGGER score_guard_update BEFORE UPDATE ON score_items
BEGIN
  SELECT RAISE(ABORT, 'SCORE_SNAPSHOT_OR_ELIGIBILITY_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM exam_participations p WHERE p.id = NEW.participation_id AND p.class_id_snapshot IS NEW.class_id_snapshot AND (NEW.include_in_ranking = 0 OR p.ranking_eligible = 1));
  SELECT RAISE(ABORT, 'SCORE_HELD_MISMATCH') WHERE NEW.origin = 'LOCAL' AND EXISTS (SELECT 1 FROM exam_subject_settings s WHERE s.id = NEW.setting_id AND ((s.held = 0 AND NEW.score_status <> 'NOT_HELD') OR (s.held = 1 AND NEW.score_status = 'NOT_HELD')));
END;
--> statement-breakpoint
CREATE TRIGGER score_student_insert BEFORE INSERT ON score_items
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_NOT_ACTIVE') WHERE NOT EXISTS (SELECT 1 FROM students WHERE id = NEW.student_id AND status = 'active' AND deleted_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER setting_existing_scores_guard BEFORE UPDATE OF held ON exam_subject_settings
BEGIN
  SELECT RAISE(ABORT, 'SETTING_HAS_SCORES') WHERE NEW.held <> OLD.held AND EXISTS (SELECT 1 FROM score_items WHERE setting_id = OLD.id AND origin = 'LOCAL');
END;
--> statement-breakpoint
CREATE TRIGGER history_student_guard_insert BEFORE INSERT ON score_change_history
BEGIN
  SELECT RAISE(ABORT, 'HISTORY_STUDENT_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM score_items WHERE id = NEW.score_item_id AND student_id = NEW.student_id);
END;
--> statement-breakpoint
CREATE TRIGGER history_student_guard_update BEFORE UPDATE ON score_change_history
BEGIN
  SELECT RAISE(ABORT, 'HISTORY_STUDENT_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM score_items WHERE id = NEW.score_item_id AND student_id = NEW.student_id);
END;
--> statement-breakpoint
CREATE TRIGGER result_participation_guard_insert BEFORE INSERT ON exam_results
BEGIN
  SELECT RAISE(ABORT, 'RESULT_PARTICIPATION_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM exam_participations p WHERE p.id = NEW.participation_id AND p.exam_id = NEW.exam_id AND (p.ranking_eligible = 1 OR (NEW.class_rank IS NULL AND NEW.grade_rank IS NULL)));
END;
--> statement-breakpoint
CREATE TRIGGER result_participation_guard_update BEFORE UPDATE ON exam_results
BEGIN
  SELECT RAISE(ABORT, 'RESULT_PARTICIPATION_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM exam_participations p WHERE p.id = NEW.participation_id AND p.exam_id = NEW.exam_id AND (p.ranking_eligible = 1 OR (NEW.class_rank IS NULL AND NEW.grade_rank IS NULL)));
END;
--> statement-breakpoint
CREATE TRIGGER job_result_guard_insert BEFORE INSERT ON ai_jobs
BEGIN
  SELECT RAISE(ABORT, 'JOB_SOURCE_MISMATCH') WHERE NEW.result_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM exam_result_versions WHERE id = NEW.result_version_id AND exam_id = NEW.exam_id AND source_version = NEW.source_version);
END;
--> statement-breakpoint
CREATE TRIGGER job_result_guard_update BEFORE UPDATE ON ai_jobs
BEGIN
  SELECT RAISE(ABORT, 'JOB_SOURCE_MISMATCH') WHERE NEW.result_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM exam_result_versions WHERE id = NEW.result_version_id AND exam_id = NEW.exam_id AND source_version = NEW.source_version);
END;
--> statement-breakpoint
CREATE TRIGGER job_student_insert BEFORE INSERT ON ai_jobs
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_CANNOT_RECEIVE_NEW_ADVICE') WHERE NOT EXISTS (SELECT 1 FROM students WHERE id = NEW.student_id AND status <> 'transferred_out' AND deleted_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER advice_job_guard_insert BEFORE INSERT ON ai_advices
BEGIN
  SELECT RAISE(ABORT, 'ADVICE_JOB_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM ai_jobs WHERE id = NEW.job_id AND student_id = NEW.student_id AND exam_id = NEW.exam_id AND audience = NEW.audience AND source_version = NEW.source_version);
END;
--> statement-breakpoint
CREATE TRIGGER advice_job_guard_update BEFORE UPDATE ON ai_advices
BEGIN
  SELECT RAISE(ABORT, 'ADVICE_JOB_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM ai_jobs WHERE id = NEW.job_id AND student_id = NEW.student_id AND exam_id = NEW.exam_id AND audience = NEW.audience AND source_version = NEW.source_version);
END;
--> statement-breakpoint
CREATE TRIGGER citation_guard_insert BEFORE INSERT ON ai_advice_references
BEGIN
  SELECT RAISE(ABORT, 'CITATION_SNAPSHOT_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM ai_reference_chunks WHERE id = NEW.chunk_id AND material_version = NEW.material_version AND content_hash = NEW.content_hash_snapshot);
END;
--> statement-breakpoint
CREATE TRIGGER citation_guard_update BEFORE UPDATE ON ai_advice_references
BEGIN
  SELECT RAISE(ABORT, 'CITATION_SNAPSHOT_MISMATCH') WHERE NOT EXISTS (SELECT 1 FROM ai_reference_chunks WHERE id = NEW.chunk_id AND material_version = NEW.material_version AND content_hash = NEW.content_hash_snapshot);
END;
--> statement-breakpoint
CREATE TRIGGER cited_chunk_immutable BEFORE UPDATE ON ai_reference_chunks
BEGIN
  SELECT RAISE(ABORT, 'CITED_CHUNK_IMMUTABLE') WHERE EXISTS (SELECT 1 FROM ai_advice_references WHERE chunk_id = OLD.id) AND (NEW.content <> OLD.content OR NEW.content_hash <> OLD.content_hash OR NEW.material_version <> OLD.material_version OR NEW.material_id <> OLD.material_id);
END;
--> statement-breakpoint
CREATE TRIGGER assignment_year_guard_insert BEFORE INSERT ON admin_assignments
BEGIN
  SELECT RAISE(ABORT, 'ASSIGNMENT_YEAR_MISMATCH') WHERE NEW.class_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM classes c JOIN academic_terms t ON t.academic_year_id = c.academic_year_id WHERE c.id = NEW.class_id AND t.id = NEW.academic_term_id);
END;
--> statement-breakpoint
CREATE TRIGGER assignment_year_guard_update BEFORE UPDATE ON admin_assignments
BEGIN
  SELECT RAISE(ABORT, 'ASSIGNMENT_YEAR_MISMATCH') WHERE NEW.class_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM classes c JOIN academic_terms t ON t.academic_year_id = c.academic_year_id WHERE c.id = NEW.class_id AND t.id = NEW.academic_term_id);
END;
--> statement-breakpoint
CREATE TRIGGER reserved_admin_update BEFORE UPDATE OF username ON admin_users
BEGIN
  SELECT RAISE(ABORT, 'RESERVED_ADMIN_IMMUTABLE') WHERE OLD.username = 'admin' AND NEW.username <> OLD.username;
END;
--> statement-breakpoint
CREATE TRIGGER reserved_admin_delete BEFORE DELETE ON admin_users
BEGIN
  SELECT RAISE(ABORT, 'RESERVED_ADMIN_IMMUTABLE') WHERE OLD.username = 'admin';
END;
--> statement-breakpoint
CREATE TRIGGER last_super_admin_update BEFORE UPDATE ON admin_users
BEGIN
  SELECT RAISE(ABORT, 'LAST_ACTIVE_SUPER_ADMIN') WHERE OLD.role = 'super_admin' AND OLD.status = 'active' AND (NEW.role <> 'super_admin' OR NEW.status <> 'active') AND NOT EXISTS (SELECT 1 FROM admin_users WHERE id <> OLD.id AND role = 'super_admin' AND status = 'active');
END;
--> statement-breakpoint
CREATE TRIGGER last_super_admin_delete BEFORE DELETE ON admin_users
BEGIN
  SELECT RAISE(ABORT, 'LAST_ACTIVE_SUPER_ADMIN') WHERE OLD.role = 'super_admin' AND OLD.status = 'active' AND NOT EXISTS (SELECT 1 FROM admin_users WHERE id <> OLD.id AND role = 'super_admin' AND status = 'active');
END;
--> statement-breakpoint
CREATE TRIGGER session_active_guard_insert BEFORE INSERT ON admin_sessions
BEGIN
  SELECT RAISE(ABORT, 'INVALID_SESSION_PRINCIPAL') WHERE NEW.revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM admin_users WHERE id = NEW.admin_user_id AND status = 'active' AND auth_version = NEW.auth_version);
END;
--> statement-breakpoint
CREATE TRIGGER session_active_guard_update BEFORE UPDATE ON admin_sessions
BEGIN
  SELECT RAISE(ABORT, 'INVALID_SESSION_PRINCIPAL') WHERE NEW.revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM admin_users WHERE id = NEW.admin_user_id AND status = 'active' AND auth_version = NEW.auth_version);
END;
--> statement-breakpoint
CREATE TRIGGER admin_session_invalidation AFTER UPDATE ON admin_users WHEN NEW.role IS NOT OLD.role OR NEW.status IS NOT OLD.status OR NEW.google_subject_id IS NOT OLD.google_subject_id OR NEW.authorized_email IS NOT OLD.authorized_email OR NEW.auth_version IS NOT OLD.auth_version
BEGIN
  UPDATE admin_sessions SET revoked_at = unixepoch() * 1000 WHERE admin_user_id = OLD.id AND revoked_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER assignment_revoke_insert AFTER INSERT ON admin_assignments
BEGIN
  UPDATE admin_sessions SET revoked_at = unixepoch() * 1000 WHERE revoked_at IS NULL AND admin_user_id IN (NEW.admin_user_id);
END;
--> statement-breakpoint
CREATE TRIGGER assignment_revoke_update AFTER UPDATE ON admin_assignments
BEGIN
  UPDATE admin_sessions SET revoked_at = unixepoch() * 1000 WHERE revoked_at IS NULL AND admin_user_id IN (OLD.admin_user_id, NEW.admin_user_id);
END;
--> statement-breakpoint
CREATE TRIGGER assignment_revoke_delete AFTER DELETE ON admin_assignments
BEGIN
  UPDATE admin_sessions SET revoked_at = unixepoch() * 1000 WHERE revoked_at IS NULL AND admin_user_id IN (OLD.admin_user_id);
END;
--> statement-breakpoint
CREATE TRIGGER bootstrap_never_update BEFORE UPDATE ON bootstrap_state
BEGIN
  SELECT RAISE(ABORT, 'BOOTSTRAP_ALREADY_INITIALIZED');
END;
--> statement-breakpoint
CREATE TRIGGER bootstrap_never_delete BEFORE DELETE ON bootstrap_state
BEGIN
  SELECT RAISE(ABORT, 'BOOTSTRAP_ALREADY_INITIALIZED');
END;
--> statement-breakpoint
CREATE TRIGGER academic_terms_timestamps_insert BEFORE INSERT ON academic_terms
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER academic_terms_timestamps_update BEFORE UPDATE ON academic_terms
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER academic_years_timestamps_insert BEFORE INSERT ON academic_years
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER academic_years_timestamps_update BEFORE UPDATE ON academic_years
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER admin_assignments_timestamps_insert BEFORE INSERT ON admin_assignments
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER admin_assignments_timestamps_update BEFORE UPDATE ON admin_assignments
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER admin_sessions_timestamps_insert BEFORE INSERT ON admin_sessions
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.authenticated_at IS NOT NULL AND (typeof(NEW.authenticated_at) <> 'integer' OR NEW.authenticated_at < 0)) OR (NEW.last_seen_at IS NOT NULL AND (typeof(NEW.last_seen_at) <> 'integer' OR NEW.last_seen_at < 0)) OR (NEW.expires_at IS NOT NULL AND (typeof(NEW.expires_at) <> 'integer' OR NEW.expires_at < 0)) OR (NEW.revoked_at IS NOT NULL AND (typeof(NEW.revoked_at) <> 'integer' OR NEW.revoked_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER admin_sessions_timestamps_update BEFORE UPDATE ON admin_sessions
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.authenticated_at IS NOT NULL AND (typeof(NEW.authenticated_at) <> 'integer' OR NEW.authenticated_at < 0)) OR (NEW.last_seen_at IS NOT NULL AND (typeof(NEW.last_seen_at) <> 'integer' OR NEW.last_seen_at < 0)) OR (NEW.expires_at IS NOT NULL AND (typeof(NEW.expires_at) <> 'integer' OR NEW.expires_at < 0)) OR (NEW.revoked_at IS NOT NULL AND (typeof(NEW.revoked_at) <> 'integer' OR NEW.revoked_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER admin_users_timestamps_insert BEFORE INSERT ON admin_users
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.identity_bound_at IS NOT NULL AND (typeof(NEW.identity_bound_at) <> 'integer' OR NEW.identity_bound_at < 0)) OR (NEW.last_login_at IS NOT NULL AND (typeof(NEW.last_login_at) <> 'integer' OR NEW.last_login_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER admin_users_timestamps_update BEFORE UPDATE ON admin_users
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.identity_bound_at IS NOT NULL AND (typeof(NEW.identity_bound_at) <> 'integer' OR NEW.identity_bound_at < 0)) OR (NEW.last_login_at IS NOT NULL AND (typeof(NEW.last_login_at) <> 'integer' OR NEW.last_login_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER ai_advices_timestamps_insert BEFORE INSERT ON ai_advices
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.stale_at IS NOT NULL AND (typeof(NEW.stale_at) <> 'integer' OR NEW.stale_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER ai_advices_timestamps_update BEFORE UPDATE ON ai_advices
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.stale_at IS NOT NULL AND (typeof(NEW.stale_at) <> 'integer' OR NEW.stale_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER ai_jobs_timestamps_insert BEFORE INSERT ON ai_jobs
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.lease_expires_at IS NOT NULL AND (typeof(NEW.lease_expires_at) <> 'integer' OR NEW.lease_expires_at < 0)) OR (NEW.next_attempt_at IS NOT NULL AND (typeof(NEW.next_attempt_at) <> 'integer' OR NEW.next_attempt_at < 0)) OR (NEW.completed_at IS NOT NULL AND (typeof(NEW.completed_at) <> 'integer' OR NEW.completed_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER ai_jobs_timestamps_update BEFORE UPDATE ON ai_jobs
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.lease_expires_at IS NOT NULL AND (typeof(NEW.lease_expires_at) <> 'integer' OR NEW.lease_expires_at < 0)) OR (NEW.next_attempt_at IS NOT NULL AND (typeof(NEW.next_attempt_at) <> 'integer' OR NEW.next_attempt_at < 0)) OR (NEW.completed_at IS NOT NULL AND (typeof(NEW.completed_at) <> 'integer' OR NEW.completed_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER ai_reference_chunks_timestamps_insert BEFORE INSERT ON ai_reference_chunks
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER ai_reference_chunks_timestamps_update BEFORE UPDATE ON ai_reference_chunks
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER ai_reference_materials_timestamps_insert BEFORE INSERT ON ai_reference_materials
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER ai_reference_materials_timestamps_update BEFORE UPDATE ON ai_reference_materials
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER archive_batches_timestamps_insert BEFORE INSERT ON archive_batches
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.undo_until IS NOT NULL AND (typeof(NEW.undo_until) <> 'integer' OR NEW.undo_until < 0)) OR (NEW.restored_at IS NOT NULL AND (typeof(NEW.restored_at) <> 'integer' OR NEW.restored_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER archive_batches_timestamps_update BEFORE UPDATE ON archive_batches
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.undo_until IS NOT NULL AND (typeof(NEW.undo_until) <> 'integer' OR NEW.undo_until < 0)) OR (NEW.restored_at IS NOT NULL AND (typeof(NEW.restored_at) <> 'integer' OR NEW.restored_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER archive_items_timestamps_insert BEFORE INSERT ON archive_items
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.purged_at IS NOT NULL AND (typeof(NEW.purged_at) <> 'integer' OR NEW.purged_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER archive_items_timestamps_update BEFORE UPDATE ON archive_items
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.purged_at IS NOT NULL AND (typeof(NEW.purged_at) <> 'integer' OR NEW.purged_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER audit_logs_timestamps_insert BEFORE INSERT ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER audit_logs_timestamps_update BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER bootstrap_state_timestamps_insert BEFORE INSERT ON bootstrap_state
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.initialized_at IS NOT NULL AND (typeof(NEW.initialized_at) <> 'integer' OR NEW.initialized_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER bootstrap_state_timestamps_update BEFORE UPDATE ON bootstrap_state
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.initialized_at IS NOT NULL AND (typeof(NEW.initialized_at) <> 'integer' OR NEW.initialized_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER classes_timestamps_insert BEFORE INSERT ON classes
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.archived_at IS NOT NULL AND (typeof(NEW.archived_at) <> 'integer' OR NEW.archived_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER classes_timestamps_update BEFORE UPDATE ON classes
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.archived_at IS NOT NULL AND (typeof(NEW.archived_at) <> 'integer' OR NEW.archived_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER exam_participations_timestamps_insert BEFORE INSERT ON exam_participations
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.confirmed_at IS NOT NULL AND (typeof(NEW.confirmed_at) <> 'integer' OR NEW.confirmed_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER exam_participations_timestamps_update BEFORE UPDATE ON exam_participations
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.confirmed_at IS NOT NULL AND (typeof(NEW.confirmed_at) <> 'integer' OR NEW.confirmed_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER exam_result_versions_timestamps_insert BEFORE INSERT ON exam_result_versions
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.published_at IS NOT NULL AND (typeof(NEW.published_at) <> 'integer' OR NEW.published_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER exam_result_versions_timestamps_update BEFORE UPDATE ON exam_result_versions
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.published_at IS NOT NULL AND (typeof(NEW.published_at) <> 'integer' OR NEW.published_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER exams_timestamps_insert BEFORE INSERT ON exams
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.published_at IS NOT NULL AND (typeof(NEW.published_at) <> 'integer' OR NEW.published_at < 0)) OR (NEW.locked_at IS NOT NULL AND (typeof(NEW.locked_at) <> 'integer' OR NEW.locked_at < 0)) OR (NEW.archived_at IS NOT NULL AND (typeof(NEW.archived_at) <> 'integer' OR NEW.archived_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER exams_timestamps_update BEFORE UPDATE ON exams
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.published_at IS NOT NULL AND (typeof(NEW.published_at) <> 'integer' OR NEW.published_at < 0)) OR (NEW.locked_at IS NOT NULL AND (typeof(NEW.locked_at) <> 'integer' OR NEW.locked_at < 0)) OR (NEW.archived_at IS NOT NULL AND (typeof(NEW.archived_at) <> 'integer' OR NEW.archived_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER import_jobs_timestamps_insert BEFORE INSERT ON import_jobs
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.confirmed_at IS NOT NULL AND (typeof(NEW.confirmed_at) <> 'integer' OR NEW.confirmed_at < 0)) OR (NEW.committed_at IS NOT NULL AND (typeof(NEW.committed_at) <> 'integer' OR NEW.committed_at < 0)) OR (NEW.rollback_until IS NOT NULL AND (typeof(NEW.rollback_until) <> 'integer' OR NEW.rollback_until < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER import_jobs_timestamps_update BEFORE UPDATE ON import_jobs
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.confirmed_at IS NOT NULL AND (typeof(NEW.confirmed_at) <> 'integer' OR NEW.confirmed_at < 0)) OR (NEW.committed_at IS NOT NULL AND (typeof(NEW.committed_at) <> 'integer' OR NEW.committed_at < 0)) OR (NEW.rollback_until IS NOT NULL AND (typeof(NEW.rollback_until) <> 'integer' OR NEW.rollback_until < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER score_change_history_timestamps_insert BEFORE INSERT ON score_change_history
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER score_change_history_timestamps_update BEFORE UPDATE ON score_change_history
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER score_items_timestamps_insert BEFORE INSERT ON score_items
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER score_items_timestamps_update BEFORE UPDATE ON score_items
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER student_enrollments_timestamps_insert BEFORE INSERT ON student_enrollments
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER student_enrollments_timestamps_update BEFORE UPDATE ON student_enrollments
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER student_identity_lookup_hashes_timestamps_insert BEFORE INSERT ON student_identity_lookup_hashes
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER student_identity_lookup_hashes_timestamps_update BEFORE UPDATE ON student_identity_lookup_hashes
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER student_term_ranking_policies_timestamps_insert BEFORE INSERT ON student_term_ranking_policies
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER student_term_ranking_policies_timestamps_update BEFORE UPDATE ON student_term_ranking_policies
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER students_timestamps_insert BEFORE INSERT ON students
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.deleted_at IS NOT NULL AND (typeof(NEW.deleted_at) <> 'integer' OR NEW.deleted_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER students_timestamps_update BEFORE UPDATE ON students
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.deleted_at IS NOT NULL AND (typeof(NEW.deleted_at) <> 'integer' OR NEW.deleted_at < 0)) OR (NEW.created_at IS NOT NULL AND (typeof(NEW.created_at) <> 'integer' OR NEW.created_at < 0)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER system_settings_timestamps_insert BEFORE INSERT ON system_settings
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE TRIGGER system_settings_timestamps_update BEFORE UPDATE ON system_settings
BEGIN
  SELECT RAISE(ABORT, 'INVALID_UTC_TIMESTAMP') WHERE (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at) <> 'integer' OR NEW.updated_at < 0));
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE ai_reference_chunks_fts USING fts5(content, content='ai_reference_chunks', content_rowid='id', tokenize='unicode61');
--> statement-breakpoint
CREATE TRIGGER reference_chunks_fts_insert AFTER INSERT ON ai_reference_chunks
BEGIN
  INSERT INTO ai_reference_chunks_fts(rowid, content) VALUES (NEW.id, NEW.content);
END;
--> statement-breakpoint
CREATE TRIGGER reference_chunks_fts_delete AFTER DELETE ON ai_reference_chunks
BEGIN
  INSERT INTO ai_reference_chunks_fts(ai_reference_chunks_fts, rowid, content) VALUES ('delete', OLD.id, OLD.content);
END;
--> statement-breakpoint
CREATE TRIGGER reference_chunks_fts_update AFTER UPDATE ON ai_reference_chunks
BEGIN
  INSERT INTO ai_reference_chunks_fts(ai_reference_chunks_fts, rowid, content) VALUES ('delete', OLD.id, OLD.content);
  INSERT INTO ai_reference_chunks_fts(rowid, content) VALUES (NEW.id, NEW.content);
END;
--> statement-breakpoint
INSERT INTO ai_reference_chunks_fts(ai_reference_chunks_fts) VALUES ('rebuild');
--> statement-breakpoint
CREATE TRIGGER score_identity_immutable BEFORE UPDATE ON score_items
BEGIN
  SELECT RAISE(ABORT, 'SCORE_IDENTITY_IMMUTABLE') WHERE NEW.id IS NOT OLD.id OR NEW.participation_id IS NOT OLD.participation_id OR NEW.setting_id IS NOT OLD.setting_id OR NEW.exam_id IS NOT OLD.exam_id OR NEW.student_id IS NOT OLD.student_id OR NEW.exam_type IS NOT OLD.exam_type OR NEW.subject IS NOT OLD.subject OR NEW.origin IS NOT OLD.origin OR NEW.class_id_snapshot IS NOT OLD.class_id_snapshot;
END;
--> statement-breakpoint
CREATE TRIGGER score_history_append_only BEFORE UPDATE ON score_change_history
BEGIN
  SELECT RAISE(ABORT, 'SCORE_HISTORY_APPEND_ONLY') WHERE 1;
END;
--> statement-breakpoint
CREATE TRIGGER result_values_immutable BEFORE UPDATE ON exam_results
BEGIN
  SELECT RAISE(ABORT, 'RESULT_VERSION_IMMUTABLE') WHERE 1;
END;
--> statement-breakpoint
CREATE TRIGGER result_source_immutable BEFORE UPDATE ON exam_result_versions
BEGIN
  SELECT RAISE(ABORT, 'RESULT_VERSION_IMMUTABLE') WHERE NEW.id IS NOT OLD.id OR NEW.exam_id IS NOT OLD.exam_id OR NEW.version IS NOT OLD.version OR NEW.source_version IS NOT OLD.source_version OR NEW.calculation_version IS NOT OLD.calculation_version OR NEW.provisional IS NOT OLD.provisional OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by;
END;
--> statement-breakpoint
CREATE TRIGGER advice_content_immutable BEFORE UPDATE ON ai_advices
BEGIN
  SELECT RAISE(ABORT, 'ADVICE_VERSION_IMMUTABLE') WHERE NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.student_id IS NOT OLD.student_id OR NEW.exam_id IS NOT OLD.exam_id OR NEW.audience IS NOT OLD.audience OR NEW.version IS NOT OLD.version OR NEW.source_version IS NOT OLD.source_version OR NEW.provider IS NOT OLD.provider OR NEW.model IS NOT OLD.model OR NEW.prompt_version IS NOT OLD.prompt_version OR NEW.content IS NOT OLD.content OR NEW.created_at IS NOT OLD.created_at;
END;
