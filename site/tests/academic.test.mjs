import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { AcademicService } from "../lib/server/academic/service.ts";
import {
  createIsolatedDatabase,
  fictionalKeys,
  migrateLocalDatabase,
  migrationPreflight,
  migrationsFolder,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";

const rejects = (promise, code) =>
  assert.rejects(promise, (error) => error.code === code);
const sql = (db, query, ...values) => db.prepare(query).bind(...values);
const one = (db, query, ...values) => sql(db, query, ...values).first();
const all = async (db, query, ...values) =>
  (await sql(db, query, ...values).all()).results;
const now = Date.UTC(2030, 0, 1);

async function setup(t) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  for (const [id, role, hash] of [
    ["admin-a", "super_admin", "a"],
    ["admin-b", "viewer", "b"],
  ]) {
    await sql(
      db,
      "INSERT INTO admin_users (id, username, display_name, authorized_email, google_subject_id, role, status, identity_bound_at) VALUES (?, ?, '虛構測試管理員', ?, ?, ?, 'active', ?)",
      id,
      id,
      `${id}@example.test`,
      `fictional-${id}`,
      role,
      now - 1000,
    ).run();
    await sql(
      db,
      "INSERT INTO admin_sessions (id, admin_user_id, token_hash, auth_version, authenticated_at, last_seen_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
      `session-${id}`,
      id,
      hash.repeat(64),
      now - 1000,
      now - 1000,
      now + 86400000,
    ).run();
  }
  const keys = fictionalKeys();
  const grants = {
    adminId: "admin-a",
    sessionId: "session-admin-a",
    recentGoogleAuthentication: false,
  };
  const policy = {
    deniedClasses: new Set(),
    deniedActions: new Set(),
    deniedStudents: new Set(),
    calls: [],
  };
  const authorize = async (request) => {
    policy.calls.push(structuredClone(request));
    if (
      policy.deniedActions.has(request.action) ||
      request.resources.classIds.some((id) => policy.deniedClasses.has(id)) ||
      request.resources.studentIds.some((id) => policy.deniedStudents.has(id))
    )
      return null;
    return { ...grants };
  };
  const dependencies = {
    db,
    authorize,
    identityKeys: () => keys,
    now: () => now,
  };
  const service = new AcademicService(dependencies);
  const confirm = (preview) => service.confirm(preview.id, { confirmed: true });
  const year = async (
    code = "115",
    startsOn = "2026-08-01",
    secondTermStartsOn = "2027-02-01",
    endsOn = "2027-08-01",
  ) => {
    const preview = await service.previewAcademicYear({
      code,
      startsOn,
      secondTermStartsOn,
      endsOn,
    });
    const result = await confirm(preview);
    return {
      id: result.yearIds[0],
      terms: await all(
        db,
        "SELECT * FROM academic_terms WHERE academic_year_id = ? ORDER BY term_number",
        result.yearIds[0],
      ),
    };
  };
  const classes = async (yearId, codes, options = {}) => {
    const preview = await service.previewClasses(yearId, codes, options);
    await confirm(preview);
    return Object.fromEntries(
      preview.rows.map((row) => [row.code, row.classId]),
    );
  };
  const first = await year();
  const rooms = await classes(first.id, ["701", "702", "801", "901"]);
  const student = (number, room = rooms["701"], extra = {}) => ({
    name: `虛構學生${number}`,
    birthDate: "2013-05-10",
    studentNumber: `FICTIONAL-${number}`,
    identityNumber: `fictional-identity-${number}`,
    classId: room,
    seatNumber: number,
    effectiveFrom: first.terms[0].starts_on,
    ...extra,
  });
  const add = async (inputs, termId = first.terms[0].id, mode = "new") => {
    const preview = await service.previewNewStudents(termId, inputs, mode);
    const receipt = await confirm(preview);
    return { preview, receipt, ids: preview.rows.map((row) => row.studentId) };
  };
  return {
    db,
    keys,
    grants,
    policy,
    dependencies,
    service,
    confirm,
    year,
    classes,
    first,
    rooms,
    student,
    add,
  };
}

