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
