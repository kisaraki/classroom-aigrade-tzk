import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  fictionalKeys,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { AdminWorkspaceService } from "../lib/server/admin/service.ts";
import { handleWorkspace } from "../lib/server/admin/http.ts";
import { handleAuthRequest } from "../lib/server/auth/http.ts";
const now = Date.UTC(2026, 8, 30, 4);
const identity = (name) => ({
  verified: true,
  emailVerified: true,
  subject: "fictional-" + name,
  email: name + "@example.test",
  issuer: "https://accounts.google.com",
  audience: "fictional",
  nonce: "fictional",
  issuedAt: now / 1000,
  authTime: now / 1000,
  expiresAt: now / 1000 + 600,
});
async function fixture(t) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  const keys = fictionalKeys();
  await seedFictional(db, keys);
  await db
    .prepare("UPDATE academic_state SET current_year_id='year-115' WHERE id=1")
    .run();
  const auth = new AuthService({
      db,
      now: () => now,
      bootstrapSecret: "fictional-bootstrap",
    }),
    authz = new AuthorizationService({ db, now: () => now }),
    management = new AdminManagementService({
      db,
      authorization: authz,
      now: () => now,
    });
  const owner = await auth.bootstrap({
    secret: "fictional-bootstrap",
    identity: identity("owner"),
  });
  const workspace = new AdminWorkspaceService({
    db,
    now: () => now,
    identityKeys: () => keys,
  });
  async function user(name, role, scopeType = "class", extra = {}) {
    await management.createAdmin(owner, {
      username: name,
      displayName: "虛構管理員",
      authorizedEmail: name + "@example.test",
      role,
      assignments: [
        {
          academicTermId: "term-115-1",
          scopeType,
          ...(scopeType === "school" ? {} : { classId: "class-701" }),
          startsOn: "2026-08-01",
          ...extra,
        },
      ],
      confirmed: true,
    });
    return auth.loginVerifiedGoogle(identity(name));
  }
  const call = (session, operation, input = {}, overrides = {}) =>
    handleWorkspace(
      new Request("https://fictional.test/api/admin/workspace", {
        method: "POST",
        headers: {
          Origin: "https://fictional.test",
          "Content-Type": "application/json",
          Cookie: session ? "__Host-admin_session=" + session.token : "",
        },
        body: JSON.stringify({ operation, input }),
        ...overrides,
      }),
      { auth, workspace },
    );
  return { db, auth, authz, management, owner, workspace, user, call };
}
test("Phase 14 workspace boundary requires session, same origin, JSON, bounded body and known operation", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call(null, "profile")).status, 401);
  assert.equal(
    (
      await f.call(
        f.owner,
        "profile",
        {},
        { headers: { Origin: "https://wrong.test" } },
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.call(f.owner, "profile", {}, { body: "x".repeat(65537) })).status,
    413,
  );
  assert.equal(
    (await f.call(f.owner, "profile", {}, { body: "not-json" })).status,
    400,
  );
  assert.equal(
    (await f.call(f.owner, "sql", { query: "SELECT * FROM students" })).status,
    400,
  );
  assert.equal(
    (await f.call(f.owner, "profile", { role: "super_admin" })).status,
    400,
  );
  assert.equal(
    (
      await f.call(f.owner, "context", {
        termId: "term-115-1",
        onDate: "2026-09-30",
        scope: "school",
      })
    ).status,
    400,
  );
  const profile = await f.call(f.owner, "profile");
  assert.equal(profile.status, 200);
  assert.match(profile.headers.get("Cache-Control"), /no-store/);
  const encoded = await profile.text();
  for (const key of ["token_hash", "sessionId", "google_subject_id", "secret"])
    assert.ok(!encoded.includes(key));
});

