import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  guardAuthAttempt,
  cleanupAuthLimits,
  AUTH_LIMITS,
} from "../lib/server/auth/limit.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
} from "../scripts/db-local.mjs";
const now = Date.UTC(2026, 9, 1);
const secret = "fictional-auth-limit-secret-for-tests-only";
const request = (ip = "192.0.2.11") =>
  new Request(
    "https://school.example.test/api/auth/google/callback?error=denied",
    { headers: ip ? { "CF-Connecting-IP": ip } : {} },
  );

test("Phase 16 auth limiter fails closed without trusting forwarded headers or leaking input", async () => {
  for (const deps of [
    {},
    { verified: "false", secret },
    { verified: "true", secret },
    { verified: "true", secret: "short", db: {} },
  ])
    await assert.rejects(guardAuthAttempt(request(), deps), {
      code: "AUTH_RATE_UNAVAILABLE",
      status: 503,
    });
  for (const ip of [null, "999.2.3.4", "bad", "2001:db8:invalid"])
    await assert.rejects(
      guardAuthAttempt(request(ip), { verified: "true", secret, db: {} }),
      { code: "AUTH_RATE_UNAVAILABLE" },
    );
  await assert.rejects(
    guardAuthAttempt(request(), {
      verified: "true",
      secret,
      db: {
        batch() {
          throw new Error("private internal failure");
        },
        prepare() {
          return {
            bind() {
              return this;
            },
          };
        },
      },
    }),
    { code: "AUTH_RATE_UNAVAILABLE", message: "AUTH_RATE_UNAVAILABLE" },
  );
});

test("Phase 16 atomic OAuth attempts share the 60 counter and expire at exactly ten minutes", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  const deps = { db, secret, verified: "true", now };
  const results = await Promise.allSettled(
    Array.from({ length: 70 }, () => guardAuthAttempt(request(), deps)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 60);
  assert.ok(
    results
      .filter((r) => r.status === "rejected")
      .every((r) => r.reason.code === "AUTH_RATE_LIMITED"),
  );
  await assert.rejects(
    guardAuthAttempt(request("192.000.002.011"), {
      ...deps,
      now: now + AUTH_LIMITS.windowMs - 1,
    }),
    { status: 429 },
  );
  await guardAuthAttempt(request(), {
    ...deps,
    now: now + AUTH_LIMITS.windowMs,
  });
  const rows = (await db.prepare("SELECT * FROM auth_rate_attempts").all())
    .results;
  assert.equal(rows.length, 61);
  assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.ip_hash)));
  assert.ok(!JSON.stringify(rows).includes("192.0.2"));
  await cleanupAuthLimits(db, now + AUTH_LIMITS.retentionMs - 3_600_000);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM auth_rate_attempts").first())
      .n,
    1,
  );
  await guardAuthAttempt(request(), {
    ...deps,
    now: now + AUTH_LIMITS.retentionMs + AUTH_LIMITS.windowMs,
  });
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM auth_rate_attempts").first())
      .n,
    1,
  );
});

test("Phase 16 Bootstrap and Identity share five attempts and rejected starts do not partially consume", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  const deps = { db, secret, verified: "true", now };
  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, () =>
      guardAuthAttempt(request("2001:db8::1"), deps, true),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 5);
  await assert.rejects(
    guardAuthAttempt(request("2001:db8:0:0:0:0:0:1"), deps, true),
    { code: "AUTH_RATE_LIMITED" },
  );
  for (let n = 0; n < 55; n++)
    await guardAuthAttempt(request("2001:db8::1"), deps);
  await assert.rejects(guardAuthAttempt(request("2001:db8::1"), deps), {
    status: 429,
  });
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM auth_rate_attempts").first())
      .n,
    60,
  );
  await guardAuthAttempt(
    request("2001:db8::1"),
    { ...deps, now: now + AUTH_LIMITS.windowMs },
    true,
  );
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO auth_rate_attempts VALUES('invalid','plain-ip',2,-1)",
      )
      .run(),
  );
});

test("Phase 16 all OAuth routes count attempts before code, body or auth service dispatch", () => {
  for (const [route, restricted] of [
    ["google/start", false],
    ["google/callback", false],
    ["bootstrap/start", true],
    ["identity/start", true],
    ["reauth/start", false],
  ]) {
    const source = readFileSync(
      new URL(`../app/api/auth/${route}/route.ts`, import.meta.url),
      "utf8",
    );
    const guard = source.indexOf(
      restricted
        ? "await authAttempt(request, true)"
        : "await authAttempt(request",
    );
    assert.ok(guard > 0, route);
    assert.ok(guard < source.indexOf("authService()"), route);
    if (route === "google/callback")
      assert.ok(guard < source.indexOf('url.searchParams.get("code")'));
  }
});
