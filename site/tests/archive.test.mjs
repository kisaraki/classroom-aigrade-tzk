import { ArchiveService } from "../lib/server/archive/service.ts";
import { AcademicService } from "../lib/server/academic/service.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ExamService } from "../lib/server/exams/service.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  fictionalKeys,
  migrationPreflight,
  migrationsFolder,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";
import { readMigrationFiles } from "drizzle-orm/migrator";
const now = Date.UTC(2026, 8, 24, 4);
const run = (db, q, ...v) =>
  db
    .prepare(q)
    .bind(...v)
    .run();
const one = (db, q, ...v) =>
  db
    .prepare(q)
    .bind(...v)
    .first();
const all = async (db, q, ...v) =>
  (
    await db
      .prepare(q)
      .bind(...v)
      .all()
  ).results;
const rejects = (promise, code) =>
  assert.rejects(promise, (error) => error.code === code);
const identity = (name) => ({
  verified: true,
  emailVerified: true,
  subject: `fictional-${name}`,
  email: `${name}@example.test`,
  issuer: "https://accounts.google.com",
  audience: "fictional-client",
  nonce: "fictional",
  issuedAt: now / 1000,
  authTime: now / 1000,
  expiresAt: now / 1000 + 3600,
});
const assignment = (type, extra = {}) => ({
  academicTermId: "term-115-1",
  scopeType: type,
  startsOn: "2026-08-01",
  ...extra,
});
const score = (participationId, settingId, value, expectedVersion = 0) => ({
  participationId,
  settingId,
  value,
  expectedVersion,
});
async function fixture(t) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  await seedFictional(db, fictionalKeys());
  await run(
    db,
    "UPDATE academic_state SET current_year_id='year-115' WHERE id=1",
  );
  const clock = () => now;
  const auth = new AuthService({
    db,
    oidc: {},
    bootstrapSecret: "fictional-bootstrap",
    now: clock,
  });
  const owner = await auth.bootstrap({
    secret: "fictional-bootstrap",
    identity: identity("owner"),
  });
  const management = new AdminManagementService({
    db,
    now: clock,
    authorization: new AuthorizationService({ db, now: clock }),
  });
  const service = new ExamService({ db, now: clock });
  async function user(name, role, assignments) {
    await management.createAdmin(owner, {
      username: name,
      displayName: "虛構教師",
      authorizedEmail: `${name}@example.test`,
      role,
      assignments,
      confirmed: true,
    });
    return auth.loginVerifiedGoogle(identity(name));
  }
  const homeroom = await user("homeroom", "score_admin", [
    assignment("homeroom", { classId: "class-701" }),
  ]);
  const teacher = await user("teacher", "score_admin", [
    assignment("teaching_subject", {
      classId: "class-701",
      subject: "CHINESE",
    }),
    assignment("teaching_subject", { classId: "class-702", subject: "MATH" }),
  ]);
  const viewer = await user("viewer", "viewer", [
    assignment("class", { classId: "class-701" }),
  ]);
  return {
    db,
    auth,
    management,
    service,
    owner,
    homeroom,
    teacher,
    viewer,
    user,
  };
}
const target = (extra = {}) => ({
  academicTermId: "term-115-1",
  onDate: "2026-09-24",
  studentId: "fictional-a",
  ...extra,
});
const request = (extra = {}) => ({
  action: "ARCHIVE",
  target: target(),
  reason: "虛構封存原因",
  force: true,
  ...extra,
});
const archive = (f) => new ArchiveService({ db: f.db, now: () => now });
const academic = (f) =>
  new AcademicService({
    db: f.db,
    now: () => now,
    authorize: async () => ({ ...f.owner, recentGoogleAuthentication: true }),
  });
const snapshot = async (db) => ({
  students: await all(db, "SELECT * FROM students ORDER BY id"),
  enrollments: await all(db, "SELECT * FROM student_enrollments ORDER BY id"),
  parts: await all(db, "SELECT * FROM exam_participations ORDER BY id"),
  scores: await all(db, "SELECT * FROM score_items ORDER BY id"),
  batches: await all(db, "SELECT * FROM archive_batches ORDER BY id"),
  events: await all(db, "SELECT * FROM retention_events ORDER BY id"),
});
const commit = async (f, r) => {
  const s = archive(f),
    p = await s.preview(f.owner, r);
  return s.confirm(f.owner, p.previewId, true);
};

