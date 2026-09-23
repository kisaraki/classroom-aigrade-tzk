import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthService } from "../lib/server/auth/service.ts";
import {
  base64UrlEncode,
  GoogleOidcClient,
  sha256Hex,
} from "../lib/server/auth/google-oidc.ts";
import { AuthError } from "../lib/server/auth/types.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
} from "../scripts/db-local.mjs";

const now = Date.UTC(2030, 0, 15, 4);
const sql = (db, query, ...values) => db.prepare(query).bind(...values);
const one = (db, query, ...values) => sql(db, query, ...values).first();
const rejectsCode = (promise, code) =>
  assert.rejects(
    promise,
    (error) => error instanceof AuthError && error.code === code,
  );

function identity(overrides = {}) {
  return {
    verified: true,
    subject: "fictional-google-subject",
    email: "Admin@Example.Test",
    emailVerified: true,
    issuer: "https://accounts.google.com",
    audience: "fictional-client",
    nonce: "fictional-nonce",
    issuedAt: Math.floor(now / 1000) - 30,
    authTime: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + 300,
    name: "虛構 Google 管理員",
    ...overrides,
  };
}

function stubOidc(overrides = {}) {
  const client = new GoogleOidcClient(
    {
      clientId: "fictional-client",
      clientSecret: "fictional-client-secret",
      redirectUri: "https://admin.example.test/api/auth/google/callback",
    },
    async () =>
      new Response(
        JSON.stringify({
          issuer: "https://accounts.google.com",
          authorization_endpoint:
            "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        }),
        { headers: { "content-type": "application/json" } },
      ),
    () => now,
  );
  return Object.assign(client, overrides);
}

async function setup(t, options = {}) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  let sequence = 0;
  const service = new AuthService({
    db,
    oidc: options.oidc ?? stubOidc(),
    bootstrapSecret: "fictional-bootstrap-secret",
    now: options.now ?? (() => now),
    idleTimeoutMs: options.idleTimeoutMs ?? 30 * 60_000,
    absoluteTimeoutMs: options.absoluteTimeoutMs ?? 8 * 60 * 60_000,
    idFactory: (prefix) => `${prefix}-fictional-${++sequence}`,
  });
  return { db, service };
}

function decodeCookie(setCookie) {
  const value = setCookie.split(";", 1)[0].split("=", 2)[1];
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        atob(
          value.replaceAll("-", "+").replaceAll("_", "/") +
            "=".repeat((4 - (value.length % 4)) % 4),
        ),
        (character) => character.charCodeAt(0),
      ),
    ),
  );
}

test("Phase 3A Google OIDC validation enforces issuer, audience, nonce, signature and email_verified", async (t) => {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const fetcher = async (input, init) => {
    const url = String(input);
    if (url.includes(".well-known"))
      return new Response(
        JSON.stringify({
          issuer: "https://accounts.google.com",
          authorization_endpoint:
            "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        }),
        { headers: { "content-type": "application/json" } },
      );
    if (url.includes("certs"))
      return new Response(
        JSON.stringify({ keys: [{ ...jwk, kid: "fictional-kid" }] }),
      );
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init.method, "POST");
    return new Response(JSON.stringify({ id_token: "unused" }));
  };
  const client = new GoogleOidcClient(
    {
      clientId: "fictional-client",
      clientSecret: "fictional-secret",
      redirectUri: "https://admin.example.test/callback",
    },
    fetcher,
    () => now,
  );
  const sign = async (claims, tamper = false) => {
    const header = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({ alg: "RS256", typ: "JWT", kid: "fictional-kid" }),
      ),
    );
    const payload = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify(claims)),
    );
    const input = `${header}.${payload}`;
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        privateKey,
        new TextEncoder().encode(input),
      ),
    );
    if (tamper) signature[0] ^= 1;
    return `${input}.${base64UrlEncode(signature)}`;
  };
  const validClaims = {
    iss: "https://accounts.google.com",
    sub: "fictional-sub",
    aud: "fictional-client",
    iat: Math.floor(now / 1000) - 30,
    auth_time: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 300,
    nonce: "fictional-nonce",
    email: "admin@example.test",
    email_verified: true,
  };
  const result = await client.verifyIdToken(
    await sign(validClaims),
    "fictional-nonce",
  );
  assert.equal(result.subject, "fictional-sub");
  assert.equal(result.emailVerified, true);
  assert.equal(result.authTime, validClaims.auth_time);
  await rejectsCode(
    client.verifyIdToken(
      await sign({ ...validClaims, iss: "https://evil.example" }),
      "fictional-nonce",
    ),
    "OIDC_INVALID_ISSUER",
  );
  await rejectsCode(
    client.verifyIdToken(
      await sign({ ...validClaims, aud: "other-client" }),
      "fictional-nonce",
    ),
    "OIDC_INVALID_AUDIENCE",
  );
  await rejectsCode(
    client.verifyIdToken(
      await sign({ ...validClaims, nonce: "other" }),
      "fictional-nonce",
    ),
    "OIDC_NONCE_MISMATCH",
  );
  await rejectsCode(
    client.verifyIdToken(
      await sign({ ...validClaims, email_verified: false }),
      "fictional-nonce",
    ),
    "OIDC_EMAIL_UNVERIFIED",
  );
  await rejectsCode(
    client.verifyIdToken(
      await sign({ ...validClaims }, true),
      "fictional-nonce",
    ),
    "OIDC_INVALID_SIGNATURE",
  );
  t.diagnostic(
    "OIDC signed-token fixtures use generated keys and never call Google.",
  );
});

