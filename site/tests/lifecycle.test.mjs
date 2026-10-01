import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicLookupService } from "../lib/server/public/service.ts";
import {
  LifecycleService,
  COPY_CATEGORIES,
} from "../lib/server/lifecycle/service.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import { PublicationService } from "../lib/server/exams/publication.ts";
import { RankingService } from "../lib/server/exams/ranking-service.ts";
import { ArchiveService } from "../lib/server/archive/service.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  fictionalKeys,
  migrationPreflight,
  migrationsFolder,
} from "../scripts/db-local.mjs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { seedFictional } from "../db/seed-fictional.ts";
const now = Date.UTC(2026, 8, 26, 4),
  day = 86400000;
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
const rejects = (promise, code) =>
  assert.rejects(promise, (e) => e.code === code);
async function fixture(t) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  await seedFictional(db, fictionalKeys());
  await run(
    db,
    "UPDATE academic_state SET current_year_id='year-115' WHERE id=1",
  );
  const auth = new AuthService({
    db,
    now: () => now,
    oidc: {},
    bootstrapSecret: "fictional-bootstrap",
  });
  const owner = await auth.bootstrap({
    secret: "fictional-bootstrap",
    identity: {
      verified: true,
      emailVerified: true,
      subject: "fictional-owner",
      email: "owner@example.test",
      issuer: "https://accounts.google.com",
      audience: "fictional-client",
      nonce: "fictional",
      issuedAt: now / 1000,
      authTime: now / 1000,
      expiresAt: now / 1000 + 3600,
    },
  });
  const objects = new Set();
  let failRemove = false;
  const copies = {
    inventory: async (ids, keys) => ({
      complete: true,
      restorationDeadlines: [],
      categories: [...COPY_CATEGORIES],
      objects: keys.map((key) => ({ key, category: "imports" })),
      evidence: "isolated fictional storage only",
    }),
    remove: async (key) => {
      if (failRemove) throw new Error("mock failure");
      objects.delete(key);
    },
    absent: async (key) => !objects.has(key),
  };
  const service = new LifecycleService({ db, now: () => now, copies });
  return {
    db,
    auth,
    owner,
    service,
    copies,
    objects,
    setFailure: (v) => {
      failRemove = v;
    },
  };
}
const input = (action = "DELETE", ids = ["fictional-a"]) => ({
  action,
  studentIds: ids,
  reason: "虛構生命週期操作",
});
const commit = async (f, request) => {
  const p = await f.service.preview(f.owner, request);
  return f.service.confirm(
    f.owner,
    p.previewId,
    true,
    p.confirmation ?? undefined,
  );
};
async function expire(f, id = "fictional-a") {
  await run(
    f.db,
    "UPDATE students SET deleted_at=?,version=version+1,updated_at=? WHERE id=?",
    now - 30 * day,
    now,
    id,
  );
}
test("Recycle Bin: preview/confirm, 30-day restore, historical rows unchanged and replay", async (t) => {
  const f = await fixture(t),
    count = await one(f.db, "SELECT count(*) AS n FROM exam_participations");
  const p = await f.service.preview(f.owner, input());
  await rejects(
    f.service.confirm(f.owner, p.previewId, false),
    "CONFIRMATION_REQUIRED",
  );
  await f.service.confirm(f.owner, p.previewId, true);
  assert.equal(
    (await f.service.confirm(f.owner, p.previewId, true)).replayed,
    true,
  );
  assert.equal((await f.service.list(f.owner)).items.length, 1);
  await commit(f, input("RESTORE"));
  assert.equal(
    (await one(f.db, "SELECT deleted_at FROM students WHERE id='fictional-a'"))
      .deleted_at,
    null,
  );
  assert.deepEqual(
    await one(f.db, "SELECT count(*) AS n FROM exam_participations"),
    count,
  );
  assert.equal((await f.service.list(f.owner)).items.length, 0);
});
test("Recycle Bin: source conflicts, expired restore and atomic failures", async (t) => {
  const f = await fixture(t),
    p = await f.service.preview(f.owner, input());
  await run(
    f.db,
    "UPDATE students SET version=version+1 WHERE id='fictional-a'",
  );
  await rejects(
    f.service.confirm(f.owner, p.previewId, true),
    "LIFECYCLE_CONFLICT",
  );
  await commit(f, input());
  const s = new LifecycleService({ db: f.db, now: () => now + 30 * day });
  await run(
    f.db,
    "UPDATE admin_sessions SET expires_at=?,last_seen_at=?,recent_auth_at=?",
    now + 31 * day,
    now + 30 * day,
    now + 30 * day,
  );
  await rejects(
    s.preview(f.owner, input("RESTORE")),
    "RECYCLE_RESTORE_EXPIRED",
  );
});
test("Purge: capability and promises block before destructive work", async (t) => {
  const f = await fixture(t);
  await rejects(
    new LifecycleService({ db: f.db, now: () => now }).preview(
      f.owner,
      input("PURGE"),
    ),
    "PURGE_COPY_CAPABILITY_UNVERIFIED",
  );
  await rejects(
    f.service.preview(f.owner, input("PURGE")),
    "PURGE_BLOCKED_ACTIVE_STUDENT",
  );
  await commit(f, input());
  await rejects(
    f.service.preview(f.owner, input("PURGE")),
    "PURGE_BLOCKED_RECYCLE_PROMISE",
  );
  assert.ok(await one(f.db, "SELECT id FROM students WHERE id='fictional-a'"));
});
test("Purge: permanent relational cleanup, fixed ranks, frozen recalculation, minimal evidence", async (t) => {
  const f = await fixture(t);
  await run(
    f.db,
    "INSERT INTO public_lookup_attempts(id,ip_hash,query_hash,created_at) VALUES(?,?,?,?)",
    "fictional-attempt",
    "a".repeat(64),
    "b".repeat(64),
    now,
  );
  const pub = new PublicationService({ db: f.db, now: () => now });
  // Publish a real snapshot using the Phase 7 service.
  const exam = await one(f.db, "SELECT version FROM exams WHERE id='exam-1'");
  const preview = await pub.preview(f.owner, "exam-1", {
    kind: "PUBLISH",
    component: "QUIZ",
    expectedVersion: exam.version,
  });
  await pub.confirm(f.owner, preview.previewId, true);
  const before = await pub.publishedClass(f.owner, "exam-1", "class-701");
  await expire(f);
  const p = await f.service.preview(f.owner, input("PURGE"));
  await rejects(
    f.service.confirm(f.owner, p.previewId, true),
    "PURGE_SECOND_CONFIRMATION_REQUIRED",
  );
  const result = await f.service.confirm(
    f.owner,
    p.previewId,
    true,
    p.confirmation,
  );
  assert.equal(result.status, "DONE");
  assert.equal(
    (await one(f.db, "SELECT count(*) n FROM public_lookup_attempts")).n,
    0,
  );
  const publicLookup = new PublicLookupService({
    db: f.db,
    hmacSecret: "fictional-public-lookup-secret-independent",
    now: () => now,
  });
  const preserved = await publicLookup.lookup(
    {
      year: "115",
      term: 1,
      sequence: 1,
      classCode: "701",
      name: "虛構同名學生",
      birthDate: "2013-05-10",
    },
    "192.0.2.1",
  );
  assert.equal(preserved.historicalInputsRemoved, true);
  assert.equal(preserved.classStatistics.average, null);
  assert.equal(preserved.semester.average, null);
  assert.equal(
    preserved.classRank,
    before.students.find((s) => s.studentId === "fictional-b").classRank,
  );
  assert.equal(
    await one(f.db, "SELECT id FROM students WHERE id='fictional-a'"),
    null,
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*) AS n FROM exam_participations WHERE student_id='fictional-a'",
      )
    ).n,
    0,
  );
  const after = await pub.publishedClass(f.owner, "exam-1", "class-701");
  assert.deepEqual(
    after.students,
    before.students.filter((s) => s.studentId !== "fictional-a"),
  );
  assert.equal(after.statistics, null);
  await rejects(
    new RankingService({ db: f.db, now: () => now }).calculate(
      f.owner,
      "exam-1",
      { classId: "class-701" },
      "PROVISIONAL",
    ),
    "PURGED_EXAM_FROZEN",
  );
  const evidence = await one(
    f.db,
    "SELECT * FROM purge_jobs WHERE id=?",
    result.jobId,
  );
  assert.equal(evidence.manifest_json, null);
  assert.equal(evidence.retention_until, "2028-09-26");
  assert.equal((await f.service.retry(f.owner, result.jobId)).replayed, true);
  const fk = await f.db.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(fk.results, []);
});
test("Purge: copy failure locks writes; retry removes copies and finalizes once", async (t) => {
  const f = await fixture(t);
  await expire(f);
  f.copies.inventory = async () => ({
    complete: true,
    restorationDeadlines: [],
    categories: [...COPY_CATEGORIES],
    objects: [{ key: "fictional-copy", category: "backups" }],
    evidence: "isolated mock",
  });
  f.objects.add("fictional-copy");
  f.setFailure(true);
  const result = await commit(f, input("PURGE"));
  assert.equal(result.status, "PARTIAL");
  assert.ok(await one(f.db, "SELECT id FROM students WHERE id='fictional-a'"));
  await assert.rejects(
    run(f.db, "UPDATE students SET version=version+1 WHERE id='fictional-b'"),
    /PURGE_IN_PROGRESS/,
  );
  assert.equal(
    (await f.service.readJob(f.owner, result.jobId)).status,
    "PARTIAL",
  );
  f.setFailure(false);
  assert.equal((await f.service.retry(f.owner, result.jobId)).status, "DONE");
  assert.equal(f.objects.size, 0);
  await run(
    f.db,
    "UPDATE students SET version=version+1 WHERE id='fictional-b'",
  );
});

