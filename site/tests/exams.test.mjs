import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { ExamService } from "../lib/server/exams/service.ts";
import { handleExamRequest } from "../lib/server/exams/http.ts";
import { parseScore } from "../lib/domain/scores.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  migrationPreflight,
  migrationsFolder,
  fictionalKeys,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";

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
const op = (extra = {}) => ({
  operationId: crypto.randomUUID(),
  confirmed: true,
  expectedVersion: 1,
  ...extra,
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
const createInput = (extra = {}) => ({
  operationId: crypto.randomUUID(),
  academicTermId: "term-115-1",
  sequence: 3,
  startsOn: "2027-01-10",
  endsOn: "2027-01-14",
  confirmed: true,
  ...extra,
});
const snapshot = async (db) => ({
  scores: await all(db, "SELECT * FROM score_items ORDER BY id"),
  history: await all(db, "SELECT * FROM score_change_history ORDER BY id"),
  operations: await all(db, "SELECT * FROM exam_operations ORDER BY id"),
  exams: await all(db, "SELECT * FROM exams ORDER BY id"),
  audits: await all(
    db,
    "SELECT * FROM audit_logs WHERE entity_type='exam' ORDER BY id",
  ),
});

test("Phase 4 score parser: exact hundredths, zero, missing and all special codes", () => {
  for (const [input, value] of [
    [0, 0],
    [100, 10000],
    [80.25, 8025],
    ["80.10", 8010],
    ["0.01", 1],
    ["100.00", 10000],
  ])
    assert.deepEqual(parseScore(input), {
      scoreValue: value,
      scoreStatus: "NORMAL",
      includeInAverage: 1,
    });
  for (const [input, status] of [
    [null, "UNENTERED"],
    ["", "UNENTERED"],
    ["A", "ABSENT"],
    ["B", "OFFICIAL_LEAVE"],
    ["C", "SICK_LEAVE"],
    ["D", "EXEMPT"],
    ["N", "NOT_HELD"],
  ])
    assert.deepEqual(parseScore(input), {
      scoreValue: null,
      scoreStatus: status,
      includeInAverage: 0,
    });
  for (const input of [
    -1,
    -0,
    100.01,
    80.001,
    NaN,
    Infinity,
    "-0",
    "1e2",
    "0x10",
    "+5",
    "80.000",
    "01",
    "1,00",
    "Ａ",
    "a",
    "NORMAL",
    "__proto__",
    "constructor",
    "toString",
    true,
    {},
    undefined,
  ])
    assert.throws(
      () => parseScore(input),
      (e) => e.code === "INVALID_SCORE",
    );
});

test("Phase 4 exam creation/schedule: three sequences, term isolation, whole-school scope, replay", async (t) => {
  const f = await fixture(t),
    { service: s, owner, db } = f;
  const input = createInput();
  await rejects(s.createExam(f.homeroom, input), "SCOPE_DENIED");
  await rejects(s.createExam(f.viewer, input), "PERMISSION_DENIED");
  const receipt = await s.createExam(owner, input);
  assert.equal(
    (
      await all(
        db,
        "SELECT * FROM exam_subject_settings WHERE exam_id=?",
        receipt.examId,
      )
    ).length,
    10,
  );
  assert.equal((await s.createExam(owner, input)).replayed, true);
  await rejects(
    s.createExam(owner, { ...input, sequence: 2 }),
    "OPERATION_CONFLICT",
  );
  await rejects(s.createExam(owner, createInput()), "EXAM_CONFLICT");
  await rejects(
    s.createExam(owner, createInput({ sequence: 4 })),
    "INVALID_EXAM_SEQUENCE",
  );
  await rejects(
    s.createExam(owner, createInput({ startsOn: "2027-02-30" })),
    "INVALID_EXAM_DATE",
  );
  await rejects(
    s.createExam(owner, createInput({ endsOn: "2027-02-02" })),
    "EXAM_OUTSIDE_TERM",
  );
  const second = await s.createExam(
    owner,
    createInput({
      academicTermId: "term-115-2",
      sequence: 1,
      startsOn: "2027-03-01",
      endsOn: "2027-03-05",
    }),
  );
  assert.notEqual(second.examId, "exam-1");
  await rejects(
    s.updateSchedule(
      owner,
      "exam-1",
      op({ startsOn: "2026-09-14", endsOn: "2026-09-20" }),
    ),
    "EXAM_HAS_FROZEN_ROSTER",
  );
  await s.updateSchedule(
    owner,
    receipt.examId,
    op({ startsOn: "2027-01-11", endsOn: "2027-01-15" }),
  );
  assert.equal(
    (await one(db, "SELECT version FROM exams WHERE id=?", receipt.examId))
      .version,
    2,
  );
});

test("Phase 4 roster: preview/confirm, D-03 snapshots, late entrants, stale sources and replay", async (t) => {
  const { service: s, owner, homeroom, teacher, db } = await fixture(t);
  const late = await s.previewRoster(homeroom, "exam-1", {
    classId: "class-701",
  });
  assert.deepEqual(late.rows, []); // a/b already confirmed, late entrant is after exam start.
  await rejects(
    s.confirmRoster(homeroom, "exam-1", op({ previewId: late.previewId })),
    "EMPTY_ROSTER",
  );
  await rejects(
    s.previewRoster(teacher, "exam-2", { classId: "class-701" }),
    "SCOPE_DENIED",
  );
  let preview = await s.previewRoster(homeroom, "exam-2", {
    classId: "class-701",
    overrides: [{ studentId: "fictional-b", eligible: true }],
  });
  assert.deepEqual(
    preview.rows.map((r) => r.studentId),
    ["fictional-b", "fictional-late"],
  );
  assert.equal(preview.rows[0].termOverride, false);
  assert.equal(preview.rows[0].rankingEligible, true);
  await run(
    db,
    "UPDATE students SET ranking_eligible_default=0,version=version+1 WHERE id='fictional-late'",
  );
  await rejects(
    s.confirmRoster(homeroom, "exam-2", op({ previewId: preview.previewId })),
    "STALE_ROSTER_PREVIEW",
  );
  preview = await s.previewRoster(homeroom, "exam-2", {
    classId: "class-701",
    overrides: [{ studentId: "fictional-b", eligible: true }],
  });
  await rejects(
    s.confirmRoster(owner, "exam-2", op({ previewId: preview.previewId })),
    "PREVIEW_NOT_FOUND",
  );
  const command = op({ previewId: preview.previewId });
  await rejects(
    s.confirmRoster(homeroom, "exam-2", { ...command, confirmed: false }),
    "CONFIRMATION_REQUIRED",
  );
  const result = await s.confirmRoster(homeroom, "exam-2", command);
  assert.equal(result.count, 2);
  assert.equal(
    (await s.confirmRoster(homeroom, "exam-2", command)).replayed,
    true,
  );
  const saved = await all(
    db,
    "SELECT * FROM exam_participations WHERE exam_id='exam-2' ORDER BY id",
  );
  await run(
    db,
    "UPDATE students SET ranking_eligible_default=1,version=version+1 WHERE id='fictional-late'",
  );
  assert.deepEqual(
    await all(
      db,
      "SELECT * FROM exam_participations WHERE exam_id='exam-2' ORDER BY id",
    ),
    saved,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT class_id_snapshot FROM exam_participations WHERE id='part-a1'",
      )
    ).class_id_snapshot,
    "class-701",
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT class_id_snapshot FROM exam_participations WHERE id='part-a2'",
      )
    ).class_id_snapshot,
    "class-702",
  );
  await assert.rejects(
    run(
      db,
      "UPDATE exam_roster_previews SET roster_json='[]' WHERE id=?",
      preview.previewId,
    ),
    /EXAM_PREVIEW_IMMUTABLE/,
  );
});

