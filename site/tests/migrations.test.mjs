import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema.ts";
import {
  createIsolatedDatabase,
  fictionalKeys,
  migrateLocalDatabase,
  migrationPreflight,
  migrationsFolder,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";
import {
  openIdentity,
  rotateIdentity,
  sealIdentity,
} from "../lib/server/identity.ts";

function insert(db, table, row) {
  const columns = Object.keys(row);
  return db
    .prepare(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    )
    .bind(...Object.values(row));
}
const admin = (id, extra = {}) => ({
  id,
  username: id,
  display_name: "虛構管理員",
  authorized_email: `${id}@example.test`,
  role: "viewer",
  status: "pending_identity_binding",
  ...extra,
});
const active = (id, role = "viewer") =>
  admin(id, {
    role,
    status: "active",
    google_subject_id: `fictional-google-${id}`,
    identity_bound_at: 1,
  });
const enrollment = (id, extra = {}) => ({
  id,
  student_id: "fictional-late",
  academic_year_id: "year-115",
  academic_term_id: "term-115-1",
  class_id: "class-702",
  seat_number: 9,
  effective_from: "2026-08-01",
  effective_to: "2026-09-16",
  change_source: "fictional_test",
  ...extra,
});
const participation = (id, extra = {}) => ({
  id,
  exam_id: "exam-1",
  academic_term_id: "term-115-1",
  student_id: "fictional-late",
  enrollment_id: "enroll-late",
  class_id_snapshot: "class-701",
  class_code_snapshot: "701",
  grade_snapshot: 7,
  seat_number_snapshot: 3,
  origin: "LOCAL",
  student_eligibility_snapshot: 1,
  term_eligibility_snapshot: null,
  exam_eligibility_override: null,
  ranking_eligible: 1,
  confirmed_at: 1,
  ...extra,
});
const score = (id, extra = {}) => ({
  id,
  participation_id: "part-a1",
  setting_id: "setting-1-QUIZ-ENGLISH",
  exam_id: "exam-1",
  student_id: "fictional-a",
  exam_type: "QUIZ",
  subject: "ENGLISH",
  origin: "LOCAL",
  class_id_snapshot: "class-701",
  score_value: 8750,
  score_status: "NORMAL",
  include_in_average: 1,
  include_in_ranking: 1,
  ...extra,
});
const rejects = (promise, pattern) =>
  assert.rejects(
    promise,
    (error) => pattern.test(String(error)) || pattern.test(String(error.cause)),
  );

test("Phase 1: real migrations, fictional seed and database boundaries", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  const keys = fictionalKeys();
  try {
    await t.test(
      "empty preflight, all core tables/indexes/FKs, repeat migration and seed isolation",
      async () => {
        assert.equal((await migrationPreflight(db)).pending, 4);
        assert.deepEqual(await migrateLocalDatabase(db), {
          applied: 4,
          pending: 0,
          foreignKeys: "ok",
          integrity: "ok",
        });
        for (const table of Object.values(schema)) {
          const config = getTableConfig(table);
          const columns = (
            await db.prepare(`PRAGMA table_info('${config.name}')`).all()
          ).results;
          assert.deepEqual(
            columns.map((column) => column.name),
            config.columns.map((column) => column.name),
          );
          for (const idx of config.indexes)
            assert.ok(
              await db
                .prepare(
                  "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = ?",
                )
                .bind(idx.config.name)
                .first(),
            );
        }
        assert.equal(Object.keys(schema).length, 33);
        assert.ok(
          await db
            .prepare(
              "SELECT name FROM sqlite_schema WHERE name = 'ai_reference_chunks_fts'",
            )
            .first(),
        );
        await seedFictional(db, keys);
        await migrateLocalDatabase(db);
        assert.equal(
          (await db.prepare("SELECT count(*) AS n FROM students").first()).n,
          4,
        );
        assert.equal(
          (await db.prepare("SELECT count(*) AS n FROM admin_users").first()).n,
          0,
        );
        assert.equal(
          (
            await db
              .prepare("SELECT count(*) AS n FROM bootstrap_state")
              .first()
          ).n,
          0,
        );
        await rejects(seedFictional(db, keys), /SEED_REQUIRES_EMPTY_DATABASE/);
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM students WHERE name = ? AND birth_date = ?",
              )
              .bind("虛構同名學生", "2013-05-10")
              .first()
          ).n,
          2,
        );
      },
    );

    await t.test(
      "invalid dates, grade/class mismatch, unknown FKs and cross-year links are rejected",
      async () => {
        await rejects(
          insert(db, "classes", {
            id: "bad-grade",
            academic_year_id: "year-115",
            grade: 8,
            code: "703",
          }).run(),
          /class_grade_code/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE students SET birth_date = '2026-02-30' WHERE id = 'fictional-a'",
            )
            .run(),
          /student_birth_date/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE students SET created_at = 0.5 WHERE id = 'fictional-a'",
            )
            .run(),
          /INVALID_UTC_TIMESTAMP/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE students SET student_number = 'changed' WHERE id = 'fictional-a'",
            )
            .run(),
          /STUDENT_NUMBER_IMMUTABLE/,
        );
        await rejects(
          insert(db, "student_term_ranking_policies", {
            id: "bad-fk",
            student_id: "unknown",
            academic_term_id: "term-115-1",
          }).run(),
          /FOREIGN KEY/,
        );
        await insert(db, "academic_years", {
          id: "year-116",
          code: "116",
          starts_on: "2027-08-01",
          ends_on: "2028-08-01",
        }).run();
        await insert(db, "classes", {
          id: "class-next",
          academic_year_id: "year-116",
          grade: 8,
          code: "801",
        }).run();
        await rejects(
          insert(
            db,
            "student_enrollments",
            enrollment("bad-year", { class_id: "class-next" }),
          ).run(),
          /FOREIGN KEY/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE academic_terms SET ends_on = '2026-09-01' WHERE id = 'term-115-1'",
            )
            .run(),
          /TERM_EXCLUDES_CHILD/,
        );
      },
    );

    await t.test(
      "student and seat ranges cannot overlap; adjoining and voided enrollments are valid",
      async () => {
        await rejects(
          insert(
            db,
            "student_enrollments",
            enrollment("overlap", { effective_to: "2026-09-17" }),
          ).run(),
          /STUDENT_ENROLLMENT_OVERLAP/,
        );
        await rejects(
          insert(
            db,
            "student_enrollments",
            enrollment("seat-overlap", {
              class_id: "class-701",
              seat_number: 1,
            }),
          ).run(),
          /CLASS_SEAT_OVERLAP/,
        );
        await insert(db, "student_enrollments", enrollment("boundary")).run();
        await rejects(
          db
            .prepare(
              "UPDATE student_enrollments SET effective_to = '2026-09-17' WHERE id = 'boundary'",
            )
            .run(),
          /STUDENT_ENROLLMENT_OVERLAP/,
        );
        await db
          .prepare(
            "UPDATE student_enrollments SET status = 'voided' WHERE id = 'boundary'",
          )
          .run();
        await insert(
          db,
          "student_enrollments",
          enrollment("replacement"),
        ).run();
        await db
          .prepare(
            "UPDATE student_enrollments SET status = 'voided' WHERE id = 'replacement'",
          )
          .run();
      },
    );

    await t.test(
      "late transfer waits until next exam; D-03 sources and historical snapshots are frozen",
      async () => {
        await rejects(
          insert(db, "exam_participations", participation("late-exam1")).run(),
          /INVALID_PARTICIPATION_SNAPSHOT/,
        );
        await rejects(
          insert(
            db,
            "exam_participations",
            participation("stale-source", {
              exam_id: "exam-2",
              student_eligibility_snapshot: 0,
              ranking_eligible: 0,
            }),
          ).run(),
          /STALE_ELIGIBILITY_SNAPSHOT/,
        );
        await insert(
          db,
          "exam_participations",
          participation("part-late2", { exam_id: "exam-2" }),
        ).run();
        const before = await db
          .prepare("SELECT * FROM exam_participations WHERE id = 'part-a1'")
          .first();
        await db
          .prepare(
            "UPDATE students SET ranking_eligible_default = 0 WHERE id = 'fictional-a'",
          )
          .run();
        await db
          .prepare(
            "UPDATE student_enrollments SET status = 'voided' WHERE id = 'enroll-a2'",
          )
          .run();
        assert.deepEqual(
          await db
            .prepare("SELECT * FROM exam_participations WHERE id = 'part-a1'")
            .first(),
          before,
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT class_id_snapshot FROM exam_participations WHERE id = 'part-a2'",
              )
              .first()
          ).class_id_snapshot,
          "class-702",
        );
        await rejects(
          db
            .prepare(
              "UPDATE exam_participations SET ranking_eligible = 0 WHERE id = 'part-a1'",
            )
            .run(),
          /PARTICIPATION_SNAPSHOT_IMMUTABLE/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE student_enrollments SET seat_number = 7 WHERE id = 'enroll-a1'",
            )
            .run(),
          /ENROLLMENT_HAS_FROZEN_SNAPSHOT/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE exams SET starts_on = '2026-09-16' WHERE id = 'exam-1'",
            )
            .run(),
          /EXAM_HAS_FROZEN_ROSTER/,
        );
        await db
          .prepare(
            "UPDATE students SET ranking_eligible_default = 1 WHERE id = 'fictional-a'",
          )
          .run();
      },
    );

    await t.test(
      "zero is valid; NULL, fractional storage, negatives and special-status numbers are rejected",
      async () => {
        assert.equal(
          (
            await db
              .prepare(
                "SELECT score_value FROM score_items WHERE id = 'score-zero'",
              )
              .first()
          ).score_value,
          0,
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT score_value FROM score_items WHERE id = 'score-absent'",
              )
              .first()
          ).score_value,
          null,
        );
        for (const value of [null, -1, 10001, 1.5])
          await rejects(
            insert(
              db,
              "score_items",
              score(`bad-${value}`, { score_value: value }),
            ).run(),
            /score_value_status/,
          );
        for (const status of [
          "ABSENT",
          "OFFICIAL_LEAVE",
          "SICK_LEAVE",
          "EXEMPT",
          "UNENTERED",
        ]) {
          await rejects(
            insert(
              db,
              "score_items",
              score(`bad-${status}`, { score_status: status }),
            ).run(),
            /score_value_status/,
          );
          await insert(
            db,
            "score_items",
            score(`valid-${status}`, {
              score_status: status,
              score_value: null,
              include_in_average: 0,
            }),
          ).run();
          await db
            .prepare("DELETE FROM score_items WHERE id = ?")
            .bind(`valid-${status}`)
            .run();
        }
        await insert(db, "score_items", score("score-english")).run();
        await rejects(
          db
            .prepare(
              "UPDATE score_items SET score_value = -1 WHERE id = 'score-english'",
            )
            .run(),
          /score_value_status/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE score_items SET class_id_snapshot = 'class-702' WHERE id = 'score-english'",
            )
            .run(),
          /SCORE_IDENTITY_IMMUTABLE/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE score_items SET student_id = 'fictional-b' WHERE id = 'score-english'",
            )
            .run(),
          /SCORE_IDENTITY_IMMUTABLE/,
        );
      },
    );

    await t.test(
      "NOT_HELD is global; external marks cannot join local ranking",
      async () => {
        await rejects(
          insert(
            db,
            "score_items",
            score("held-wrong", {
              score_status: "NOT_HELD",
              score_value: null,
              include_in_average: 0,
              setting_id: "setting-1-QUIZ-MATH",
              subject: "MATH",
            }),
          ).run(),
          /SCORE_HELD_MISMATCH/,
        );
        await insert(
          db,
          "score_items",
          score("not-held", {
            setting_id: "setting-1-MIDTERM-CIVICS",
            exam_type: "MIDTERM",
            subject: "CIVICS",
            score_status: "NOT_HELD",
            score_value: null,
            include_in_average: 0,
          }),
        ).run();
        await rejects(
          db
            .prepare(
              "UPDATE exam_subject_settings SET held = 1 WHERE id = 'setting-1-MIDTERM-CIVICS'",
            )
            .run(),
          /SETTING_HAS_SCORES/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE score_items SET include_in_ranking = 1 WHERE id = 'score-external'",
            )
            .run(),
          /SCORE_SNAPSHOT|score_origin_ranking/,
        );
        await rejects(
          insert(
            db,
            "exam_participations",
            participation("external-rank", {
              student_id: "fictional-external",
              exam_id: "exam-2",
              origin: "EXTERNAL_TRANSFER",
              enrollment_id: null,
              class_id_snapshot: null,
              class_code_snapshot: null,
              grade_snapshot: null,
              seat_number_snapshot: null,
              external_school_label: "虛構原學校",
              ranking_eligible: 1,
              exam_eligibility_override: 1,
            }),
          ).run(),
          /participation_source/,
        );
      },
    );

    await t.test(
      "batch failure rolls back earlier writes and does not erase later valid data",
      async () => {
        await rejects(
          db.batch([
            db.prepare(
              "UPDATE score_items SET score_value = 9900 WHERE id = 'score-zero'",
            ),
            db.prepare(
              "UPDATE score_items SET score_value = -1 WHERE id = 'score-english'",
            ),
          ]),
          /score_value_status/,
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT score_value FROM score_items WHERE id = 'score-zero'",
              )
              .first()
          ).score_value,
          0,
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT score_value FROM score_items WHERE id = 'score-english'",
              )
              .first()
          ).score_value,
          8750,
        );
        await rejects(
          db.prepare("DELETE FROM students WHERE id = 'fictional-a'").run(),
          /FOREIGN KEY/,
        );
      },
    );

    await t.test(
      "identity rotation is atomic and cross-version duplicates remain blocked",
      async () => {
        const old = await db
          .prepare(
            "SELECT identity_number_encrypted AS encrypted, identity_encryption_key_version AS encryptionKeyVersion FROM students WHERE id = 'fictional-a'",
          )
          .first();
        const target = {
          encryption: {
            version: 2,
            bytes: crypto.getRandomValues(new Uint8Array(32)),
          },
          lookup: [
            ...keys.lookup,
            { version: 2, bytes: crypto.getRandomValues(new Uint8Array(32)) },
          ],
        };
        const rotated = await rotateIdentity(
          "fictional-a",
          old,
          [keys.encryption],
          target,
        );
        await db.batch([
          db
            .prepare(
              "UPDATE students SET identity_number_encrypted = ?, identity_encryption_key_version = ? WHERE id = 'fictional-a'",
            )
            .bind(rotated.encrypted, 2),
          insert(db, "student_identity_lookup_hashes", {
            student_id: "fictional-a",
            key_version: 2,
            identity_number_lookup_hash: rotated.lookupHashes[1].hash,
          }),
        ]);
        assert.equal(
          await openIdentity("fictional-a", rotated.encrypted, 2, [
            target.encryption,
          ]),
          "fictional-identity-a",
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM student_identity_lookup_hashes WHERE student_id = 'fictional-a'",
              )
              .first()
          ).n,
          2,
        );
        const duplicate = await sealIdentity(
          "fictional-b",
          "fictional-identity-a",
          target,
        );
        await rejects(
          db.batch([
            db
              .prepare(
                "UPDATE students SET identity_number_encrypted = ?, identity_encryption_key_version = 2 WHERE id = 'fictional-b'",
              )
              .bind(duplicate.encrypted),
            insert(db, "student_identity_lookup_hashes", {
              student_id: "fictional-b",
              key_version: 2,
              identity_number_lookup_hash: duplicate.lookupHashes[1].hash,
            }),
          ]),
          /UNIQUE/,
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT identity_encryption_key_version AS v FROM students WHERE id = 'fictional-b'",
              )
              .first()
          ).v,
          1,
        );
        // Unmigrated student has only v1; new writes must include retained v1 to catch that duplicate.
        const mixed = await sealIdentity(
          "fictional-new-duplicate",
          "fictional-identity-b",
          target,
        );
        await rejects(
          db.batch([
            insert(db, "students", {
              id: "fictional-new-duplicate",
              student_number: "FICTIONAL-NEW-DUPLICATE",
              name: "虛構重複資料",
              birth_date: "2013-01-01",
              identity_number_encrypted: mixed.encrypted,
              identity_encryption_key_version: 2,
            }),
            ...mixed.lookupHashes.map((hash) =>
              insert(db, "student_identity_lookup_hashes", {
                student_id: "fictional-new-duplicate",
                key_version: hash.keyVersion,
                identity_number_lookup_hash: hash.hash,
              }),
            ),
          ]),
          /UNIQUE/,
        );
        assert.equal(
          await db
            .prepare(
              "SELECT id FROM students WHERE id = 'fictional-new-duplicate'",
            )
            .first(),
          null,
        );
      },
    );

    await t.test(
      "Google-bound active accounts, reserved admin and last super-admin safeguards",
      async () => {
        await rejects(
          insert(
            db,
            "admin_users",
            admin("unbound", { status: "active" }),
          ).run(),
          /admin_active_binding/,
        );
        await insert(db, "admin_users", active("admin", "super_admin")).run();
        await rejects(
          db
            .prepare(
              "UPDATE admin_users SET username = 'renamed' WHERE id = 'admin'",
            )
            .run(),
          /RESERVED_ADMIN_IMMUTABLE/,
        );
        await rejects(
          db.prepare("DELETE FROM admin_users WHERE id = 'admin'").run(),
          /LAST_ACTIVE_SUPER_ADMIN|RESERVED_ADMIN_IMMUTABLE/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE admin_users SET status = 'disabled' WHERE id = 'admin'",
            )
            .run(),
          /LAST_ACTIVE_SUPER_ADMIN/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE admin_users SET role = 'viewer' WHERE id = 'admin'",
            )
            .run(),
          /LAST_ACTIVE_SUPER_ADMIN/,
        );
        const attempts = await Promise.allSettled(
          [1, 2].map((initialized_at) =>
            insert(db, "bootstrap_state", {
              id: 1,
              initialized_by: "admin",
              initialized_at,
            }).run(),
          ),
        );
        assert.equal(
          attempts.filter((result) => result.status === "fulfilled").length,
          1,
        );
        await rejects(
          insert(db, "bootstrap_state", {
            id: 1,
            initialized_by: "admin",
            initialized_at: 2,
          }).run(),
          /UNIQUE/,
        );
        await rejects(
          db.prepare("DELETE FROM bootstrap_state").run(),
          /BOOTSTRAP_ALREADY_INITIALIZED/,
        );
        await rejects(
          db.prepare("UPDATE bootstrap_state SET initialized_at = 2").run(),
          /BOOTSTRAP_ALREADY_INITIALIZED/,
        );
      },
    );

    await t.test(
      "session hashes only; binding and scope changes invalidate existing sessions",
      async () => {
        await insert(db, "admin_users", active("viewer")).run();
        const session = {
          id: "session-viewer",
          admin_user_id: "viewer",
          token_hash: "a".repeat(64),
          auth_version: 1,
          authenticated_at: 1,
          last_seen_at: 1,
          expires_at: 10000,
        };
        await rejects(
          insert(db, "admin_sessions", {
            ...session,
            token_hash: "plaintext-token",
          }).run(),
          /session_hash/,
        );
        await insert(db, "admin_sessions", session).run();
        await db
          .prepare(
            "UPDATE admin_users SET google_subject_id = 'fictional-new-binding' WHERE id = 'viewer'",
          )
          .run();
        assert.notEqual(
          (
            await db
              .prepare(
                "SELECT revoked_at FROM admin_sessions WHERE id = 'session-viewer'",
              )
              .first()
          ).revoked_at,
          null,
        );
        await insert(db, "admin_sessions", {
          ...session,
          id: "session-scope",
          token_hash: "b".repeat(64),
        }).run();
        await insert(db, "admin_assignments", {
          id: "assignment",
          admin_user_id: "viewer",
          academic_term_id: "term-115-1",
          scope_type: "homeroom",
          class_id: "class-701",
          starts_on: "2026-08-01",
        }).run();
        assert.notEqual(
          (
            await db
              .prepare(
                "SELECT revoked_at FROM admin_sessions WHERE id = 'session-scope'",
              )
              .first()
          ).revoked_at,
          null,
        );
        await db
          .prepare(
            "UPDATE admin_users SET status = 'disabled' WHERE id = 'viewer'",
          )
          .run();
        await rejects(
          insert(db, "admin_sessions", {
            ...session,
            id: "disabled-session",
            token_hash: "c".repeat(64),
          }).run(),
          /INVALID_SESSION_PRINCIPAL/,
        );
        await rejects(
          insert(db, "system_settings", {
            key: "OPENAI_API_KEY",
            value_json: '"synthetic"',
          }).run(),
          /settings_key_allowlist/,
        );
        const columns = (
          await db.prepare("PRAGMA table_info(admin_users)").all()
        ).results
          .map((row) => row.name)
          .join(" ");
        assert.doesNotMatch(columns, /chatgpt|gemini|password|api_key/);
      },
    );

    await t.test(
      "FTS reflects inserts/edits/deletes; archive/expiry filters preserve stored chunks",
      async () => {
        await insert(db, "ai_reference_materials", {
          id: "material",
          title: "虛構參考教材",
          object_key: "fictional/material.txt",
          content_hash: "d".repeat(64),
          status: "active",
          valid_from: "2026-09-01",
          valid_to: "2026-10-01",
          created_by: "admin",
        }).run();
        await insert(db, "ai_reference_chunks", {
          id: 1,
          material_id: "material",
          material_version: 1,
          ordinal: 0,
          content: "fictional algebra guidance",
          content_hash: "e".repeat(64),
        }).run();
        const search = (term, day = "2026-09-23") =>
          db
            .prepare(
              "SELECT c.id FROM ai_reference_chunks_fts JOIN ai_reference_chunks c ON c.id = ai_reference_chunks_fts.rowid JOIN ai_reference_materials m ON m.id = c.material_id WHERE ai_reference_chunks_fts MATCH ? AND m.status = 'active' AND c.material_version = m.version AND (m.valid_from IS NULL OR m.valid_from <= ?) AND (m.valid_to IS NULL OR m.valid_to > ?)",
            )
            .bind(term, day, day)
            .all();
        assert.equal((await search("algebra")).results.length, 1);
        assert.equal((await search("algebra", "2026-10-01")).results.length, 0);
        await db
          .prepare(
            "UPDATE ai_reference_chunks SET content = 'fictional geometry guidance' WHERE id = 1",
          )
          .run();
        assert.equal((await search("algebra")).results.length, 0);
        assert.equal((await search("geometry")).results.length, 1);
        await db
          .prepare(
            "UPDATE ai_reference_materials SET status = 'archived' WHERE id = 'material'",
          )
          .run();
        assert.equal((await search("geometry")).results.length, 0);
        assert.equal(
          (
            await db
              .prepare("SELECT count(*) AS n FROM ai_reference_chunks")
              .first()
          ).n,
          1,
        );
        await db.prepare("DELETE FROM ai_reference_chunks WHERE id = 1").run();
        assert.equal(
          (
            await db
              .prepare(
                "SELECT rowid FROM ai_reference_chunks_fts WHERE ai_reference_chunks_fts MATCH 'geometry'",
              )
              .all()
          ).results.length,
          0,
        );
      },
    );

    await t.test(
      "publication version and AI source links cannot cross students/exams; transfer stops new jobs",
      async () => {
        await insert(db, "exam_result_versions", {
          id: "result-v1",
          exam_id: "exam-1",
          source_version: 1,
          calculation_version: "future-calculation-fixture",
          provisional: 1,
        }).run();
        await rejects(
          insert(db, "exam_results", {
            id: "cross-exam",
            result_version_id: "result-v1",
            exam_id: "exam-1",
            participation_id: "part-a2",
            computed_json: "{}",
          }).run(),
          /RESULT_PARTICIPATION_MISMATCH/,
        );
        await rejects(
          insert(db, "exam_results", {
            id: "external-ranked",
            result_version_id: "result-v1",
            exam_id: "exam-1",
            participation_id: "part-external",
            class_rank: 1,
            computed_json: "{}",
          }).run(),
          /RESULT_PARTICIPATION_MISMATCH/,
        );
        const job = {
          id: "job",
          student_id: "fictional-a",
          exam_id: "exam-1",
          result_version_id: "result-v1",
          audience: "parent",
          dedupe_key: "fictional-job",
          source_version: 1,
        };
        await rejects(
          insert(db, "ai_jobs", { ...job, source_version: 2 }).run(),
          /JOB_SOURCE_MISMATCH/,
        );
        await insert(db, "ai_jobs", job).run();
        await rejects(
          insert(db, "ai_jobs", { ...job, id: "duplicate-job" }).run(),
          /UNIQUE/,
        );
        await rejects(
          insert(db, "ai_advices", {
            id: "bad-advice",
            job_id: "job",
            student_id: "fictional-b",
            exam_id: "exam-1",
            audience: "parent",
            source_version: 1,
            provider: "openai",
            model: "fictional-model",
            prompt_version: "fixture",
            content: "fictional",
          }).run(),
          /ADVICE_JOB_MISMATCH/,
        );
        await db
          .prepare(
            "UPDATE students SET status = 'transferred_out', transferred_out_on = '2026-12-01' WHERE id = 'fictional-a'",
          )
          .run();
        await rejects(
          insert(db, "ai_jobs", {
            ...job,
            id: "transfer-job",
            dedupe_key: "fictional-transfer",
          }).run(),
          /STUDENT_CANNOT_RECEIVE_NEW_ADVICE/,
        );
        await rejects(
          insert(
            db,
            "score_items",
            score("transfer-score", {
              subject: "MATH",
              setting_id: "setting-1-QUIZ-MATH",
            }),
          ).run(),
          /STUDENT_NOT_ACTIVE/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE students SET retention_until = '2029-12-01', public_query_until = '2029-12-02' WHERE id = 'fictional-a'",
            )
            .run(),
          /student_retention_dates/,
        );
      },
    );

    await t.test(
      "versioned import/archive/history fields keep recoverable data without cascade deletes",
      async () => {
        await insert(db, "score_change_history", {
          id: "history",
          score_item_id: "score-zero",
          student_id: "fictional-a",
          actor_id: "admin",
          operation_id: "fictional-change",
          reason: "虛構測試原因",
          before_json: '{"score_value":0}',
          after_json: '{"score_value":100}',
          from_version: 1,
          to_version: 2,
        }).run();
        await rejects(
          db.prepare("DELETE FROM score_items WHERE id = 'score-zero'").run(),
          /FOREIGN KEY/,
        );
        await rejects(
          db
            .prepare(
              "UPDATE score_change_history SET student_id = 'fictional-b' WHERE id = 'history'",
            )
            .run(),
          /SCORE_HISTORY_APPEND_ONLY/,
        );
        await insert(db, "import_jobs", {
          id: "import",
          actor_id: "admin",
          kind: "scores",
          status: "preview",
          object_key: "fictional/import.csv",
          file_hash: "f".repeat(64),
        }).run();
        await insert(db, "import_job_items", {
          id: "import-item",
          job_id: "import",
          row_number: 1,
          entity_type: "score",
          entity_id: "score-zero",
          student_id: "fictional-a",
          status: "valid",
          source_version: 1,
          before_json: "{}",
          after_json: "{}",
        }).run();
        await rejects(
          db
            .prepare(
              "UPDATE import_jobs SET rollback_until = 1 WHERE id = 'import'",
            )
            .run(),
          /import_rollback_window/,
        );
        await insert(db, "archive_batches", {
          id: "archive",
          actor_id: "admin",
          reason: "虛構封存",
          status: "prepared",
          manifest_json: '{"items":1}',
          created_at: 1,
          undo_until: 2,
        }).run();
        await insert(db, "archive_items", {
          id: "archive-item",
          batch_id: "archive",
          entity_type: "student",
          entity_id: "fictional-a",
          student_id: "fictional-a",
          source_version: 1,
          snapshot_json: "{}",
          status: "prepared",
        }).run();
        await rejects(
          db.prepare("DELETE FROM archive_batches WHERE id = 'archive'").run(),
          /FOREIGN KEY/,
        );
        assert.equal((await migrationPreflight(db)).foreignKeys, "ok");
      },
    );

    await t.test(
      "preflight detects journal tampering and missing constraint triggers",
      async () => {
        const row = await db
          .prepare(
            "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at LIMIT 1",
          )
          .first();
        await db
          .prepare(
            "UPDATE __drizzle_migrations SET hash = 'altered' WHERE created_at = ?",
          )
          .bind(row.created_at)
          .run();
        await rejects(migrationPreflight(db), /MIGRATION_HISTORY_MISMATCH/);
        await db
          .prepare(
            "UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?",
          )
          .bind(row.hash, row.created_at)
          .run();
        await db.prepare("DROP TRIGGER participation_snapshot_immutable").run();
        await rejects(
          migrationPreflight(db),
          /MIGRATION_SCHEMA_OBJECT_MISSING/,
        );
      },
    );
  } finally {
    await mf.dispose();
  }
});