test("Phase 8 individual archive: warning acknowledgement, preserved history, replay, undo", async (t) => {
  const f = await fixture(t),
    s = archive(f),
    before = await snapshot(f.db);
  const preview = await s.preview(f.owner, request({ force: false }));
  assert.equal(preview.requiresForce, true);
  assert.equal(
    preview.warnings.find((w) => w.code === "UNPUBLISHED_EXAMS").count,
    (
      await one(
        f.db,
        "SELECT count(*) AS n FROM exams WHERE academic_term_id='term-115-1'",
      )
    ).n,
  );
  assert.ok(preview.warnings.some((w) => w.code === "MISSING_SCORES"));
  await rejects(
    s.confirm(f.owner, preview.previewId, true),
    "ARCHIVE_WARNINGS_REQUIRE_FORCE",
  );
  const p = await s.preview(f.owner, request()),
    receipt = await s.confirm(f.owner, p.previewId, true);
  assert.equal((await s.confirm(f.owner, p.previewId, true)).replayed, true);
  assert.ok(
    (await one(f.db, "SELECT archived_at FROM students WHERE id='fictional-a'"))
      .archived_at,
  );
  assert.deepEqual((await snapshot(f.db)).parts, before.parts);
  assert.deepEqual((await snapshot(f.db)).scores, before.scores);
  assert.equal(await s.publicEligibility("fictional-a"), true);
  await rejects(
    academic(f).previewTransferOut("fictional-a", "2026-09-24"),
    "NOT_FOUND",
  );
  const undo = await s.preview(f.owner, {
    action: "UNDO",
    batchId: receipt.batchId,
    reason: "虛構撤銷",
  });
  await s.confirm(f.owner, undo.previewId, true);
  assert.equal(
    (await one(f.db, "SELECT archived_at FROM students WHERE id='fictional-a'"))
      .archived_at,
    null,
  );
});

test("Phase 8 class archive and restore are atomic and do not overwrite later extensions", async (t) => {
  const f = await fixture(t),
    s = archive(f);
  const result = await commit(
    f,
    request({
      target: {
        academicTermId: "term-115-1",
        onDate: "2026-09-24",
        classId: "class-701",
      },
    }),
  );
  assert.ok(
    (await one(f.db, "SELECT archived_at FROM classes WHERE id='class-701'"))
      .archived_at,
  );
  await run(
    f.db,
    "UPDATE students SET version=version+1 WHERE id='fictional-a'",
  );
  await rejects(
    s.preview(f.owner, {
      action: "RESTORE",
      batchId: result.batchId,
      reason: "虛構復原",
    }),
    "ARCHIVE_RESTORE_CONFLICT",
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT status FROM archive_batches WHERE id=?",
        result.batchId,
      )
    ).status,
    "archived",
  );
});

test("Phase 8 exact 30 day Undo boundary and formal Restore after deadline", async (t) => {
  const f = await fixture(t),
    receipt = await commit(f, request());
  let time = now + 30 * 86400000 - 1;
  const s = new ArchiveService({ db: f.db, now: () => time });
  const refresh = () =>
    run(
      f.db,
      "UPDATE admin_sessions SET expires_at=?,last_seen_at=?,recent_auth_at=? WHERE id=?",
      time + 3600000,
      time,
      time,
      f.owner.sessionId,
    );
  await refresh();
  const p = await s.preview(f.owner, {
    action: "UNDO",
    batchId: receipt.batchId,
    reason: "虛構撤銷",
  });
  time++;
  await refresh();
  await rejects(s.confirm(f.owner, p.previewId, true), "ARCHIVE_UNDO_EXPIRED");
  const restore = await s.preview(f.owner, {
    action: "RESTORE",
    batchId: receipt.batchId,
    reason: "虛構正式復原",
  });
  await s.confirm(f.owner, restore.previewId, true);
  assert.equal(
    (await one(f.db, "SELECT archived_at FROM students WHERE id='fictional-a'"))
      .archived_at,
    null,
  );
});

test("Phase 8 graduation: separate events keep longer transfer promise and preserve snapshots", async (t) => {
  const f = await fixture(t),
    a = academic(f);
  const transfer = await a.previewTransferOut("fictional-a", "2026-09-24");
  await a.confirm(transfer.id, { confirmed: true });
  await run(f.db, "UPDATE classes SET grade=9,code='901' WHERE id='class-701'");
  const before = await all(
    f.db,
    "SELECT * FROM exam_participations ORDER BY id",
  );
  const result = await commit(
    f,
    request({
      action: "GRADUATE",
      target: { academicTermId: "term-115-1", onDate: "2026-09-24", grade: 9 },
    }),
  );
  const student = await one(
    f.db,
    "SELECT * FROM students WHERE id='fictional-a'",
  );
  assert.equal(student.retention_until, "2029-09-24");
  assert.equal(student.status, "graduated");
  assert.equal(
    (
      await all(
        f.db,
        "SELECT * FROM retention_events WHERE student_id='fictional-a' AND revoked_at IS NULL",
      )
    ).length,
    2,
  );
  assert.deepEqual(
    await all(f.db, "SELECT * FROM exam_participations ORDER BY id"),
    before,
  );
  await commit(f, {
    action: "RESTORE",
    batchId: result.batchId,
    reason: "虛構誤標畢業",
  });
  assert.equal(
    (await one(f.db, "SELECT status FROM students WHERE id='fictional-a'"))
      .status,
    "transferred_out",
  );
  assert.equal(
    (
      await all(
        f.db,
        "SELECT * FROM retention_events WHERE student_id='fictional-a' AND revoked_at IS NULL",
      )
    ).length,
    1,
  );
});

