import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { AuthService } from "../lib/server/auth/service.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import { handleAuthRequest } from "../lib/server/auth/http.ts";
import { GoogleOidcClient, sha256Hex } from "../lib/server/auth/google-oidc.ts";
import { AuthError } from "../lib/server/auth/types.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  migrationPreflight,
  migrationsFolder,
  fictionalKeys,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";

const now = Date.UTC(2026, 8, 24, 4);
const run = (db, query, ...values) =>
  db
    .prepare(query)
    .bind(...values)
    .run();
const one = (db, query, ...values) =>
  db
    .prepare(query)
    .bind(...values)
    .first();
const rejects = (promise, code) =>
  assert.rejects(
    promise,
    (error) => error instanceof AuthError && error.code === code,
  );
const identity = (name = "owner", overrides = {}) => ({
  verified: true,
  subject: `fictional-${name}-subject`,
  email: `${name}@example.test`,
  emailVerified: true,
  issuer: "https://accounts.google.com",
  audience: "fictional-client",
  nonce: "fictional-nonce",
  issuedAt: Math.floor(now / 1000),
  authTime: Math.floor(now / 1000),
  expiresAt: Math.floor(now / 1000) + 600,
  ...overrides,
});
const confirmed = (expectedVersion = 1) => ({
  expectedVersion,
  confirmed: true,
});
const assignment = (scopeType = "school", extra = {}) => ({
  academicTermId: "term-115-1",
  scopeType,
  startsOn: "2026-08-01",
  ...extra,
});
const scope = (extra = {}) => ({ academicTermId: "term-115-1", ...extra });
function oidc(clock, getIdentity) {
  const client = new GoogleOidcClient(
    {
      clientId: "fictional-client",
      clientSecret: "fictional-client-secret",
      redirectUri: "https://admin.example.test/api/auth/google/callback",
    },
    async () =>
      Response.json({
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      }),
    clock,
  );
  client.exchangeCode = async () => "fictional-id-token";
  client.verifyIdToken = async (_token, nonce) => ({ ...getIdentity(), nonce });
  return client;
}
async function fixture(t) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  await seedFictional(db, fictionalKeys());
  await run(
    db,
    "UPDATE academic_state SET current_year_id='year-115' WHERE id=1",
  );
  let time = now,
    nextIdentity = identity();
  const clock = () => time;
  const authorization = new AuthorizationService({ db, now: clock });
  const makeManagement = (
    database = db,
    secret = "fictional-recovery-secret",
  ) =>
    new AdminManagementService({
      db: database,
      authorization,
      recoverySecret: secret,
      now: clock,
    });
  const management = makeManagement();
  const auth = new AuthService({
    db,
    oidc: oidc(clock, () => nextIdentity),
    bootstrapSecret: "fictional-bootstrap-secret",
    identityRequests: management,
    now: clock,
  });
  const owner = await auth.bootstrap({
    secret: "fictional-bootstrap-secret",
    identity: identity(),
  });
  async function user(name, role = "viewer", assignments = [assignment()]) {
    const row = await management.createAdmin(owner, {
      username: name,
      displayName: "虛構管理員",
      authorizedEmail: `${name}@example.test`,
      role,
      assignments,
      confirmed: true,
    });
    const session = await auth.loginVerifiedGoogle(identity(name));
    return { ...row, ...session };
  }
  async function callback(start, session) {
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    return auth.completeGoogleLogin({
      state,
      code: "fictional-code",
      cookieHeader:
        start.stateCookie.split(";", 1)[0] +
        (session ? `; __Host-admin_session=${session.token}` : ""),
    });
  }
  return {
    db,
    auth,
    authorization,
    management,
    owner,
    user,
    callback,
    makeManagement,
    setTime: (value) => {
      time = value;
    },
    setIdentity: (value) => {
      nextIdentity = value;
    },
  };
}

