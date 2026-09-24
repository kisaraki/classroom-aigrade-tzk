import assert from "node:assert/strict";
import { test } from "node:test";
import { RankingService } from "../lib/server/exams/ranking-service.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  fictionalKeys,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";

const now = Date.UTC(2026, 8, 24, 4);
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
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  await seedFictional(db, fictionalKeys());
  await db
    .prepare("UPDATE academic_state SET current_year_id='year-115' WHERE id=1")
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
  const management = new AdminManagementService({
    db,
    now: () => now,
    authorization: new AuthorizationService({ db, now: () => now }),
  });
  const service = new RankingService({ db, now: () => now });
  const user = async (name, scopeType, extra = {}) => {
    await management.createAdmin(owner, {
      username: name,
      displayName: "虛構教師",
      authorizedEmail: `${name}@example.test`,
      role: "score_admin",
      confirmed: true,
      assignments: [
        {
          academicTermId: "term-115-1",
          scopeType,
          startsOn: "2026-08-01",
          ...extra,
        },
      ],
    });
    return auth.loginVerifiedGoogle(identity(name));
  };
  return { db, owner, service, user };
}
const denied = (promise) =>
  assert.rejects(promise, (error) =>
    ["SCOPE_DENIED", "ACCESS_DENIED", "PERMISSION_DENIED"].includes(error.code),
  );

test("Phase 5 server: dated local cohort and scope prevent class/grade/subject escalation", async (t) => {
  const { db, owner, service, user } = await fixture(t);
  const home = await user("home", "homeroom", { classId: "class-701" });
  const teacher = await user("teacher", "teaching_subject", {
    classId: "class-701",
    subject: "CHINESE",
  });
  const grade = await user("grade", "grade", { grade: 7 });
  const result = await service.calculate(
    home,
    "exam-1",
    { classId: "class-701" },
    "FINAL",
  );
  assert.equal(result.classes[0].enrollmentCount, 2);
  assert.equal(result.classes[0].participationCount, 2);
  assert.equal(
    result.local.find((p) => p.participationId === "part-a1").classRank,
    1,
  );
  assert.equal(
    result.local.find((p) => p.participationId === "part-b1").classRank,
    null,
  );
  assert.ok(result.local.every((p) => !Object.hasOwn(p, "gradeRank")));
  assert.ok(!Object.hasOwn(result, "grades"));
  assert.ok(!Object.hasOwn(result, "external"));
  assert.equal(result.published, false);
  await denied(
    service.calculate(home, "exam-1", { classId: "class-702" }, "FINAL"),
  );
  await denied(service.calculate(home, "exam-1", { grade: 7 }, "FINAL"));
  await denied(
    service.calculate(teacher, "exam-1", { classId: "class-701" }, "FINAL"),
  );
  await denied(
    service.calculate(
      { ...teacher, role: "super_admin" },
      "exam-1",
      { grade: 7 },
      "FINAL",
    ),
  );
  const full = await service.calculate(grade, "exam-1", { grade: 7 }, "FINAL");
  assert.equal(
    full.local.find((p) => p.participationId === "part-a1").gradeRank,
    1,
  );
  assert.equal(full.grades.length, 1);
  await denied(service.calculate(grade, "exam-1", { grade: 8 }, "FINAL"));
  await assert.rejects(
    service.calculate(
      owner,
      "exam-1",
      { grade: 7, classId: "class-701" },
      "FINAL",
    ),
    /INVALID_CALCULATION_SCOPE/,
  );
  await db
    .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
    .bind(now, home.sessionId)
    .run();
  await denied(
    service.calculate(home, "exam-1", { classId: "class-701" }, "FINAL"),
  );
});

test("Phase 5 server: later enrollment and student lifecycle never rebuild historical ranking", async (t) => {
  const { db, owner, service } = await fixture(t);
  const before = await service.calculate(
    owner,
    "exam-1",
    { grade: 7 },
    "FINAL",
  );
  for (const status of ["transferred_out", "graduated"]) {
    await db
      .prepare(
        "UPDATE students SET status=?, ranking_eligible_default=0 WHERE id='fictional-a'",
      )
      .bind(status)
      .run();
    const after = await service.calculate(
      owner,
      "exam-1",
      { grade: 7 },
      "FINAL",
    );
    assert.deepEqual(after.local, before.local);
    assert.deepEqual(after.classes, before.classes);
  }
  const historical = await service.calculate(
    owner,
    "exam-2",
    { grade: 7 },
    "FINAL",
  );
  assert.equal(
    historical.local.find((p) => p.participationId === "part-a2")
      .classIdSnapshot,
    "class-702",
  );
  assert.equal(
    before.local.find((p) => p.participationId === "part-a1").classIdSnapshot,
    "class-701",
  );
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM exam_result_versions").first())
      .n,
    0,
  );
});

test("Phase 5 server: changed source or revoked session during snapshot read cannot return a result", async (t) => {
  const { db, owner } = await fixture(t);
  const intercepted = (mutation) => ({
    prepare: (query) => db.prepare(query),
    batch: async (statements) => {
      const result = await db.batch(statements);
      await mutation();
      return result;
    },
  });
  const changed = new RankingService({
    db: intercepted(() =>
      db.prepare("UPDATE exams SET version=version+1 WHERE id='exam-1'").run(),
    ),
    now: () => now,
  });
  await assert.rejects(
    changed.calculate(owner, "exam-1", { grade: 7 }, "FINAL"),
    (error) => error.code === "CALCULATION_SOURCE_CHANGED",
  );
  const revoked = new RankingService({
    db: intercepted(() =>
      db
        .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
        .bind(now, owner.sessionId)
        .run(),
    ),
    now: () => now,
  });
  await denied(revoked.calculate(owner, "exam-1", { grade: 7 }, "FINAL"));
});