test("Phase 8 D-05 extension and readmission retain event history and future transfer promises", async (t) => {
  const f = await fixture(t),
    s = archive(f),
    a = academic(f);
  const p = await a.previewTransferOut("fictional-a", "2026-09-24");
  await a.confirm(p.id, { confirmed: true });
  await commit(f, request({ action: "EXTEND", until: "2031-01-01" }));
  assert.equal(await s.publicEligibility("fictional-a", "2030-12-31"), true);
  assert.equal(await s.publicEligibility("fictional-a", "2031-01-01"), false);
  await rejects(
    s.preview(f.owner, request({ action: "EXTEND", until: "2030-01-01" })),
    "EXTENSION_MUST_LENGTHEN",
  );
  await commit(
    f,
    request({
      action: "READMIT",
      target: target({ classId: "class-702" }),
      seatNumber: 20,
    }),
  );
  let student = await one(
    f.db,
    "SELECT * FROM students WHERE id='fictional-a'",
  );
  assert.equal(student.status, "active");
  assert.equal(student.public_query_until, null);
  const again = await a.previewTransferOut("fictional-a", "2026-09-24");
  await a.confirm(again.id, { confirmed: true });
  student = await one(f.db, "SELECT * FROM students WHERE id='fictional-a'");
  assert.equal(student.retention_until, "2031-01-01");
  const undo = await a.previewUndo(again.id);
  await a.confirm(undo.id, { confirmed: true });
  assert.equal(
    (
      await one(
        f.db,
        "SELECT public_query_until FROM students WHERE id='fictional-a'",
      )
    ).public_query_until,
    null,
  );
});

test("Phase 8 force cannot bypass scope, recent authentication, revocation or stale preview", async (t) => {
  const f = await fixture(t),
    s = archive(f),
    clerk = await f.user("archiver", "archive_admin", [
      assignment("class", { classId: "class-701" }),
    ]);
  await rejects(s.preview(f.teacher, request()), "PERMISSION_DENIED");
  await rejects(
    s.preview(
      clerk,
      request({
        target: {
          academicTermId: "term-115-1",
          onDate: "2026-09-24",
          classId: "class-702",
        },
      }),
    ),
    "SCOPE_DENIED",
  );
  const p = await s.preview(clerk, request());
  await run(
    f.db,
    "UPDATE admin_sessions SET recent_auth_at=? WHERE id=?",
    now - 300000,
    clerk.sessionId,
  );
  await rejects(
    s.confirm(clerk, p.previewId, true),
    "RECENT_AUTHENTICATION_REQUIRED",
  );
  await run(
    f.db,
    "UPDATE admin_sessions SET recent_auth_at=? WHERE id=?",
    now,
    clerk.sessionId,
  );
  await run(
    f.db,
    "UPDATE score_items SET version=version+1 WHERE id='score-zero'",
  );
  await rejects(s.confirm(clerk, p.previewId, true), "ARCHIVE_CONFLICT");
});

test("Phase 8 atomic failure and concurrent confirmation yield one archive batch", async (t) => {
  const f = await fixture(t),
    s = archive(f),
    p = await s.preview(f.owner, request()),
    before = await snapshot(f.db);
  await f.db
    .prepare(
      "CREATE TRIGGER fictional_archive_failure BEFORE UPDATE ON students BEGIN SELECT RAISE(ABORT,'FICTIONAL_FAILURE'); END",
    )
    .run();
  await rejects(s.confirm(f.owner, p.previewId, true), "ARCHIVE_CONFLICT");
  assert.deepEqual(await snapshot(f.db), before);
  await f.db.prepare("DROP TRIGGER fictional_archive_failure").run();
  const results = await Promise.all([
    s.confirm(f.owner, p.previewId, true),
    s.confirm(f.owner, p.previewId, true),
  ]);
  assert.equal(new Set(results.map((r) => r.batchId)).size, 1);
  assert.equal((await all(f.db, "SELECT id FROM archive_batches")).length, 1);
});

