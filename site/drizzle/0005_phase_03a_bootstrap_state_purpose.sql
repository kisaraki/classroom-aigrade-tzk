ALTER TABLE `auth_oauth_states` ADD COLUMN `purpose` text DEFAULT 'login' NOT NULL;--> statement-breakpoint
CREATE TRIGGER `auth_oauth_state_purpose_insert` BEFORE INSERT ON `auth_oauth_states`
BEGIN
  SELECT RAISE(ABORT, 'INVALID_OAUTH_STATE_PURPOSE') WHERE NEW.purpose NOT IN ('login', 'bootstrap');
END;--> statement-breakpoint
CREATE TRIGGER `auth_oauth_state_purpose_update` BEFORE UPDATE OF purpose ON `auth_oauth_states`
BEGIN
  SELECT RAISE(ABORT, 'INVALID_OAUTH_STATE_PURPOSE') WHERE NEW.purpose NOT IN ('login', 'bootstrap');
END;