test("Phase 3B permissions and scope fail closed for IDOR, missing resources and mixed batches", async (t) => {
  const f = await fixture(t);
  const teacher = await f.user("math-teacher", "score_admin", [
    assignment("teaching_subject", { classId: "class-701", subject: "MATH" }),
    assignment("teaching_subject", {
      classId: "class-702",
      subject: "ENGLISH",
    }),
  ]);
  const homeroom = await f.user("homeroom", "score_admin", [
    assignment("homeroom", { classId: "class-701" }),
  ]);
  const access = (session, resource, permission = "score.write") =>
    f.authorization.assertPermission(session, permission, resource);
  await access(teacher, scope({ classId: "class-701", subject: "MATH" }));
  for (const resource of [
    undefined,
    {},
    scope(),
    scope({ subject: "MATH" }),
    scope({ classId: "class-701" }),
    scope({ classId: "class-701", subject: "ENGLISH" }),
    scope({ classIds: ["class-701", "class-702"], subject: "MATH" }),
    scope({
      classId: "class-701",
      subject: "MATH",
      studentId: "fictional-external",
    }),
    scope({ classId: "missing", subject: "MATH" }),
    scope({ classId: "class-701", subject: "MATH", academicYearId: "wrong" }),
    scope({
      classId: "class-701",
      subject: "MATH",
      academicTermId: "term-115-2",
    }),
    scope({ classId: "class-701", subject: "MATH", grade: 8 }),
  ]) {
    await rejects(access(teacher, resource), "SCOPE_DENIED");
  }
  for (const subject of [
    "CHINESE",
    "ENGLISH",
    "MATH",
    "SCIENCE",
    "GEOGRAPHY",
    "HISTORY",
    "CIVICS",
  ])
    await access(homeroom, scope({ classId: "class-701", subject }));
  await rejects(
    access(homeroom, scope({ classId: "class-702", subject: "MATH" })),
    "SCOPE_DENIED",
  );
  await rejects(f.management.listAdmins(teacher), "PERMISSION_DENIED");
  const viewer = await f.user("viewer");
  await access(viewer, scope(), "score.read");
  await rejects(access(viewer, scope()), "PERMISSION_DENIED");
  const system = await f.user("system", "system_admin", [
    assignment("class", { classId: "class-701" }),
  ]);
  await rejects(
    f.management.createAdmin(system, {
      username: "forbidden",
      displayName: "虛構",
      authorizedEmail: "forbidden@example.test",
      role: "viewer",
      assignments: [assignment()],
      confirmed: true,
    }),
    "PERMISSION_DENIED",
  );
  await rejects(
    access(system, scope({ classId: "class-701" }), "system.manage"),
    "SCOPE_DENIED",
  );
  const tampered = {
    ...teacher,
    role: "super_admin",
    adminId: f.owner.adminId,
  };
  await rejects(access(tampered, scope()), "ACCESS_DENIED");
});

test("Phase 3B historical authorization uses dated assignments and fixed participation snapshots", async (t) => {
  const f = await fixture(t);
  const teacher = await f.user("history-teacher", "score_admin", [
    assignment("homeroom", { classId: "class-701", endsOn: "2026-10-01" }),
    assignment("homeroom", { classId: "class-702", startsOn: "2026-10-01" }),
  ]);
  await f.authorization.assertPermission(teacher, "score.read", {
    participationId: "part-a1",
  });
  await f.authorization.assertPermission(teacher, "score.read", {
    participationId: "part-a2",
  });
  await rejects(
    f.authorization.assertPermission(teacher, "score.read", {
      participationId: "part-a1",
      classId: "class-702",
    }),
    "SCOPE_DENIED",
  );
  await rejects(
    f.authorization.assertPermission(
      teacher,
      "score.read",
      scope({ classId: "class-701", onDate: "2026-10-01" }),
    ),
    "SCOPE_DENIED",
  );
  await rejects(
    f.authorization.assertPermission(
      teacher,
      "score.read",
      scope({ classId: "class-701", onDate: "2026-02-30" }),
    ),
    "SCOPE_DENIED",
  );
  await run(
    f.db,
    "INSERT INTO academic_years (id,code,starts_on,ends_on) VALUES ('year-116','116','2027-08-01','2028-08-01')",
  );
  await run(
    f.db,
    "UPDATE academic_state SET current_year_id='year-116' WHERE id=1",
  );
  await f.authorization.assertPermission(teacher, "score.read", {
    participationId: "part-a1",
  });
  await rejects(
    f.authorization.assertPermission(teacher, "score.write", {
      participationId: "part-a1",
    }),
    "HISTORICAL_SCOPE_DENIED",
  );
  await rejects(
    f.authorization.assertPermission(f.owner, "score.write", {
      participationId: "part-a1",
    }),
    "HISTORICAL_SCOPE_DENIED",
  );
  await f.authorization.assertPermission(f.owner, "score.write", {
    participationId: "part-a1",
    historyReason: "虛構修正原因",
  });
});