test("Phase 2 academic foundation, preview confirmation and default denial", async (t) => {
  const f = await setup(t);
  await t.test(
    "year atomically has exactly two explicit-date terms; new year makes earlier year historical",
    async () => {
      assert.equal(f.first.terms.length, 2);
      assert.equal(f.first.terms[0].ends_on, f.first.terms[1].starts_on);
      assert.equal(
        (await f.service.listAcademicYears())[0].historical_read_only,
        0,
      );
      await rejects(
        f.service.previewAcademicYear({
          code: "overlap",
          startsOn: "2027-01-01",
          secondTermStartsOn: "2027-02-01",
          endsOn: "2027-08-01",
        }),
        "YEAR_OVERLAP_OR_NOT_NEWER",
      );
      await rejects(
        f.service.previewAcademicYear({
          code: "invalid",
          startsOn: "2027-08-01",
          secondTermStartsOn: "2027-08-01",
          endsOn: "2028-08-01",
        }),
        "INVALID_YEAR_INTERVAL",
      );
      await f.year("116", "2027-08-01", "2028-02-01", "2028-08-01");
      const years = await f.service.listAcademicYears();
      assert.deepEqual(
        years.map((row) => [row.code, row.historical_read_only]),
        [
          ["116", 0],
          ["115", 1],
        ],
      );
    },
  );
  await t.test(
    "historical write requires super-admin, trusted Google recent authentication and reason",
    async () => {
      await rejects(
        f.service.previewClasses(f.first.id, ["703"]),
        "HISTORICAL_YEAR_LOCKED",
      );
      f.grants.recentGoogleAuthentication = true;
      await rejects(
        f.service.previewClasses(f.first.id, ["703"]),
        "HISTORICAL_YEAR_LOCKED",
      );
      f.grants.adminId = "admin-b";
      f.grants.sessionId = "session-admin-b";
      await rejects(
        f.service.previewClasses(f.first.id, ["703"], {
          historyReason: "虛構歷史修正",
        }),
        "HISTORICAL_YEAR_LOCKED",
      );
      f.grants.adminId = "admin-a";
      f.grants.sessionId = "session-admin-a";
      const preview = await f.service.previewClasses(f.first.id, ["703"], {
        historyReason: "虛構歷史修正",
      });
      f.grants.recentGoogleAuthentication = false;
      await rejects(f.confirm(preview), "HISTORICAL_YEAR_LOCKED");
      f.grants.recentGoogleAuthentication = true;
      await f.confirm(preview);
      assert.equal(
        (await f.service.listAcademicYears()).find(
          (row) => row.id === f.first.id,
        ).historical_read_only,
        1,
      );
      const audit = await one(
        f.db,
        "SELECT metadata_json FROM audit_logs WHERE operation_id = ?",
        preview.id,
      );
      assert.equal(JSON.parse(audit.metadata_json).reason, "虛構歷史修正");
      f.grants.recentGoogleAuthentication = false;
      await rejects(
        f.service.previewClasses(f.first.id, ["704"], {
          historyReason: "虛構歷史修正",
        }),
        "HISTORICAL_YEAR_LOCKED",
      );
    },
  );
  await t.test(
    "no authorization adapter defaults to denial; read paths check scope",
    async () => {
      const denied = new AcademicService({ db: f.db, now: () => now });
      await rejects(denied.listAcademicYears(), "ACCESS_DENIED");
      f.policy.deniedClasses.add(f.rooms["701"]);
      await rejects(
        f.service.classRoster(
          f.first.terms[0].id,
          f.rooms["701"],
          "2026-09-01",
        ),
        "ACCESS_DENIED",
      );
      f.policy.deniedClasses.clear();
      await rejects(
        f.service.previewClasses(f.first.id, ["wrong"]),
        "INVALID_CLASS_CODE",
      );
    },
  );
});