test("Phase 14 student selections require purpose permission and historical exam scope", async (t) => {
  const f = await fixture(t);
  const teacher = await f.user(
    "selectionmath",
    "score_admin",
    "teaching_subject",
    { subject: "MATH" },
  );
  const input = {
    purpose: "score",
    classId: "class-701",
    examId: "exam-1",
    subject: "MATH",
  };
  const result = await f.workspace.execute(teacher, "selection", input);
  assert.ok(result.students.some((s) => s.id === "fictional-a"));
  assert.ok(!JSON.stringify(result).includes("birth_date"));
  assert.ok(!JSON.stringify(result).includes("identity_number"));
  for (const altered of [{ subject: "CHINESE" }, { classId: "class-702" }]) {
    await assert.rejects(
      f.workspace.execute(teacher, "selection", { ...input, ...altered }),
      { code: "SCOPE_DENIED" },
    );
  }
  await assert.rejects(
    f.workspace.execute(teacher, "selection", { ...input, purpose: "archive" }),
    { code: "PERMISSION_DENIED" },
  );
  await assert.rejects(
    f.workspace.execute(teacher, "selection", { ...input, purpose: "unknown" }),
    { code: "INVALID_INPUT" },
  );
  const afterMove = await f.workspace.execute(f.owner, "selection", {
    purpose: "archive",
    termId: "term-115-1",
    classId: "class-701",
    onDate: "2026-10-01",
  });
  assert.ok(!afterMove.students.some((s) => s.id === "fictional-a"));
  const historicalExam = await f.workspace.execute(f.owner, "selection", {
    purpose: "score",
    classId: "class-701",
    examId: "exam-1",
  });
  assert.ok(historicalExam.students.some((s) => s.id === "fictional-a"));
});

