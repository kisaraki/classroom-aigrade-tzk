-- Enforce existing 30 minute idle / 5 minute recent Google authentication
-- commitments at the academic transaction boundary, including internal adapters.
CREATE TRIGGER academic_operation_session_security BEFORE INSERT ON academic_operations
BEGIN
  SELECT RAISE(ABORT, 'ACADEMIC_SESSION_REVOKED') WHERE NOT EXISTS (
    SELECT 1 FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id
    WHERE s.id=NEW.auth_session_id AND a.id=NEW.actor_id AND a.status='active'
    AND a.google_subject_id IS NOT NULL AND s.revoked_at IS NULL
    AND s.auth_version=a.auth_version AND s.expires_at>NEW.created_at
    AND s.last_seen_at>NEW.created_at-1800000 AND s.last_seen_at<=NEW.created_at
  );
  SELECT RAISE(ABORT, 'ACADEMIC_HISTORY_LOCKED') WHERE EXISTS (
    SELECT 1 FROM academic_previews p WHERE p.id=NEW.preview_id
    AND json_array_length(p.resources_json, '$.historicalYearIds')>0
  ) AND NOT EXISTS (
    SELECT 1 FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id
    WHERE s.id=NEW.auth_session_id AND a.id=NEW.actor_id AND a.role='super_admin'
    AND s.recent_auth_at>0 AND s.recent_auth_at>NEW.created_at-300000
    AND s.recent_auth_at<=NEW.created_at
  );
END;
