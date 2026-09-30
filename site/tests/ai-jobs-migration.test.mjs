import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  migrationPreflight,
  migrationsFolder,
  fictionalKeys,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";
test("Phase 12 migration is atomic/retryable and legacy requests remain unauthorized", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  const migrations = readMigrationFiles({ migrationsFolder });
  await db
    .prepare(
      "CREATE TABLE __drizzle_migrations(id SERIAL PRIMARY KEY,hash text NOT NULL,created_at numeric)",
    )
    .run();
  for (const m of migrations.slice(0, 12)) {
    await db.batch(m.sql.filter((s) => s.trim()).map((s) => db.prepare(s)));
    await db
      .prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)")
      .bind(m.hash, m.folderMillis)
      .run();
  }
  await seedFictional(db, fictionalKeys());
  await db
    .prepare(
      "INSERT INTO ai_jobs(id,student_id,exam_id,audience,dedupe_key,source_version) VALUES('fictional-legacy','fictional-a','exam-1','parent','fictional-dedupe',1)",
    )
    .run();
  assert.equal((await migrationPreflight(db)).pending, 2);
  await assert.rejects(
    db.batch([
      ...migrations[12].sql.filter((s) => s.trim()).map((s) => db.prepare(s)),
      db.prepare("SELECT * FROM fictional_missing"),
    ]),
  );
  assert.ok(
    !(await db.prepare("PRAGMA table_info(ai_jobs)").all()).results.some(
      (c) => c.name === "pair_key",
    ),
  );
  await migrateLocalDatabase(db);
  await migrateLocalDatabase(db);
  const row = await db
    .prepare("SELECT * FROM ai_jobs WHERE id='fictional-legacy'")
    .first();
  assert.equal(row.status, "pending");
  assert.equal(row.pair_key, null);
  assert.equal(row.requested_by, null);
  await assert.rejects(
    db
      .prepare(
        "UPDATE ai_jobs SET pair_key='unauthorized' WHERE id='fictional-legacy'",
      )
      .run(),
  );
  assert.equal((await migrationPreflight(db)).pending, 0);
});
