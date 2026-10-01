import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { encodeCBOR } from "@levischuck/tiny-cbor";
import { SitesAuthService } from "../lib/server/auth/sites-service.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { handleSitesAuth } from "../lib/server/auth/sites-http.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
} from "../scripts/db-local.mjs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrationsFolder, migrationPreflight } from "../scripts/db-local.mjs";

const origin = "https://fictional-sites.invalid";
const initial = Date.UTC(2026, 9, 1, 4);
const hash = (value) => createHash("sha256").update(value).digest();
const b64 = (value) => Buffer.from(value).toString("base64url");
const reject = (promise, code) =>
  assert.rejects(promise, (e) => e.code === code);
const one = (db, sql, ...values) =>
  db
    .prepare(sql)
    .bind(...values)
    .first();
const run = (db, sql, ...values) =>
  db
    .prepare(sql)
    .bind(...values)
    .run();

// A synthetic authenticator makes real ES256 signatures; no production keys or accounts.
function authenticator(adminId) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const cose = encodeCBOR(
    new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
    ]),
  );
  function data(options, type, overrides) {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge: options.challenge,
        origin,
        crossOrigin: false,
        ...overrides,
      }),
    );
  }
  function authData(flags, count, rpID = new URL(origin).hostname) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(count);
    return Buffer.concat([hash(rpID), Buffer.from([flags]), counter]);
  }
  return {
    id: b64(id),
    registration(options, overrides = {}) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(id.length);
      const bytes = Buffer.concat([
        authData(overrides.flags ?? 0x45, 0, overrides.rpID),
        Buffer.alloc(16),
        len,
        id,
        Buffer.from(cose),
      ]);
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(
            data(options, "webauthn.create", overrides.client),
          ),
          attestationObject: b64(
            encodeCBOR(
              new Map([
                ["fmt", "none"],
                ["attStmt", new Map()],
                ["authData", new Uint8Array(bytes)],
              ]),
            ),
          ),
          transports: ["internal"],
        },
      };
    },
    assertion(options, count = 1, overrides = {}) {
      const client = data(options, "webauthn.get", overrides.client);
      const bytes = authData(overrides.flags ?? 5, count, overrides.rpID);
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(client),
          authenticatorData: b64(bytes),
          signature: b64(
            sign(
              "sha256",
              Buffer.concat([bytes, hash(client)]),
              pair.privateKey,
            ),
          ),
          userHandle: overrides.userHandle ?? b64(adminId),
        },
      };
    },
  };
}
async function fixture(t) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  assert.equal((await migrateLocalDatabase(db)).applied, 17);
  let time = initial;
  const service = (subject = "sites-owner") =>
    new SitesAuthService({
      db,
      identity: { provider: "sites", subject },
      origin,
      bootstrapSecret: "fictional-bootstrap",
      now: () => time,
    });
  const auth = service();
  const owner = await auth.bootstrapSites({
    secret: "fictional-bootstrap",
    displayName: "虛構管理員",
    contactEmail: "fictional@example.invalid",
  });
  const authorization = new AuthorizationService({ db, now: () => time });
  const management = new AdminManagementService({
    db,
    authorization,
    recoverySecret: "fictional-recovery",
    now: () => time,
  });
  const key = authenticator(owner.adminId);
  const enroll = async () => {
    const c = await auth.passkeyOptions(owner.token, "register", true);
    await auth.verifyPasskey(
      owner.token,
      "register",
      c.challengeId,
      key.registration(c.options),
    );
    return auth.validateSession(owner.token);
  };
  return {
    db,
    auth,
    owner,
    service,
    authorization,
    management,
    key,
    enroll,
    setTime: (value) => (time = value),
  };
}

test("Sites bootstrap and sessions bind to the platform subject, never email or a stolen app cookie", async (t) => {
  const f = await fixture(t);
  assert.equal(f.owner.recentAuthenticatedAt, 0);
  await reject(
    f.auth.bootstrapSites({
      secret: "fictional-bootstrap",
      displayName: "虛構",
      contactEmail: "x@example.invalid",
    }),
    "BOOTSTRAP_CLOSED",
  );
  await reject(f.service("unknown").loginSites(), "SITES_ADMIN_NOT_AUTHORIZED");
  assert.equal(await f.service("unknown").validateSession(f.owner.token), null);
  await reject(
    f.authorization.assertPermission(f.owner, "admin.manage"),
    "RECENT_AUTHENTICATION_REQUIRED",
  );
  await f.enroll();
  await f.authorization.assertPermission(f.owner, "admin.manage");
  assert.equal((await f.auth.loginSites()).recentAuthenticatedAt, 0);
  assert.notEqual(
    (
      await one(
        f.db,
        "SELECT token_hash FROM admin_sessions WHERE id=?",
        f.owner.sessionId,
      )
    ).token_hash,
    f.owner.token,
  );
  assert.match(f.auth.cookieForSession(f.owner.token), /HttpOnly/);
  assert.match(f.auth.cookieForSession(f.owner.token), /Secure/);
});