test("Purge: concurrent confirms/retries never repeat a completed database purge", async (t) => {
  const f = await fixture(t);
  await expire(f);
  f.copies.inventory = async () => ({
    complete: true,
    restorationDeadlines: [],
    categories: [...COPY_CATEGORIES],
    objects: [{ key: "fictional-copy", category: "backups" }],
    evidence: "isolated mock",
  });
  f.setFailure(true);
  const r = await commit(f, input("PURGE"));
  assert.equal(r.status, "PARTIAL");
  f.setFailure(false);
  const results = await Promise.all([
    f.service.retry(f.owner, r.jobId),
    f.service.retry(f.owner, r.jobId),
  ]);
  assert.ok(results.every((r) => r.status === "DONE"));
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*) AS n FROM audit_logs WHERE action='PURGE_COMPLETE'",
      )
    ).n,
    1,
  );
  assert.equal(
    (await one(f.db, "SELECT executing_job FROM purge_control WHERE id=1"))
      .executing_job,
    null,
  );
});
test("Purge: incomplete inventory, undeleted copies, recent authentication and revocation", async (t) => {
  const f = await fixture(t);
  await expire(f);
  const original = f.copies.inventory;
  f.copies.inventory = async () => ({
    complete: true,
    restorationDeadlines: [],
    categories: ["imports"],
    objects: [],
    evidence: "incomplete mock",
  });
  await rejects(
    f.service.preview(f.owner, input("PURGE")),
    "PURGE_COPY_INVENTORY_INCOMPLETE",
  );
  f.copies.inventory = original;
  const p = await f.service.preview(f.owner, input("PURGE"));
  await run(
    f.db,
    "UPDATE admin_sessions SET recent_auth_at=? WHERE id=?",
    now - 5 * 60000,
    f.owner.sessionId,
  );
  await rejects(
    f.service.confirm(f.owner, p.previewId, true, p.confirmation),
    "RECENT_AUTHENTICATION_REQUIRED",
  );
  await run(
    f.db,
    "UPDATE admin_sessions SET recent_auth_at=?,revoked_at=? WHERE id=?",
    now,
    now,
    f.owner.sessionId,
  );
  await rejects(
    f.service.confirm(f.owner, p.previewId, true, p.confirmation),
    "ACCESS_DENIED",
  );
  assert.equal((await one(f.db, "SELECT count(*) AS n FROM purge_jobs")).n, 0);
});
test("Lifecycle HTTP: cookie, CSRF, strict body, creator binding and no-store", async (t) => {
  const f = await fixture(t);
  const { handleLifecycleRequest } =
    await import("../lib/server/lifecycle/http.ts");
  const { SESSION_COOKIE } = await import("../lib/server/auth/cookies.ts");
  const send = (body, headers = {}) =>
    handleLifecycleRequest(
      new Request(
        "https://fictional.example.test/api/admin/lifecycle/preview",
        {
          method: "POST",
          headers: {
            Origin: "https://fictional.example.test",
            "Content-Type": "application/json",
            Cookie: `${SESSION_COOKIE}=${f.owner.token}`,
            ...headers,
          },
          body: JSON.stringify(body),
        },
      ),
      { auth: f.auth, lifecycle: f.service },
      "preview",
    );
  assert.equal(
    (await send(input(), { Origin: "https://elsewhere.example.test" })).status,
    403,
  );
  assert.equal((await send(input(), { Cookie: "" })).status, 401);
  assert.equal(
    (await send({ ...input(), copies: { complete: true } })).status,
    400,
  );
  const response = await send(input());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const p = await response.json();
  await rejects(
    f.service.confirm(
      { ...f.owner, adminId: "fictional-other" },
      p.previewId,
      true,
    ),
    "LIFECYCLE_PREVIEW_NOT_FOUND",
  );
});
test("Lifecycle scopes: archive role cannot purge or delete another class; mixed batches are denied", async (t) => {
  const f = await fixture(t);
  const management = new AdminManagementService({
    db: f.db,
    now: () => now,
    authorization: new AuthorizationService({ db: f.db, now: () => now }),
  });
  await management.createAdmin(f.owner, {
    username: "archiveother",
    displayName: "虛構封存管理員",
    authorizedEmail: "archiveother@example.test",
    role: "archive_admin",
    assignments: [
      {
        academicTermId: "term-115-1",
        scopeType: "class",
        classId: "class-702",
        startsOn: "2026-08-01",
      },
    ],
    confirmed: true,
  });
  const outsider = await f.auth.loginVerifiedGoogle({
    verified: true,
    emailVerified: true,
    subject: "fictional-archive-other",
    email: "archiveother@example.test",
    issuer: "https://accounts.google.com",
    audience: "fictional-client",
    nonce: "fictional",
    issuedAt: now / 1000,
    authTime: now / 1000,
    expiresAt: now / 1000 + 3600,
  });
  await rejects(
    f.service.preview(
      outsider,
      input("DELETE", ["fictional-external", "fictional-b"]),
    ),
    "SCOPE_DENIED",
  );
  await rejects(f.service.preview(outsider, input("PURGE")), "SCOPE_DENIED");
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*) AS n FROM students WHERE deleted_at IS NOT NULL",
      )
    ).n,
    0,
  );
});

