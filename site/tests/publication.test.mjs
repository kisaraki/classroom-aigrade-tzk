import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicationService } from "../lib/server/exams/publication.ts";
import { handlePublicationRequest } from "../lib/server/exams/publication-http.ts";
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
const publication = (f) => new PublicationService({ db: f.db, now: () => now });
const publish = async (f, component = "QUIZ") => {
  const p = publication(f),
    e = await one(f.db, "SELECT version FROM exams WHERE id='exam-1'");
  const preview = await p.preview(f.owner, "exam-1", {
    kind: "PUBLISH",
    component,
    expectedVersion: e.version,
  });
  return p.confirm(f.owner, preview.previewId, true);
};
const edit = async (f, actor = f.owner, value = 90, expectedVersion = 1) => {
  const e = await one(f.db, "SELECT version FROM exams WHERE id='exam-1'");
  return publication(f).preview(actor, "exam-1", {
    kind: "EDIT",
    reason: "虛構更正原因",
    expectedVersion: e.version,
    scores: [
      score("part-a1", "setting-1-QUIZ-CHINESE", value, expectedVersion),
    ],
  });
};
const state = async (db) => ({
  exam: await one(db, "SELECT * FROM exams WHERE id='exam-1'"),
  results: await all(db, "SELECT * FROM exam_result_versions ORDER BY id"),
  scores: await all(db, "SELECT * FROM score_items ORDER BY id"),
  history: await all(db, "SELECT * FROM score_change_history ORDER BY id"),
  jobs: await all(db, "SELECT * FROM ai_jobs ORDER BY id"),
  audit: await all(db, "SELECT * FROM audit_logs ORDER BY id"),
});

test("Phase 7 D-08: midterm first hides quiz, final requires both, replay and snapshot isolation", async (t) => {
  const f = await fixture(t),
    p = publication(f);
  assert.deepEqual(await p.publishedClass(f.owner, "exam-1", "class-701"), {
    published: false,
  });
  const first = await publish(f, "MIDTERM");
  let result = await p.publishedClass(f.owner, "exam-1", "class-701");
  assert.equal(result.mode, "PROVISIONAL");
  assert.deepEqual(result.components, ["MIDTERM"]);
  assert.equal(
    result.students.find((s) => s.participationId === "part-a1").exam
      .averageHundredths,
    null,
  );
  assert.ok(result.students.every((s) => !("gradeRank" in s)));
  assert.equal(JSON.stringify(result).includes("fictional-external"), false);
  const final = await publish(f, "QUIZ");
  result = await p.publishedClass(f.owner, "exam-1", "class-701");
  assert.equal(result.mode, "FINAL");
  assert.equal(
    result.students.find((s) => s.participationId === "part-a1").exam
      .averageHundredths,
    0,
  );
  assert.notEqual(first.resultVersionId, final.resultVersionId);
  const old = await one(
    f.db,
    "SELECT snapshot_json FROM publication_snapshots WHERE result_version_id=?",
    first.resultVersionId,
  );
  assert.equal(
    JSON.parse(old.snapshot_json).input.participants[0].scores.some(
      (s) => s.examType === "QUIZ",
    ),
    false,
  );
  await assert.rejects(
    run(
      f.db,
      "UPDATE publication_snapshots SET snapshot_json='{}' WHERE result_version_id=?",
      first.resultVersionId,
    ),
  );
  await rejects(
    p.preview(f.owner, "exam-1", {
      kind: "PUBLISH",
      component: "QUIZ",
      expectedVersion: 3,
    }),
    "COMPONENT_ALREADY_PUBLISHED",
  );
});