test("Removed Google endpoints cannot restart OAuth and every failed Sites API attempt is rate guarded once", async () => {
  for (const path of [
    "google/start",
    "google/callback",
    "bootstrap/start",
    "identity/start",
    "reauth/start",
  ]) {
    const route = await import("../app/api/auth/" + path + "/route.ts");
    for (const method of ["GET", "POST"]) {
      const response = route[method]();
      assert.equal(response.status, 410);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  }
  for (const [body, expected] of [
    ["invalid json", false],
    [JSON.stringify({ operation: "bootstrap", secret: "fictional" }), true],
    [JSON.stringify({ operation: "reauth-options" }), false],
  ]) {
    const calls = [];
    const response = await handleSitesAuth(
      new Request(origin + "/api/auth/sites", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body,
      }),
      () => {
        throw new Error("fictional unavailable");
      },
      async (restricted) => {
        calls.push(restricted);
      },
    );
    assert.deepEqual(calls, [expected]);
    assert.ok(response.status >= 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("Passkey requires real signatures, a fresh single-use challenge and increasing counter", async (t) => {
  const f = await fixture(t);
  await f.enroll();
  f.setTime(initial + 300000);
  await reject(
    f.authorization.assertPermission(f.owner, "admin.manage"),
    "RECENT_AUTHENTICATION_REQUIRED",
  );
  let c = await f.auth.passkeyOptions(f.owner.token, "reauth", false);
  const response = f.key.assertion(c.options);
  await f.auth.verifyPasskey(f.owner.token, "reauth", c.challengeId, response);
  await f.authorization.assertPermission(f.owner, "admin.manage");
  await reject(
    f.auth.verifyPasskey(f.owner.token, "reauth", c.challengeId, response),
    "PASSKEY_CHALLENGE_INVALID",
  );
  c = await f.auth.passkeyOptions(f.owner.token, "reauth", false);
  await reject(
    f.auth.verifyPasskey(
      f.owner.token,
      "reauth",
      c.challengeId,
      f.key.assertion(c.options, 1),
    ),
    "PASSKEY_INVALID",
  );
  c = await f.auth.passkeyOptions(f.owner.token, "reauth", false);
  f.setTime(initial + 600000);
  await reject(
    f.auth.verifyPasskey(
      f.owner.token,
      "reauth",
      c.challengeId,
      f.key.assertion(c.options, 2),
    ),
    "PASSKEY_CHALLENGE_INVALID",
  );
});

test("Origin, RP ID, user verification, challenge, userHandle, cross-origin and signature failures burn the challenge", async (t) => {
  const f = await fixture(t);
  await f.enroll();
  for (const overrides of [
    { client: { origin: "https://other.invalid" } },
    { rpID: "other.invalid" },
    { flags: 1 },
    { flags: 4 },
    { client: { challenge: b64(randomBytes(32)) } },
    { userHandle: b64("another-admin") },
    { client: { crossOrigin: true } },
    { client: { crossOrigin: "true" } },
    { client: { topOrigin: origin } },
    { tamper: true },
    { wrongId: true },
  ]) {
    const c = await f.auth.passkeyOptions(f.owner.token, "reauth", false);
    const response = f.key.assertion(c.options, 1, overrides);
    if (overrides.tamper) response.response.signature = b64(randomBytes(72));
    if (overrides.wrongId) response.id = response.rawId = b64(randomBytes(32));
    await reject(
      f.auth.verifyPasskey(f.owner.token, "reauth", c.challengeId, response),
      "PASSKEY_INVALID",
    );
    await reject(
      f.auth.verifyPasskey(
        f.owner.token,
        "reauth",
        c.challengeId,
        f.key.assertion(c.options),
      ),
      "PASSKEY_CHALLENGE_INVALID",
    );
  }
  assert.equal(
    (await one(f.db, "SELECT counter FROM admin_passkeys")).counter,
    0,
  );
});

test("Enrollment requires UV; competing enrollment cannot overwrite and replacement needs recent Passkey", async (t) => {
  const f = await fixture(t);
  const invalid = await f.auth.passkeyOptions(f.owner.token, "register", true);
  await reject(
    f.auth.verifyPasskey(
      f.owner.token,
      "register",
      invalid.challengeId,
      f.key.registration(invalid.options, { flags: 0x41 }),
    ),
    "PASSKEY_INVALID",
  );
  const stale = await f.auth.passkeyOptions(f.owner.token, "register", true);
  const mismatch = await f.auth.passkeyOptions(f.owner.token, "register", true);
  const mismatchedResponse = f.key.registration(mismatch.options);
  mismatchedResponse.id = mismatchedResponse.rawId = b64(randomBytes(32));
  await reject(
    f.auth.verifyPasskey(
      f.owner.token,
      "register",
      mismatch.challengeId,
      mismatchedResponse,
    ),
    "PASSKEY_INVALID",
  );
  await f.enroll();
  await reject(
    f.auth.verifyPasskey(
      f.owner.token,
      "register",
      stale.challengeId,
      f.key.registration(stale.options),
    ),
    "PASSKEY_CHALLENGE_INVALID",
  );
  f.setTime(initial + 300000);
  await reject(
    f.auth.passkeyOptions(f.owner.token, "register", true),
    "RECENT_AUTHENTICATION_REQUIRED",
  );
  const c = await f.auth.passkeyOptions(f.owner.token, "reauth", false);
  await f.auth.verifyPasskey(
    f.owner.token,
    "reauth",
    c.challengeId,
    f.key.assertion(c.options),
  );
  const newKey = authenticator(f.owner.adminId);
  const replacement = await f.auth.passkeyOptions(
    f.owner.token,
    "register",
    true,
  );
  await f.auth.verifyPasskey(
    f.owner.token,
    "register",
    replacement.challengeId,
    newKey.registration(replacement.options),
  );
  assert.equal(
    (await one(f.db, "SELECT credential_id FROM admin_passkeys")).credential_id,
    newKey.id,
  );
});

test("Challenge is session-bound and revocation blocks completion", async (t) => {
  const f = await fixture(t);
  await f.enroll();
  const c = await f.auth.passkeyOptions(f.owner.token, "reauth", false);
  const second = await f.auth.loginSites();
  await reject(
    f.auth.verifyPasskey(
      second.token,
      "reauth",
      c.challengeId,
      f.key.assertion(c.options),
    ),
    "PASSKEY_CHALLENGE_INVALID",
  );
  await run(
    f.db,
    "UPDATE admin_sessions SET revoked_at=? WHERE id=?",
    initial,
    f.owner.sessionId,
  );
  await reject(
    f.auth.verifyPasskey(
      f.owner.token,
      "reauth",
      c.challengeId,
      f.key.assertion(c.options),
    ),
    "AUTHENTICATION_REQUIRED",
  );
  await run(
    f.db,
    "UPDATE admin_sites_bindings SET subject=? WHERE admin_user_id=?",
    "changed-owner",
    f.owner.adminId,
  );
  assert.equal(
    await f.service("changed-owner").validateSession(second.token),
    null,
  );
});

test("Recovery requires the approved Sites identity and a new Passkey, revokes all sessions, and cannot reopen bootstrap", async (t) => {
  const f = await fixture(t);
  await f.enroll();
  const approved = await f.management.approveRecovery({
    targetAdminId: f.owner.adminId,
    authorizedEmail: "recovered@example.invalid",
    sitesSubject: "sites-recovered",
    approvalSecret: "fictional-recovery",
    approvedBy: "fictional-operator",
    evidenceReference: "case:fictional",
    expectedVersion: 1,
    confirmed: true,
  });
  const token = approved.requestToken;
  await reject(f.auth.identityOptions(token), "IDENTITY_REQUEST_INVALID");
  const recovering = f.service("sites-recovered");
  const c = await recovering.identityOptions(token);
  const newKey = authenticator(f.owner.adminId);
  await recovering.verifyIdentity(
    token,
    c.challengeId,
    newKey.registration(c.options),
  );
  assert.equal(await f.auth.validateSession(f.owner.token), null);
  await reject(f.auth.loginSites(), "SITES_ADMIN_NOT_AUTHORIZED");
  assert.equal((await recovering.loginSites()).recentAuthenticatedAt, 0);
  assert.equal(
    (await one(f.db, "SELECT credential_id FROM admin_passkeys")).credential_id,
    newKey.id,
  );
  await reject(recovering.identityOptions(token), "IDENTITY_REQUEST_INVALID");
  assert.equal(
    (await one(f.db, "SELECT count(*) AS n FROM bootstrap_state")).n,
    1,
  );
});

test("Sites HTTP enforces origin, strict input, size and safe session delivery", async (t) => {
  const f = await fixture(t);
  const call = (body, extra = {}) =>
    handleSitesAuth(
      new Request(origin + "/api/auth/sites", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...extra,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      f.auth,
    );
  assert.equal(
    (await call({ operation: "login" }, { Origin: "https://evil.invalid" }))
      .status,
    403,
  );
  for (const body of [
    { operation: "constructor" },
    { operation: "login", role: "super_admin" },
    { operation: "register-options" },
    [],
    null,
  ])
    assert.equal((await call(body)).status >= 400, true);
  assert.equal((await call("x".repeat(65537))).status, 413);
  const login = await call({ operation: "login" });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { ok: true });
  assert.match(login.headers.get("Set-Cookie"), /HttpOnly/);
  assert.equal(login.headers.get("Cache-Control"), "no-store");
  assert.throws(
    () =>
      new SitesAuthService({
        db: f.db,
        identity: { provider: "sites", subject: "s" },
        origin: "http://localhost",
        bootstrapSecret: "fictional",
      }),
    (e) => e.code === "PASSKEY_CONFIGURATION_INVALID",
  );
});

test("Explicit provisioning activates only the assigned subject and duplicate bindings roll back the account", async (t) => {
  const f = await fixture(t);
  await f.enroll();
  const input = {
    username: "fictional-viewer",
    displayName: "虛構",
    authorizedEmail: "viewer@example.invalid",
    sitesSubject: "sites-viewer",
    role: "super_admin",
    confirmed: true,
  };
  const created = await f.management.createAdmin(f.owner, input);
  const session = await f.service("sites-viewer").loginSites();
  assert.equal(session.adminId, created.id);
  assert.equal(session.isFirstBinding, true);
  await assert.rejects(
    f.management.createAdmin(f.owner, {
      ...input,
      username: "duplicate",
      authorizedEmail: "other@example.invalid",
    }),
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*) AS n FROM admin_users WHERE username='duplicate'",
      )
    ).n,
    0,
  );
  await run(
    f.db,
    "UPDATE admin_users SET status='disabled' WHERE id=?",
    created.id,
  );
  assert.equal(
    await f.service("sites-viewer").validateSession(session.token),
    null,
  );
  await reject(
    f.service("sites-viewer").loginSites(),
    "SITES_ADMIN_NOT_AUTHORIZED",
  );
});

test("Concurrent verification has one winner and expired Recovery approvals cannot mutate identity", async (t) => {
  const f = await fixture(t);
  await f.enroll();
  const c = await f.auth.passkeyOptions(f.owner.token, "reauth", false);
  const result = await Promise.allSettled(
    [1, 2].map(() =>
      f.auth.verifyPasskey(
        f.owner.token,
        "reauth",
        c.challengeId,
        f.key.assertion(c.options),
      ),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const approval = await f.management.approveRecovery({
    targetAdminId: f.owner.adminId,
    authorizedEmail: "recovered@example.invalid",
    sitesSubject: "sites-recovered",
    approvalSecret: "fictional-recovery",
    approvedBy: "fictional-operator",
    evidenceReference: "case:fictional",
    expectedVersion: 1,
    confirmed: true,
  });
  f.setTime(initial + 300000);
  await reject(
    f.service("sites-recovered").identityOptions(approval.requestToken),
    "IDENTITY_REQUEST_INVALID",
  );
  assert.equal(
    (await one(f.db, "SELECT subject FROM admin_sites_bindings")).subject,
    "sites-owner",
  );
});

test("Recovery rejects a credential change after challenge issuance without consuming approval or modifying binding", async (t) => {
  const f = await fixture(t);
  await f.enroll();
  const approval = await f.management.approveRecovery({
    targetAdminId: f.owner.adminId,
    authorizedEmail: "recovered@example.invalid",
    sitesSubject: "sites-recovered",
    approvalSecret: "fictional-recovery",
    approvedBy: "fictional-operator",
    evidenceReference: "case:fictional",
    expectedVersion: 1,
    confirmed: true,
  });
  const recovery = f.service("sites-recovered");
  const c = await recovery.identityOptions(approval.requestToken);
  await run(f.db, "UPDATE admin_passkeys SET version=version+1");
  await reject(
    recovery.verifyIdentity(
      approval.requestToken,
      c.challengeId,
      authenticator(f.owner.adminId).registration(c.options),
    ),
    "AUTH_CONFLICT",
  );
  assert.equal(
    (await one(f.db, "SELECT subject FROM admin_sites_bindings")).subject,
    "sites-owner",
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT status FROM auth_identity_requests WHERE id=?",
        approval.requestId,
      )
    ).status,
    "approved",
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*) AS n FROM audit_logs WHERE action='ADMIN_SITES_RECOVERY'",
      )
    ).n,
    0,
  );
});