test("Phase 3B five-minute auth_time boundary and browser-bound Google reauthentication", async (t) => {
  const f = await fixture(t);
  f.setTime(now + 5 * 60_000 - 1);
  await f.authorization.assertPermission(f.owner, "admin.manage");
  f.setTime(now + 5 * 60_000);
  await rejects(
    f.authorization.assertPermission(f.owner, "admin.manage"),
    "RECENT_AUTHENTICATION_REQUIRED",
  );
  for (const authTime of [
    undefined,
    0,
    Math.floor(now / 1000),
    Math.floor((now + 6 * 60_000) / 1000),
  ]) {
    const start = await f.auth.beginGoogleReauthentication(f.owner.token);
    f.setIdentity(identity("owner", { authTime }));
    await rejects(f.callback(start, f.owner), "RECENT_AUTHENTICATION_REQUIRED");
  }
  let start = await f.auth.beginGoogleReauthentication(f.owner.token);
  f.setIdentity(
    identity("owner", { authTime: Math.floor((now + 5 * 60_000) / 1000) }),
  );
  await rejects(f.callback(start), "OAUTH_STATE_MISMATCH");
  start = await f.auth.beginGoogleReauthentication(f.owner.token);
  f.setIdentity(
    identity("wrong-person", {
      authTime: Math.floor((now + 5 * 60_000) / 1000),
    }),
  );
  await rejects(f.callback(start, f.owner), "RECENT_AUTHENTICATION_REQUIRED");
  start = await f.auth.beginGoogleReauthentication(f.owner.token);
  f.setIdentity(
    identity("owner", { authTime: Math.floor((now + 5 * 60_000) / 1000) }),
  );
  const result = await f.callback(start, f.owner);
  assert.equal(result.token, "");
  await f.authorization.assertPermission(f.owner, "admin.manage");
  await rejects(f.callback(start, f.owner), "OAUTH_STATE_MISMATCH");
  const url = new URL(start.authorizationUrl);
  assert.deepEqual(JSON.parse(url.searchParams.get("claims")), {
    id_token: { auth_time: { essential: true } },
  });
  await run(
    f.db,
    "UPDATE admin_sessions SET recent_auth_at=? WHERE id=?",
    now + 6 * 60_000,
    f.owner.sessionId,
  );
  await rejects(
    f.authorization.assertPermission(f.owner, "admin.manage"),
    "RECENT_AUTHENTICATION_REQUIRED",
  );
});

test("Phase 3B account changes require confirmation/version and revoke sessions atomically", async (t) => {
  const f = await fixture(t);
  const user = await f.user("managed-user");
  await rejects(
    f.management.updateAdmin(f.owner, user.id, {
      status: "disabled",
      expectedVersion: 1,
    }),
    "CONFIRMATION_REQUIRED",
  );
  await rejects(
    f.management.updateAdmin(f.owner, user.id, {
      status: "disabled",
      ...confirmed(2),
    }),
    "ADMIN_VERSION_CONFLICT",
  );
  await rejects(
    f.management.updateAdmin(f.owner, user.id, {
      status: "disabled",
      assignments: [assignment("class", { classId: "missing" })],
      ...confirmed(),
    }),
    "CLASS_TERM_MISMATCH",
  );
  assert.equal(
    (await one(f.db, "SELECT status FROM admin_users WHERE id=?", user.id))
      .status,
    "active",
  );
  assert.ok(await f.auth.validateSession(user.token));
  await f.management.updateAdmin(f.owner, user.id, {
    role: "score_admin",
    ...confirmed(),
  });
  assert.equal(await f.auth.validateSession(user.token), null);
  const login = await f.auth.loginVerifiedGoogle(identity("managed-user"));
  await f.management.replaceAssignments(
    f.owner,
    user.id,
    [assignment("homeroom", { classId: "class-701" })],
    confirmed(2),
  );
  assert.equal(await f.auth.validateSession(login.token), null);
  await f.management.updateAdmin(f.owner, user.id, {
    status: "disabled",
    ...confirmed(3),
  });
  await rejects(
    f.auth.loginVerifiedGoogle(identity("managed-user")),
    "ADMIN_STATUS_NOT_ALLOWED",
  );
  await f.management.updateAdmin(f.owner, user.id, {
    status: "active",
    ...confirmed(4),
  });
  const enabled = await f.auth.loginVerifiedGoogle(identity("managed-user"));
  await f.management.revokeSessions(f.owner, user.id, confirmed(5));
  assert.equal(await f.auth.validateSession(enabled.token), null);
  const noSecret = new AdminManagementService({
    db: f.db,
    authorization: f.authorization,
    now: () => now,
  });
  assert.ok((await noSecret.listAdmins(f.owner)).length);
  const list = await f.management.listAdmins(f.owner);
  assert.equal(Object.hasOwn(list[0], "google_subject_id"), false);
});

