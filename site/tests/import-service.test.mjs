import assert from "node:assert/strict";
import { test } from "node:test";
import { Miniflare } from "miniflare";
import { ImportService } from "../lib/server/imports/service.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import { identityLookupHash } from "../lib/server/identity.ts";
import { migrateLocalDatabase, fictionalKeys } from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";
import { createWorkbook, parseXlsx } from "../lib/domain/import-xlsx.ts";
import { handleImportRequest } from "../lib/server/imports/http.ts";
import { SESSION_COOKIE } from "../lib/server/auth/cookies.ts";

const now = Date.UTC(2026, 8, 24, 4);
const target = {
  kind: "SCORES",
  examId: "exam-1",
  classId: "class-701",
  examType: "QUIZ",
  subjects: ["CHINESE"],
};
const header = [
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
const row = (who = "a", value = "80") => [
  "115",
  "1",
  "1",
  "QUIZ",
  "701",
  "虛構同名學生",
  who === "a" ? "1" : "2",
  who === "a" ? "FICTIONAL-1" : "FICTIONAL-2",
  `FICTIONAL-IDENTITY-${who.toUpperCase()}`,
  "國文",
  value,
  "LOCAL",
  "",
];
const csv = (rows) =>
  new TextEncoder().encode(
    [header, ...rows].map((r) => r.join(",")).join("\r\n"),
  );
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
async function fixture(t) {
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    cf: false,
    d1Databases: ["DB"],
    r2Buckets: ["FILES"],
    script: "export default {fetch(){return new Response('fictional')}}",
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB"),
    files = await mf.getR2Bucket("FILES"),
    keys = fictionalKeys();
  await migrateLocalDatabase(db);
  await seedFictional(db, keys);
  await db
    .prepare("UPDATE academic_state SET current_year_id='year-115' WHERE id=1")
    .run();
  // Match the uppercase canonical identity convention used by academic enrollment.
  for (const who of ["a", "b", "late", "external"])
    for (const key of keys.lookup)
      await db
        .prepare(
          "UPDATE student_identity_lookup_hashes SET identity_number_lookup_hash=? WHERE student_id=? AND key_version=?",
        )
        .bind(
          await identityLookupHash(
            `FICTIONAL-IDENTITY-${who.toUpperCase()}`,
            key,
          ),
          `fictional-${who}`,
          key.version,
        )
        .run();
  const auth = new AuthService({
    db,
    oidc: {},
    bootstrapSecret: "fictional-bootstrap",
    now: () => now,
  });
  const owner = await auth.bootstrap({
    secret: "fictional-bootstrap",
    identity: identity("owner"),
  });
  const service = new ImportService({
    db,
    files,
    identityKeys: () => keys,
    now: () => now,
  });
  const management = new AdminManagementService({
    db,
    now: () => now,
    authorization: new AuthorizationService({ db, now: () => now }),
  });
  const user = async (name, classId, subject = "CHINESE") => {
    await management.createAdmin(owner, {
      username: name,
      displayName: "虛構教師",
      authorizedEmail: `${name}@example.test`,
      role: "score_admin",
      confirmed: true,
      assignments: [
        {
          academicTermId: "term-115-1",
          scopeType: "teaching_subject",
          classId,
          subject,
          startsOn: "2026-08-01",
        },
      ],
    });
    return auth.loginVerifiedGoogle(identity(name));
  };
  const prepare = async (rows = [row()], scope = target, actor = owner) => {
    const { jobId } = await service.upload(actor, scope, "csv", csv(rows));
    const preview = await service.preview(actor, jobId);
    return { jobId, preview };
  };
  return { db, files, keys, owner, service, prepare, user, auth };
}
const one = (db, q, ...v) =>
  db
    .prepare(q)
    .bind(...v)
    .first();

test("Phase 6 import: upload/preview never writes scores, atomic commit and rollback are idempotent", async (t) => {
  const { db, owner, service, prepare } = await fixture(t);
  const { jobId, preview } = await prepare([row("a", "80.25"), row("b", "0")]);
  assert.equal(preview.status, "PREVIEW");
  assert.equal(
    (await one(db, "SELECT score_value FROM score_items WHERE id='score-zero'"))
      .score_value,
    0,
  );
  const result = await service.commit(
    owner,
    jobId,
    preview.previewVersion,
    true,
  );
  assert.equal(result.status, "COMMITTED");
  assert.equal(
    (await one(db, "SELECT score_value FROM score_items WHERE id='score-zero'"))
      .score_value,
    8025,
  );
  assert.equal(
    (await service.commit(owner, jobId, preview.previewVersion, true)).replayed,
    true,
  );
  const rollback = await service.previewRollback(owner, jobId);
  assert.equal(rollback.canRollback, true);
  await db
    .prepare(
      "CREATE TRIGGER reject_rollback BEFORE UPDATE OF status ON import_jobs WHEN NEW.status='ROLLED_BACK' BEGIN SELECT RAISE(ABORT,'fictional rollback fault'); END",
    )
    .run();
  await assert.rejects(
    service.rollback(owner, jobId, rollback.previewVersion, true),
  );
  assert.equal(
    (await one(db, "SELECT score_value FROM score_items WHERE id='score-zero'"))
      .score_value,
    8025,
  );
  assert.equal(
    (await one(db, "SELECT count(*) n FROM score_change_history")).n,
    2,
  );
  await db.prepare("DROP TRIGGER reject_rollback").run();
  await service.rollback(owner, jobId, rollback.previewVersion, true);
  assert.equal(
    (await one(db, "SELECT score_value FROM score_items WHERE id='score-zero'"))
      .score_value,
    0,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT score_status FROM score_items WHERE id='score-absent'",
      )
    ).score_status,
    "ABSENT",
  );
  assert.equal(
    (await service.rollback(owner, jobId, rollback.previewVersion, true))
      .replayed,
    true,
  );
  assert.equal(
    (await one(db, "SELECT count(*) n FROM score_change_history")).n,
    4,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*) n FROM audit_logs WHERE action LIKE 'IMPORT_%'",
      )
    ).n,
    2,
  );
});