test("Phase 2 new students: encrypted identifiers, duplicate boundaries and atomic batches", async (t) => {
  const f = await setup(t);
  await t.test(
    "preview writes no students; explicit confirmation creates profiles and enrollment together",
    async () => {
      const rows = [
        f.student(1, undefined, { name: "虛構同名學生" }),
        f.student(2, undefined, { name: "虛構同名學生" }),
      ];
      const preview = await f.service.previewNewStudents(
        f.first.terms[0].id,
        rows,
      );
      assert.equal(
        (await one(f.db, "SELECT count(*) AS n FROM students")).n,
        0,
      );
      const stored = await one(
        f.db,
        "SELECT payload_json FROM academic_previews WHERE id = ?",
        preview.id,
      );
      assert.equal(
        stored.payload_json.includes(rows[0].identityNumber.toUpperCase()),
        false,
      );
      assert.equal(
        JSON.stringify(preview).includes(rows[0].identityNumber.toUpperCase()),
        false,
      );
      await rejects(
        f.service.confirm(preview.id, { confirmed: false }),
        "CONFIRMATION_REQUIRED",
      );
      await f.confirm(preview);
      assert.equal(
        (await one(f.db, "SELECT count(*) AS n FROM students")).n,
        2,
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM student_identity_lookup_hashes",
          )
        ).n,
        2,
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT payload_json FROM academic_previews WHERE id = ?",
            preview.id,
          )
        ).payload_json,
        "{}",
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[0].id,
            f.rooms["701"],
            "2026-08-01",
          )
        ).length,
        2,
      );
      const logs = await all(f.db, "SELECT metadata_json FROM audit_logs");
      assert.equal(JSON.stringify(logs).includes("虛構同名學生"), false);
      assert.equal(
        JSON.stringify(logs).includes(rows[0].identityNumber),
        false,
      );
    },
  );
  await t.test(
    "same name/birthday is allowed; normalized identity and student number duplicates are blocked",
    async () => {
      await rejects(
        f.service.previewNewStudents(f.first.terms[0].id, [
          f.student(3, undefined, {
            identityNumber: "  FICTIONAL-IDENTITY-1  ",
          }),
        ]),
        "STUDENT_ALREADY_EXISTS",
      );
      await rejects(
        f.service.previewNewStudents(f.first.terms[0].id, [f.student(1)]),
        "STUDENT_ALREADY_EXISTS",
      );
      await rejects(
        f.service.previewNewStudents(f.first.terms[0].id, [
          f.student(3),
          f.student(4, undefined, { identityNumber: "FICTIONAL-IDENTITY-3" }),
        ]),
        "DUPLICATE_STUDENT_INPUT",
      );
      await rejects(
        f.service.previewNewStudents(f.first.terms[0].id, [
          f.student(3, undefined, { seatNumber: 1 }),
        ]),
        "SEAT_OCCUPIED",
      );
      await rejects(
        f.service.previewNewStudents(f.first.terms[0].id, [
          f.student(3, f.rooms["801"]),
        ]),
        "NEW_STUDENT_REQUIRES_GRADE_7",
      );
      await rejects(
        f.service.previewNewStudents(f.first.terms[0].id, [
          f.student(3, undefined, { seatNumber: -1 }),
        ]),
        "INVALID_SEAT_NUMBER",
      );
      await rejects(
        f.service.previewNewStudents(f.first.terms[0].id, [
          f.student(3, undefined, { birthDate: "2031-01-01" }),
        ]),
        "INVALID_BIRTH_DATE",
      );
    },
  );
  await t.test(
    "missing keys and key-ring change refuse writes; all retained HMAC versions are stored",
    async () => {
      const noKeys = new AcademicService({
        ...f.dependencies,
        identityKeys: undefined,
      });
      await rejects(
        noKeys.previewNewStudents(f.first.terms[0].id, [f.student(3)]),
        "IDENTITY_KEYS_REQUIRED",
      );
      const preview = await f.service.previewNewStudents(f.first.terms[0].id, [
        f.student(3),
      ]);
      f.keys.lookup.push({
        version: 2,
        bytes: crypto.getRandomValues(new Uint8Array(32)),
      });
      await rejects(f.confirm(preview), "IDENTITY_KEY_RING_CHANGED");
      const added = await f.add([f.student(3)]);
      assert.equal(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM student_identity_lookup_hashes WHERE student_id = ?",
            added.ids[0],
          )
        ).n,
        2,
      );
    },
  );
  await t.test(
    "audit failure rolls back all profiles, enrollments, receipts and revision; same preview retries",
    async () => {
      const preview = await f.service.previewNewStudents(f.first.terms[0].id, [
        f.student(4),
        f.student(5),
      ]);
      const revision = (await one(f.db, "SELECT revision FROM academic_state"))
        .revision;
      await f.db
        .prepare(
          "CREATE TRIGGER fictional_audit_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'fictional failure'); END",
        )
        .run();
      await rejects(f.confirm(preview), "COMMIT_CONFLICT");
      assert.equal(
        (await one(f.db, "SELECT revision FROM academic_state")).revision,
        revision,
      );
      assert.equal(
        (await one(f.db, "SELECT count(*) AS n FROM students")).n,
        3,
      );
      assert.equal(
        await one(
          f.db,
          "SELECT id FROM academic_operations WHERE id = ?",
          preview.id,
        ),
        null,
      );
      await f.db.prepare("DROP TRIGGER fictional_audit_failure").run();
      await f.confirm(preview);
      assert.equal(
        (await one(f.db, "SELECT count(*) AS n FROM students")).n,
        5,
      );
    },
  );
  await t.test(
    "late transfer-in creates only its effective enrollment, without backfilling prior exams",
    async () => {
      await sql(
        f.db,
        "INSERT INTO exams (id, academic_term_id, sequence, starts_on, ends_on) VALUES ('late-transfer-exam', ?, 1, '2026-09-15', '2026-09-19')",
        f.first.terms[0].id,
      ).run();
      const added = await f.add(
        [f.student(6, f.rooms["702"], { effectiveFrom: "2026-09-16" })],
        f.first.terms[0].id,
        "transfer_in",
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[0].id,
            f.rooms["702"],
            "2026-09-15",
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[0].id,
            f.rooms["702"],
            "2026-09-16",
          )
        ).length,
        1,
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM exam_participations WHERE student_id = ?",
            added.ids[0],
          )
        ).n,
        0,
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM score_items WHERE student_id = ?",
            added.ids[0],
          )
        ).n,
        0,
      );
      await rejects(
        f.service.previewEnrollments(f.first.terms[0].id, [
          {
            studentId: added.ids[0],
            classId: f.rooms["701"],
            seatNumber: 6,
            effectiveFrom: f.first.terms[0].ends_on,
          },
        ]),
        "DATE_OUTSIDE_TERM",
      );
    },
  );
});