test("Phase 3B transaction guards stop target races, revoked operators and last-super-admin races", async (t) => {
  const f = await fixture(t);
  const user = await f.user("race-target");
  const proxy = (hook) => ({
    prepare: f.db.prepare.bind(f.db),
    batch: async (statements) => {
      await hook();
      return f.db.batch(statements);
    },
  });
  const racing = f.makeManagement(
    proxy(() =>
      run(
        f.db,
        "UPDATE admin_users SET display_name='競爭更新', auth_version=auth_version+1 WHERE id=?",
        user.id,
      ),
    ),
  );
  await rejects(
    racing.updateAdmin(f.owner, user.id, {
      displayName: "過期更新",
      ...confirmed(),
    }),
    "ADMIN_CONFLICT",
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT display_name FROM admin_users WHERE id=?",
        user.id,
      )
    ).display_name,
    "競爭更新",
  );
  const revoked = f.makeManagement(
    proxy(() =>
      run(
        f.db,
        "UPDATE admin_sessions SET revoked_at=? WHERE id=?",
        now,
        f.owner.sessionId,
      ),
    ),
  );
  await rejects(
    revoked.updateAdmin(f.owner, user.id, {
      displayName: "未授權更新",
      ...confirmed(2),
    }),
    "ADMIN_CONFLICT",
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*) AS n FROM audit_logs WHERE action='ADMIN_UPDATED'",
      )
    ).n,
    0,
  );
  const owner = await f.auth.loginVerifiedGoogle(identity());
  const second = await f.management.createAdmin(owner, {
    username: "second-super",
    displayName: "虛構超級管理員",
    authorizedEmail: "second-super@example.test",
    role: "super_admin",
    confirmed: true,
  });
  const secondLogin = await f.auth.loginVerifiedGoogle(
    identity("second-super"),
  );
  const outcomes = await Promise.allSettled([
    f.management.updateAdmin(owner, second.id, {
      status: "disabled",
      ...confirmed(),
    }),
    f.management.updateAdmin(secondLogin, owner.adminId, {
      status: "disabled",
      ...confirmed(),
    }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*) AS n FROM admin_users WHERE role='super_admin' AND status='active'",
      )
    ).n,
    1,
  );
});

test("Phase 3B Rebind verifies approved Email, operator freshness and single-use callback", async (t) => {
  const f = await fixture(t);
  const user = await f.user("rebind-user");
  let approved = await f.management.approveRebind(f.owner, user.id, {
    authorizedEmail: "new-identity@example.test",
    reason: "虛構更換",
    ...confirmed(),
  });
  f.setIdentity(identity("wrong-identity"));
  let start = await f.auth.beginIdentityVerification(approved.requestToken);
  await rejects(f.callback(start), "IDENTITY_REQUEST_INVALID");
  f.setIdentity(identity("new-identity"));
  start = await f.auth.beginIdentityVerification(approved.requestToken);
  assert.equal(await f.callback(start), null);
  assert.equal(await f.auth.validateSession(user.token), null);
  await rejects(
    f.auth.beginIdentityVerification(approved.requestToken),
    "IDENTITY_REQUEST_INVALID",
  );
  await rejects(
    f.auth.loginVerifiedGoogle(identity("rebind-user")),
    "AUTHORIZED_EMAIL_REQUIRED",
  );
  assert.ok((await f.auth.loginVerifiedGoogle(identity("new-identity"))).token);
  approved = await f.management.approveRebind(f.owner, user.id, {
    authorizedEmail: "later@example.test",
    reason: "虛構更換",
    ...confirmed(2),
  });
  start = await f.auth.beginIdentityVerification(approved.requestToken);
  f.setIdentity(identity("later"));
  await run(
    f.db,
    "UPDATE admin_sessions SET revoked_at=? WHERE id=?",
    now,
    f.owner.sessionId,
  );
  await rejects(f.callback(start), "ACCESS_DENIED");
  assert.equal(
    (
      await one(
        f.db,
        "SELECT authorized_email FROM admin_users WHERE id=?",
        user.id,
      )
    ).authorized_email,
    "new-identity@example.test",
  );
});

