import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  fictionalKeys,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AISettingsService } from "../lib/server/ai/settings.ts";
import { AIJobService, JOB_POLICY } from "../lib/server/ai/jobs.ts";
import { AIProviderError } from "../lib/server/ai/provider.ts";
import { PublicationService } from "../lib/server/exams/publication.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import { handleAIJobRequest } from "../lib/server/ai/jobs-http.ts";
import { SESSION_COOKIE } from "../lib/server/auth/cookies.ts";
import { fingerprint } from "../lib/server/references/parse.ts";
import { referenceSearchTokens } from "../lib/domain/rag-text.ts";
const start = Date.UTC(2026, 8, 29, 4);
const identity = (name) => ({
  verified: true,
  emailVerified: true,
  subject: `fictional-${name}`,
  email: `${name}@example.test`,
  issuer: "https://accounts.google.com",
  audience: "fictional-client",
  nonce: "fictional",
  issuedAt: start / 1000,
  authTime: start / 1000,
  expiresAt: start / 1000 + 3600,
});
const body = (input) =>
  JSON.stringify({
    summary: "學習".repeat(250),
    diagnosis: "持續練習",
    improvements: "加強理解",
    plan: "每日複習",
    encouragement: "持續進步",
    ...(input.instructions.includes("parentSupport")
      ? { parentSupport: "陪伴學習" }
      : {}),
  });
async function fixture(t, generate) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  await seedFictional(db, fictionalKeys());
  let time = start,
    calls = 0;
  const now = () => time;
  await db
    .prepare("UPDATE academic_state SET current_year_id='year-115' WHERE id=1")
    .run();
  const auth = new AuthService({
    db,
    bootstrapSecret: "fictional-bootstrap",
    now,
  });
  const owner = await auth.bootstrap({
    secret: "fictional-bootstrap",
    identity: identity("owner"),
  });
  const settings = new AISettingsService({ db, now });
  await settings.update(owner, {
    configuration: { provider: "openai", model: "fictional-model" },
    expectedVersion: 0,
    confirmed: true,
  });
  const publication = new PublicationService({ db, now });
  const publish = async (exam = "exam-1", component = "QUIZ") => {
    const row = await db
      .prepare("SELECT version FROM exams WHERE id=?")
      .bind(exam)
      .first();
    const preview = await publication.preview(owner, exam, {
      kind: "PUBLISH",
      component,
      expectedVersion: row.version,
    });
    return publication.confirm(owner, preview.previewId, true);
  };
  await publish();
  const jobs = new AIJobService({
    db,
    now,
    provider: (config) => ({
      generate: async (input) => {
        calls++;
        assert.ok(!input.text.includes("fictional-a"));
        assert.ok(!input.text.includes("studentId"));
        if (generate)
          return generate({
            input,
            config,
            calls,
            db,
            now,
            publish,
            advance: (ms) => {
              time += ms;
            },
          });
        return {
          ...config,
          text: body(input),
          attempts: 1,
          usage: { inputTokens: 100, outputTokens: 600, totalTokens: 700 },
        };
      },
    }),
  });
  const request = (extra = {}, session = owner) =>
    jobs.request(session, {
      examId: "exam-1",
      studentId: "fictional-a",
      confirmed: true,
      ...extra,
    });
  return {
    db,
    auth,
    owner,
    jobs,
    request,
    publish,
    publication,
    settings,
    now,
    advance: (ms) => {
      time += ms;
    },
    calls: () => calls,
  };
}
test("Phase 12 manual first start, durable pair, usage, replay and atomic advice history", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.jobs.consumeOne()).status, "idle");
  const requested = await f.request();
  assert.equal((await f.request()).replayed, true);
  assert.equal((await f.jobs.consumeOne()).status, "completed");
  assert.equal(f.calls(), 2);
  const history = await f.jobs.history(f.owner, "exam-1", "fictional-a");
  assert.equal(history.versions.length, 2);
  assert.equal(new Set(history.versions.map((v) => v.version)).size, 1);
  assert.ok(
    history.jobs.every(
      (j) =>
        j.status === "completed" &&
        j.input_tokens === 100 &&
        j.duration_ms === 0,
    ),
  );
  assert.equal((await f.jobs.consumeOne()).status, "idle");
  assert.equal((await f.request()).pairKey, requested.pairKey);
});
test("Phase 12 rejected student output publishes neither audience and requires explicit retry", async (t) => {
  const f = await fixture(t, async ({ input, config }) => ({
    ...config,
    text: input.instructions.includes("parentSupport") ? body(input) : "{}",
    attempts: 1,
  }));
  await f.request();
  assert.equal((await f.jobs.consumeOne()).error, "AI_ADVICE_INVALID");
  assert.equal(
    (await f.jobs.history(f.owner, "exam-1", "fictional-a")).versions.length,
    0,
  );
  assert.equal((await f.jobs.consumeOne()).status, "idle");
  assert.equal((await f.request({ retry: true })).replayed, false);
});
test("Phase 12 persisted transient retry uses 1/5 minute backoff and stops after three executions", async (t) => {
  const f = await fixture(t, async () => {
    throw new AIProviderError("AI_NETWORK");
  });
  await f.request();
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal((await f.jobs.consumeOne()).error, "AI_NETWORK");
    if (attempt < 3) {
      assert.equal((await f.jobs.consumeOne()).status, "idle");
      f.advance(JOB_POLICY.retryMs[attempt - 1]);
    }
  }
  assert.equal((await f.jobs.consumeOne()).status, "idle");
  const state = await f.db
    .prepare(
      "SELECT status,attempt_count FROM ai_jobs WHERE pair_key IS NOT NULL",
    )
    .all();
  assert.ok(
    state.results.every((r) => r.status === "failed" && r.attempt_count === 3),
  );
});
test("Phase 12 concurrent consumers cannot claim or publish the same pair twice", async (t) => {
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async ({ input, config, calls }) => {
    if (calls === 1) {
      started();
      await held;
    }
    return { ...config, text: body(input), attempts: 1 };
  });
  await f.request();
  const first = f.jobs.consumeOne();
  await entered;
  assert.equal((await f.jobs.consumeOne()).status, "idle");
  release();
  assert.equal((await first).status, "completed");
  assert.equal(
    (await f.jobs.history(f.owner, "exam-1", "fictional-a")).versions.length,
    2,
  );
});
test("Phase 12 expired lease and transferred student block completion and further calls", async (t) => {
  for (const mode of ["expiry", "transfer"])
    await t.test(mode, async (child) => {
      const f = await fixture(
        child,
        async ({ input, config, db, calls, advance }) => {
          if (calls === 1) {
            if (mode === "expiry") advance(JOB_POLICY.leaseMs);
            else
              await db
                .prepare(
                  "UPDATE students SET status='transferred_out',transferred_out_on='2026-09-29' WHERE id='fictional-a'",
                )
                .run();
          }
          return { ...config, text: body(input), attempts: 1 };
        },
      );
      await f.request();
      const result = await f.jobs.consumeOne();
      assert.ok(
        ["AI_LEASE_EXPIRED", "AI_SOURCE_CHANGED"].includes(result.error),
      );
      assert.equal(f.calls(), 1);
      assert.equal(
        (await f.db.prepare("SELECT COUNT(*) n FROM ai_advices").first()).n,
        0,
      );
    });
});
test("Phase 12 source edit invalidates existing advice, enqueues regeneration, and blocks late output", async (t) => {
  const f = await fixture(t);
  await f.request();
  await f.jobs.consumeOne();
  await f.publish("exam-1", "MIDTERM");
  const old = await f.jobs.history(f.owner, "exam-1", "fictional-a");
  assert.ok(old.versions.every((v) => v.stale_at !== null));
  assert.equal((await f.jobs.consumeOne()).status, "completed");
  assert.equal((await f.request()).replayed, true);
  assert.equal(
    (await f.jobs.history(f.owner, "exam-1", "fictional-a")).versions.length,
    4,
  );
});