test("Phase 2 confirmation: replay, concurrent writes, ownership and authorization changes", async (t) => {
  const f = await setup(t);
  await t.test(
    "two confirms of the same preview produce one receipt and one audit",
    async () => {
      const preview = await f.service.previewNewStudents(f.first.terms[0].id, [
        f.student(1),
      ]);
      const results = await Promise.all([
        f.confirm(preview),
        f.confirm(preview),
      ]);
      assert.equal(results[0].operationId, results[1].operationId);
      const stored = await one(
        f.db,
        "SELECT after_revision, result_json FROM academic_operations WHERE id = ?",
        preview.id,
      );
      assert.equal(
        JSON.parse(stored.result_json).revision,
        stored.after_revision,
      );
      assert.equal(results[0].revision, stored.after_revision);
      assert.equal(results.filter((result) => result.replayed).length, 1);
      assert.equal(
        (await one(f.db, "SELECT count(*) AS n FROM students")).n,
        1,
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM audit_logs WHERE operation_id = ?",
            preview.id,
          )
        ).n,
        1,
      );
    },
  );
  await t.test(
    "competing previews cannot both commit from the same source revision",
    async () => {
      const [a, b] = await Promise.all([
        f.service.previewNewStudents(f.first.terms[0].id, [f.student(2)]),
        f.service.previewNewStudents(f.first.terms[0].id, [f.student(3)]),
      ]);
      const outcomes = await Promise.allSettled([f.confirm(a), f.confirm(b)]);
      assert.equal(
        outcomes.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        (await one(f.db, "SELECT count(*) AS n FROM students")).n,
        2,
      );
    },
  );
  await t.test(
    "another actor cannot commit or replay a preview; permission is rechecked at confirm",
    async () => {
      const preview = await f.service.previewClasses(f.first.id, ["703"]);
      f.grants.adminId = "admin-b";
      f.grants.sessionId = "session-admin-b";
      await rejects(f.confirm(preview), "ACCESS_DENIED");
      f.grants.adminId = "admin-a";
      f.grants.sessionId = "session-admin-a";
      f.policy.deniedActions.add("CREATE_CLASSES");
      await rejects(f.confirm(preview), "ACCESS_DENIED");
      f.policy.deniedActions.clear();
      await f.confirm(preview);
      f.grants.adminId = "admin-b";
      f.grants.sessionId = "session-admin-b";
      await rejects(f.confirm(preview), "ACCESS_DENIED");
      f.grants.adminId = "admin-a";
      f.grants.sessionId = "session-admin-a";
    },
  );
  await t.test(
    "transaction guard catches session revocation after service authorization",
    async () => {
      const preview = await f.service.previewClasses(f.first.id, ["704"]);
      const wrapped = {
        prepare: f.db.prepare.bind(f.db),
        batch: async (statements) => {
          await sql(
            f.db,
            "UPDATE admin_sessions SET revoked_at = ? WHERE id = 'session-admin-a'",
            now,
          ).run();
          return f.db.batch(statements);
        },
      };
      const raced = new AcademicService({ ...f.dependencies, db: wrapped });
      await rejects(
        raced.confirm(preview.id, { confirmed: true }),
        "COMMIT_CONFLICT",
      );
      assert.equal(
        await one(f.db, "SELECT id FROM classes WHERE code = '704'"),
        null,
      );
      assert.equal(
        await one(
          f.db,
          "SELECT id FROM academic_operations WHERE id = ?",
          preview.id,
        ),
        null,
      );
      await rejects(f.confirm(preview), "ACCESS_DENIED");
    },
  );
});

