import assert from "node:assert/strict";
import { test } from "node:test";
import { Miniflare } from "miniflare";
import {
  migrateLocalDatabase,
  fictionalKeys,
  migrationPreflight,
} from "../scripts/db-local.mjs";
import { AuthService } from "../lib/server/auth/service.ts";
import { AdminWorkspaceService } from "../lib/server/admin/service.ts";
import { ExamService } from "../lib/server/exams/service.ts";
import { PublicationService } from "../lib/server/exams/publication.ts";
import { ImportService } from "../lib/server/imports/service.ts";
import { AISettingsService } from "../lib/server/ai/settings.ts";
import { AIJobService } from "../lib/server/ai/jobs.ts";
import { PublicLookupService } from "../lib/server/public/service.ts";
import { ArchiveService } from "../lib/server/archive/service.ts";
import {
  LifecycleService,
  COPY_CATEGORIES,
} from "../lib/server/lifecycle/service.ts";
import { RankingService } from "../lib/server/exams/ranking-service.ts";
import { taipeiBusinessDate } from "../lib/domain/dates.ts";

const headers = [
  "學年度",
  "學期",
  "評量次序",
  "評量分類",
  "班級",
  "姓名",
  "座號",
  "學號",
  "身分證字號",
  "科目",
  "分數",
  "成績來源",
  "原校名稱",
];
const reason = "虛構生命週期整合驗證";
async function fixture(t) {
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    cf: false,
    d1Databases: ["DB"],
    r2Buckets: ["FILES"],
    script:
      "export default {fetch(){return new Response('fictional isolated integration')}}",
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB"),
    files = await mf.getR2Bucket("FILES"),
    keys = fictionalKeys();
  await migrateLocalDatabase(db);
  let time = Date.UTC(2026, 8, 14, 4),
    owner,
    calls = 0,
    failCopies = false;
  const now = () => time;
  const query = (sql, ...args) => db.prepare(sql).bind(...args);
  const one = (sql, ...args) => query(sql, ...args).first();
  const all = async (sql, ...args) => (await query(sql, ...args).all()).results;
  const identity = () => ({
    verified: true,
    emailVerified: true,
    subject: "fictional-integration-owner",
    email: "integration-owner@example.test",
    issuer: "https://accounts.google.com",
    audience: "fictional-client",
    nonce: "fictional",
    issuedAt: time / 1000,
    authTime: time / 1000,
    expiresAt: time / 1000 + 3600,
  });
  const auth = new AuthService({
    db,
    now,
    bootstrapSecret: "fictional-integration-bootstrap",
  });
  owner = await auth.bootstrap({
    secret: "fictional-integration-bootstrap",
    identity: identity(),
  });
  const workspace = new AdminWorkspaceService({
    db,
    now,
    identityKeys: () => keys,
  });
  const execute = (op, input) => workspace.execute(owner, op, input);
  const confirm = (preview) =>
    execute("academic-confirm", { previewId: preview.id, confirmed: true });
  const academic = async (op, input) => {
    const p = await execute(op, input);
    const receipt = await confirm(p);
    return { p, receipt };
  };
  const advance = async (date) => {
    const next = Date.parse(date + "T04:00:00Z");
    assert.ok(next >= time, "integration clock never moves backwards");
    time = next;
    owner = await auth.loginVerifiedGoogle(identity());
  };
  const year = async (code, base) => {
    const { receipt } = await academic("year-preview", {
      code,
      startsOn: `${base}-08-01`,
      secondTermStartsOn: `${base + 1}-02-01`,
      endsOn: `${base + 1}-08-01`,
    });
    const terms = await all(
      "SELECT * FROM academic_terms WHERE academic_year_id=? ORDER BY term_number",
      receipt.yearIds[0],
    );
    return { id: receipt.yearIds[0], terms };
  };
  const rooms = async (yearId, codes) => {
    const { p } = await academic("classes-preview", { yearId, codes });
    return Object.fromEntries(p.rows.map((r) => [r.code, r.classId]));
  };
  const exams = new ExamService({ db, now }),
    publication = new PublicationService({ db, now }),
    imports = new ImportService({ db, files, now, identityKeys: () => keys }),
    archive = new ArchiveService({ db, now });
  const copies = {
    inventory: async (ids, importKeys) => ({
      complete: true,
      categories: [...COPY_CATEGORIES],
      restorationDeadlines: [],
      objects: importKeys.map((key) => ({ key, category: "imports" })),
      evidence:
        "isolated in-memory R2, no external reports, exports, caches or backups",
    }),
    remove: async (key) => {
      if (failCopies) throw new Error("fictional copy removal failure");
      await files.delete(key);
    },
    absent: async (key) => (await files.head(key)) === null,
  };
  const lifecycle = new LifecycleService({ db, now, copies });
  const lookup = new PublicLookupService({
    db,
    now,
    hmacSecret: "fictional-integration-public-lookup-independent-secret",
  });
  const jobs = new AIJobService({
    db,
    now,
    provider: (config) => ({
      generate: async (input) => {
        calls++;
        for (const forbidden of [
          "虛構整合學生",
          "FICTIONAL-INTEGRATION",
          "fictional-integration-identity",
          "studentId",
          "birthDate",
          "identityNumber",
        ])
          assert.ok(
            !input.text.includes(forbidden),
            "AI context excludes identifiers",
          );
        return {
          ...config,
          text: JSON.stringify({
            summary: "學習".repeat(250),
            diagnosis: "持續練習",
            improvements: "加強理解",
            plan: "每日複習",
            encouragement: "持續進步",
            ...(input.instructions.includes("parentSupport")
              ? { parentSupport: "陪伴學習" }
              : {}),
          }),
          attempts: 1,
          usage: { inputTokens: 100, outputTokens: 600, totalTokens: 700 },
        };
      },
    }),
  });
  const publish = async (examId, component) => {
    const e = await one("SELECT version FROM exams WHERE id=?", examId);
    const p = await publication.preview(owner, examId, {
      kind: "PUBLISH",
      component,
      expectedVersion: e.version,
    });
    return publication.confirm(owner, p.previewId, true);
  };
  const createExam = async (termId, sequence, startsOn, endsOn, classIds) => {
    const e = await exams.createExam(owner, {
      operationId: crypto.randomUUID(),
      academicTermId: termId,
      sequence,
      startsOn,
      endsOn,
      confirmed: true,
    });
    for (const classId of classIds) {
      const p = await exams.previewRoster(owner, e.examId, { classId });
      const v = await one("SELECT version FROM exams WHERE id=?", e.examId);
      await exams.confirmRoster(owner, e.examId, {
        operationId: crypto.randomUUID(),
        previewId: p.previewId,
        expectedVersion: v.version,
        confirmed: true,
      });
    }
    return e.examId;
  };
  const upload = async (
    examId,
    classId,
    examType,
    students,
    values,
    sequence = 1,
    classCode = "701",
  ) => {
    const rows = students.map((s, n) => [
      "115",
      "1",
      String(sequence),
      examType,
      classCode,
      s.name,
      String(s.seatNumber),
      s.studentNumber,
      s.identityNumber,
      "國文",
      String(values[n]),
      "LOCAL",
      "",
    ]);
    const bytes = new TextEncoder().encode(
      [headers, ...rows].map((r) => r.join(",")).join("\r\n"),
    );
    const result = await imports.upload(
      owner,
      { kind: "SCORES", examId, classId, examType, subjects: ["CHINESE"] },
      "csv",
      bytes,
    );
    const p = await imports.preview(owner, result.jobId);
    return { jobId: result.jobId, p };
  };
  const commitImport = async (job) => {
    assert.equal(job.p.status, "PREVIEW", JSON.stringify(job.p.issues));
    return imports.commit(owner, job.jobId, job.p.previewVersion, true);
  };
  const archiveCommit = async (input) => {
    const p = await archive.preview(owner, input);
    return archive.confirm(owner, p.previewId, true);
  };
  const lifecycleCommit = async (input) => {
    const p = await lifecycle.preview(owner, input);
    return lifecycle.confirm(
      owner,
      p.previewId,
      true,
      p.confirmation ?? undefined,
    );
  };
  const foundation = async (preloadMidterm = false) => {
    const first = await year("115", 2026),
      classes = await rooms(first.id, ["701", "702"]);
    const students = [1, 2, 3].map((n) => ({
      name: "虛構整合學生" + n,
      birthDate: "2013-05-10",
      studentNumber: "FICTIONAL-INTEGRATION-" + n,
      identityNumber: "FICTIONAL-INTEGRATION-IDENTITY-" + n,
      classId: classes["701"],
      seatNumber: n,
      effectiveFrom: "2026-08-01",
    }));
    const { receipt } = await academic("students-preview", {
      termId: first.terms[0].id,
      rows: students,
      mode: "new",
    });
    receipt.studentIds.forEach((id, n) => (students[n].id = id));
    // Use the input-to-generated-ID mapping, never assume receipt ordering.
    for (const s of students)
      s.id = (
        await one(
          "SELECT id FROM students WHERE student_number=?",
          s.studentNumber,
        )
      ).id;
    const examId = await createExam(
      first.terms[0].id,
      1,
      "2026-09-15",
      "2026-09-17",
      [classes["701"]],
    );
    const quiz = await upload(
      examId,
      classes["701"],
      "QUIZ",
      students.slice(0, 2),
      [0, 80],
    );
    await commitImport(quiz);
    if (preloadMidterm) {
      const mid = await upload(
        examId,
        classes["701"],
        "MIDTERM",
        students.slice(0, 2),
        [100, 80],
      );
      await commitImport(mid);
    }
    return { first, classes, students, examId, quiz };
  };
  return {
    db,
    files,
    auth,
    now,
    one,
    all,
    execute,
    academic,
    advance,
    year,
    rooms,
    exams,
    publication,
    imports,
    archive,
    lifecycle,
    jobs,
    lookup,
    publish,
    createExam,
    upload,
    commitImport,
    archiveCommit,
    lifecycleCommit,
    foundation,
    owner: () => owner,
    calls: () => calls,
    setCopyFailure: (v) => {
      failCopies = v;
    },
    tick: (ms) => {
      time += ms;
    },
    refresh: async () => {
      owner = await auth.loginVerifiedGoogle(identity());
    },
    date: () => taipeiBusinessDate(time),
  };
}