test("Phase 6 validation: identity disagreement, duplicate rows and target mismatch block every row", async (t) => {
  const { db, owner, service, prepare } = await fixture(t);
  for (const bad of [
    (() => {
      const r = row("b");
      r[7] = "FICTIONAL-1";
      return r;
    })(),
    (() => {
      const r = row("b");
      r[0] = "114";
      return r;
    })(),
    row("a"),
  ]) {
    const { jobId, preview } = await prepare([row("a"), bad]);
    assert.equal(preview.status, "INVALID");
    await assert.rejects(
      service.commit(owner, jobId, preview.previewVersion, true),
      (e) => e.code === "IMPORT_PREVIEW_CONFLICT",
    );
    const report = await service.errorReport(owner, jobId);
    assert.ok(!report.includes("FICTIONAL"));
    assert.ok(!report.includes("虛構"));
  }
  assert.equal(
    (await one(db, "SELECT score_value FROM score_items WHERE id='score-zero'"))
      .score_value,
    0,
  );
});

test("Phase 6 scope: class/subject/owner and revoked sessions are rechecked", async (t) => {
  const { db, owner, service, prepare, user } = await fixture(t);
  const teacher = await user("teacher", "class-701"),
    other = await user("other", "class-702");
  await assert.rejects(
    service.upload(
      teacher,
      { ...target, subjects: ["MATH"] },
      "csv",
      csv([row()]),
    ),
    (e) => e.code === "SCOPE_DENIED",
  );
  const { jobId, preview } = await prepare([row()], target, teacher);
  await assert.rejects(
    service.read(other, jobId),
    (e) => e.code === "IMPORT_ACCESS_DENIED",
  );
  await assert.rejects(
    service.commit(owner, jobId, preview.previewVersion, true),
    (e) => e.code === "IMPORT_ACCESS_DENIED",
  );
  await db
    .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
    .bind(now, teacher.sessionId)
    .run();
  await assert.rejects(
    service.commit(teacher, jobId, preview.previewVersion, true),
    (e) => e.code === "ACCESS_DENIED",
  );
});