async function snapshotFixture(f, studentId, enrollmentId) {
  const termId = f.first.terms[0].id;
  await sql(
    f.db,
    "INSERT INTO exams (id, academic_term_id, sequence, starts_on, ends_on) VALUES ('fictional-exam', ?, 1, '2026-09-15', '2026-09-19')",
    termId,
  ).run();
  await sql(
    f.db,
    "INSERT INTO exam_subject_settings (id, exam_id, exam_type, subject, held) VALUES ('fictional-setting', 'fictional-exam', 'QUIZ', 'CHINESE', 1)",
  ).run();
  await sql(
    f.db,
    "INSERT INTO exam_participations (id, exam_id, academic_term_id, student_id, enrollment_id, class_id_snapshot, class_code_snapshot, grade_snapshot, seat_number_snapshot, student_eligibility_snapshot, ranking_eligible, confirmed_at) VALUES ('fictional-participation', 'fictional-exam', ?, ?, ?, ?, '701', 7, 1, 1, 1, ?)",
    termId,
    studentId,
    enrollmentId,
    f.rooms["701"],
    now,
  ).run();
  await sql(
    f.db,
    "INSERT INTO score_items (id, participation_id, setting_id, exam_id, student_id, exam_type, subject, origin, class_id_snapshot, score_value, score_status, include_in_average, include_in_ranking) VALUES ('fictional-score', 'fictional-participation', 'fictional-setting', 'fictional-exam', ?, 'QUIZ', 'CHINESE', 'LOCAL', ?, 9000, 'NORMAL', 1, 1)",
    studentId,
    f.rooms["701"],
  ).run();
  return {
    participation: await one(
      f.db,
      "SELECT * FROM exam_participations WHERE id = 'fictional-participation'",
    ),
    score: await one(
      f.db,
      "SELECT * FROM score_items WHERE id = 'fictional-score'",
    ),
  };
}