test("Purge: shared archive retains other students' formal Restore after 30 days", async (t) => {
  const f = await fixture(t),
    archive = new ArchiveService({ db: f.db, now: () => now });
  const p = await archive.preview(f.owner, {
    action: "ARCHIVE",
    target: {
      academicTermId: "term-115-1",
      onDate: "2026-09-26",
      classId: "class-701",
    },
    reason: "虛構班級封存",
    force: true,
  });
  const batch = await archive.confirm(f.owner, p.previewId, true);
  await expire(f);
  const later = now + 31 * day;
  await run(
    f.db,
    "UPDATE admin_sessions SET recent_auth_at=?,last_seen_at=?,expires_at=?",
    later,
    later,
    later + day,
  );
  const lifecycle = new LifecycleService({
    db: f.db,
    now: () => later,
    copies: f.copies,
  });
  const purge = await lifecycle.preview(f.owner, input("PURGE"));
  const receipt = await lifecycle.confirm(
    f.owner,
    purge.previewId,
    true,
    purge.confirmation,
  );
  assert.equal(receipt.status, "DONE");
  const restore = new ArchiveService({ db: f.db, now: () => later });
  const rp = await restore.preview(f.owner, {
    action: "RESTORE",
    batchId: batch.batchId,
    reason: "虛構剩餘學生復原",
  });
  await restore.confirm(f.owner, rp.previewId, true);
  assert.equal(
    (await one(f.db, "SELECT archived_at FROM students WHERE id='fictional-b'"))
      .archived_at,
    null,
  );
  assert.equal(
    await one(f.db, "SELECT id FROM students WHERE id='fictional-a'"),
    null,
  );
});

