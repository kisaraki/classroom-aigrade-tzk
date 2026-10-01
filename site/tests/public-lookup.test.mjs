import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  fictionalKeys,
  migrationPreflight,
  migrationsFolder,
} from "../scripts/db-local.mjs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { seedFictional } from "../db/seed-fictional.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { PublicationService } from "../lib/server/exams/publication.ts";
import { PublicLookupService } from "../lib/server/public/service.ts";
import { handlePublicLookup } from "../lib/server/public/http.ts";
import {
  limitLookup,
  cleanupLookupLimits,
  LOOKUP_LIMITS,
} from "../lib/server/public/limit.ts";
import { AIJobService } from "../lib/server/ai/jobs.ts";
import { AISettingsService } from "../lib/server/ai/settings.ts";
const start = Date.UTC(2026, 8, 29, 4),
  secret = "fictional-public-only-hmac-secret-32-bytes";
const input = {
  year: "115",
  term: 1,
  classCode: "701",
  sequence: 1,
  name: "虛構查詢甲",
  birthDate: "2013-05-10",
};
const identity = {
  verified: true,
  emailVerified: true,
  subject: "fictional-google-owner",
  email: "owner@example.test",
  issuer: "https://accounts.google.com",
  audience: "fictional-client",
  nonce: "fictional",
  issuedAt: start / 1000,
  authTime: start / 1000,
  expiresAt: start / 1000 + 3600,
};
async function fixture(t) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  await seedFictional(db, fictionalKeys());
  await db
    .prepare("UPDATE students SET name=? WHERE id='fictional-a'")
    .bind(input.name)
    .run();
  await db
    .prepare("UPDATE academic_state SET current_year_id='year-115' WHERE id=1")
    .run();
  let time = start;
  const now = () => time;
  const auth = new AuthService({
    db,
    bootstrapSecret: "fictional-bootstrap",
    now,
  });
  const owner = await auth.bootstrap({
    secret: "fictional-bootstrap",
    identity,
  });
  const publisher = new PublicationService({ db, now });
  const publish = async (exam = "exam-1", component = "QUIZ") => {
    const row = await db
      .prepare("SELECT version FROM exams WHERE id=?")
      .bind(exam)
      .first();
    const preview = await publisher.preview(owner, exam, {
      kind: "PUBLISH",
      component,
      expectedVersion: row.version,
    });
    return publisher.confirm(owner, preview.previewId, true);
  };
  await publish();
  const service = new PublicLookupService({ db, hmacSecret: secret, now });
  return {
    db,
    service,
    owner,
    now,
    publish,
    publisher,
    advance: (ms) => {
      time += ms;
    },
    lookup: (body = input, ip = "192.0.2.10") => service.lookup(body, ip),
  };
}
test("Phase 13 only published own data, historical class, zero and no identifiers escape", async (t) => {
  const f = await fixture(t);
  const result = await f.lookup();
  assert.equal(result.provisional, true);
  assert.equal(result.scores[0].midterm.status, "UNPUBLISHED");
  assert.equal(result.midterm.average, null);
  assert.equal(result.trends.length, 1);
  const encoded = JSON.stringify(result);
  for (const forbidden of [
    "fictional",
    "虛構",
    "2013-05-10",
    "studentId",
    "gradeRank",
    "identity_number",
    "snapshot_json",
    "classId",
  ])
    assert.ok(!encoded.includes(forbidden), forbidden);
  assert.equal(result.classStatistics.population, 2);
  assert.equal(result.advice.status, "unavailable");
  f.advance(11 * 60_000);
  await assert.rejects(f.lookup({ ...input, classCode: "702" }), {
    kind: "failed",
  });
  assert.ok((await f.lookup()).exam.count > 0); // current enrollment may later be 702; published class remains 701.
  await assert.rejects(f.lookup({ ...input, term: 2 }), { kind: "failed" });
  await assert.rejects(f.lookup({ ...input, studentId: "fictional-b" }), {
    kind: "failed",
  });
});
test("Phase 13 duplicate, missing, unpublished and expired lookup share one generic error", async (t) => {
  const f = await fixture(t);
  const call = (body) =>
    handlePublicLookup(
      new Request("https://fictional.test/api/public/lookup", {
        method: "POST",
        headers: {
          Origin: "https://fictional.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      { service: f.service, trustedIp: "192.0.2.12" },
    );
  const missing = await call({ ...input, name: "虛構不存在" }),
    unpublished = await call({ ...input, sequence: 2, classCode: "702" });
  await f.db
    .prepare("UPDATE students SET name=? WHERE id='fictional-b'")
    .bind(input.name)
    .run();
  const ambiguous = await call(input);
  await f.db
    .prepare("UPDATE students SET name='虛構乙' WHERE id='fictional-b'")
    .run();
  await f.db
    .prepare(
      "UPDATE students SET public_query_until='2026-09-29',retention_until='2026-10-29' WHERE id='fictional-a'",
    )
    .run();
  const expired = await call(input);
  const text = await missing.text();
  for (const r of [unpublished, ambiguous, expired]) {
    assert.equal(r.status, 400);
    assert.equal(await r.text(), text);
  }
  assert.equal(
    missing.headers.get("Cache-Control"),
    "no-store, private, max-age=0",
  );
  assert.match(missing.headers.get("X-Robots-Tag"), /noindex/);
});
test("Phase 13 retained transferred/archived data remains queryable until boundary; deleted is denied", async (t) => {
  const f = await fixture(t);
  await f.db
    .prepare(
      "UPDATE students SET status='transferred_out',archived_at=?,public_query_until='2026-09-30',retention_until='2029-09-30' WHERE id='fictional-a'",
    )
    .bind(start)
    .run();
  assert.ok(await f.lookup());
  await f.db
    .prepare("UPDATE students SET deleted_at=? WHERE id='fictional-a'")
    .bind(start)
    .run();
  await assert.rejects(f.lookup(), { kind: "failed" });
});
test("Phase 13 rolling limiter is atomic, shared across IPs for one query, hashed and time bounded", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 9 }, (_, i) =>
      limitLookup(
        db,
        secret,
        `192.0.2.${i + 1}`,
        "fictional-sensitive-query",
        start,
      ),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 5);
  assert.equal(
    outcomes.filter(
      (r) => r.status === "rejected" && r.reason.kind === "limited",
    ).length,
    4,
  );
  await assert.rejects(
    limitLookup(
      db,
      secret,
      "192.0.2.50",
      "fictional-sensitive-query",
      start + 599999,
    ),
    { kind: "limited" },
  );
  await limitLookup(
    db,
    secret,
    "192.0.2.50",
    "fictional-sensitive-query",
    start + 600000,
  );
  for (let i = 0; i < 30; i++)
    await limitLookup(db, secret, "192.0.2.100", `fictional-${i}`, start);
  await assert.rejects(
    limitLookup(db, secret, "192.0.2.100", "new-fictional", start),
    { kind: "limited" },
  );
  const rows = (await db.prepare("SELECT * FROM public_lookup_attempts").all())
    .results;
  assert.equal(rows.length, 36);
  assert.ok(!JSON.stringify(rows).includes("fictional"));
  assert.ok(!JSON.stringify(rows).includes("192.0.2"));
  await cleanupLookupLimits(db, start + LOOKUP_LIMITS.retentionMs);
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM public_lookup_attempts").first())
      .n,
    0,
  );
  await assert.rejects(limitLookup(db, secret, null, "query", start), {
    kind: "unavailable",
  });
  await assert.rejects(limitLookup(db, "short", "192.0.2.1", "query", start), {
    kind: "unavailable",
  });
});
test("Phase 13 HTTP refuses GET, cross origin, URL data, malformed and oversized input; DB failure stays safe", async (t) => {
  const f = await fixture(t);
  const call = (request) =>
    handlePublicLookup(request, {
      service: f.service,
      trustedIp: "192.0.2.20",
    });
  for (const request of [
    new Request("https://fictional.test/api/public/lookup"),
    new Request("https://fictional.test/api/public/lookup", {
      method: "POST",
      headers: { Origin: "https://other.test" },
    }),
    new Request(
      "https://fictional.test/api/public/lookup?studentId=fictional-a",
      { method: "POST", headers: { Origin: "https://fictional.test" } },
    ),
    new Request("https://fictional.test/api/public/lookup", {
      method: "POST",
      headers: {
        Origin: "https://fictional.test",
        "Content-Type": "application/json",
      },
      body: "x".repeat(4097),
    }),
  ])
    assert.equal((await call(request)).status, 400);
  const request = () =>
    new Request("https://fictional.test/api/public/lookup", {
      method: "POST",
      headers: {
        Origin: "https://fictional.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  assert.equal(
    (
      await handlePublicLookup(request(), {
        service: f.service,
        trustedIp: null,
      })
    ).status,
    503,
  );
  const broken = new PublicLookupService({
    db: {
      batch: async () => {
        throw new Error("fictional-sensitive-DB-error");
      },
      prepare: (q) => f.db.prepare(q),
    },
    hmacSecret: secret,
    now: f.now,
  });
  const response = await handlePublicLookup(request(), {
    service: broken,
    trustedIp: "192.0.2.20",
  });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("fictional"));
});
test("Phase 13 deletion before response prevents stale private release", async (t) => {
  const f = await fixture(t);
  let batches = 0;
  const wrapped = {
    prepare: (q) => f.db.prepare(q),
    batch: async (stmts) => {
      batches++;
      if (batches === 2)
        await f.db
          .prepare(
            "UPDATE students SET deleted_at=?,version=version+1 WHERE id='fictional-a'",
          )
          .bind(start)
          .run();
      return f.db.batch(stmts);
    },
  };
  const service = new PublicLookupService({
    db: wrapped,
    hmacSecret: secret,
    now: f.now,
  });
  await assert.rejects(service.lookup(input, "192.0.2.21"), { kind: "failed" });
});
test("Phase 13 publication changing before response rejects mixed result versions", async (t) => {
  const f = await fixture(t);
  let batches = 0;
  const wrapped = {
    prepare: (q) => f.db.prepare(q),
    batch: async (statements) => {
      if (++batches === 2) await f.publish("exam-1", "MIDTERM");
      return f.db.batch(statements);
    },
  };
  await assert.rejects(
    new PublicLookupService({
      db: wrapped,
      hmacSecret: secret,
      now: f.now,
    }).lookup(input, "192.0.2.22"),
    { kind: "failed" },
  );
});
test("Phase 13 complete AI pair is rendered, stale pair hidden while grades remain available", async (t) => {
  const f = await fixture(t);
  await new AISettingsService({ db: f.db, now: f.now }).update(f.owner, {
    configuration: { provider: "openai", model: "fictional-model" },
    expectedVersion: 0,
    confirmed: true,
  });
  const jobs = new AIJobService({
    db: f.db,
    now: f.now,
    provider: (config) => ({
      generate: async (request) => ({
        provider: config.provider,
        model: config.model,
        attempts: 1,
        text: JSON.stringify({
          summary: "學習".repeat(250),
          diagnosis: "持續練習",
          improvements: "理解",
          plan: "複習",
          encouragement: "加油",
          ...(request.instructions.includes("parentSupport")
            ? { parentSupport: "陪伴" }
            : {}),
        }),
      }),
    }),
  });
  await jobs.request(f.owner, {
    examId: "exam-1",
    studentId: "fictional-a",
    confirmed: true,
  });
  assert.equal((await jobs.consumeOne()).status, "completed");
  assert.equal((await f.lookup()).advice.status, "ready");
  await f.publish("exam-1", "MIDTERM");
  const updated = await f.lookup();
  assert.equal(updated.advice.status, "unavailable");
  assert.equal(updated.provisional, false);
});
test("Phase 13 migration failure rolls back limiter table and retry preserves scores", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  const migrations = readMigrationFiles({ migrationsFolder });
  await db
    .prepare(
      "CREATE TABLE __drizzle_migrations(id SERIAL PRIMARY KEY,hash text NOT NULL,created_at numeric)",
    )
    .run();
  for (const m of migrations.slice(0, 13)) {
    await db.batch(m.sql.filter((s) => s.trim()).map((s) => db.prepare(s)));
    await db
      .prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)")
      .bind(m.hash, m.folderMillis)
      .run();
  }
  await seedFictional(db, fictionalKeys());
  assert.equal((await migrationPreflight(db)).pending, 4);
  await assert.rejects(
    db.batch([
      ...migrations[13].sql.filter((s) => s.trim()).map((s) => db.prepare(s)),
      db.prepare("SELECT * FROM fictional_missing"),
    ]),
  );
  assert.equal(
    await db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE name='public_lookup_attempts'",
      )
      .first(),
    null,
  );
  await migrateLocalDatabase(db);
  await migrateLocalDatabase(db);
  assert.equal((await migrationPreflight(db)).pending, 0);
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM students").first()).n,
    4,
  );
});