test("Phase 6 transaction: injected job-write failure rolls scores/history/receipt back together", async (t) => {
  const { db, owner, service, prepare } = await fixture(t);
  const { jobId, preview } = await prepare();
  await db
    .prepare(
      "CREATE TRIGGER reject_import BEFORE UPDATE OF committed_at ON import_jobs BEGIN SELECT RAISE(ABORT,'fictional fault'); END",
    )
    .run();
  await assert.rejects(
    service.commit(owner, jobId, preview.previewVersion, true),
  );
  assert.equal(
    (await one(db, "SELECT score_value FROM score_items WHERE id='score-zero'"))
      .score_value,
    0,
  );
  assert.equal(
    (await one(db, "SELECT count(*) n FROM score_change_history")).n,
    0,
  );
  assert.equal((await service.read(owner, jobId)).status, "PREVIEW");
  await db.prepare("DROP TRIGGER reject_import").run();
  const committed = await Promise.all([
    service.commit(owner, jobId, preview.previewVersion, true),
    service.commit(owner, jobId, preview.previewVersion, true),
  ]);
  assert.ok(committed.every((r) => r.status === "COMMITTED"));
  assert.equal(
    (await one(db, "SELECT count(*) n FROM score_change_history")).n,
    1,
  );
});

test("Phase 6 rollback: later changes and publication block; expired boundary cannot restore", async (t) => {
  const { db, files, keys, owner, service, prepare } = await fixture(t);
  const { jobId, preview } = await prepare();
  await service.commit(owner, jobId, preview.previewVersion, true);
  await db
    .prepare("UPDATE score_items SET version=version+1 WHERE id='score-zero'")
    .run();
  assert.equal(
    (await service.previewRollback(owner, jobId)).canRollback,
    false,
  );
  await db
    .prepare("UPDATE exams SET published_at=? WHERE id='exam-1'")
    .bind(now)
    .run();
  assert.equal(
    (await service.previewRollback(owner, jobId)).canRollback,
    false,
  );
  await db
    .prepare("UPDATE exams SET published_at=NULL WHERE id='exam-1'")
    .run();
  await db
    .prepare("UPDATE score_items SET version=version-1 WHERE id='score-zero'")
    .run();
  const expiry = now + 30 * 86400000;
  await db
    .prepare("UPDATE admin_sessions SET last_seen_at=?,expires_at=? WHERE id=?")
    .bind(expiry - 1, expiry + 86400000, owner.sessionId)
    .run();
  const justBefore = new ImportService({
    db,
    files,
    identityKeys: () => keys,
    now: () => expiry - 1,
  });
  assert.equal(
    (await justBefore.previewRollback(owner, jobId)).canRollback,
    true,
  );
  const expired = new ImportService({
    db,
    files,
    identityKeys: () => keys,
    now: () => expiry,
  });
  assert.equal(
    (await expired.previewRollback(owner, jobId)).issues[0].code,
    "IMPORT_ROLLBACK_EXPIRED",
  );
});

test("Phase 6 new students: XLSX template, encrypted creation and reversible soft removal", async (t) => {
  const { db, owner, service } = await fixture(t);
  const scope = {
    kind: "NEW_STUDENTS",
    academicTermId: "term-115-1",
    classId: "class-701",
  };
  const sheets = parseXlsx(await service.template(owner, scope));
  sheets[0].rows.push([
    "虛構新生",
    "2013-06-01",
    "701",
    "10",
    "00009",
    "FICTIONAL-NEW-ID",
    "2026-09-24",
  ]);
  const { jobId } = await service.upload(
    owner,
    scope,
    "xlsx",
    createWorkbook(sheets),
  );
  const preview = await service.preview(owner, jobId);
  assert.equal(preview.status, "PREVIEW");
  await service.commit(owner, jobId, preview.previewVersion, true);
  const student = await one(
    db,
    "SELECT * FROM students WHERE student_number='00009'",
  );
  assert.ok(student.identity_number_encrypted);
  assert.equal(student.deleted_at, null);
  await db
    .prepare("UPDATE students SET version=version+1 WHERE id='fictional-b'")
    .run();
  const rollback = await service.previewRollback(owner, jobId);
  assert.equal(rollback.canRollback, true);
  await service.rollback(owner, jobId, rollback.previewVersion, true);
  assert.equal(
    (await one(db, "SELECT deleted_at FROM students WHERE id=?", student.id))
      .deleted_at,
    now,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT status FROM student_enrollments WHERE student_id=?",
        student.id,
      )
    ).status,
    "voided",
  );
  assert.equal(
    (await service.rollback(owner, jobId, rollback.previewVersion, true))
      .replayed,
    true,
  );
});