test("Purge: shared backup restoration promises block even when target is expired", async (t) => {
  const f = await fixture(t);
  await expire(f);
  f.copies.inventory = async () => ({
    complete: true,
    categories: [...COPY_CATEGORIES],
    objects: [],
    restorationDeadlines: [now + 1],
    evidence: "isolated shared copy",
  });
  await rejects(
    f.service.preview(f.owner, input("PURGE")),
    "PURGE_COPY_RESTORE_PROMISE",
  );
});

test("Lifecycle atomicity: failed soft-delete and failed final purge leave no partial D1 changes", async (t) => {
  const f = await fixture(t);
  await run(
    f.db,
    "CREATE TRIGGER fictional_reject_soft_delete BEFORE UPDATE OF deleted_at ON students WHEN NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'fictional failure'); END",
  );
  const p = await f.service.preview(f.owner, input());
  await rejects(
    f.service.confirm(f.owner, p.previewId, true),
    "LIFECYCLE_CONFLICT",
  );
  assert.equal(
    (await one(f.db, "SELECT count(*) AS n FROM recycle_entries")).n,
    0,
  );
  await run(f.db, "DROP TRIGGER fictional_reject_soft_delete");
  await expire(f);
  const before = await one(f.db, "SELECT count(*) AS n FROM score_items");
  await run(
    f.db,
    "CREATE TRIGGER fictional_reject_purge BEFORE DELETE ON students BEGIN SELECT RAISE(ABORT,'fictional failure'); END",
  );
  const r = await commit(f, input("PURGE"));
  assert.equal(r.status, "PARTIAL");
  assert.deepEqual(
    await one(f.db, "SELECT count(*) AS n FROM score_items"),
    before,
  );
  assert.ok(await one(f.db, "SELECT id FROM students WHERE id='fictional-a'"));
  assert.equal(
    (await one(f.db, "SELECT executing_job FROM purge_control WHERE id=1"))
      .executing_job,
    null,
  );
  await run(f.db, "DROP TRIGGER fictional_reject_purge");
  assert.equal((await f.service.retry(f.owner, r.jobId)).status, "DONE");
});