test("Phase 4 subject settings: N never changes held; external scores have independent held semantics", async (t) => {
  const { service: s, owner, homeroom, db } = await fixture(t);
  const settingId = "setting-1-QUIZ-MATH";
  await rejects(
    s.setSubjectHeld(
      homeroom,
      "exam-1",
      op({ settingId, settingVersion: 1, held: false }),
    ),
    "SCOPE_DENIED",
  );
  await rejects(
    s.writeDraftScores(
      owner,
      "exam-1",
      op({ scores: [score("part-a1", settingId, "N")] }),
    ),
    "SCORE_HELD_MISMATCH",
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT held FROM exam_subject_settings WHERE id=?",
        settingId,
      )
    ).held,
    1,
  );
  await s.setSubjectHeld(
    owner,
    "exam-1",
    op({ settingId, settingVersion: 1, held: false }),
  );
  const card = await s.readParticipation(owner, "part-a1");
  assert.equal(
    card.scores.find((x) => x.settingId === settingId).scoreStatus,
    "NOT_HELD",
  );
  assert.equal(card.scores.find((x) => x.settingId === settingId).version, 0);
  await rejects(
    s.writeDraftScores(
      owner,
      "exam-1",
      op({ expectedVersion: 2, scores: [score("part-a1", settingId, "A")] }),
    ),
    "SCORE_HELD_MISMATCH",
  );
  await s.writeDraftScores(
    owner,
    "exam-1",
    op({
      expectedVersion: 2,
      scores: [
        score("part-a1", settingId, "N"),
        score("part-external", settingId, "95.50"),
      ],
    }),
  );
  await rejects(
    s.setSubjectHeld(
      owner,
      "exam-1",
      op({ expectedVersion: 3, settingId, settingVersion: 2, held: true }),
    ),
    "SETTING_HAS_SCORES",
  );
  const external = await one(
    db,
    "SELECT * FROM score_items WHERE participation_id='part-external' AND setting_id=?",
    settingId,
  );
  assert.equal(external.score_value, 9550);
  assert.equal(external.include_in_ranking, 0);
  assert.equal(external.class_id_snapshot, null);
});