test("Phase 7 edits: scope, zero, history, atomic relock and superseded AI request", async (t) => {
  const f = await fixture(t),
    p = publication(f);
  await publish(f);
  const job = await one(f.db, "SELECT id FROM ai_jobs LIMIT 1");
  assert.ok(await p.regenerationRequest(job.id));
  const preview = await edit(f, f.teacher, 85);
  assert.equal("grades" in preview, false);
  assert.equal("classes" in preview, false);
  const receipt = await p.confirm(f.teacher, preview.previewId, true);
  assert.equal(
    (await p.confirm(f.teacher, preview.previewId, true)).replayed,
    true,
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT score_value FROM score_items WHERE id='score-zero'",
      )
    ).score_value,
    8500,
  );
  const h = await one(
    f.db,
    "SELECT * FROM score_change_history WHERE score_item_id='score-zero'",
  );
  assert.equal(JSON.parse(h.before_json).scoreValue, 0);
  assert.equal(h.reason, "虛構更正原因");
  assert.ok(
    (await one(f.db, "SELECT locked_at FROM exams WHERE id='exam-1'"))
      .locked_at,
  );
  assert.equal(await p.regenerationRequest(job.id), null);
  assert.ok(
    await one(
      f.db,
      "SELECT id FROM ai_jobs WHERE result_version_id=?",
      receipt.resultVersionId,
    ),
  );
  await rejects(
    p.confirm(f.owner, preview.previewId, true),
    "PUBLICATION_PREVIEW_NOT_FOUND",
  );
  await rejects(
    p.preview(f.teacher, "exam-1", {
      kind: "EDIT",
      reason: "x",
      expectedVersion: 3,
      scores: [score("part-a1", "setting-1-QUIZ-ENGLISH", 80)],
    }),
    "SCOPE_DENIED",
  );
  await rejects(
    p.preview(f.teacher, "exam-1", {
      kind: "PUBLISH",
      component: "MIDTERM",
      expectedVersion: 3,
    }),
    "SCOPE_DENIED",
  );
});

test("Phase 7 concurrent confirmations: one version and one history, stale previews reject", async (t) => {
  const f = await fixture(t),
    p = publication(f);
  await publish(f);
  const a = await edit(f),
    b = await edit(f);
  const receipts = await Promise.all([
    p.confirm(f.owner, a.previewId, true),
    p.confirm(f.owner, a.previewId, true),
  ]);
  assert.equal(new Set(receipts.map((r) => r.resultVersionId)).size, 1);
  await rejects(
    p.confirm(f.owner, b.previewId, true),
    "PUBLICATION_SOURCE_CHANGED",
  );
  assert.equal(
    (
      await all(
        f.db,
        "SELECT id FROM score_change_history WHERE score_item_id='score-zero'",
      )
    ).length,
    1,
  );
});

test("Phase 7 transaction failure retains prior public version, lock, scores and requests", async (t) => {
  const f = await fixture(t),
    p = publication(f);
  await publish(f);
  const preview = await edit(f);
  const before = await state(f.db);
  await f.db
    .prepare(
      "CREATE TRIGGER fictional_publication_failure BEFORE INSERT ON exam_results BEGIN SELECT RAISE(ABORT,'FICTIONAL_FAILURE'); END",
    )
    .run();
  await rejects(
    p.confirm(f.owner, preview.previewId, true),
    "PUBLICATION_CONFLICT",
  );
  assert.deepEqual(await state(f.db), before);
  await f.db.prepare("DROP TRIGGER fictional_publication_failure").run();
  assert.equal(
    (await p.confirm(f.owner, preview.previewId, true)).replayed,
    false,
  );
});

test("Phase 7 authorization: revoked/recent boundary and source revision at confirm", async (t) => {
  const f = await fixture(t),
    p = publication(f);
  await publish(f);
  const preview = await edit(f, f.teacher);
  await run(
    f.db,
    "UPDATE admin_sessions SET recent_auth_at=? WHERE id=?",
    now - 300000,
    f.teacher.sessionId,
  );
  await rejects(
    p.confirm(f.teacher, preview.previewId, true),
    "RECENT_AUTHENTICATION_REQUIRED",
  );
  await run(
    f.db,
    "UPDATE admin_sessions SET recent_auth_at=? WHERE id=?",
    now,
    f.teacher.sessionId,
  );
  await run(f.db, "UPDATE academic_state SET revision=revision+1 WHERE id=1");
  await rejects(
    p.confirm(f.teacher, preview.previewId, true),
    "PUBLICATION_SOURCE_CHANGED",
  );
  const fresh = await edit(f, f.teacher);
  await run(
    f.db,
    "UPDATE admin_sessions SET revoked_at=? WHERE id=?",
    now,
    f.teacher.sessionId,
  );
  await rejects(p.confirm(f.teacher, fresh.previewId, true), "ACCESS_DENIED");
});