test("Phase 3A authorization URL uses PKCE and state cookie values are only transient", async (t) => {
  const { db, service } = await setup(t);
  const start = await service.beginGoogleLogin();
  const url = new URL(start.authorizationUrl);
  const cookie = decodeCookie(start.stateCookie);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), cookie.state);
  assert.equal(url.searchParams.get("nonce"), cookie.nonce);
  assert.equal(url.searchParams.get("client_secret"), null);
  assert.equal(
    url.searchParams.get("code_challenge"),
    await sha256Base64Url(cookie.codeVerifier),
  );
  const state = await one(
    db,
    "SELECT state_hash, nonce_hash, code_verifier_hash FROM auth_oauth_states",
  );
  assert.equal(state.state_hash, await sha256Hex(cookie.state));
  assert.equal(state.nonce_hash, await sha256Hex(cookie.nonce));
  assert.equal(state.code_verifier_hash, await sha256Hex(cookie.codeVerifier));
});

test("Phase 3A Bootstrap is Google-only, one-shot and concurrency-safe", async (t) => {
  const { db, service } = await setup(t);
  const first = await service.bootstrap({
    secret: "fictional-bootstrap-secret",
    identity: identity(),
  });
  assert.equal(first.role, "super_admin");
  assert.ok(first.token);
  assert.equal((await one(db, "SELECT count(*) AS n FROM admin_users")).n, 1);
  assert.equal(
    (await one(db, "SELECT username FROM admin_users")).username,
    "admin",
  );
  assert.equal(
    (await one(db, "SELECT count(*) AS n FROM bootstrap_state")).n,
    1,
  );
  assert.equal(
    (await one(db, "SELECT count(*) AS n FROM admin_sessions")).n,
    1,
  );
  await rejectsCode(
    service.bootstrap({
      secret: "fictional-bootstrap-secret",
      identity: identity({ subject: "another" }),
    }),
    "BOOTSTRAP_CLOSED",
  );
  await rejectsCode(
    service.bootstrap({ secret: "wrong", identity: identity() }),
    "BOOTSTRAP_SECRET_INVALID",
  );

  const second = await setup(t);
  const outcomes = await Promise.allSettled([
    second.service.bootstrap({
      secret: "fictional-bootstrap-secret",
      identity: identity({ subject: "subject-a" }),
    }),
    second.service.bootstrap({
      secret: "fictional-bootstrap-secret",
      identity: identity({ subject: "subject-b" }),
    }),
  ]);
  assert.equal(
    outcomes.filter((item) => item.status === "fulfilled").length,
    1,
  );
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  assert.equal(
    (await one(second.db, "SELECT count(*) AS n FROM admin_users")).n,
    1,
  );
});

test("Phase 3A pending binding, authorization, subject binding and status checks", async (t) => {
  const { db, service } = await setup(t);
  await sql(
    db,
    "INSERT INTO admin_users (id, username, display_name, authorized_email, role, status) VALUES ('pending', 'pending', '虛構待綁定', 'pending@example.test', 'viewer', 'pending_identity_binding')",
  ).run();
  await sql(
    db,
    "INSERT INTO admin_users (id, username, display_name, authorized_email, google_subject_id, role, status, identity_bound_at) VALUES ('active', 'active', '虛構已綁定', 'active@example.test', 'bound-sub', 'viewer', 'active', ?)",
  )
    .bind(now)
    .run();
  await sql(
    db,
    "INSERT INTO admin_users (id, username, display_name, authorized_email, google_subject_id, role, status, identity_bound_at) VALUES ('disabled', 'disabled', '虛構停權', 'disabled@example.test', 'disabled-sub', 'viewer', 'disabled', ?)",
  )
    .bind(now)
    .run();
  const pending = await service.loginVerifiedGoogle(
    identity({ email: "PENDING@example.test", subject: "pending-sub" }),
  );
  assert.equal(pending.isFirstBinding, true);
  assert.equal(
    (
      await one(
        db,
        "SELECT status, google_subject_id FROM admin_users WHERE id = 'pending'",
      )
    )?.status,
    "active",
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT google_subject_id FROM admin_users WHERE id = 'pending'",
      )
    )?.google_subject_id,
    "pending-sub",
  );
  await rejectsCode(
    service.loginVerifiedGoogle(identity({ email: "unknown@example.test" })),
    "AUTHORIZED_EMAIL_REQUIRED",
  );
  await rejectsCode(
    service.loginVerifiedGoogle(
      identity({ email: "active@example.test", subject: "different-sub" }),
    ),
    "GOOGLE_SUBJECT_MISMATCH",
  );
  await rejectsCode(
    service.loginVerifiedGoogle(
      identity({ email: "disabled@example.test", subject: "disabled-sub" }),
    ),
    "ADMIN_STATUS_NOT_ALLOWED",
  );
  await rejectsCode(
    service.loginVerifiedGoogle(
      identity({ email: "active@example.test", emailVerified: false }),
    ),
    "GOOGLE_VERIFICATION_REQUIRED",
  );
});