test("Phase 17 required order: provisional quiz publication then midterm import", async (t) => {
  const f = await fixture(t),
    x = await f.foundation();
  await f.publish(x.examId, "QUIZ");
  const provisional = await f.lookup.lookup(
    {
      year: "115",
      term: 1,
      classCode: "701",
      sequence: 1,
      name: x.students[0].name,
      birthDate: x.students[0].birthDate,
    },
    "192.0.2.17",
  );
  assert.equal(provisional.provisional, true);
  assert.equal(provisional.quiz.average, 0);
  assert.equal(provisional.midterm.average, null);
  const mid = await f.upload(
    x.examId,
    x.classes["701"],
    "MIDTERM",
    x.students.slice(0, 2),
    [100, 80],
  );
  await f.commitImport(mid);
  await f.publish(x.examId, "MIDTERM");
  const final = await f.lookup.lookup(
    {
      year: "115",
      term: 1,
      classCode: "701",
      sequence: 1,
      name: x.students[0].name,
      birthDate: x.students[0].birthDate,
    },
    "192.0.2.17",
  );
  assert.equal(final.provisional, false);
  assert.equal(final.exam.average, 5000);
});

test("Phase 17 complete chain: sequential imports, AI regeneration, historical cohorts, promotions, graduation and copy retry", async (t) => {
  const f = await fixture(t),
    x = await f.foundation(),
    a = x.students[0],
    b = x.students[1],
    c = x.students[2];
  await f.advance("2026-09-18");
  const quiz = await f.publish(x.examId, "QUIZ");
  const midtermImport = await f.upload(
    x.examId,
    x.classes["701"],
    "MIDTERM",
    x.students.slice(0, 2),
    [100, 80],
  );
  await f.commitImport(midtermImport);
  const query = (s) => ({
    year: "115",
    term: 1,
    classCode: "701",
    sequence: 1,
    name: s.name,
    birthDate: s.birthDate,
  });
  const provisional = await f.lookup.lookup(query(a), "192.0.2.18");
  assert.equal(
    provisional.midterm.average,
    null,
    "stored unpublised midterm stays private",
  );
  assert.equal(provisional.quiz.average, 0);
  assert.equal(provisional.classRank, 2, "zero is ranked");
  const noMarks = await f.lookup.lookup(query(c), "192.0.2.19");
  assert.equal(noMarks.exam.average, null);
  assert.equal(noMarks.classRank, null);
  const published = await f.publish(x.examId, "MIDTERM");
  assert.notEqual(published.resultVersionId, quiz.resultVersionId);
  const publicFinal = await f.lookup.lookup(query(a), "192.0.2.18");
  assert.equal(publicFinal.exam.average, 5000);
  assert.equal(publicFinal.provisional, false);
  assert.ok(!("gradeRank" in publicFinal));
  for (const secret of [
    b.name,
    b.studentNumber,
    b.id,
    a.id,
    "identity_number",
    "birth_date",
  ])
    assert.ok(
      !JSON.stringify(publicFinal).includes(secret),
      "public result excludes identifiers and other students",
    );

  await new AISettingsService({ db: f.db, now: f.now }).update(f.owner(), {
    configuration: { provider: "openai", model: "fictional-model" },
    expectedVersion: 0,
    confirmed: true,
  });
  await f.jobs.request(f.owner(), {
    examId: x.examId,
    studentId: a.id,
    confirmed: true,
  });
  assert.equal((await f.jobs.consumeOne()).status, "completed");
  assert.equal(f.calls(), 2);
  const withAdvice = await f.lookup.lookup(query(a), "192.0.2.18");
  assert.ok(JSON.stringify(withAdvice).includes("每日複習"));
  const score = await f.one(
    "SELECT id,participation_id,setting_id,version FROM score_items WHERE exam_id=? AND student_id=? AND exam_type='QUIZ'",
    x.examId,
    a.id,
  );
  const version = await f.one("SELECT version FROM exams WHERE id=?", x.examId);
  const edit = await f.publication.preview(f.owner(), x.examId, {
    kind: "EDIT",
    reason,
    expectedVersion: version.version,
    scores: [
      {
        participationId: score.participation_id,
        settingId: score.setting_id,
        value: 100,
        expectedVersion: score.version,
      },
    ],
  });
  await f.publication.confirm(f.owner(), edit.previewId, true);
  assert.equal(
    (await f.one("SELECT locked_at FROM exams WHERE id=?", x.examId)).locked_at,
    f.now(),
  );
  assert.ok(
    (
      await f.all("SELECT stale_at FROM ai_advices WHERE student_id=?", a.id)
    ).every((row) => row.stale_at !== null),
  );
  assert.ok(
    (
      await f.all(
        "SELECT * FROM score_change_history WHERE score_item_id=?",
        score.id,
      )
    ).length >= 2,
  );
  const stale = await f.lookup.lookup(query(a), "192.0.2.18");
  assert.ok(!JSON.stringify(stale).includes("每日複習"));
  assert.equal(stale.classRank, 1);
  assert.equal((await f.jobs.consumeOne()).status, "completed");
  assert.equal(f.calls(), 4);
  const advice = await f.all(
    "SELECT version,stale_at FROM ai_advices WHERE student_id=? ORDER BY version",
    a.id,
  );
  assert.equal(advice.length, 4);
  assert.equal(advice.filter((v) => v.stale_at === null).length, 2);

  await f.advance("2026-10-14");
  const second = await f.createExam(
    x.first.terms[0].id,
    2,
    "2026-10-10",
    "2026-10-12",
    [x.classes["701"]],
  );
  const secondJob = await f.upload(
    second,
    x.classes["701"],
    "QUIZ",
    x.students.slice(0, 2),
    [50, 50],
    2,
  );
  await f.commitImport(secondJob);
  await f.publish(second, "QUIZ");
  const frozenParts = await f.all(
    "SELECT * FROM exam_participations ORDER BY id",
  );
  const frozenSnapshots = await f.all(
    "SELECT * FROM publication_snapshots ORDER BY result_version_id",
  );
  await f.advance("2026-11-01");
  const enrollment = await f.one(
    "SELECT id FROM student_enrollments WHERE student_id=? AND academic_term_id=? AND status='valid'",
    a.id,
    x.first.terms[0].id,
  );
  await f.academic("move-preview", {
    enrollmentId: enrollment.id,
    targetClassId: x.classes["702"],
    seatNumber: 1,
    effectiveFrom: "2026-11-01",
  });
  await assert.rejects(
    f.lookup.lookup({ ...query(a), classCode: "702" }, "192.0.2.20"),
    { kind: "failed" },
  );
  assert.equal((await f.lookup.lookup(query(a), "192.0.2.20")).classRank, 1);

  await f.advance("2027-02-01");
  await f.academic("enrollments-preview", {
    termId: x.first.terms[1].id,
    rows: x.students.map((s) => ({
      studentId: s.id,
      classId: x.classes[s.id === a.id ? "702" : "701"],
      seatNumber: s.id === a.id ? 1 : s.seatNumber,
      effectiveFrom: "2027-02-01",
    })),
  });
  await f.advance("2027-08-01");
  const eighth = await f.year("116", 2027),
    grade8 = await f.rooms(eighth.id, ["801", "802"]);
  await f.academic("promotion-preview", {
    sourceTermId: x.first.terms[1].id,
    targetTermId: eighth.terms[0].id,
    historyReason: reason,
  });
  assert.equal(
    (
      await f.one(
        "SELECT class_id FROM student_enrollments WHERE student_id=? AND academic_term_id=? AND status='valid'",
        a.id,
        eighth.terms[0].id,
      )
    ).class_id,
    grade8["802"],
  );
  await f.advance("2028-02-01");
  await f.academic("enrollments-preview", {
    termId: eighth.terms[1].id,
    rows: x.students.map((s) => ({
      studentId: s.id,
      classId: grade8[s.id === a.id ? "802" : "801"],
      seatNumber: s.id === a.id ? 1 : s.seatNumber,
      effectiveFrom: "2028-02-01",
    })),
  });
  await f.advance("2028-08-01");
  const ninth = await f.year("117", 2028),
    grade9 = await f.rooms(ninth.id, ["901", "902"]);
  await f.academic("promotion-preview", {
    sourceTermId: eighth.terms[1].id,
    targetTermId: ninth.terms[0].id,
    historyReason: reason,
  });
  assert.equal(
    (
      await f.one(
        "SELECT class_id FROM student_enrollments WHERE student_id=? AND academic_term_id=? AND status='valid'",
        a.id,
        ninth.terms[0].id,
      )
    ).class_id,
    grade9["902"],
  );
  await f.advance("2029-02-01");
  await f.academic("enrollments-preview", {
    termId: ninth.terms[1].id,
    rows: x.students.map((s) => ({
      studentId: s.id,
      classId: grade9[s.id === a.id ? "902" : "901"],
      seatNumber: s.id === a.id ? 1 : s.seatNumber,
      effectiveFrom: "2029-02-01",
    })),
  });
  assert.deepEqual(
    await f.all("SELECT * FROM exam_participations ORDER BY id"),
    frozenParts,
  );
  assert.deepEqual(
    await f.all(
      "SELECT * FROM publication_snapshots ORDER BY result_version_id",
    ),
    frozenSnapshots,
  );

  await f.advance("2029-06-25");
  await assert.rejects(
    f.execute("classes-preview", { yearId: x.first.id, codes: ["703"] }),
    { code: "HISTORICAL_YEAR_LOCKED" },
  );
  f.tick(300000);
  await assert.rejects(
    f.execute("classes-preview", {
      yearId: x.first.id,
      codes: ["703"],
      historyReason: reason,
    }),
  );
  await f.refresh();
  await f.academic("classes-preview", {
    yearId: x.first.id,
    codes: ["703"],
    historyReason: reason,
  });
  assert.deepEqual(
    await f.all(
      "SELECT * FROM publication_snapshots ORDER BY result_version_id",
    ),
    frozenSnapshots,
  );
  await f.advance("2029-06-30");
  const graduateInput = {
    action: "GRADUATE",
    target: {
      academicTermId: ninth.terms[1].id,
      onDate: "2029-06-30",
      grade: 9,
    },
    reason,
    force: true,
  };
  const graduation = await f.archiveCommit(graduateInput);
  assert.ok(
    (await f.all("SELECT status,retention_until FROM students")).every(
      (s) => s.status === "graduated" && s.retention_until === "2030-06-30",
    ),
  );
  assert.ok(
    (
      await f.all(
        "SELECT archived_at FROM classes WHERE academic_year_id=?",
        ninth.id,
      )
    ).every((s) => s.archived_at !== null),
  );
  await f.archiveCommit({
    action: "UNDO",
    batchId: graduation.batchId,
    reason,
  });
  assert.ok(
    (await f.all("SELECT status,archived_at FROM students")).every(
      (s) => s.status === "active" && s.archived_at === null,
    ),
  );
  await f.archiveCommit(graduateInput);
  await assert.rejects(
    f.lifecycle.preview(f.owner(), {
      action: "PURGE",
      studentIds: [a.id],
      reason,
    }),
  );
  await f.advance("2030-06-29");
  await assert.rejects(
    f.lifecycle.preview(f.owner(), {
      action: "PURGE",
      studentIds: [a.id],
      reason,
    }),
    { code: "PURGE_BLOCKED_RETENTION_NOT_EXPIRED" },
  );
  await f.advance("2030-06-30");
  const p = await f.lifecycle.preview(f.owner(), {
    action: "PURGE",
    studentIds: [a.id],
    reason,
  });
  assert.ok(
    p.copies.length >= 2,
    "real isolated R2 imports appear in copy inventory",
  );
  await assert.rejects(f.lifecycle.confirm(f.owner(), p.previewId, true), {
    code: "PURGE_SECOND_CONFIRMATION_REQUIRED",
  });
  f.setCopyFailure(true);
  const pending = await f.lifecycle.confirm(
    f.owner(),
    p.previewId,
    true,
    p.confirmation,
  );
  assert.equal(pending.status, "PARTIAL");
  assert.ok(
    await f.one("SELECT id FROM students WHERE id=?", a.id),
    "relational deletion waits for copy verification",
  );
  assert.ok(
    (await f.all("SELECT object_key FROM import_jobs")).length >= 2,
    "copy failure retains protected retry source metadata",
  );
  f.setCopyFailure(false);
  const done = await f.lifecycle.retry(f.owner(), pending.jobId);
  assert.equal(done.status, "DONE");
  assert.equal(await f.one("SELECT id FROM students WHERE id=?", a.id), null);
  assert.equal((await f.all("SELECT object_key FROM import_jobs")).length, 0);
  for (const copy of p.copies) assert.equal(await f.files.head(copy.key), null);
  const evidence = await f.one(
    "SELECT * FROM purge_jobs WHERE id=?",
    pending.jobId,
  );
  assert.equal(evidence.manifest_json, null);
  assert.ok(!JSON.stringify(evidence).includes(a.id));
  const remaining = await f.publication.publishedClass(
    f.owner(),
    x.examId,
    x.classes["701"],
  );
  assert.equal(
    remaining.students.find((s) => s.studentId === b.id).classRank,
    2,
    "Purge does not renumber published ranks",
  );
  await assert.rejects(
    new RankingService({ db: f.db, now: f.now }).calculate(
      f.owner(),
      x.examId,
      { classId: x.classes["701"] },
      "FINAL",
    ),
    { code: "PURGED_EXAM_FROZEN" },
  );
  assert.deepEqual(await f.all("PRAGMA foreign_key_check"), []);
  assert.equal((await migrationPreflight(f.db)).pending, 0);
});