test("Phase 14 Bootstrap initiation validates origin and fields before passing the secret", async () => {
  let calls = 0;
  const auth = {
    beginGoogleBootstrap: async ({ secret }) => {
      assert.equal(secret, "fictional-bootstrap");
      calls++;
      return {
        authorizationUrl:
          "https://accounts.google.com/o/oauth2/v2/auth?state=fictional",
        stateCookie: "fictional-state=one; Secure; HttpOnly",
      };
    },
  };
  const make = (body, origin = "https://fictional.test") =>
    new Request("https://fictional.test/api/auth/bootstrap/start", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  const deps = { auth, management: {} };
  assert.equal(
    (
      await handleAuthRequest(
        make({ secret: "fictional-bootstrap" }, "https://wrong.test"),
        deps,
        "bootstrap",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleAuthRequest(
        make({ secret: "fictional-bootstrap", role: "super_admin" }),
        deps,
        "bootstrap",
      )
    ).status,
    400,
  );
  const response = await handleAuthRequest(
    make({ secret: "fictional-bootstrap" }),
    deps,
    "bootstrap",
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
  assert.ok(!(await response.text()).includes("fictional-bootstrap"));
  assert.equal(calls, 1);
});
test("Phase 14 catalogs preserve teaching-subject scope and roster requires academic permission", async (t) => {
  const f = await fixture(t),
    teacher = await f.user("math", "score_admin", "teaching_subject", {
      subject: "MATH",
    });
  const result = await f.workspace.execute(teacher, "context", {
    termId: "term-115-1",
    onDate: "2026-09-30",
  });
  assert.deepEqual(
    result.classes.map((c) => c.id),
    ["class-701"],
  );
  assert.deepEqual(result.classes[0].subjects, ["MATH"]);
  assert.ok(!result.classes[0].capabilities.includes("score.read"));
  assert.ok(result.exams.length);
  await assert.rejects(
    f.workspace.execute(teacher, "roster", {
      termId: "term-115-1",
      classId: "class-701",
      onDate: "2026-09-30",
    }),
    { code: "PERMISSION_DENIED" },
  );
  await assert.rejects(
    f.workspace.execute(teacher, "rankings", {
      examId: "exam-1",
      classId: "class-701",
      mode: "FINAL",
    }),
    { code: "SCOPE_DENIED" },
  );
});
test("Phase 14 roster respects dates, term and class IDOR without identity ciphertext", async (t) => {
  const f = await fixture(t),
    staff = await f.user("academic", "academic_admin");
  const result = await f.workspace.execute(staff, "roster", {
    termId: "term-115-1",
    classId: "class-701",
    onDate: "2026-09-30",
  });
  assert.ok(result.students.some((s) => s.id === "fictional-a"));
  assert.ok(!JSON.stringify(result).includes("identity_number"));
  const later = await f.workspace.execute(staff, "roster", {
    termId: "term-115-1",
    classId: "class-701",
    onDate: "2026-10-01",
  });
  assert.ok(!later.students.some((s) => s.id === "fictional-a"));
  for (const input of [
    { termId: "term-115-1", classId: "class-702", onDate: "2026-09-30" },
    { termId: "term-115-2", classId: "class-701", onDate: "2027-02-01" },
  ])
    await assert.rejects(f.workspace.execute(staff, "roster", input), {
      code: "SCOPE_DENIED",
    });
  await assert.rejects(
    f.workspace.execute(staff, "user-details", { id: f.owner.adminId }),
    { code: "PERMISSION_DENIED" },
  );
});
test("Phase 14 academic preview uses domain scopes, masks identity, confirms atomically and replays for class staff", async (t) => {
  const f = await fixture(t),
    staff = await f.user("academic", "academic_admin");
  const input = {
    termId: "term-115-1",
    mode: "new",
    rows: [
      {
        name: "虛構新增學生",
        birthDate: "2013-01-02",
        studentNumber: "FICTIONAL-NEW-14",
        identityNumber: "fictional-phase14-identity",
        classId: "class-701",
        seatNumber: 14,
        effectiveFrom: "2026-09-30",
      },
    ],
  };
  const preview = await f.workspace.execute(staff, "students-preview", input);
  assert.ok(
    !JSON.stringify(preview)
      .toLowerCase()
      .includes(input.rows[0].identityNumber),
  );
  const receipt = await f.workspace.execute(staff, "academic-confirm", {
    previewId: preview.id,
    confirmed: true,
  });
  assert.equal(receipt.studentIds.length, 1);
  const again = await f.workspace.execute(staff, "academic-confirm", {
    previewId: preview.id,
    confirmed: true,
  });
  assert.equal(again.replayed, true);
  await assert.rejects(
    f.workspace.execute(staff, "students-preview", {
      ...input,
      rows: [
        {
          ...input.rows[0],
          studentNumber: "FICTIONAL-OTHER-14",
          identityNumber: "fictional-phase14-other",
          classId: "class-702",
        },
      ],
    }),
    { code: "SCOPE_DENIED" },
  );
});
test("Phase 16 academic scope uses the operation date instead of a copied future segment end", async (t) => {
  const f = await fixture(t);
  await f.db
    .prepare(
      "UPDATE student_enrollments SET effective_to='2026-12-01' WHERE id='enroll-b'",
    )
    .run();
  const future = await f.user("future-staff", "academic_admin", "class", {
    startsOn: "2026-12-01",
  });
  const input = {
    enrollmentId: "enroll-b",
    targetClassId: "class-701",
    seatNumber: 14,
    effectiveFrom: "2026-09-30",
  };
  await assert.rejects(f.workspace.execute(future, "move-preview", input), {
    code: "SCOPE_DENIED",
  });
  const current = await f.user("dated-staff", "academic_admin", "class", {
    startsOn: "2026-09-30",
    endsOn: "2026-10-01",
  });
  const preview = await f.workspace.execute(current, "move-preview", input);
  const stored = await f.db
    .prepare("SELECT resources_json FROM academic_previews WHERE id=?")
    .bind(preview.id)
    .first();
  assert.deepEqual(JSON.parse(stored.resources_json).scopeContexts, [
    { termId: "term-115-1", classId: "class-701", onDate: "2026-09-30" },
  ]);
  const receipt = await f.workspace.execute(current, "academic-confirm", {
    previewId: preview.id,
    confirmed: true,
  });
  assert.equal(receipt.replayed, false);
  assert.equal(
    (
      await f.workspace.execute(current, "academic-confirm", {
        previewId: preview.id,
        confirmed: true,
      })
    ).replayed,
    true,
  );
});

test("Phase 14 preview confirmation rejects revoked authority and other actor without partial write", async (t) => {
  const f = await fixture(t),
    staff = await f.user("academic", "academic_admin", "school");
  const preview = await f.workspace.execute(staff, "classes-preview", {
    yearId: "year-115",
    codes: ["703"],
  });
  await assert.rejects(
    f.workspace.execute(f.owner, "academic-confirm", {
      previewId: preview.id,
      confirmed: true,
    }),
    { code: "ACCESS_DENIED" },
  );
  await f.management.revokeSessions(f.owner, staff.adminId, {
    expectedVersion: 1,
    confirmed: true,
  });
  await assert.rejects(
    f.workspace.execute(staff, "academic-confirm", {
      previewId: preview.id,
      confirmed: true,
    }),
    { code: "ACCESS_DENIED" },
  );
  assert.equal(
    await f.db.prepare("SELECT id FROM classes WHERE code='703'").first(),
    null,
  );
});
test("Phase 14 year creation and confirmation do not silently bypass explicit confirmation", async (t) => {
  const f = await fixture(t);
  const preview = await f.workspace.execute(f.owner, "year-preview", {
    code: "116",
    startsOn: "2027-08-01",
    secondTermStartsOn: "2028-02-01",
    endsOn: "2028-08-01",
  });
  await assert.rejects(
    f.workspace.execute(f.owner, "academic-confirm", {
      previewId: preview.id,
      confirmed: false,
    }),
    { code: "CONFIRMATION_REQUIRED" },
  );
  assert.equal(
    await f.db
      .prepare("SELECT id FROM academic_years WHERE code='116'")
      .first(),
    null,
  );
  const receipt = await f.workspace.execute(f.owner, "academic-confirm", {
    previewId: preview.id,
    confirmed: true,
  });
  assert.equal(receipt.yearIds.length, 1);
});
test("Phase 14 response rechecks session revocation before returning private data", async (t) => {
  const f = await fixture(t);
  const response = await handleWorkspace(
    new Request("https://fictional.test/api/admin/workspace", {
      method: "POST",
      headers: {
        Origin: "https://fictional.test",
        "Content-Type": "application/json",
        Cookie: "__Host-admin_session=" + f.owner.token,
      },
      body: JSON.stringify({ operation: "profile", input: {} }),
    }),
    {
      auth: f.auth,
      workspace: {
        execute: async () => {
          await f.db
            .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
            .bind(now, f.owner.sessionId)
            .run();
          return { private: "must-not-escape" };
        },
      },
    },
  );
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes("must-not-escape"));
});
test("Phase 14 Google browser initiation returns JSON only on explicit Accept and preserves state cookie", async () => {
  let calls = 0;
  const auth = {
    beginGoogleReauthentication: async () => {
      calls++;
      return {
        authorizationUrl:
          "https://accounts.google.com/o/oauth2/v2/auth?state=fictional",
        stateCookie: "fictional-state=one; Secure; HttpOnly",
      };
    },
  };
  const make = (accept, origin = "https://fictional.test") =>
    new Request("https://fictional.test/api/auth/reauth/start", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Accept: accept,
      },
      body: "{}",
    });
  const json = await handleAuthRequest(
    make("application/json"),
    { auth, management: {} },
    "reauth",
  );
  assert.equal(json.status, 200);
  assert.match(json.headers.get("Set-Cookie"), /HttpOnly/);
  assert.match(
    (await json.json()).authorizationUrl,
    /^https:\/\/accounts.google.com/,
  );
  const redirect = await handleAuthRequest(
    make("text/html"),
    { auth, management: {} },
    "reauth",
  );
  assert.equal(redirect.status, 302);
  assert.equal(
    (
      await handleAuthRequest(
        make("application/json", "https://wrong.test"),
        { auth, management: {} },
        "reauth",
      )
    ).status,
    403,
  );
  assert.equal(calls, 2);
});