test("Phase 4 draft history and scope: zero, all codes, mixed batch, forgery and stale versions", async (t) => {
  const { service: s, owner, teacher, homeroom, viewer, db } = await fixture(t);
  const before = await snapshot(db);
  await rejects(
    s.writeDraftScores(
      viewer,
      "exam-1",
      op({ scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 70, 1)] }),
    ),
    "PERMISSION_DENIED",
  );
  await rejects(
    s.writeDraftScores(
      teacher,
      "exam-1",
      op({
        scores: [
          score("part-a1", "setting-1-QUIZ-CHINESE", 70, 1),
          score("part-a1", "setting-1-QUIZ-MATH", 80),
        ],
      }),
    ),
    "SCOPE_DENIED",
  );
  await rejects(
    s.writeDraftScores(
      { ...teacher, role: "super_admin" },
      "exam-2",
      op({ scores: [score("part-a2", "setting-2-QUIZ-CHINESE", 70)] }),
    ),
    "SCOPE_DENIED",
  );
  assert.deepEqual(await snapshot(db), before);
  const input = op({
    scores: [score("part-a1", "setting-1-QUIZ-CHINESE", "0.00", 1)],
  });
  const receipt = await s.writeDraftScores(teacher, "exam-1", input);
  assert.equal(receipt.version, 2);
  assert.equal(
    (await s.writeDraftScores(teacher, "exam-1", input)).replayed,
    true,
  );
  await rejects(
    s.writeDraftScores(teacher, "exam-1", {
      ...input,
      scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 1, 1)],
    }),
    "OPERATION_CONFLICT",
  );
  assert.equal(
    (await one(db, "SELECT count(*) AS n FROM score_change_history")).n,
    1,
  );
  const codes = ["A", "B", "C", "D", null],
    subjects = ["ENGLISH", "MATH", "SCIENCE", "GEOGRAPHY", "HISTORY"];
  await s.writeDraftScores(
    homeroom,
    "exam-1",
    op({
      expectedVersion: 2,
      scores: codes.map((v, i) =>
        score("part-a1", `setting-1-MIDTERM-${subjects[i]}`, v),
      ),
    }),
  );
  const card = await s.readParticipation(homeroom, "part-a1");
  assert.equal(
    card.scores.find((x) => x.settingId === "setting-1-QUIZ-CHINESE")
      .displayValue,
    "0.00",
  );
  for (const status of [
    "ABSENT",
    "OFFICIAL_LEAVE",
    "SICK_LEAVE",
    "EXEMPT",
    "UNENTERED",
  ])
    assert.ok(
      card.scores.some(
        (x) => x.scoreStatus === status && x.scoreValue === null,
      ),
    );
  await rejects(
    s.writeDraftScores(
      owner,
      "exam-1",
      op({
        expectedVersion: 3,
        scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 50, 1)],
      }),
    ),
    "SCORE_VERSION_CONFLICT",
  );
  await rejects(
    s.writeDraftScores(
      owner,
      "exam-1",
      op({
        expectedVersion: 2,
        scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 50, 2)],
      }),
    ),
    "EXAM_VERSION_CONFLICT",
  );
  await rejects(
    s.writeDraftScores(
      owner,
      "exam-1",
      op({
        expectedVersion: 3,
        scores: [score("part-a1", "setting-2-QUIZ-CHINESE", 50)],
      }),
    ),
    "SCORE_TARGET_NOT_FOUND",
  );
  await rejects(
    s.readExam(teacher, "exam-1", { classId: "class-701" }),
    "SCOPE_DENIED",
  );
  const view = await s.readExam(teacher, "exam-1", {
    classId: "class-701",
    subject: "CHINESE",
  });
  assert.equal(view.settings.length, 2);
  assert.ok(
    view.participants.every(
      (p) =>
        p.class_id_snapshot === "class-701" &&
        p.scores.every((x) => x.subject === "CHINESE"),
    ),
  );
});