test("Phase 12 immediately following assessment is invalidated and regenerated from the changed previous version", async (t) => {
  const f = await fixture(t);
  await f.publish("exam-2");
  await f.request({ examId: "exam-2" });
  assert.equal((await f.jobs.consumeOne()).status, "completed");
  await f.publish("exam-1", "MIDTERM");
  assert.ok(
    (await f.jobs.history(f.owner, "exam-2", "fictional-a")).versions.every(
      (v) => v.stale_at !== null,
    ),
  );
  assert.equal((await f.jobs.consumeOne()).status, "completed");
  assert.equal(
    (await f.jobs.history(f.owner, "exam-2", "fictional-a")).versions.length,
    4,
  );
});

test("Phase 12 source changes during generation reject late output while durable regeneration survives", async (t) => {
  const f = await fixture(t, async ({ input, config, calls, publish }) => {
    if (calls === 1) await publish("exam-1", "MIDTERM");
    return { ...config, text: body(input), attempts: 1 };
  });
  await f.request();
  assert.equal((await f.jobs.consumeOne()).error, "AI_SOURCE_CHANGED");
  assert.equal(
    (await f.jobs.history(f.owner, "exam-1", "fictional-a")).versions.length,
    0,
  );
  assert.equal((await f.jobs.consumeOne()).status, "completed");
});