test("Phase 8 migration upgrades Phase 7 and backfills existing retention without touching scores", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  const migrations = readMigrationFiles({ migrationsFolder });
  await run(
    db,
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY,hash text NOT NULL,created_at numeric)",
  );
  for (const m of migrations.slice(0, 9)) {
    await db.batch(m.sql.filter((s) => s.trim()).map((s) => db.prepare(s)));
    await run(
      db,
      "INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)",
      m.hash,
      m.folderMillis,
    );
  }
  await seedFictional(db, fictionalKeys());
  await run(
    db,
    "UPDATE students SET status='transferred_out',transferred_out_on='2026-09-24',retention_until='2029-09-24',public_query_until='2029-09-24' WHERE id='fictional-a'",
  );
  const scores = await all(db, "SELECT * FROM score_items ORDER BY id");
  assert.equal((await migrationPreflight(db)).pending, 1);
  const migration = migrations[9];
  await assert.rejects(
    db.batch([
      ...migration.sql.filter((s) => s.trim()).map((s) => db.prepare(s)),
      db.prepare("SELECT * FROM fictional_missing_table"),
    ]),
  );
  assert.equal(
    await one(
      db,
      "SELECT name FROM sqlite_schema WHERE name='retention_events'",
    ),
    null,
  );
  await migrateLocalDatabase(db);
  assert.equal((await migrateLocalDatabase(db)).pending, 0);
  assert.deepEqual(
    await all(db, "SELECT * FROM score_items ORDER BY id"),
    scores,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT retention_until FROM retention_events WHERE student_id='fictional-a'",
      )
    ).retention_until,
    "2029-09-24",
  );
  assert.equal(
    (await one(db, "SELECT archived_at FROM students WHERE id='fictional-a'"))
      .archived_at,
    null,
  );
});

test("Phase 8 HTTP: cookie, CSRF, strict fields, scoped batch access and no-store", async (t) => {
  const f = await fixture(t),
    s = archive(f);
  const { handleArchiveRequest } =
    await import("../lib/server/archive/http.ts");
  const { SESSION_COOKIE } = await import("../lib/server/auth/cookies.ts");
  const send = (body, headers = {}) =>
    handleArchiveRequest(
      new Request("https://fictional.example.test/api/admin/archives/preview", {
        method: "POST",
        headers: {
          Origin: "https://fictional.example.test",
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE}=${f.owner.token}`,
          ...headers,
        },
        body: JSON.stringify(body),
      }),
      { auth: f.auth, archive: s },
      "preview",
    );
  assert.equal(
    (await send(request(), { Origin: "https://elsewhere.example.test" }))
      .status,
    403,
  );
  assert.equal((await send(request(), { Cookie: "" })).status, 401);
  assert.equal((await send({ ...request(), actorId: "forged" })).status, 400);
  const response = await send(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const p = await response.json();
  await rejects(
    s.confirm(f.teacher, p.previewId, true),
    "ARCHIVE_PREVIEW_NOT_FOUND",
  );
  const receipt = await s.confirm(f.owner, p.previewId, true);
  const outsider = await f.user("archiveother", "archive_admin", [
    assignment("class", { classId: "class-702" }),
  ]);
  await rejects(s.readBatch(outsider, receipt.batchId), "SCOPE_DENIED");
});

test("Phase 8 transaction guard catches revocation after authorization", async (t) => {
  const f = await fixture(t),
    p = await archive(f).preview(f.owner, request()),
    before = await snapshot(f.db);
  let done = false;
  const wrapped = {
    prepare: (q) => f.db.prepare(q),
    batch: async (statements) => {
      if (!done) {
        done = true;
        await run(
          f.db,
          "UPDATE admin_sessions SET revoked_at=? WHERE id=?",
          now,
          f.owner.sessionId,
        );
      }
      return f.db.batch(statements);
    },
  };
  await rejects(
    new ArchiveService({ db: wrapped, now: () => now }).confirm(
      f.owner,
      p.previewId,
      true,
    ),
    "ACCESS_DENIED",
  );
  assert.deepEqual(await snapshot(f.db), before);
});

test("Phase 8 archived students cannot receive draft marks or new AI requests", async (t) => {
  const f = await fixture(t);
  await commit(f, request());
  await rejects(
    f.service.writeDraftScores(f.owner, "exam-1", {
      operationId: crypto.randomUUID(),
      expectedVersion: 1,
      scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 90, 1)],
    }),
    "STUDENT_NOT_ACTIVE",
  );
  const { PublicationService } =
    await import("../lib/server/exams/publication.ts");
  const p = new PublicationService({ db: f.db, now: () => now });
  const preview = await p.preview(f.owner, "exam-1", {
    kind: "PUBLISH",
    component: "QUIZ",
    expectedVersion: 1,
  });
  await p.confirm(f.owner, preview.previewId, true);
  assert.equal(
    (await all(f.db, "SELECT id FROM ai_jobs WHERE student_id='fictional-a'"))
      .length,
    0,
  );
  assert.ok(
    (await all(f.db, "SELECT id FROM ai_jobs WHERE student_id='fictional-b'"))
      .length > 0,
  );
});