test("Phase 2 transfers, seat changes and undo preserve assessment snapshots", async (t) => {
  const f = await setup(t),
    { ids } = await f.add([f.student(1)]);
  const old = await one(
    f.db,
    "SELECT * FROM student_enrollments WHERE student_id = ?",
    ids[0],
  );
  const snapshot = await snapshotFixture(f, ids[0], old.id);
  let moveReceipt;
  await t.test(
    "mid-assessment transfers and cross-grade moves are refused",
    async () => {
      await rejects(
        f.service.previewMove({
          enrollmentId: old.id,
          targetClassId: f.rooms["702"],
          seatNumber: 1,
          effectiveFrom: "2026-09-16",
        }),
        "ASSESSMENT_IN_PROGRESS",
      );
      await rejects(
        f.service.previewMove({
          enrollmentId: old.id,
          targetClassId: f.rooms["801"],
          seatNumber: 1,
          effectiveFrom: "2026-10-01",
        }),
        "TRANSFER_GRADE_MISMATCH",
      );
      await rejects(
        f.service.previewMove({
          enrollmentId: old.id,
          targetClassId: f.rooms["702"],
          seatNumber: 1,
          effectiveFrom: "2026-09-01",
        }),
        "FROZEN_SUBSEQUENT_ROSTER",
      );
    },
  );
  await t.test(
    "transfer scope checks both classes; transfer splits current enrollment without editing frozen rows",
    async () => {
      f.policy.deniedClasses.add(f.rooms["702"]);
      await rejects(
        f.service.previewMove({
          enrollmentId: old.id,
          targetClassId: f.rooms["702"],
          seatNumber: 1,
          effectiveFrom: "2026-10-01",
        }),
        "ACCESS_DENIED",
      );
      f.policy.deniedClasses.clear();
      const preview = await f.service.previewMove({
        enrollmentId: old.id,
        targetClassId: f.rooms["702"],
        seatNumber: 1,
        effectiveFrom: "2026-10-01",
      });
      assert.equal(
        (
          await one(
            f.db,
            "SELECT status FROM student_enrollments WHERE id = ?",
            old.id,
          )
        ).status,
        "valid",
      );
      moveReceipt = await f.confirm(preview);
      assert.equal(
        (
          await one(
            f.db,
            "SELECT status FROM student_enrollments WHERE id = ?",
            old.id,
          )
        ).status,
        "voided",
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[0].id,
            f.rooms["701"],
            "2026-09-30",
          )
        ).length,
        1,
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[0].id,
            f.rooms["701"],
            "2026-10-01",
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[0].id,
            f.rooms["702"],
            "2026-10-01",
          )
        ).length,
        1,
      );
      assert.deepEqual(
        await one(
          f.db,
          "SELECT * FROM exam_participations WHERE id = 'fictional-participation'",
        ),
        snapshot.participation,
      );
      assert.deepEqual(
        await one(
          f.db,
          "SELECT * FROM score_items WHERE id = 'fictional-score'",
        ),
        snapshot.score,
      );
    },
  );
  await t.test(
    "undo restores original enrollment, preserves snapshots, and cannot run twice",
    async () => {
      const undo = await f.service.previewUndo(moveReceipt.operationId);
      await f.confirm(undo);
      assert.equal(
        (
          await one(
            f.db,
            "SELECT status FROM student_enrollments WHERE id = ?",
            old.id,
          )
        ).status,
        "valid",
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[0].id,
            f.rooms["701"],
            "2026-10-01",
          )
        ).length,
        1,
      );
      assert.deepEqual(
        await one(
          f.db,
          "SELECT * FROM exam_participations WHERE id = 'fictional-participation'",
        ),
        snapshot.participation,
      );
      await rejects(
        f.service.previewUndo(moveReceipt.operationId),
        "OPERATION_ALREADY_UNDONE",
      );
    },
  );
  await t.test(
    "same-class seat adjustment is versioned; undo refuses later legitimate changes",
    async () => {
      const preview = await f.service.previewMove({
        enrollmentId: old.id,
        targetClassId: f.rooms["701"],
        seatNumber: 8,
        effectiveFrom: "2026-10-01",
      });
      const firstMove = await f.confirm(preview);
      const current = await one(
        f.db,
        "SELECT id FROM student_enrollments WHERE student_id = ? AND status = 'valid' AND effective_from = '2026-10-01'",
        ids[0],
      );
      const next = await f.service.previewMove({
        enrollmentId: current.id,
        targetClassId: f.rooms["702"],
        seatNumber: 8,
        effectiveFrom: "2026-11-01",
      });
      await f.confirm(next);
      await rejects(
        f.service.previewUndo(firstMove.operationId),
        "UNDO_VERSION_CONFLICT",
      );
    },
  );
});