test("Phase 6 origins and held policy: external scores stay unranked, late participants are refused, NOT_HELD is not absent", async (t) => {
  const { db, owner, service } = await fixture(t);
  const scope = { ...target, classId: "class-702" };
  const external = [
    "115",
    "1",
    "1",
    "QUIZ",
    "702",
    "虛構學生4",
    "2",
    "FICTIONAL-4",
    "FICTIONAL-IDENTITY-EXTERNAL",
    "國文",
    "90",
    "EXTERNAL_TRANSFER",
    "虛構原學校",
  ];
  const first = await service.upload(owner, scope, "csv", csv([external]));
  const pre = await service.preview(owner, first.jobId);
  assert.equal(pre.status, "PREVIEW");
  await service.commit(owner, first.jobId, pre.previewVersion, true);
  assert.equal(
    (
      await one(
        db,
        "SELECT include_in_ranking FROM score_items WHERE id='score-external'",
      )
    ).include_in_ranking,
    0,
  );
  const late = [
    "115",
    "1",
    "1",
    "QUIZ",
    "701",
    "虛構學生3",
    "3",
    "FICTIONAL-3",
    "FICTIONAL-IDENTITY-LATE",
    "國文",
    "90",
    "LOCAL",
    "",
  ];
  const pending = await service.upload(owner, target, "csv", csv([late]));
  assert.equal(
    (await service.preview(owner, pending.jobId)).issues[0].code,
    "IMPORT_PARTICIPATION_MISSING",
  );
  const civics = { ...target, examType: "MIDTERM", subjects: ["CIVICS"] };
  const notHeld = row();
  notHeld[3] = "MIDTERM";
  notHeld[9] = "公民";
  const invalid = await service.upload(owner, civics, "csv", csv([notHeld]));
  assert.equal(
    (await service.preview(owner, invalid.jobId)).issues[0].code,
    "SCORE_HELD_MISMATCH",
  );
  notHeld[10] = "N";
  const good = await service.upload(owner, civics, "csv", csv([notHeld]));
  const preview = await service.preview(owner, good.jobId);
  assert.equal(preview.status, "PREVIEW");
  await service.commit(owner, good.jobId, preview.previewVersion, true);
  assert.equal(
    (
      await one(
        db,
        "SELECT score_status FROM score_items WHERE participation_id='part-a1' AND subject='CIVICS'",
      )
    ).score_status,
    "NOT_HELD",
  );
});