test("Phase 4 external participation resolves current enrollment and never grants local ranking", async (t) => {
  const { service: s, owner, homeroom, teacher, db } = await fixture(t);
  const input = op({ studentId: "fictional-late", schoolLabel: "虛構原校" });
  const result = await s.addExternalParticipation(homeroom, "exam-1", input);
  assert.equal(
    (await s.addExternalParticipation(homeroom, "exam-1", input))
      .participationId,
    result.participationId,
  );
  const part = await one(
    db,
    "SELECT * FROM exam_participations WHERE id=?",
    result.participationId,
  );
  assert.equal(part.origin, "EXTERNAL_TRANSFER");
  assert.equal(part.class_id_snapshot, null);
  assert.equal(part.ranking_eligible, 0);
  await s.writeDraftScores(
    teacher,
    "exam-1",
    op({
      expectedVersion: 2,
      scores: [score(result.participationId, "setting-1-QUIZ-CHINESE", 90)],
    }),
  );
  await rejects(
    s.addExternalParticipation(
      homeroom,
      "exam-1",
      op({
        expectedVersion: 3,
        studentId: "fictional-external",
        schoolLabel: "虛構原校",
      }),
    ),
    "SCOPE_DENIED",
  );
  await rejects(
    s.readParticipation(teacher, "part-external", "CHINESE"),
    "SCOPE_DENIED",
  );
  await run(
    db,
    "UPDATE students SET status='transferred_out',transferred_out_on='2026-09-24',version=version+1 WHERE id='fictional-late'",
  );
  await rejects(
    s.writeDraftScores(
      owner,
      "exam-1",
      op({
        expectedVersion: 3,
        scores: [
          score(result.participationId, "setting-1-QUIZ-CHINESE", 95, 1),
        ],
      }),
    ),
    "STUDENT_SCOPE_UNAVAILABLE",
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT score_value FROM score_items WHERE participation_id=?",
        result.participationId,
      )
    ).score_value,
    9000,
  );
});

test("Phase 4 draft gates: published components, locked, archived, historical and transferred students", async (t) => {
  const { service: s, owner, db } = await fixture(t);
  const input = () =>
    op({ scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 88, 1)] });
  for (const field of ["published_at", "locked_at", "archived_at"]) {
    await run(db, `UPDATE exams SET ${field}=? WHERE id='exam-1'`, now);
    await rejects(
      s.writeDraftScores(owner, "exam-1", input()),
      "EXAM_NOT_DRAFT",
    );
    await run(db, `UPDATE exams SET ${field}=NULL WHERE id='exam-1'`);
  }
  await run(
    db,
    "INSERT INTO exam_result_versions (id,exam_id,version,source_version,calculation_version,provisional,published_at) VALUES ('published-component','exam-1',1,1,'fictional',1,?)",
    now,
  );
  await rejects(s.writeDraftScores(owner, "exam-1", input()), "EXAM_CONFLICT");
  await run(
    db,
    "DELETE FROM exam_result_versions WHERE id='published-component'",
  );
  await run(
    db,
    "UPDATE students SET status='transferred_out',transferred_out_on='2026-09-24',version=version+1 WHERE id='fictional-a'",
  );
  await rejects(
    s.writeDraftScores(owner, "exam-1", input()),
    "STUDENT_NOT_ACTIVE",
  );
  await run(
    db,
    "UPDATE students SET status='active',transferred_out_on=NULL,version=version+1 WHERE id='fictional-a'",
  );
  await run(
    db,
    "INSERT INTO academic_years (id,code,starts_on,ends_on) VALUES ('year-116','116','2027-08-01','2028-08-01')",
  );
  // Historical writes require the Phase 7 unlock flow, unavailable from this draft route.
  await rejects(
    s.writeDraftScores(owner, "exam-1", input()),
    "HISTORICAL_SCOPE_DENIED",
  );
  assert.equal(
    (await s.readParticipation(owner, "part-a1")).scores[0].version >= 0,
    true,
  );
  assert.equal(
    (await one(db, "SELECT score_value FROM score_items WHERE id='score-zero'"))
      .score_value,
    0,
  );
});