test("Phase 2 upgrades a populated Phase 1 database without rewriting historical rows", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await db
    .prepare(
      "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
    )
    .run();
  for (const migration of readMigrationFiles({ migrationsFolder }).slice(
    0,
    2,
  )) {
    await db.batch([
      ...migration.sql.map((statement) => db.prepare(statement)),
      sql(
        db,
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        migration.hash,
        migration.folderMillis,
      ),
    ]);
  }
  await seedFictional(db, fictionalKeys());
  const before = {};
  for (const table of [
    "students",
    "student_enrollments",
    "exam_participations",
    "score_items",
  ])
    before[table] = await all(db, `SELECT * FROM ${table} ORDER BY id`);
  assert.equal((await migrationPreflight(db)).pending, 2);
  await migrateLocalDatabase(db);
  for (const [table, rows] of Object.entries(before))
    assert.deepEqual(await all(db, `SELECT * FROM ${table} ORDER BY id`), rows);
  assert.equal(
    (await one(db, "SELECT current_year_id FROM academic_state"))
      .current_year_id,
    "year-115",
  );
  assert.equal((await migrationPreflight(db)).pending, 0);
});

test("Phase 2 transfer-out and mistaken-transfer recovery", async (t) => {
  const f = await setup(t),
    { ids } = await f.add([f.student(1)]);
  const original = await one(
    f.db,
    "SELECT * FROM students WHERE id = ?",
    ids[0],
  );
  const old = await one(
    f.db,
    "SELECT * FROM student_enrollments WHERE student_id = ?",
    ids[0],
  );
  const snapshot = await snapshotFixture(f, ids[0], old.id);
  await f.confirm(
    await f.service.previewEnrollments(f.first.terms[1].id, [
      {
        studentId: ids[0],
        classId: f.rooms["701"],
        seatNumber: 1,
        effectiveFrom: f.first.terms[1].starts_on,
      },
    ]),
  );
  await t.test(
    "transfer-out preserves history, closes future enrollments and sets three calendar years",
    async () => {
      const preview = await f.service.previewTransferOut(ids[0], "2026-11-01");
      const receipt = await f.confirm(preview);
      const changed = await one(
        f.db,
        "SELECT * FROM students WHERE id = ?",
        ids[0],
      );
      assert.equal(changed.status, "transferred_out");
      assert.equal(changed.retention_until, "2029-11-01");
      assert.equal(changed.public_query_until, "2029-11-01");
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[0].id,
            f.rooms["701"],
            "2026-10-31",
          )
        ).length,
        1,
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[0].id,
            f.rooms["701"],
            "2026-11-01",
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[1].id,
            f.rooms["701"],
            "2027-02-01",
          )
        ).length,
        0,
      );
      assert.deepEqual(
        await one(
          f.db,
          "SELECT * FROM exam_participations WHERE id = 'fictional-participation'",
        ),
        snapshot.participation,
      );
      assert.deepEqual(
        await one(
          f.db,
          "SELECT * FROM score_items WHERE id = 'fictional-score'",
        ),
        snapshot.score,
      );
      assert.equal(
        (await one(f.db, "SELECT count(*) AS n FROM archive_batches")).n,
        0,
      );
      const undo = await f.service.previewUndo(receipt.operationId);
      await f.confirm(undo);
      const restored = await one(
        f.db,
        "SELECT * FROM students WHERE id = ?",
        ids[0],
      );
      for (const field of [
        "status",
        "transferred_out_on",
        "retention_until",
        "public_query_until",
        "identity_number_encrypted",
      ])
        assert.equal(restored[field], original[field]);
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[1].id,
            f.rooms["701"],
            "2027-02-01",
          )
        ).length,
        1,
      );
    },
  );
  await t.test(
    "existing retention events are blocked pending D-05; future scheduling is not silently immediate",
    async () => {
      await rejects(
        f.service.previewTransferOut(ids[0], "2031-01-01"),
        "FUTURE_TRANSFER_OUT_NOT_SUPPORTED",
      );
      await sql(
        f.db,
        "UPDATE students SET retention_until = '2035-01-01', public_query_until = '2035-01-01', version = version + 1 WHERE id = ?",
        ids[0],
      ).run();
      await rejects(
        f.service.previewTransferOut(ids[0], "2026-12-01"),
        "RETENTION_POLICY_REQUIRED",
      );
    },
  );
});