test("Phase 3B Recovery requires maintenance approval and Google; expiry, version conflict and concurrent replay are safe", async (t) => {
  const f = await fixture(t);
  const input = {
    targetAdminId: f.owner.adminId,
    authorizedEmail: "recovered@example.test",
    approvalSecret: "fictional-recovery-secret",
    approvedBy: "maintenance-operator-1",
    evidenceReference: "case/fictional-1",
    ...confirmed(),
  };
  await rejects(
    f.management.approveRecovery({ ...input, approvalSecret: "wrong" }),
    "RECOVERY_APPROVAL_INVALID",
  );
  await rejects(
    f.management.approveRecovery({ ...input, approvedBy: "" }),
    "APPROVAL_EVIDENCE_REQUIRED",
  );
  let approved = await f.management.approveRecovery(input);
  f.setTime(now + 5 * 60_000);
  await rejects(
    f.auth.beginIdentityVerification(approved.requestToken),
    "IDENTITY_REQUEST_INVALID",
  );
  f.setTime(now);
  approved = await f.management.approveRecovery(input);
  await run(
    f.db,
    "UPDATE admin_users SET auth_version=auth_version+1 WHERE id=?",
    f.owner.adminId,
  );
  await rejects(
    f.management.completeIdentityRequest(
      approved.requestId,
      identity("recovered"),
    ),
    "IDENTITY_REQUEST_INVALID",
  );
  approved = await f.management.approveRecovery({ ...input, ...confirmed(2) });
  await rejects(
    f.management.completeIdentityRequest(
      approved.requestId,
      identity("recovered", { verified: false }),
    ),
    "GOOGLE_VERIFICATION_REQUIRED",
  );
  const outcomes = await Promise.allSettled([
    f.management.completeIdentityRequest(
      approved.requestId,
      identity("recovered"),
    ),
    f.management.completeIdentityRequest(
      approved.requestId,
      identity("recovered", { subject: "fictional-replayed-subject" }),
    ),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*) AS n FROM audit_logs WHERE action='ADMIN_RECOVERY_COMPLETED'",
      )
    ).n,
    1,
  );
  assert.equal(await f.auth.validateSession(f.owner.token), null);
  await rejects(
    f.auth.bootstrap({
      secret: "fictional-bootstrap-secret",
      identity: identity("another"),
    }),
    "BOOTSTRAP_CLOSED",
  );
  const stored = JSON.stringify(
    (await f.db.prepare("SELECT * FROM auth_identity_requests").all()).results,
  );
  const audits = JSON.stringify(
    (await f.db.prepare("SELECT * FROM audit_logs").all()).results,
  );
  for (const secret of [
    input.approvalSecret,
    approved.requestToken,
    "fictional-id-token",
  ]) {
    assert.equal(stored.includes(secret), false);
    assert.equal(audits.includes(secret), false);
  }
  assert.notEqual(
    (
      await one(
        f.db,
        "SELECT approval_hash FROM auth_identity_requests WHERE id=?",
        approved.requestId,
      )
    ).approval_hash,
    await sha256Hex(input.approvalSecret),
  );
});