test("Phase 12 expired processing lease can be reclaimed and the old worker cannot overwrite it", async (t) => {
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async ({ input, config, calls }) => {
    if (calls === 1) {
      started();
      await held;
    }
    return { ...config, text: body(input), attempts: 1 };
  });
  await f.request();
  const old = f.jobs.consumeOne();
  await entered;
  f.advance(JOB_POLICY.leaseMs);
  assert.equal((await f.jobs.consumeOne()).status, "completed");
  release();
  await old;
  const state = await f.jobs.history(f.owner, "exam-1", "fictional-a");
  assert.equal(state.versions.length, 2);
  assert.ok(
    state.jobs.every((j) => j.status === "completed" && j.attempt_count === 2),
  );
});

test("Phase 12 late batch failure rolls back both advice versions and completion", async (t) => {
  const f = await fixture(t);
  await f.request();
  const db = {
    prepare: (...args) => f.db.prepare(...args),
    batch: (statements) =>
      f.db.batch(
        statements.length > 4
          ? [
              ...statements,
              f.db.prepare("SELECT * FROM fictional_missing_table"),
            ]
          : statements,
      ),
  };
  const jobs = new AIJobService({
    db,
    now: f.now,
    provider: (config) => ({
      generate: async (input) => ({
        ...config,
        text: body(input),
        attempts: 1,
      }),
    }),
  });
  assert.equal((await jobs.consumeOne()).error, "AI_JOB_CONFLICT");
  const state = await f.jobs.history(f.owner, "exam-1", "fictional-a");
  assert.equal(state.versions.length, 0);
  assert.ok(state.jobs.every((j) => j.status === "failed"));
});

test("Phase 12 references preserve citations and archived material cannot complete new advice", async (t) => {
  for (const archived of [false, true])
    await t.test(String(archived), async (child) => {
      const f = await fixture(child, async ({ input, config, calls, db }) => {
        assert.equal(JSON.parse(input.text).untrustedReferences.length, 1);
        if (archived && calls === 2)
          await db
            .prepare(
              "UPDATE ai_reference_materials SET status='archived' WHERE id='fictional-reference'",
            )
            .run();
        return { ...config, text: body(input), attempts: 1 };
      });
      const content = "數學 分數 練習 學習方法",
        hash = await fingerprint(content);
      await f.db
        .prepare(
          "INSERT INTO ai_reference_materials(id,title,object_key,content_hash,subject,grade,status,created_by) VALUES('fictional-reference','數學教學','fictional-object',?,'MATH',7,'active',?)",
        )
        .bind(hash, f.owner.adminId)
        .run();
      await f.db
        .prepare(
          "INSERT INTO ai_reference_chunks(material_id,material_version,ordinal,content,content_hash,search_tokens) VALUES('fictional-reference',1,0,?,?,?)",
        )
        .bind(content, hash, referenceSearchTokens(content).join(" "))
        .run();
      await f.request();
      const result = await f.jobs.consumeOne();
      assert.equal(result.status, archived ? "failed" : "completed");
      assert.equal(
        (
          await f.db
            .prepare("SELECT COUNT(*) n FROM ai_advice_references")
            .first()
        ).n,
        archived ? 0 : 2,
      );
    });
});
test("Phase 12 HTTP authorization, origin and scope; revoked grant cannot call provider", async (t) => {
  const f = await fixture(t);
  const management = new AdminManagementService({
    db: f.db,
    now: f.now,
    authorization: new AuthorizationService({ db: f.db, now: f.now }),
  });
  await management.createAdmin(f.owner, {
    username: "restricted",
    displayName: "虛構管理員",
    authorizedEmail: "restricted@example.test",
    role: "ai_admin",
    confirmed: true,
    assignments: [
      {
        academicTermId: "term-115-1",
        scopeType: "class",
        classId: "class-702",
        startsOn: "2026-08-01",
      },
    ],
  });
  const restricted = await f.auth.loginVerifiedGoogle(identity("restricted"));
  await assert.rejects(f.request({}, restricted), { code: "SCOPE_DENIED" });
  const call = (origin, cookie) =>
    handleAIJobRequest(
      new Request("https://fictional.test/api/admin/ai/jobs", {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          examId: "exam-1",
          studentId: "fictional-a",
          confirmed: true,
        }),
      }),
      { auth: f.auth, jobs: f.jobs },
    );
  assert.equal(
    (await call("https://other.test", `${SESSION_COOKIE}=${f.owner.token}`))
      .status,
    403,
  );
  assert.equal((await call("https://fictional.test", "")).status, 401);
  assert.equal(
    (await call("https://fictional.test", `${SESSION_COOKIE}=${f.owner.token}`))
      .status,
    202,
  );
  await f.db
    .prepare("UPDATE admin_users SET auth_version=auth_version+1 WHERE id=?")
    .bind(f.owner.adminId)
    .run();
  assert.equal((await f.jobs.consumeOne()).error, "AI_AUTHORIZATION_CHANGED");
  assert.equal(f.calls(), 0);
});