test("Phase 2 batch promotion preview, manual regrouping and historical invariants", async (t) => {
  const f = await setup(t);
  const lower = await f.add([f.student(1), f.student(2)]);
  const older = await f.add(
    [f.student(3, f.rooms["801"]), f.student(4, f.rooms["901"])],
    f.first.terms[0].id,
    "transfer_in",
  );
  const beforeEnrollments = await all(
    f.db,
    "SELECT * FROM student_enrollments ORDER BY id",
  );
  await f.confirm(
    await f.service.previewEnrollments(f.first.terms[1].id, [
      {
        studentId: lower.ids[0],
        classId: f.rooms["701"],
        seatNumber: 1,
        effectiveFrom: "2027-02-01",
      },
      {
        studentId: lower.ids[1],
        classId: f.rooms["701"],
        seatNumber: 2,
        effectiveFrom: "2027-02-01",
      },
      {
        studentId: older.ids[0],
        classId: f.rooms["801"],
        seatNumber: 3,
        effectiveFrom: "2027-02-01",
      },
      {
        studentId: older.ids[1],
        classId: f.rooms["901"],
        seatNumber: 4,
        effectiveFrom: "2027-02-01",
      },
    ]),
  );
  const target = await f.year("116", "2027-08-01", "2028-02-01", "2028-08-01");
  const targetRooms = await f.classes(target.id, ["801", "802", "901"]);
  const input = {
    sourceTermId: f.first.terms[1].id,
    targetTermId: target.terms[0].id,
  };
  await t.test(
    "defaults preserve class suffix/seat; grade 9 is explicitly skipped",
    async () => {
      const preview = await f.service.previewPromotion(input);
      assert.deepEqual(
        preview.rows
          .filter((row) => row.status === "PROMOTE")
          .map((row) => row.toClass),
        ["801", "801", "901"],
      );
      assert.equal(
        preview.rows.filter((row) => row.status === "SKIPPED_GRADE_9").length,
        1,
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM student_enrollments WHERE academic_term_id = ?",
            target.terms[0].id,
          )
        ).n,
        0,
      );
    },
  );
  await t.test(
    "manual assignments reject conflicts, unknown students and invalid target grade",
    async () => {
      await rejects(
        f.service.previewPromotion({
          ...input,
          overrides: [
            {
              studentId: lower.ids[1],
              classId: targetRooms["801"],
              seatNumber: 1,
            },
          ],
        }),
        "SEAT_OCCUPIED",
      );
      await rejects(
        f.service.previewPromotion({
          ...input,
          overrides: [
            {
              studentId: lower.ids[0],
              classId: targetRooms["901"],
              seatNumber: 1,
            },
          ],
        }),
        "PROMOTION_GRADE_MISMATCH",
      );
      await rejects(
        f.service.previewPromotion({
          ...input,
          overrides: [
            {
              studentId: "unknown",
              classId: targetRooms["801"],
              seatNumber: 1,
            },
          ],
        }),
        "INVALID_PROMOTION_OVERRIDE",
      );
    },
  );
  await t.test(
    "confirmed regrouping promotes 7/8, leaves old enrollments and student numbers unchanged, and can undo",
    async () => {
      const preview = await f.service.previewPromotion({
        ...input,
        overrides: [
          {
            studentId: lower.ids[1],
            classId: targetRooms["802"],
            seatNumber: 7,
          },
        ],
      });
      const result = await f.confirm(preview);
      assert.equal(result.studentIds.length, 3);
      assert.equal(
        (
          await f.service.classRoster(
            target.terms[0].id,
            targetRooms["802"],
            "2027-08-01",
          )
        )[0].seat_number,
        7,
      );
      for (const previous of beforeEnrollments)
        assert.deepEqual(
          await one(
            f.db,
            "SELECT * FROM student_enrollments WHERE id = ?",
            previous.id,
          ),
          previous,
        );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT student_number FROM students WHERE id = ?",
            lower.ids[0],
          )
        ).student_number,
        "FICTIONAL-1",
      );
      assert.equal(
        (
          await one(
            f.db,
            "SELECT status FROM students WHERE id = ?",
            older.ids[1],
          )
        ).status,
        "active",
      );
      await f.confirm(await f.service.previewUndo(result.operationId));
      assert.equal(
        (
          await f.service.classRoster(
            target.terms[0].id,
            targetRooms["801"],
            "2027-08-01",
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await f.service.classRoster(
            f.first.terms[1].id,
            f.rooms["701"],
            "2027-07-31",
          )
        ).length,
        2,
      );
      assert.equal((await migrationPreflight(f.db)).foreignKeys, "ok");
    },
  );
});