test("Phase 6 HTTP: real cookie, same origin, strict fields and private downloads", async (t) => {
  const { auth, owner, service } = await fixture(t);
  const deps = { auth, imports: service };
  const request = (body, extra = {}) =>
    new Request("https://school.example.test/api/admin/imports", {
      method: "POST",
      headers: {
        Origin: "https://school.example.test",
        Cookie: `${SESSION_COOKIE}=${owner.token}`,
        "Content-Type": "application/json",
        ...extra,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await handleImportRequest(
        request({ target }, { Origin: "https://evil.example.test" }),
        deps,
        "template",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleImportRequest(
        request({ target }, { Cookie: "" }),
        deps,
        "template",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handleImportRequest(
        request({ target, role: "super_admin" }),
        deps,
        "template",
      )
    ).status,
    400,
  );
  const template = await handleImportRequest(
    request({ target }),
    deps,
    "template",
  );
  assert.equal(template.status, 200);
  assert.equal(template.headers.get("Cache-Control"), "no-store");
  assert.equal(
    parseXlsx(new Uint8Array(await template.arrayBuffer())).length,
    1,
  );
  const uploaded = await handleImportRequest(
    new Request("https://school.example.test/api/admin/imports", {
      method: "POST",
      headers: {
        Origin: "https://school.example.test",
        Cookie: `${SESSION_COOKIE}=${owner.token}`,
        "Content-Type": "application/octet-stream",
        "X-Import-Format": "csv",
        "X-Import-Target": JSON.stringify(target),
      },
      body: csv([row()]),
    }),
    deps,
    "upload",
  );
  assert.equal(uploaded.status, 200);
  const { jobId } = await uploaded.json();
  const preview = await handleImportRequest(
    request({}),
    deps,
    "preview",
    jobId,
  );
  assert.equal(preview.status, 200);
  const report = await handleImportRequest(
    new Request("https://school.example.test/errors", {
      headers: { Cookie: `${SESSION_COOKIE}=${owner.token}` },
    }),
    deps,
    "errors",
    jobId,
  );
  assert.equal(report.headers.get("Cache-Control"), "no-store");
  assert.equal(await report.text(), "row,code\r\n");
});

test("Phase 6 race: revocation immediately before commit batch prevents every write", async (t) => {
  const { db, files, keys, owner, prepare } = await fixture(t);
  const { jobId, preview } = await prepare();
  const raced = {
    prepare: (q) => db.prepare(q),
    batch: async (statements) => {
      await db
        .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
        .bind(now, owner.sessionId)
        .run();
      return db.batch(statements);
    },
  };
  const service = new ImportService({
    db: raced,
    files,
    identityKeys: () => keys,
    now: () => now,
  });
  await assert.rejects(
    service.commit(owner, jobId, preview.previewVersion, true),
  );
  assert.equal(
    (await one(db, "SELECT score_value FROM score_items WHERE id='score-zero'"))
      .score_value,
    0,
  );
  assert.equal(
    (await one(db, "SELECT status FROM import_jobs WHERE id=?", jobId)).status,
    "PREVIEW",
  );
});

test("Phase 6 repeated file and inserted score: explicit new preview, conflict-aware rollback, original empty semantics", async (t) => {
  const { db, owner, service } = await fixture(t);
  const scope = { ...target, subjects: ["ENGLISH"] };
  const source = row();
  source[9] = "英文";
  const prepare = async () => {
    const { jobId } = await service.upload(owner, scope, "csv", csv([source]));
    return { jobId, preview: await service.preview(owner, jobId) };
  };
  const first = await prepare();
  await service.commit(owner, first.jobId, first.preview.previewVersion, true);
  const second = await prepare();
  assert.equal(second.preview.duplicateOf, first.jobId);
  assert.equal(
    (await one(db, "SELECT count(*) n FROM score_change_history")).n,
    1,
  );
  await service.commit(
    owner,
    second.jobId,
    second.preview.previewVersion,
    true,
  );
  assert.equal(
    (await service.previewRollback(owner, first.jobId)).canRollback,
    false,
  );
  const undo = await service.previewRollback(owner, second.jobId);
  await service.rollback(owner, second.jobId, undo.previewVersion, true);
  assert.equal(
    (
      await one(
        db,
        "SELECT score_value FROM score_items WHERE participation_id='part-a1' AND subject='ENGLISH'",
      )
    ).score_value,
    8000,
  );
  // A fresh import of a previously absent subject restores UNENTERED, retaining its history FK.
  const math = { ...target, subjects: ["MATH"] };
  source[9] = "數學";
  const { jobId } = await service.upload(owner, math, "csv", csv([source]));
  const pre = await service.preview(owner, jobId);
  await service.commit(owner, jobId, pre.previewVersion, true);
  const back = await service.previewRollback(owner, jobId);
  await service.rollback(owner, jobId, back.previewVersion, true);
  assert.equal(
    (
      await one(
        db,
        "SELECT score_status FROM score_items WHERE participation_id='part-a1' AND subject='MATH'",
      )
    ).score_status,
    "UNENTERED",
  );
});
