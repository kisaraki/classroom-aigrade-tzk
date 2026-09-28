CREATE TABLE `reference_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`object_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reference_upload_status" CHECK("reference_uploads"."status" IN ('pending','ready','cleanup'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reference_uploads_object_key_unique` ON `reference_uploads` (`object_key`);--> statement-breakpoint
ALTER TABLE `ai_reference_chunks` ADD `search_tokens` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE VIRTUAL TABLE reference_search USING fts5(search_tokens, content='ai_reference_chunks', content_rowid='id', tokenize='unicode61');
--> statement-breakpoint
CREATE TRIGGER reference_search_insert AFTER INSERT ON ai_reference_chunks BEGIN INSERT INTO reference_search(rowid,search_tokens) VALUES(NEW.id,NEW.search_tokens); END;
--> statement-breakpoint
CREATE TRIGGER reference_search_delete AFTER DELETE ON ai_reference_chunks BEGIN INSERT INTO reference_search(reference_search,rowid,search_tokens) VALUES('delete',OLD.id,OLD.search_tokens); END;
--> statement-breakpoint
CREATE TRIGGER reference_search_update AFTER UPDATE ON ai_reference_chunks BEGIN INSERT INTO reference_search(reference_search,rowid,search_tokens) VALUES('delete',OLD.id,OLD.search_tokens); INSERT INTO reference_search(rowid,search_tokens) VALUES(NEW.id,NEW.search_tokens); END;
--> statement-breakpoint
CREATE TRIGGER reference_upload_commit_guard BEFORE INSERT ON ai_reference_materials WHEN NEW.object_key LIKE 'references/%' BEGIN SELECT RAISE(ABORT,'REFERENCE_UPLOAD_NOT_PENDING') WHERE NOT EXISTS(SELECT 1 FROM reference_uploads WHERE id=NEW.id AND object_key=NEW.object_key AND status='pending'); END;
--> statement-breakpoint
CREATE TRIGGER reference_cleanup_guard BEFORE UPDATE ON reference_uploads WHEN NEW.status='cleanup' BEGIN SELECT RAISE(ABORT,'REFERENCE_ALREADY_COMMITTED') WHERE EXISTS(SELECT 1 FROM ai_reference_materials WHERE id=NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER reference_uploads_purge_lock_insert BEFORE INSERT ON reference_uploads WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE') BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER reference_uploads_purge_lock_update BEFORE UPDATE ON reference_uploads WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE') BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER reference_uploads_purge_lock_delete BEFORE DELETE ON reference_uploads WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE') BEGIN SELECT RAISE(ABORT,'PURGE_IN_PROGRESS'); END;

--> statement-breakpoint
INSERT INTO reference_search(reference_search) VALUES('rebuild');