test("Purge: shared import rollback and another student's recycle promise block whole-file deletion", async (t) => {
  const f = await fixture(t);
  await expire(f);
  await run(
    f.db,
    "INSERT INTO import_jobs (id,actor_id,kind,status,object_key,file_hash,committed_at,rollback_until) VALUES ('fictional-import',?,'SCORES','COMMITTED','fictional/source',?,?,?)",
    f.owner.adminId,
    "0".repeat(64),
    now - day,
    now + day,
  );
  for (const [i, student] of ["fictional-a", "fictional-b"].entries())
    await run(
      f.db,
      "INSERT INTO import_job_items (id,job_id,row_number,entity_type,entity_id,student_id,status,before_json,after_json) VALUES (?,'fictional-import',?,'students',?,?,'COMMITTED','{}','{}')",
      `fictional-item-${i}`,
      i + 1,
      student,
      student,
    );
  await rejects(
    f.service.preview(f.owner, input("PURGE")),
    "PURGE_IMPORT_PROMISE",
  );
  await run(
    f.db,
    "UPDATE import_jobs SET committed_at=?,rollback_until=? WHERE id='fictional-import'",
    now - 31 * day,
    now - day,
  );
  await commit(f, input("DELETE", ["fictional-b"]));
  await rejects(
    f.service.preview(f.owner, input("PURGE")),
    "PURGE_SHARED_RESTORE_PROMISE",
  );
  await commit(f, input("RESTORE", ["fictional-b"]));
  f.objects.add("fictional/source");
  f.copies.absent = async () => false;
  const r = await commit(f, input("PURGE"));
  assert.equal(r.status, "PARTIAL");
  assert.ok(await one(f.db, "SELECT id FROM students WHERE id='fictional-a'"));
  f.copies.absent = async (key) => !f.objects.has(key);
  assert.equal((await f.service.retry(f.owner, r.jobId)).status, "DONE");
  assert.equal(f.objects.size, 0);
  assert.ok(await one(f.db, "SELECT id FROM students WHERE id='fictional-b'"));
  assert.equal((await one(f.db, "SELECT count(*) AS n FROM import_jobs")).n, 0);
});

test("Phase 9 migration: Phase 8 data preserved, soft deletion backfill, failure atomic and retryable", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  const migrations = readMigrationFiles({ migrationsFolder });
  await run(
    db,
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY,hash text NOT NULL,created_at numeric)",
  );
  for (const m of migrations.slice(0, 10)) {
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
    "UPDATE students SET deleted_at=?,version=version+1 WHERE id='fictional-a'",
    now,
  );
  const before = await one(db, "SELECT * FROM students WHERE id='fictional-a'");
  assert.equal((await migrationPreflight(db)).pending, 7);
  await assert.rejects(
    db.batch([
      ...migrations[10].sql.filter((s) => s.trim()).map((s) => db.prepare(s)),
      db.prepare("SELECT * FROM fictional_missing_table"),
    ]),
  );
  assert.equal(
    await one(db, "SELECT name FROM sqlite_schema WHERE name='purge_jobs'"),
    null,
  );
  await migrateLocalDatabase(db);
  await migrateLocalDatabase(db);
  assert.deepEqual(
    await one(db, "SELECT * FROM students WHERE id='fictional-a'"),
    before,
  );
  const entry = await one(
    db,
    "SELECT * FROM recycle_entries WHERE student_id='fictional-a'",
  );
  assert.equal(entry.restore_until, now + 30 * day);
  assert.equal(entry.source_version, before.version);
});