test("Phase 14 Audit: only active super_admin has the dedicated permission, forged role and foreign scope cannot grant it", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call(null, "audit")).status, 401);
  const ownerView = await f.call(f.owner, "audit");
  assert.equal(ownerView.status, 200);
  assert.equal(ownerView.headers.get("Cache-Control"), "no-store, private");
  assert.ok((await ownerView.json()).rows.length > 0);
  assert.ok(f.authz.rolePermissions("super_admin").includes("audit.read"));
  for (const role of [
    "system_admin",
    "academic_admin",
    "score_admin",
    "ai_admin",
    "archive_admin",
    "viewer",
  ]) {
    const staff = await f.user("audit-" + role, role, "school");
    assert.ok(!f.authz.rolePermissions(role).includes("audit.read"));
    await assert.rejects(
      f.workspace.execute({ ...staff, role: "super_admin" }, "audit", {}),
      { code: "PERMISSION_DENIED" },
    );
    assert.equal((await f.call(staff, "audit")).status, 403);
  }
  assert.equal(
    (await f.call(f.owner, "audit", { role: "super_admin" })).status,
    400,
  );
  assert.equal(
    (await f.call(f.owner, "audit", { classId: "class-702" })).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        f.owner,
        "audit",
        {},
        {
          headers: {
            Origin: "https://foreign.test",
            "Content-Type": "application/json",
            Cookie: "__Host-admin_session=" + f.owner.token,
          },
        },
      )
    ).status,
    403,
  );
});