test("migration recovery: failed DDL batch is atomic, and replay from a fresh database succeeds", async () => {
  const { mf, db } = await createIsolatedDatabase();
  try {
    const first = readMigrationFiles({ migrationsFolder })[0];
    await rejects(
      db.batch([
        ...first.sql.map((statement) => db.prepare(statement)),
        db.prepare("INSERT INTO missing_table VALUES (1)"),
      ]),
      /no such table/,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT name FROM sqlite_schema WHERE name = 'students'")
          .all()
      ).results.length,
      0,
    );
    // Simulate a completed first migration followed by an interrupted deployment.
    await db
      .prepare(
        "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
      )
      .run();
    await db.batch([
      ...first.sql.map((statement) => db.prepare(statement)),
      db
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .bind(first.hash, first.folderMillis),
    ]);
    assert.equal((await migrationPreflight(db)).pending, 3);
    await insert(db, "admin_users", admin("recovery-admin")).run();
    await insert(db, "ai_reference_materials", {
      id: "existing-material",
      title: "虛構復原測試",
      object_key: "fictional/recovery.txt",
      content_hash: "d".repeat(64),
      created_by: "recovery-admin",
    }).run();
    await insert(db, "ai_reference_chunks", {
      id: 1,
      material_id: "existing-material",
      material_version: 1,
      ordinal: 0,
      content: "recoverable fictional material",
      content_hash: "e".repeat(64),
    }).run();
    await migrateLocalDatabase(db);
    assert.equal((await migrationPreflight(db)).pending, 0);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT rowid FROM ai_reference_chunks_fts WHERE ai_reference_chunks_fts MATCH 'recoverable'",
          )
          .all()
      ).results.length,
      1,
    );
  } finally {
    await mf.dispose();
  }
});

test("migration preflight refuses untracked existing schemas", async () => {
  const { mf, db } = await createIsolatedDatabase();
  try {
    await db.prepare("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)").run();
    await rejects(migrateLocalDatabase(db), /UNTRACKED_SCHEMA/);
  } finally {
    await mf.dispose();
  }
});