test("Rebind completion rechecks the approving administrator session", async (t) => {
  const f = await fixture(t);
  await f.enroll();
  const target = await f.management.createAdmin(f.owner, {
    username: "fictional-target",
    displayName: "虛構",
    authorizedEmail: "target@example.invalid",
    sitesSubject: "sites-target",
    role: "super_admin",
    confirmed: true,
  });
  const approval = await f.management.approveRebind(f.owner, target.id, {
    authorizedEmail: "new-target@example.invalid",
    sitesSubject: "sites-new-target",
    reason: "fictional replacement",
    expectedVersion: 1,
    confirmed: true,
  });
  const targetAuth = f.service("sites-new-target");
  const c = await targetAuth.identityOptions(approval.requestToken);
  await run(
    f.db,
    "UPDATE admin_sessions SET revoked_at=? WHERE id=?",
    initial,
    f.owner.sessionId,
  );
  await reject(
    targetAuth.verifyIdentity(
      approval.requestToken,
      c.challengeId,
      authenticator(target.id).registration(c.options),
    ),
    "AUTH_CONFLICT",
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT subject FROM admin_sites_bindings WHERE admin_user_id=?",
        target.id,
      )
    ).subject,
    "sites-target",
  );
});

test("Migration 0016 revokes legacy sessions and approvals, never auto-maps Google identities, and is repeatable", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  const migrations = readMigrationFiles({ migrationsFolder });
  await run(
    db,
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );
  for (const m of migrations.slice(0, 16))
    await db.batch([
      ...m.sql.map((s) => db.prepare(s)),
      db
        .prepare(
          "INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)",
        )
        .bind(m.hash, m.folderMillis),
    ]);
  await run(
    db,
    "INSERT INTO admin_users(id,username,display_name,authorized_email,google_subject_id,role,status,identity_bound_at) VALUES ('legacy','admin','虛構','legacy@example.invalid','fictional-google','super_admin','active',1)",
  );
  await run(
    db,
    "INSERT INTO bootstrap_state(id,initialized_by,initialized_at) VALUES (1,'legacy',1)",
  );
  await run(
    db,
    "INSERT INTO admin_sessions(id,admin_user_id,token_hash,auth_version,authenticated_at,recent_auth_at,last_seen_at,expires_at) VALUES ('legacy-session','legacy',?,1,1,1,1,?)",
    "a".repeat(64),
    initial + 1000000,
  );
  await run(
    db,
    "INSERT INTO auth_identity_requests(id,kind,target_admin_id,target_auth_version,authorized_email,approval_hash,status,expires_at,approved_at,approved_by,evidence_reference) VALUES ('legacy-recovery','recovery','legacy',1,'legacy@example.invalid',?,'approved',?,1,'fictional-operator','case:fictional')",
    "b".repeat(64),
    initial + 1000000,
  );
  assert.equal((await migrationPreflight(db)).pending, 1);
  assert.equal((await migrateLocalDatabase(db)).applied, 17);
  assert.equal(
    (await one(db, "SELECT auth_version FROM admin_users WHERE id='legacy'"))
      .auth_version,
    2,
  );
  const session = await one(
    db,
    "SELECT revoked_at,recent_auth_at FROM admin_sessions",
  );
  assert.notEqual(session.revoked_at, null);
  assert.equal(session.recent_auth_at, 0);
  assert.equal(
    (await one(db, "SELECT status FROM auth_identity_requests")).status,
    "expired",
  );
  assert.equal(
    (await one(db, "SELECT count(*) AS n FROM admin_sites_bindings")).n,
    0,
  );
  assert.equal(
    (await one(db, "SELECT count(*) AS n FROM bootstrap_state")).n,
    1,
  );
  assert.equal((await migrateLocalDatabase(db)).pending, 0);
});