test("Phase 14 Audit: safe projection, expired/future exclusion and stable pagination do not expose metadata or student identifiers", async (t) => {
  const f = await fixture(t);
  const forbidden = [
    "fictional-session-token-hidden",
    "fictional-cookie-hidden",
    "fictional-oauth-code-hidden",
    "fictional-student-identifier-hidden",
    "fictional-email-hidden@example.test",
  ];
  for (let n = 0; n < 65; n++)
    await f.db
      .prepare(
        "INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        f.owner.adminId,
        "SCORE_UPDATE",
        "student",
        forbidden[3],
        forbidden[2],
        "success",
        JSON.stringify({
          secret: forbidden[0],
          cookie: forbidden[1],
          email: forbidden[4],
        }),
        now - 1000 - Math.floor(n / 2),
        "2026-11-30",
      )
      .run();
  for (const [id, created, until] of [
    ["fictional-expired", now - 1, "2026-09-30"],
    ["fictional-future", now + 1, "2026-11-30"],
  ])
    await f.db
      .prepare(
        "INSERT INTO audit_logs (id,action,entity_type,operation_id,outcome,created_at,retention_until) VALUES (?,'LOGIN','admin_auth',?,'success',?,?)",
      )
      .bind(id, id, created, until)
      .run();
  const expected = (
    await f.db
      .prepare(
        "SELECT id FROM audit_logs WHERE retention_until>'2026-09-30' AND created_at<=? ORDER BY created_at DESC,id DESC",
      )
      .bind(now)
      .all()
  ).results.map((r) => r.id);
  const first = await f.workspace.execute(f.owner, "audit", {});
  assert.equal(first.rows.length, 50);
  assert.ok(first.nextCursor);
  const second = await f.workspace.execute(f.owner, "audit", {
    cursor: first.nextCursor,
  });
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    [...first.rows, ...second.rows].map((r) => r.id),
    expected,
  );
  for (const row of [...first.rows, ...second.rows])
    assert.deepEqual(
      Object.keys(row).sort(),
      ["id", "createdAt", "actor", "action", "entityType", "outcome"].sort(),
    );
  const body = JSON.stringify([first, second]);
  for (const value of forbidden) assert.ok(!body.includes(value));
  for (const field of [
    "metadata_json",
    "entity_id",
    "operation_id",
    "actor_id",
    "authorized_email",
  ])
    assert.ok(!body.includes(field));
  assert.ok(first.rows.some((r) => r.actor === "admin"));
  for (const cursor of [
    "invalid",
    [],
    { createdAt: -1, id: "valid" },
    { createdAt: now + 1, id: "valid" },
    { createdAt: now, id: "' OR 1=1" },
    { createdAt: now, id: "valid", role: "super_admin" },
  ])
    assert.equal((await f.call(f.owner, "audit", { cursor })).status, 400);
});