test("Phase 4 transactions: concurrent writers, identical retries, mid-batch failure and revocation races", async (t) => {
  const { service: s, owner, teacher, management, db } = await fixture(t);
  const make = (value) =>
    op({ scores: [score("part-a1", "setting-1-QUIZ-CHINESE", value, 1)] });
  const results = await Promise.allSettled([
    s.writeDraftScores(teacher, "exam-1", make(10)),
    s.writeDraftScores(teacher, "exam-1", make(20)),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  const same = op({
    expectedVersion: 2,
    scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 30, 2)],
  });
  const retries = await Promise.all([
    s.writeDraftScores(teacher, "exam-1", same),
    s.writeDraftScores(teacher, "exam-1", same),
  ]);
  assert.equal(retries.filter((x) => x.replayed).length, 1);
  assert.equal(
    (await one(db, "SELECT count(*) AS n FROM score_change_history")).n,
    2,
  );
  const before = await snapshot(db);
  await run(
    db,
    "CREATE TRIGGER fail_second_score BEFORE INSERT ON score_items WHEN NEW.subject='ENGLISH' BEGIN SELECT RAISE(ABORT,'INJECTED_FAILURE'); END",
  );
  await rejects(
    s.writeDraftScores(
      owner,
      "exam-1",
      op({
        expectedVersion: 3,
        scores: [
          score("part-a1", "setting-1-QUIZ-CHINESE", 40, 3),
          score("part-a1", "setting-1-QUIZ-ENGLISH", 50),
        ],
      }),
    ),
    "EXAM_CONFLICT",
  );
  assert.deepEqual(await snapshot(db), before);
  await run(db, "DROP TRIGGER fail_second_score");
  let injected = false;
  const wrapped = {
    prepare: db.prepare.bind(db),
    batch: async (statements) => {
      if (!injected) {
        injected = true;
        await management.revokeSessions(owner, teacher.adminId, {
          expectedVersion: 1,
          confirmed: true,
        });
      }
      return db.batch(statements);
    },
  };
  const raced = new ExamService({ db: wrapped, now: () => now });
  await rejects(
    raced.writeDraftScores(
      teacher,
      "exam-1",
      op({
        expectedVersion: 3,
        scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 60, 3)],
      }),
    ),
    "ACCESS_DENIED",
  );
  assert.deepEqual(await snapshot(db), before);
});

test("Phase 4 commit guards reject academic and setting changes after preflight", async (t) => {
  const { db, owner } = await fixture(t);
  const race = (change) => {
    let injected = false;
    return new ExamService({
      now: () => now,
      db: {
        prepare: db.prepare.bind(db),
        batch: async (statements) => {
          if (!injected) {
            injected = true;
            await change();
          }
          return db.batch(statements);
        },
      },
    });
  };
  const original = await snapshot(db);
  const academicRace = race(() =>
    run(
      db,
      "UPDATE students SET ranking_eligible_default=0,version=version+1 WHERE id='fictional-a'",
    ),
  );
  await rejects(
    academicRace.writeDraftScores(
      owner,
      "exam-1",
      op({ scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 80, 1)] }),
    ),
    "EXAM_CONFLICT",
  );
  assert.deepEqual(await snapshot(db), original);
  const settingId = "setting-1-QUIZ-MATH";
  const settingRace = race(() =>
    run(
      db,
      "UPDATE exam_subject_settings SET version=version+1 WHERE id=?",
      settingId,
    ),
  );
  await rejects(
    settingRace.setSubjectHeld(
      owner,
      "exam-1",
      op({ settingId, settingVersion: 1, held: false }),
    ),
    "EXAM_CONFLICT",
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT held FROM exam_subject_settings WHERE id=?",
        settingId,
      )
    ).held,
    1,
  );
  assert.deepEqual(await snapshot(db), original);
});