test("Phase 3B HTTP handlers reject CSRF, identity forgery, unknown fields and partial account patches", async (t) => {
  const f = await fixture(t);
  const user = await f.user("http-user");
  const request = (body, headers = {}, cookie = f.owner.token) =>
    new Request("https://admin.example.test/api/admin/users", {
      method: "POST",
      headers: {
        Origin: "https://admin.example.test",
        "Content-Type": "application/json",
        Cookie: `__Host-admin_session=${cookie}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const call = (req, operation = "update") =>
    handleAuthRequest(
      req,
      { auth: f.auth, management: f.management },
      operation,
      user.id,
    );
  for (const [req, status] of [
    [
      request(
        { status: "disabled", ...confirmed() },
        { Origin: "https://evil.example.test" },
      ),
      403,
    ],
    [request({ status: "disabled", ...confirmed() }, { Origin: "null" }), 403],
    [
      request(
        { status: "disabled", ...confirmed() },
        { "Content-Type": "text/plain" },
      ),
      415,
    ],
    [request({ username: "renamed", ...confirmed() }), 400],
    [request({ identity: identity(), ...confirmed() }), 400],
    [
      request({ status: "disabled", ...confirmed() }, {}, "fake-session-token"),
      401,
    ],
    [request({ status: "disabled", ...confirmed() }, {}, user.token), 403],
  ]) {
    const response = await call(req);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const missingOrigin = request({ status: "disabled", ...confirmed() });
  missingOrigin.headers.delete("Origin");
  assert.equal((await call(missingOrigin)).status, 403);
  assert.equal(
    (
      await call(
        request({
          status: "disabled",
          assignments: [assignment("class", { classId: "missing" })],
          ...confirmed(),
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    (await one(f.db, "SELECT status FROM admin_users WHERE id=?", user.id))
      .status,
    "active",
  );
  const good = await call(request({ status: "disabled", ...confirmed() }));
  assert.equal(good.status, 204);
  assert.equal(await f.auth.validateSession(user.token), null);
  const tooLarge = request({
    displayName: "x".repeat(70 * 1024),
    ...confirmed(2),
  });
  assert.equal((await call(tooLarge)).status, 413);
});

test("Phase 3B migration upgrades Phase 3A in place and preserves outstanding OAuth states", async (t) => {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  const migrations = readMigrationFiles({ migrationsFolder });
  await run(
    db,
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );
  for (const migration of migrations.slice(0, 6)) {
    await db.batch(migration.sql.map((s) => db.prepare(s)));
    await run(
      db,
      "INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)",
      migration.hash,
      migration.folderMillis,
    );
  }
  const hash = "a".repeat(64);
  await run(
    db,
    "INSERT INTO auth_oauth_states (id,state_hash,nonce_hash,code_verifier_hash,expires_at,created_at,purpose) VALUES ('old-state',?,?,?,?,?,'bootstrap')",
    hash,
    hash,
    hash,
    now + 60_000,
    now,
  );
  const before = await one(
    db,
    "SELECT * FROM auth_oauth_states WHERE id='old-state'",
  );
  await migrateLocalDatabase(db);
  const after = await one(
    db,
    "SELECT * FROM auth_oauth_states WHERE id='old-state'",
  );
  for (const key of Object.keys(before)) assert.equal(after[key], before[key]);
  assert.equal(after.admin_session_id, null);
  assert.equal(after.identity_request_id, null);
  await assert.rejects(
    run(
      db,
      "UPDATE auth_oauth_states SET purpose='login' WHERE id='old-state'",
    ),
    /INVALID_OAUTH_STATE_PURPOSE/,
  );
  assert.equal((await migrationPreflight(db)).applied, 7);
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE '__new_%'",
      )
    ).n,
    0,
  );
});

test("Phase 3B specialized roles stay within their permissions and assignment dates", async (t) => {
  const f = await fixture(t);
  for (const [name, role, permission] of [
    ["academic", "academic_admin", "academic.write"],
    ["ai", "ai_admin", "ai.manage"],
    ["archive", "archive_admin", "archive.read"],
    ["system-wide", "system_admin", "system.manage"],
  ]) {
    const user = await f.user(name, role);
    await f.authorization.assertPermission(user, permission, scope());
    await rejects(
      f.authorization.assertPermission(user, "admin.manage"),
      "PERMISSION_DENIED",
    );
    await rejects(
      f.authorization.assertPermission(user, "score.write", scope()),
      "PERMISSION_DENIED",
    );
  }
  const expired = await f.user("expired-teacher", "score_admin", [
    assignment("homeroom", { classId: "class-701", endsOn: "2026-09-24" }),
  ]);
  await rejects(
    f.authorization.assertPermission(
      expired,
      "score.write",
      scope({ classId: "class-701" }),
    ),
    "SCOPE_DENIED",
  );
  const grade = await f.user("grade-reader", "viewer", [
    assignment("grade", { grade: 7 }),
  ]);
  await f.authorization.assertPermission(
    grade,
    "score.read",
    scope({ classIds: ["class-701", "class-702"] }),
  );
  await rejects(
    f.authorization.assertPermission(grade, "score.read", scope({ grade: 8 })),
    "SCOPE_DENIED",
  );
  const noFresh = await f.auth.loginVerifiedGoogle(
    identity("grade-reader", { authTime: undefined }),
  );
  assert.ok(await f.auth.validateSession(noFresh.token));
  await rejects(
    f.authorization.assertPermission(
      noFresh,
      "score.read",
      scope({ grade: 7 }),
      true,
    ),
    "RECENT_AUTHENTICATION_REQUIRED",
  );
});