test("Phase 14 Audit: suspension, role reduction and session revocation reject subsequent reads", async (t) => {
  const f = await fixture(t);
  for (const mutation of ["status='disabled'", "role='viewer'"]) {
    const staff = await f.user(
      "audit-super-" + mutation.split("=")[0],
      "super_admin",
      "school",
    );
    assert.equal((await f.call(staff, "audit")).status, 200);
    await f.db
      .prepare(`UPDATE admin_users SET ${mutation} WHERE id=?`)
      .bind(staff.adminId)
      .run();
    const response = await f.call(staff, "audit");
    assert.ok([401, 403].includes(response.status));
    assert.ok(!Object.hasOwn(await response.json(), "rows"));
  }
  await f.db
    .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
    .bind(now, f.owner.sessionId)
    .run();
  assert.equal((await f.call(f.owner, "audit")).status, 401);
});

test("Phase 14 Audit: revocation after the query is caught before returning any record", async (t) => {
  const f = await fixture(t);
  let queried = false;
  const db = {
    prepare(sql) {
      const statement = f.db.prepare(sql);
      if (!sql.includes("FROM audit_logs l")) return statement;
      return {
        bind(...args) {
          const bound = statement.bind(...args);
          return {
            async all() {
              const result = await bound.all();
              queried = true;
              await f.db
                .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
                .bind(now, f.owner.sessionId)
                .run();
              return result;
            },
          };
        },
      };
    },
  };
  const workspace = new AdminWorkspaceService({ db, now: () => now });
  const response = await handleWorkspace(
    new Request("https://fictional.test/api/admin/workspace", {
      method: "POST",
      headers: {
        Origin: "https://fictional.test",
        "Content-Type": "application/json",
        Cookie: "__Host-admin_session=" + f.owner.token,
      },
      body: JSON.stringify({ operation: "audit", input: {} }),
    }),
    { auth: f.auth, workspace },
  );
  assert.equal(queried, true);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "ACCESS_DENIED" });
});

test("Phase 14 Audit table renders escaped text and accessible columns without exposing hidden fields", async () => {
  const { build } = await import("esbuild");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const output = resolve(".wrangler/phase14-audit-render.mjs");
  await mkdir(".wrangler", { recursive: true });
  const bundle = await build({
    entryPoints: ["app/admin/audit.tsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
    jsx: "automatic",
  });
  await writeFile(output, bundle.outputFiles[0].contents);
  const { AuditTable, default: Audit } = await import(
    pathToFileURL(output).href
  );
  const React = await import("react"),
    { renderToStaticMarkup } = await import("react-dom/server");
  const html = renderToStaticMarkup(
    React.createElement(AuditTable, {
      rows: [
        {
          id: "fictional-audit",
          createdAt: now,
          actor: "<script>fictional()</script>",
          action: "LOGIN",
          entityType: "admin_auth",
          outcome: "success",
          metadata_json: "fictional-hidden-metadata",
        },
      ],
    }),
  );
  assert.match(html, /scope="col"/);
  assert.match(html, /時間（臺北）/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes("<script>fictional"));
  assert.ok(!html.includes("fictional-hidden-metadata"));
  assert.match(html, /成功/);
  const denied = renderToStaticMarkup(
    React.createElement(Audit, { profile: { permissions: [] } }),
  );
  assert.match(denied, /沒有稽核查看權限/);
  assert.ok(!denied.includes("讀取最新紀錄"));
});

test("Phase 14 Audit: crossing Taipei retention midnight during a read refuses the old page", async (t) => {
  const f = await fixture(t);
  let time = Date.UTC(2026, 8, 30, 15, 59, 59);
  const auth = new AuthService({ db: f.db, now: () => time });
  const owner = await auth.loginVerifiedGoogle({
    ...identity("owner"),
    issuedAt: time / 1000,
    authTime: time / 1000,
    expiresAt: time / 1000 + 3600,
  });
  let queried = false;
  const db = {
    prepare(sql) {
      const statement = f.db.prepare(sql);
      if (!sql.includes("FROM audit_logs l")) return statement;
      return {
        bind(...args) {
          const bound = statement.bind(...args);
          return {
            async all() {
              const result = await bound.all();
              queried = true;
              time += 1000;
              return result;
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    new AdminWorkspaceService({ db, now: () => time }).execute(
      owner,
      "audit",
      {},
    ),
    { code: "AUDIT_SOURCE_CHANGED" },
  );
  assert.equal(queried, true);
});