test("Phase 17 alternate branches: import rollback, late transfer, external marks, transfer-out and restore promises", async (t) => {
  const f = await fixture(t),
    x = await f.foundation(),
    a = x.students[0],
    b = x.students[1],
    c = x.students[2];
  const rollback = await f.imports.previewRollback(f.owner(), x.quiz.jobId);
  assert.equal(rollback.canRollback, true);
  await f.imports.rollback(
    f.owner(),
    x.quiz.jobId,
    rollback.previewVersion,
    true,
  );
  const restoredScores = await f.all(
    "SELECT score_value,score_status FROM score_items WHERE exam_id=?",
    x.examId,
  );
  assert.equal(restoredScores.length, 2);
  assert.ok(
    restoredScores.every(
      (s) => s.score_value === null && s.score_status === "UNENTERED",
    ),
  );
  assert.equal(
    (
      await f.imports.rollback(
        f.owner(),
        x.quiz.jobId,
        rollback.previewVersion,
        true,
      )
    ).replayed,
    true,
  );
  const quiz = await f.upload(
    x.examId,
    x.classes["701"],
    "QUIZ",
    x.students.slice(0, 2),
    [0, 80],
  );
  await f.commitImport(quiz);
  const mid = await f.upload(
    x.examId,
    x.classes["701"],
    "MIDTERM",
    x.students.slice(0, 2),
    [100, 80],
  );
  await f.commitImport(mid);
  await f.publish(x.examId, "QUIZ");
  await f.publish(x.examId, "MIDTERM");
  const blocked = await f.imports.previewRollback(f.owner(), quiz.jobId);
  assert.equal(
    blocked.canRollback,
    false,
    "publication blocks rollback of the earlier import",
  );
  const old = await f.all(
    "SELECT * FROM publication_snapshots ORDER BY result_version_id",
  );
  await f.advance("2026-09-20");
  const newcomer = {
    name: "虛構整合轉入學生",
    birthDate: "2013-06-11",
    studentNumber: "FICTIONAL-INTEGRATION-LATE",
    identityNumber: "FICTIONAL-INTEGRATION-IDENTITY-LATE",
    classId: x.classes["701"],
    seatNumber: 4,
    effectiveFrom: "2026-09-20",
  };
  const admitted = await f.academic("students-preview", {
    termId: x.first.terms[0].id,
    rows: [newcomer],
    mode: "transfer_in",
  });
  newcomer.id = admitted.p.rows[0].studentId;
  assert.equal(
    (
      await f.one(
        "SELECT count(*) AS n FROM exam_participations WHERE exam_id=? AND student_id=?",
        x.examId,
        newcomer.id,
      )
    ).n,
    0,
    "late admission does not rebuild the old roster",
  );
  await f.advance("2026-09-25");
  await f.academic("transfer-preview", {
    studentId: b.id,
    effectiveOn: "2026-09-25",
  });
  assert.equal(
    (
      await f.one(
        "SELECT status,retention_until FROM students WHERE id=?",
        b.id,
      )
    ).retention_until,
    "2029-09-25",
  );
  await new AISettingsService({ db: f.db, now: f.now }).update(f.owner(), {
    configuration: { provider: "openai", model: "fictional-model" },
    expectedVersion: 0,
    confirmed: true,
  });
  await assert.rejects(
    f.jobs.request(f.owner(), {
      examId: x.examId,
      studentId: b.id,
      confirmed: true,
    }),
    { code: "AI_JOB_CONFLICT" },
  );
  assert.equal(f.calls(), 0);
  const second = await f.createExam(
    x.first.terms[0].id,
    2,
    "2026-10-10",
    "2026-10-12",
    [x.classes["701"]],
  );
  assert.equal(
    (
      await f.one(
        "SELECT count(*) AS n FROM exam_participations WHERE exam_id=? AND student_id=?",
        second,
        b.id,
      )
    ).n,
    0,
  );
  const v = await f.one("SELECT version FROM exams WHERE id=?", second);
  const external = await f.exams.addExternalParticipation(f.owner(), second, {
    operationId: crypto.randomUUID(),
    expectedVersion: v.version,
    confirmed: true,
    studentId: newcomer.id,
    schoolLabel: "虛構原學校",
  });
  const setting = await f.one(
    "SELECT id FROM exam_subject_settings WHERE exam_id=? AND exam_type='QUIZ' AND subject='CHINESE'",
    second,
  );
  await f.exams.writeDraftScores(f.owner(), second, {
    operationId: crypto.randomUUID(),
    expectedVersion: external.version,
    confirmed: true,
    scores: [
      {
        participationId: external.participationId,
        settingId: setting.id,
        expectedVersion: 0,
        value: 99,
      },
    ],
  });
  const local = await f.upload(
    second,
    x.classes["701"],
    "QUIZ",
    [a, newcomer],
    [50, 50],
    2,
  );
  await f.commitImport(local);
  await f.publish(second, "QUIZ");
  const report = await f.publication.publishedClass(
    f.owner(),
    second,
    x.classes["701"],
  );
  assert.deepEqual(
    report.students.filter((s) => s.studentId !== c.id).map((s) => s.classRank),
    [1, 1],
  );
  const snapshot = JSON.parse(
    (
      await f.one(
        "SELECT snapshot_json FROM publication_snapshots s JOIN exam_result_versions v ON v.id=s.result_version_id WHERE v.exam_id=? ORDER BY v.version DESC LIMIT 1",
        second,
      )
    ).snapshot_json,
  );
  assert.equal(snapshot.result.external[0].classRank, null);
  assert.equal(snapshot.result.external[0].gradeRank, null);
  const publicLate = await f.lookup.lookup(
    {
      year: "115",
      term: 1,
      classCode: "701",
      sequence: 2,
      name: newcomer.name,
      birthDate: newcomer.birthDate,
    },
    "192.0.2.21",
  );
  assert.equal(publicLate.quiz.average, 5000);
  assert.equal(publicLate.classStatistics.average, 5000);
  assert.deepEqual(
    await f.all(
      "SELECT * FROM publication_snapshots WHERE result_version_id IN (SELECT id FROM exam_result_versions WHERE exam_id=?) ORDER BY result_version_id",
      x.examId,
    ),
    old,
  );

  await f.advance("2026-10-20");
  const archived = await f.archiveCommit({
    action: "ARCHIVE",
    target: {
      academicTermId: x.first.terms[0].id,
      onDate: "2026-10-20",
      studentId: a.id,
    },
    reason,
    force: true,
  });
  await f.archiveCommit({ action: "UNDO", batchId: archived.batchId, reason });
  assert.equal(
    (await f.one("SELECT archived_at FROM students WHERE id=?", a.id))
      .archived_at,
    null,
  );
  await f.lifecycleCommit({ action: "DELETE", studentIds: [c.id], reason });
  await assert.rejects(
    f.lifecycle.preview(f.owner(), {
      action: "PURGE",
      studentIds: [c.id],
      reason,
    }),
    { code: "PURGE_BLOCKED_RECYCLE_PROMISE" },
  );
  await f.lifecycleCommit({ action: "RESTORE", studentIds: [c.id], reason });
  assert.equal(
    (await f.one("SELECT deleted_at FROM students WHERE id=?", c.id))
      .deleted_at,
    null,
  );
  assert.deepEqual(
    await f.all(
      "SELECT * FROM publication_snapshots WHERE result_version_id IN (SELECT id FROM exam_result_versions WHERE exam_id=?) ORDER BY result_version_id",
      x.examId,
    ),
    old,
  );
  await f.advance("2029-09-24");
  await assert.rejects(
    f.lifecycle.preview(f.owner(), {
      action: "PURGE",
      studentIds: [b.id],
      reason,
    }),
    { code: "PURGE_BLOCKED_RETENTION_NOT_EXPIRED" },
  );
  await f.advance("2029-09-25");
  const purged = await f.lifecycleCommit({
    action: "PURGE",
    studentIds: [b.id],
    reason,
  });
  assert.equal(purged.status, "DONE");
  assert.equal(await f.one("SELECT id FROM students WHERE id=?", b.id), null);
  assert.ok(await f.one("SELECT id FROM students WHERE id=?", a.id));
  assert.deepEqual(await f.all("PRAGMA foreign_key_check"), []);
});

