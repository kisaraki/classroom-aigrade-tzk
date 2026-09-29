ALTER TABLE `ai_jobs` ADD `pair_key` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `requested_by` text REFERENCES admin_users(id);--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `request_auth_version` integer;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `previous_result_id` text REFERENCES exam_result_versions(id);--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `configuration_version` integer;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `model` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `prompt_version` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `total_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `api_attempts` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_jobs_pair_audience` ON `ai_jobs` (`pair_key`,`audience`);--> statement-breakpoint
CREATE TRIGGER ai_job_execution_insert BEFORE INSERT ON ai_jobs WHEN NEW.pair_key IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'INVALID_AI_EXECUTION') WHERE NEW.requested_by IS NULL OR NEW.request_auth_version IS NULL OR NEW.request_auth_version<1 OR NEW.configuration_version IS NULL OR NEW.configuration_version<1 OR NEW.provider NOT IN ('openai','gemini') OR NEW.provider IS NULL OR NEW.model IS NULL OR NEW.prompt_version IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER ai_job_execution_update BEFORE UPDATE ON ai_jobs WHEN NEW.pair_key IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'INVALID_AI_EXECUTION') WHERE NEW.requested_by IS NULL OR NEW.request_auth_version IS NULL OR NEW.request_auth_version<1 OR NEW.configuration_version IS NULL OR NEW.configuration_version<1 OR NEW.provider NOT IN ('openai','gemini') OR NEW.provider IS NULL OR NEW.model IS NULL OR NEW.prompt_version IS NULL;
  SELECT RAISE(ABORT,'INVALID_AI_USAGE') WHERE (NEW.duration_ms IS NOT NULL AND (typeof(NEW.duration_ms)<>'integer' OR NEW.duration_ms<0)) OR (NEW.input_tokens IS NOT NULL AND (typeof(NEW.input_tokens)<>'integer' OR NEW.input_tokens<0)) OR (NEW.output_tokens IS NOT NULL AND (typeof(NEW.output_tokens)<>'integer' OR NEW.output_tokens<0)) OR (NEW.total_tokens IS NOT NULL AND (typeof(NEW.total_tokens)<>'integer' OR NEW.total_tokens<0)) OR (NEW.api_attempts IS NOT NULL AND (typeof(NEW.api_attempts)<>'integer' OR NEW.api_attempts<1));
END;