test("Phase 7 historical correction requires super admin and keeps original cohort; transferred students get no jobs", async (t) => {
  const f = await fixture(t),
    p = publication(f);
  await publish(f);
  await run(
    f.db,
    "UPDATE academic_state SET current_year_id=NULL,revision=revision+1 WHERE id=1",
  );
  await run(
    f.db,
    "UPDATE students SET status='transferred_out',version=version+1 WHERE id='fictional-a'",
  );
  await rejects(edit(f, f.teacher), "HISTORICAL_SCOPE_DENIED");
  const preview = await edit(f),
    result = await p.confirm(f.owner, preview.previewId, true);
  assert.equal(
    (
      await all(
        f.db,
        "SELECT id FROM ai_jobs WHERE result_version_id=? AND student_id='fictional-a'",
        result.resultVersionId,
      )
    ).length,
    0,
  );
  assert.ok(
    (await one(f.db, "SELECT locked_at FROM exams WHERE id='exam-1'"))
      .locked_at,
  );
  assert.equal(
    (await p.publishedClass(f.owner, "exam-1", "class-701")).students.find(
      (s) => s.studentId === "fictional-a",
    ).classIdSnapshot,
    "class-701",
  );
});

test("Phase 7 all NOT_HELD explicitly publishes and never ranks; first publication failure exposes nothing", async (t) => {
  const f = await fixture(t),
    p = publication(f);
  await run(
    f.db,
    "UPDATE exam_subject_settings SET held=0 WHERE exam_id='exam-1' AND exam_type='MIDTERM'",
  );
  const preview = await p.preview(f.owner, "exam-1", {
    kind: "PUBLISH",
    component: "MIDTERM",
    expectedVersion: 1,
  });
  await f.db
    .prepare(
      "CREATE TRIGGER fictional_first_failure BEFORE INSERT ON ai_jobs BEGIN SELECT RAISE(ABORT,'FICTIONAL_FAILURE'); END",
    )
    .run();
  await rejects(
    p.confirm(f.owner, preview.previewId, true),
    "PUBLICATION_CONFLICT",
  );
  assert.deepEqual(await p.publishedClass(f.owner, "exam-1", "class-701"), {
    published: false,
  });
  await f.db.prepare("DROP TRIGGER fictional_first_failure").run();
  await p.confirm(f.owner, preview.previewId, true);
  const result = await p.publishedClass(f.owner, "exam-1", "class-701");
  assert.equal(result.mode, "PROVISIONAL");
  assert.ok(result.students.every((s) => s.classRank === null));
});

test("Phase 7 migration upgrades Phase 6, preserves scores and is replayable", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  const migrations = readMigrationFiles({ migrationsFolder });
  await run(
    db,
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );
  for (const m of migrations.slice(0, 8)) {
    await db.batch(m.sql.filter((s) => s.trim()).map((s) => db.prepare(s)));
    await run(
      db,
      "INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)",
      m.hash,
      m.folderMillis,
    );
  }
  await seedFictional(db, fictionalKeys());
  const before = await all(db, "SELECT * FROM score_items ORDER BY id");
  assert.equal((await migrationPreflight(db)).pending, 1);
  await migrateLocalDatabase(db);
  assert.deepEqual(
    await all(db, "SELECT * FROM score_items ORDER BY id"),
    before,
  );
  assert.equal((await migrateLocalDatabase(db)).pending, 0);
});