test("Phase 4 HTTP: cookie auth, CSRF, strict JSON, scope and no-store responses", async (t) => {
  const f = await fixture(t);
  const call = (operation, body, options = {}) => {
    const headers = {
      Origin: "https://school.example.test",
      "Content-Type": "application/json",
      Cookie: `__Host-admin_session=${(options.session ?? f.owner).token}`,
      ...options.headers,
    };
    return handleExamRequest(
      new Request(
        `https://school.example.test/api/admin/exams${options.search ?? ""}`,
        {
          method: options.method ?? "POST",
          headers,
          ...(options.method === "GET" ? {} : { body: JSON.stringify(body) }),
        },
      ),
      { auth: f.auth, exams: f.service },
      operation,
      options.id ?? "exam-1",
    );
  };
  assert.equal(
    (await call("create", createInput(), { headers: { Cookie: "" } })).status,
    401,
  );
  assert.equal(
    (
      await call("create", createInput(), {
        headers: { Origin: "https://evil.example.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("create", createInput(), { headers: { Origin: "" } })).status,
    403,
  );
  assert.equal(
    (
      await call("create", createInput(), {
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal(
    (await call("create", { ...createInput(), role: "super_admin" })).status,
    400,
  );
  assert.equal(
    (await call("create", { ...createInput(), extra: "x".repeat(65536) }))
      .status,
    413,
  );
  assert.equal(
    (await call("create", createInput(), { session: f.viewer })).status,
    403,
  );
  const written = await call(
    "scores",
    {
      operationId: crypto.randomUUID(),
      expectedVersion: 1,
      scores: [score("part-a1", "setting-1-QUIZ-CHINESE", 75, 1)],
    },
    { session: f.teacher },
  );
  assert.equal(written.status, 200);
  assert.equal(written.headers.get("Cache-Control"), "no-store");
  assert.equal(
    (
      await call("scores", {
        operationId: crypto.randomUUID(),
        expectedVersion: 2,
        scores: [
          {
            ...score("part-a1", "setting-1-QUIZ-CHINESE", 85, 2),
            includeInRanking: 1,
          },
        ],
      })
    ).status,
    400,
  );
  const read = await call("read", null, {
    session: f.teacher,
    method: "GET",
    search: "?classId=class-701&subject=CHINESE",
  });
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("Cache-Control"), "no-store");
  assert.equal(
    (
      await call("read", null, {
        session: f.teacher,
        method: "GET",
        search: "?classId=class-702&subject=CHINESE",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("read", null, {
        method: "GET",
        search: "?classId=class-701&classId=class-702",
      })
    ).status,
    400,
  );
});

test("Phase 4 migration: upgrade Phase 3B without changing its scores, snapshots or sessions", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await run(
    db,
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY,hash text NOT NULL,created_at numeric)",
  );
  for (const m of readMigrationFiles({ migrationsFolder }).slice(0, 7))
    await db.batch([
      ...m.sql.map((sql) => db.prepare(sql)),
      db
        .prepare(
          "INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)",
        )
        .bind(m.hash, m.folderMillis),
    ]);
  await seedFictional(db, fictionalKeys());
  const auth = new AuthService({
    db,
    oidc: {},
    bootstrapSecret: "fictional-upgrade",
    now: () => now,
  });
  await auth.bootstrap({
    secret: "fictional-upgrade",
    identity: identity("upgrade"),
  });
  const before = {
    scores: await all(db, "SELECT * FROM score_items ORDER BY id"),
    parts: await all(db, "SELECT * FROM exam_participations ORDER BY id"),
    sessions: await all(db, "SELECT * FROM admin_sessions ORDER BY id"),
  };
  assert.equal((await migrationPreflight(db)).pending, 3);
  assert.equal((await migrateLocalDatabase(db)).applied, 10);
  assert.equal((await migrateLocalDatabase(db)).pending, 0);
  assert.deepEqual(
    await all(db, "SELECT * FROM score_items ORDER BY id"),
    before.scores,
  );
  assert.deepEqual(
    await all(db, "SELECT * FROM exam_participations ORDER BY id"),
    before.parts,
  );
  assert.deepEqual(
    await all(db, "SELECT * FROM admin_sessions ORDER BY id"),
    before.sessions,
  );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    [],
  );
});