test("Phase 17 component locks: unpublished writes preserve public snapshot and AI, published and mixed writes reject", async (t) => {
  const f = await fixture(t),
    x = await f.foundation();
  const published = await f.publish(x.examId, "QUIZ");
  await new AISettingsService({ db: f.db, now: f.now }).update(f.owner(), {
    configuration: { provider: "openai", model: "fictional-model" },
    expectedVersion: 0,
    confirmed: true,
  });
  await f.jobs.request(f.owner(), {
    examId: x.examId,
    studentId: x.students[0].id,
    confirmed: true,
  });
  assert.equal((await f.jobs.consumeOne()).status, "completed");
  const snapshot = await f.one(
    "SELECT snapshot_json FROM publication_snapshots WHERE result_version_id=?",
    published.resultVersionId,
  );
  const before = await f.all(
    "SELECT * FROM score_items WHERE exam_id=? ORDER BY id",
    x.examId,
  );
  const settings = await f.all(
    "SELECT id,exam_type FROM exam_subject_settings WHERE exam_id=? AND subject='CHINESE'",
    x.examId,
  );
  const participation = await f.one(
    "SELECT id FROM exam_participations WHERE exam_id=? AND student_id=? AND origin='LOCAL'",
    x.examId,
    x.students[0].id,
  );
  const input = async (types) => ({
    operationId: crypto.randomUUID(),
    expectedVersion: (
      await f.one("SELECT version FROM exams WHERE id=?", x.examId)
    ).version,
    confirmed: true,
    scores: types.map((type) => ({
      participationId: participation.id,
      settingId: settings.find((s) => s.exam_type === type).id,
      expectedVersion:
        before.find(
          (s) => s.exam_type === type && s.student_id === x.students[0].id,
        )?.version ?? 0,
      value: 75,
    })),
  });
  for (const types of [["QUIZ"], ["QUIZ", "MIDTERM"]]) {
    await assert.rejects(
      f.exams.writeDraftScores(f.owner(), x.examId, await input(types)),
      { code: "EXAM_NOT_DRAFT" },
    );
    assert.deepEqual(
      await f.all(
        "SELECT * FROM score_items WHERE exam_id=? ORDER BY id",
        x.examId,
      ),
      before,
    );
  }
  const view = await f.exams.readExam(f.owner(), x.examId, {
    classId: x.classes["701"],
  });
  assert.deepEqual(view.publishedComponents, ["QUIZ"]);
  await assert.rejects(
    f.publication.preview(f.owner(), x.examId, {
      kind: "EDIT",
      expectedVersion: view.exam.version,
      reason,
      scores: (await input(["MIDTERM"])).scores,
    }),
    { code: "COMPONENT_NOT_PUBLISHED" },
  );
  assert.deepEqual(
    await f.all(
      "SELECT * FROM score_items WHERE exam_id=? ORDER BY id",
      x.examId,
    ),
    before,
  );
  const rejected = await f.upload(
    x.examId,
    x.classes["701"],
    "QUIZ",
    [x.students[0]],
    [90],
  );
  assert.equal(rejected.p.status, "INVALID");
  assert.ok(
    JSON.stringify(rejected.p.issues).includes("IMPORT_TARGET_READ_ONLY"),
  );
  await f.exams.writeDraftScores(f.owner(), x.examId, await input(["MIDTERM"]));
  const mid = await f.upload(
    x.examId,
    x.classes["701"],
    "MIDTERM",
    [x.students[0]],
    [100],
  );
  await f.commitImport(mid);
  assert.equal(
    (await f.imports.previewRollback(f.owner(), mid.jobId)).canRollback,
    false,
  );
  assert.deepEqual(
    await f.one(
      "SELECT snapshot_json FROM publication_snapshots WHERE result_version_id=?",
      published.resultVersionId,
    ),
    snapshot,
  );
  const advice = await f.all(
    "SELECT stale_at FROM ai_advices WHERE student_id=?",
    x.students[0].id,
  );
  assert.equal(advice.length, 2);
  assert.ok(advice.every((a) => a.stale_at === null));
  assert.equal(f.calls(), 2);
  const publicResult = await f.lookup.lookup(
    {
      year: "115",
      term: 1,
      classCode: "701",
      sequence: 1,
      name: x.students[0].name,
      birthDate: x.students[0].birthDate,
    },
    "192.0.2.20",
  );
  assert.equal(publicResult.provisional, true);
  assert.equal(publicResult.midterm.average, null);
  assert.ok(JSON.stringify(publicResult).includes("每日複習"));
  await assert.rejects(
    f.exams.previewRoster(f.owner(), x.examId, { classId: x.classes["701"] }),
    { code: "EXAM_NOT_DRAFT" },
  );
});

