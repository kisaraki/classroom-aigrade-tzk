import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AISettingsService,
  readAISettings,
} from "../lib/server/ai/settings.ts";
import { createAIProvider } from "../lib/server/ai/provider.ts";
import { handleAISettingsRequest } from "../lib/server/ai/http.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { SESSION_COOKIE } from "../lib/server/auth/cookies.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  fictionalKeys,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";
const now = Date.UTC(2026, 8, 28, 4);
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
    bootstrapSecret: "fictional-bootstrap",
    now: () => now,
  });
  const owner = await auth.bootstrap({
    secret: "fictional-bootstrap",
    identity: identity("owner"),
  });
  const service = new AISettingsService({ db, now: () => now });
  const management = new AdminManagementService({
    db,
    now: () => now,
    authorization: new AuthorizationService({ db, now: () => now }),
  });
  const user = async (name, role, scopeType) => {
    await management.createAdmin(owner, {
      username: name,
      displayName: "虛構管理員",
      authorizedEmail: `${name}@example.test`,
      role,
      confirmed: true,
      assignments: [
        {
          academicTermId: "term-115-1",
          scopeType,
          ...(scopeType === "class" ? { classId: "class-701" } : {}),
          startsOn: "2026-08-01",
        },
      ],
    });
    return auth.loginVerifiedGoogle(identity(name));
  };
  return { db, auth, owner, service, user };
}
const update = (provider, expectedVersion = 0) => ({
  configuration: { provider, model: `fictional-${provider}` },
  expectedVersion,
  confirmed: true,
});
test("AI settings switch atomically with version and audit; sessions and grades remain independent", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.read(f.owner), {
    version: 0,
    configuration: null,
  });
  const scoresBefore = await f.db
    .prepare("SELECT * FROM score_items ORDER BY id")
    .all();
  await f.service.update(f.owner, update("openai"));
  const switched = await f.service.update(f.owner, update("gemini", 1));
  assert.equal(switched.version, 2);
  assert.deepEqual(await readAISettings(f.db), switched);
  assert.ok(await f.auth.validateSession(f.owner.token));
  const instance = createAIProvider(switched.configuration, {
    secrets: {},
    fetch: () => assert.fail("no paid API"),
  });
  await assert.rejects(
    instance.generate({ instructions: "", text: "學習建議" }),
    { code: "AI_SECRET_MISSING" },
  );
  assert.ok(await f.auth.validateSession(f.owner.token));
  assert.deepEqual(
    (await f.db.prepare("SELECT * FROM score_items ORDER BY id").all()).results,
    scoresBefore.results,
  );
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='AI_PROVIDER_UPDATE'",
        )
        .first()
    ).n,
    2,
  );
  await assert.rejects(f.service.update(f.owner, update("openai", 1)), {
    code: "AI_SETTINGS_CONFLICT",
  });
  assert.deepEqual(await readAISettings(f.db), switched);
  const results = await Promise.allSettled([
    f.service.update(f.owner, update("openai", 2)),
    f.service.update(f.owner, update("gemini", 2)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await readAISettings(f.db)).version, 3);
});
test("AI settings enforce ai.manage and school scope; forged role and revoked session fail", async (t) => {
  const f = await fixture(t);
  const manager = await f.user("aimanager", "ai_admin", "school");
  const scoped = await f.user("scopedai", "ai_admin", "class");
  const viewer = await f.user("viewer", "viewer", "school");
  for (const actor of [scoped, viewer, { ...viewer, role: "super_admin" }]) {
    await assert.rejects(f.service.read(actor));
    await assert.rejects(f.service.update(actor, update("openai")));
  }
  await f.service.update(manager, update("openai"));
  await f.db
    .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
    .bind(now, manager.sessionId)
    .run();
  await assert.rejects(f.service.update(manager, update("gemini", 1)));
  assert.equal((await readAISettings(f.db)).configuration.provider, "openai");
});
test("AI settings transaction rechecks revocation and rolls back both rows and audit", async (t) => {
  const f = await fixture(t);
  const manager = await f.user("raceai", "ai_admin", "school");
  const db = {
    prepare: (...args) => f.db.prepare(...args),
    batch: async (statements) => {
      await f.db
        .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
        .bind(now, manager.sessionId)
        .run();
      return f.db.batch(statements);
    },
  };
  await assert.rejects(
    new AISettingsService({ db, now: () => now }).update(
      manager,
      update("openai"),
    ),
    { code: "AI_SETTINGS_CONFLICT" },
  );
  assert.equal((await readAISettings(f.db)).version, 0);
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='AI_PROVIDER_UPDATE'",
        )
        .first()
    ).n,
    0,
  );
});
test("AI settings HTTP requires session, origin, JSON, bounded input and explicit confirmation", async (t) => {
  const f = await fixture(t);
  const call = (body, headers = {}, method = "POST") =>
    handleAISettingsRequest(
      new Request("https://fictional.test/api/admin/ai/settings", {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: "https://fictional.test",
          Cookie: `${SESSION_COOKIE}=${f.owner.token}`,
          ...headers,
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      }),
      { auth: f.auth, settings: f.service },
    );
  assert.equal((await call(update("openai"), { Cookie: "" })).status, 401);
  assert.equal(
    (await call(update("openai"), { Origin: "https://other.test" })).status,
    403,
  );
  assert.equal(
    (await call(update("openai"), { "Content-Type": "text/plain" })).status,
    415,
  );
  assert.equal(
    (await call({ ...update("openai"), confirmed: false })).status,
    400,
  );
  assert.equal(
    (await call({ ...update("openai"), apiKey: "fictional-key" })).status,
    400,
  );
  assert.equal(
    (await call({ ...update("openai"), extra: "x".repeat(4096) })).status,
    413,
  );
  const success = await call(update("openai"));
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("Cache-Control"), "no-store");
  const response = await call(null, {}, "GET");
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes("KEY"));
});

test("AI settings partial batch failure rolls back configuration and audit", async (t) => {
  const f = await fixture(t);
  const db = {
    prepare: (...args) => f.db.prepare(...args),
    batch: (statements) =>
      f.db.batch([
        statements[0],
        statements[1],
        f.db.prepare(
          "INSERT INTO system_settings (key,value_json,version) VALUES ('ai_model','invalid-json',1)",
        ),
      ]),
  };
  await assert.rejects(
    new AISettingsService({ db, now: () => now }).update(
      f.owner,
      update("openai"),
    ),
    { code: "AI_SETTINGS_CONFLICT" },
  );
  assert.deepEqual(await readAISettings(f.db), {
    version: 0,
    configuration: null,
  });
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='AI_PROVIDER_UPDATE'",
        )
        .first()
    ).n,
    0,
  );
});