test("Phase 7 HTTP: cookie, CSRF, unknown fields, URL/preview mismatch and class scope", async (t) => {
  const f = await fixture(t),
    p = publication(f),
    base = "https://fictional.example.test/api/admin/exams/exam-1/publication";
  const { SESSION_COOKIE } = await import("../lib/server/auth/cookies.ts");
  const send = (path, body, extra = {}) =>
    handlePublicationRequest(
      new Request(base + "/" + path, {
        method: "POST",
        headers: {
          Origin: "https://fictional.example.test",
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE}=${f.owner.token}`,
          ...extra,
        },
        body: JSON.stringify(body),
      }),
      { auth: f.auth, publication: p },
      path,
      "exam-1",
    );
  const body = { kind: "PUBLISH", component: "QUIZ", expectedVersion: 1 };
  assert.equal(
    (await send("preview", body, { Origin: "https://other.example.test" }))
      .status,
    403,
  );
  assert.equal((await send("preview", body, { Cookie: "" })).status, 401);
  assert.equal(
    (await send("preview", { ...body, actorId: "forged" })).status,
    400,
  );
  const response = await send("preview", body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const preview = await response.json();
  await rejects(
    p.confirm(f.owner, preview.previewId, true, "exam-2"),
    "PUBLICATION_PREVIEW_NOT_FOUND",
  );
  assert.equal(
    (await send("confirm", { previewId: preview.previewId, confirmed: true }))
      .status,
    200,
  );
  await rejects(
    p.publishedClass(f.viewer, "exam-1", "class-702"),
    "SCOPE_DENIED",
  );
});

test("Phase 7 transaction guard rechecks revocation after preflight", async (t) => {
  const f = await fixture(t);
  await publish(f);
  const preview = await edit(f, f.teacher);
  const before = await state(f.db);
  let revoked = false;
  const wrapped = {
    prepare: (q) => f.db.prepare(q),
    batch: async (statements) => {
      if (!revoked) {
        revoked = true;
        await run(
          f.db,
          "UPDATE admin_sessions SET revoked_at=? WHERE id=?",
          now,
          f.teacher.sessionId,
        );
      }
      return f.db.batch(statements);
    },
  };
  const p = new PublicationService({ db: wrapped, now: () => now });
  await rejects(p.confirm(f.teacher, preview.previewId, true), "ACCESS_DENIED");
  assert.deepEqual(await state(f.db), before);
});

test("Phase 7 recalculation failure is side-effect free; advice stale and durable requests need no AI provider", async (t) => {
  const f = await fixture(t),
    p = publication(f);
  await publish(f);
  const job = await one(
    f.db,
    "SELECT * FROM ai_jobs WHERE student_id='fictional-b' AND audience='parent'",
  );
  await run(
    f.db,
    "INSERT INTO ai_advices (id,job_id,student_id,exam_id,audience,source_version,provider,model,prompt_version,content) VALUES ('fictional-advice',?,?,?,?,?,'openai','fictional-model','fictional-v1',?)",
    job.id,
    job.student_id,
    job.exam_id,
    job.audience,
    job.source_version,
    "虛".repeat(500),
  );
  const preview = await edit(f),
    before = await state(f.db);
  const calculate = p.calculate;
  p.calculate = () => {
    throw new Error("FICTIONAL_CALCULATION_FAILURE");
  };
  await assert.rejects(
    p.confirm(f.owner, preview.previewId, true),
    /FICTIONAL_CALCULATION_FAILURE/,
  );
  assert.deepEqual(await state(f.db), before);
  assert.equal(
    (
      await one(
        f.db,
        "SELECT stale_at FROM ai_advices WHERE id='fictional-advice'",
      )
    ).stale_at,
    null,
  );
  p.calculate = calculate;
  const receipt = await p.confirm(f.owner, preview.previewId, true);
  assert.equal(
    (
      await one(
        f.db,
        "SELECT stale_at FROM ai_advices WHERE id='fictional-advice'",
      )
    ).stale_at,
    now,
  );
  assert.ok(
    await one(
      f.db,
      "SELECT id FROM ai_jobs WHERE student_id='fictional-b' AND result_version_id=?",
      receipt.resultVersionId,
    ),
  );
});