test("Phase 17 reverse publication order and commit after publication rejects old preview", async (t) => {
  const f = await fixture(t),
    x = await f.foundation(true);
  await f.publish(x.examId, "MIDTERM");
  const quiz = await f.upload(
    x.examId,
    x.classes["701"],
    "QUIZ",
    [x.students[0]],
    [50],
  );
  await f.commitImport(quiz);
  const stale = await f.upload(
    x.examId,
    x.classes["701"],
    "QUIZ",
    [x.students[0]],
    [99],
  );
  assert.equal(stale.p.status, "PREVIEW");
  await f.publish(x.examId, "QUIZ");
  const before = await f.all(
    "SELECT * FROM score_items WHERE exam_id=? ORDER BY id",
    x.examId,
  );
  await assert.rejects(
    f.imports.commit(f.owner(), stale.jobId, stale.p.previewVersion, true),
  );
  assert.deepEqual(
    await f.all(
      "SELECT * FROM score_items WHERE exam_id=? ORDER BY id",
      x.examId,
    ),
    before,
  );
  assert.equal(
    (await f.one("SELECT status FROM import_jobs WHERE id=?", stale.jobId))
      .status,
    "PREVIEW",
  );
});

test("Phase 17 transaction race: publication between score precheck and batch atomically rejects writes", async (t) => {
  const f = await fixture(t),
    x = await f.foundation();
  await f.publish(x.examId, "QUIZ");
  const before = await f.all(
    "SELECT * FROM score_items WHERE exam_id=? ORDER BY id",
    x.examId,
  );
  const history = await f.one("SELECT count(*) AS n FROM score_change_history");
  const participation = await f.one(
    "SELECT id FROM exam_participations WHERE exam_id=? AND student_id=? AND origin='LOCAL'",
    x.examId,
    x.students[0].id,
  );
  const setting = await f.one(
    "SELECT id FROM exam_subject_settings WHERE exam_id=? AND exam_type='MIDTERM' AND subject='CHINESE'",
    x.examId,
  );
  let batches = 0;
  const racedDb = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      batches++;
      await f.publish(x.examId, "MIDTERM");
      return f.db.batch(statements);
    },
  };
  const operationId = crypto.randomUUID();
  await assert.rejects(
    new ExamService({ db: racedDb, now: f.now }).writeDraftScores(
      f.owner(),
      x.examId,
      {
        operationId,
        expectedVersion: (
          await f.one("SELECT version FROM exams WHERE id=?", x.examId)
        ).version,
        confirmed: true,
        scores: [
          {
            participationId: participation.id,
            settingId: setting.id,
            expectedVersion: 0,
            value: 100,
          },
        ],
      },
    ),
    { code: "EXAM_CONFLICT" },
  );
  assert.equal(batches, 1);
  assert.deepEqual(
    await f.all(
      "SELECT * FROM score_items WHERE exam_id=? ORDER BY id",
      x.examId,
    ),
    before,
  );
  assert.deepEqual(
    await f.one("SELECT count(*) AS n FROM score_change_history"),
    history,
  );
  assert.equal(
    await f.one("SELECT id FROM exam_operations WHERE id=?", operationId),
    null,
  );
});