test("Phase 3A Session idle/absolute expiry, revocation and logout", async (t) => {
  let clock = now;
  const { db, service } = await setup(t, { now: () => clock });
  const login = await service.bootstrap({
    secret: "fictional-bootstrap-secret",
    identity: identity(),
  });
  assert.equal(
    (await service.validateSession(login.token))?.adminId,
    login.adminId,
  );
  clock += 31 * 60_000;
  assert.equal(await service.validateSession(login.token), null);
  assert.ok(
    (
      await one(
        db,
        "SELECT revoked_at FROM admin_sessions WHERE id = ?",
        login.sessionId,
      )
    ).revoked_at,
  );

  const second = await setup(t, {
    now: () => clock,
    absoluteTimeoutMs: 60 * 60_000,
    idleTimeoutMs: 30 * 60_000,
  });
  const secondLogin = await second.service.bootstrap({
    secret: "fictional-bootstrap-secret",
    identity: identity({ subject: "absolute-sub" }),
  });
  clock += 61 * 60_000;
  assert.equal(await second.service.validateSession(secondLogin.token), null);

  const third = await setup(t);
  const thirdLogin = await third.service.bootstrap({
    secret: "fictional-bootstrap-secret",
    identity: identity({ subject: "logout-sub" }),
  });
  await third.service.logout(thirdLogin.token);
  assert.equal(await third.service.validateSession(thirdLogin.token), null);
  assert.equal(
    (
      await one(
        third.db,
        "SELECT revoked_at FROM admin_sessions WHERE id = ?",
        thirdLogin.sessionId,
      )
    ).revoked_at !== null,
    true,
  );
});

test("Phase 3A callback consumes state once and never logs code, token or cookie", async (t) => {
  const fakeIdentity = identity({
    email: "callback@example.test",
    subject: "callback-sub",
  });
  const oidc = stubOidc({
    authorizationUrl: async ({ state }) =>
      `https://accounts.google.com/auth?state=${state}`,
    exchangeCode: async (code, verifier) => {
      assert.equal(code, "fictional-code");
      assert.ok(verifier);
      return "fictional-id-token";
    },
    verifyIdToken: async () => fakeIdentity,
  });
  const { db, service } = await setup(t, { oidc });
  await sql(
    db,
    "INSERT INTO admin_users (id, username, display_name, authorized_email, role, status) VALUES ('callback', 'callback', '虛構 Callback', 'callback@example.test', 'viewer', 'pending_identity_binding')",
  ).run();
  const start = await service.beginGoogleLogin();
  const cookie = start.stateCookie;
  const state = decodeCookie(cookie).state;
  const result = await service.completeGoogleLogin({
    code: "fictional-code",
    state,
    cookieHeader: cookie,
  });
  assert.equal(result.adminId, "callback");
  await rejectsCode(
    service.completeGoogleLogin({
      code: "fictional-code",
      state,
      cookieHeader: cookie,
    }),
    "OAUTH_STATE_MISMATCH",
  );
  const stateRow = await one(db, "SELECT used_at FROM auth_oauth_states");
  assert.ok(stateRow.used_at);
  const logs = await db.prepare("SELECT metadata_json FROM audit_logs").all();
  assert.equal(JSON.stringify(logs.results).includes("fictional-code"), false);
  assert.equal(JSON.stringify(logs.results).includes(result.token), false);
});

test("Phase 3A AI availability is unrelated to Google login", async (t) => {
  const { db, service } = await setup(t);
  const login = await service.bootstrap({
    secret: "fictional-bootstrap-secret",
    identity: identity({ email: "google-only@example.test" }),
  });
  assert.equal(login.role, "super_admin");
  const columns = await db.prepare("PRAGMA table_info(admin_users)").all();
  assert.equal(
    columns.results.some((column) =>
      String(column.name).toLowerCase().includes("chatgpt"),
    ),
    false,
  );
  assert.equal(
    columns.results.some((column) =>
      String(column.name).toLowerCase().includes("gemini"),
    ),
    false,
  );
});

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64UrlEncode(new Uint8Array(digest));
}
