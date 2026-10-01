import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { applySecurityHeaders } from "../lib/http-security.ts";
import {
  parseCookieHeader,
  SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
} from "../lib/server/auth/cookies.ts";
import { handleAuthRequest } from "../lib/server/auth/http.ts";
import { handleExamRequest } from "../lib/server/exams/http.ts";
import { handleImportRequest } from "../lib/server/imports/http.ts";
import { handleArchiveRequest } from "../lib/server/archive/http.ts";
import { handlePublicationRequest } from "../lib/server/exams/publication-http.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AcademicService } from "../lib/server/academic/service.ts";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  migrationPreflight,
  migrationsFolder,
  fictionalKeys,
} from "../scripts/db-local.mjs";
import { seedFictional } from "../db/seed-fictional.ts";

const now = Date.UTC(2026, 9, 1);
const sql = (db, statement, ...values) => db.prepare(statement).bind(...values);

test("Phase 16 security cookies reject ambiguous credentials and prototype names are inert", () => {
  for (const name of [SESSION_COOKIE, OAUTH_STATE_COOKIE]) {
    for (const second of ["other", "same"]) {
      const cookies = parseCookieHeader(
        `${name}=same; ${name}=${second}; ${name}=third`,
      );
      assert.equal(cookies[name], "");
    }
  }
  const cookies = parseCookieHeader(
    "__proto__=inert; constructor=value; toString=text; ordinary=first; ordinary=second",
  );
  assert.equal(Object.getPrototypeOf(cookies), null);
  assert.equal(cookies.__proto__, "inert");
  assert.equal(cookies.ordinary, "first");
  assert.equal(parseCookieHeader(null)[SESSION_COOKIE], undefined);
});

test("Phase 16 HTTP method confusion is rejected before authentication or business dispatch", async () => {
  for (const [handler, operation, method] of [
    [handleAuthRequest, "create", "GET"],
    [handleAuthRequest, "update", "POST"],
    [handleAuthRequest, "list", "POST"],
    [handleExamRequest, "subject", "POST"],
    [handleExamRequest, "read", "POST"],
    [handleImportRequest, "commit", "GET"],
    [handleImportRequest, "errors", "POST"],
    [handleArchiveRequest, "confirm", "GET"],
    [handlePublicationRequest, "confirm", "GET"],
  ]) {
    const response = await handler(
      new Request("https://school.example.test/api/admin/test", { method }),
      {},
      operation,
      "fictional-id",
    );
    assert.equal(response.status, 405, `${operation}/${method}`);
    assert.equal((await response.json()).error, "METHOD_NOT_ALLOWED");
  }
});

test("Phase 16 malformed UTF-8 is rejected before Bootstrap secret handling", async () => {
  const prefix = new TextEncoder().encode('{"secret":"');
  const suffix = new TextEncoder().encode('"}');
  const body = new Uint8Array([...prefix, 0xc3, ...suffix]);
  const response = await handleAuthRequest(
    new Request("https://school.example.test/api/auth/bootstrap/start", {
      method: "POST",
      headers: {
        Origin: "https://school.example.test",
        "Content-Type": "application/json",
      },
      body,
    }),
    {},
    "bootstrap",
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "INVALID_JSON" });
});

test("Phase 16 security response policy prevents caching, framing and referrer leaks without rewriting cookies", () => {
  for (const path of [
    "/admin",
    "/admin/reports",
    "/api/auth/google/callback?code=fictional",
    "/api/public/lookup",
    "/api/admin/missing",
  ]) {
    const headers = new Headers({
      "Set-Cookie": "fictional-cookie=value; HttpOnly; Secure",
    });
    applySecurityHeaders(headers, new URL(path, "https://school.example.test"));
    assert.match(headers.get("Cache-Control"), /no-store/);
    assert.equal(headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(headers.get("X-Frame-Options"), "DENY");
    assert.match(
      headers.get("Content-Security-Policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal(headers.get("Strict-Transport-Security"), "max-age=31536000");
    assert.equal(
      headers.get("Set-Cookie"),
      "fictional-cookie=value; HttpOnly; Secure",
    );
  }
  const headers = new Headers();
  applySecurityHeaders(headers, new URL("http://localhost:5173/"));
  assert.equal(headers.get("Strict-Transport-Security"), null);
  assert.equal(headers.get("Cache-Control"), null);
});

async function fixture(t, beforeSecurity = false) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  if (beforeSecurity) {
    await db
      .prepare(
        "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY,hash text NOT NULL,created_at numeric)",
      )
      .run();
    for (const migration of readMigrationFiles({ migrationsFolder }).slice(
      0,
      14,
    )) {
      await db.batch([
        ...migration.sql.map((s) => db.prepare(s)),
        sql(
          db,
          "INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)",
          migration.hash,
          migration.folderMillis,
        ),
      ]);
    }
  } else await migrateLocalDatabase(db);
  await seedFictional(db, fictionalKeys());
  await sql(
    db,
    "INSERT INTO admin_users(id,username,display_name,authorized_email,google_subject_id,role,status,identity_bound_at) VALUES ('security-owner','security-owner','虛構管理員','security@example.test','fictional-security-subject','super_admin','active',?)",
    now,
  ).run();
  await sql(
    db,
    "INSERT INTO admin_sessions(id,admin_user_id,token_hash,auth_version,authenticated_at,recent_auth_at,last_seen_at,expires_at) VALUES ('security-session','security-owner',?,1,?,?,?,?)",
    "a".repeat(64),
    now - 3600000,
    now,
    now,
    now + 86400000,
  ).run();
  return db;
}

test("Phase 16 migration preserves existing data and rejects stale Google/idle credentials atomically", async (t) => {
  const db = await fixture(t, true);
  const before = (await db.prepare("SELECT * FROM students ORDER BY id").all())
    .results;
  assert.equal((await migrationPreflight(db)).pending, 3);
  const migrated = await migrateLocalDatabase(db);
  assert.equal(migrated.applied, 17);
  assert.equal((await migrationPreflight(db)).pending, 0);
  assert.notEqual(
    (
      await db
        .prepare(
          "SELECT revoked_at FROM admin_sessions WHERE id='security-session'",
        )
        .first()
    ).revoked_at,
    null,
  );
  // Isolated post-upgrade authorization fixture: preserve the revoked legacy
  // row and issue a distinct session at the current account version.
  await sql(
    db,
    "INSERT INTO admin_sessions(id,admin_user_id,token_hash,auth_version,authenticated_at,recent_auth_at,last_seen_at,expires_at) SELECT 'security-current',id,?,auth_version,?,?,?,? FROM admin_users WHERE id='security-owner'",
    "b".repeat(64),
    now - 3600000,
    now,
    now,
    now + 86400000,
  ).run();
  assert.deepEqual(
    (await db.prepare("SELECT * FROM students ORDER BY id").all()).results,
    before,
  );
  const revision = (
    await db.prepare("SELECT revision FROM academic_state WHERE id=1").first()
  ).revision;
  const attempt = async (id, historical) => {
    await sql(
      db,
      "INSERT INTO academic_previews(id,actor_id,kind,base_revision,payload_json,resources_json,history_reason,created_at) VALUES (?,'security-owner','CREATE_CLASSES',?,'{\"test\":true}',?,?,?)",
      id,
      revision + 1,
      JSON.stringify({ historicalYearIds: historical ? ["year-115"] : [] }),
      historical ? "虛構歷史維護" : null,
      now,
    ).run();
    return db.batch([
      sql(
        db,
        "UPDATE students SET name='不得保留的虛構變更' WHERE id='fictional-a'",
      ),
      sql(
        db,
        "INSERT INTO academic_operations(id,preview_id,actor_id,auth_session_id,kind,before_revision,changes_json,result_json,created_at) VALUES (?,?,'security-owner','security-current','CREATE_CLASSES',?,'[]','{}',?)",
        id,
        id,
        revision + 1,
        now,
      ),
    ]);
  };
  for (const [id, seen, recent, historical] of [
    ["idle-exact", now - 1800000, now, false],
    ["idle-future", now + 1, now, false],
    ["recent-exact", now, now - 300000, true],
    ["recent-future", now, now + 1, true],
    ["recent-zero", now, 0, true],
  ]) {
    await sql(
      db,
      "UPDATE admin_sessions SET last_seen_at=?,recent_auth_at=? WHERE id='security-current'",
      seen,
      recent,
    ).run();
    await assert.rejects(attempt(id, historical));
    assert.deepEqual(
      (await db.prepare("SELECT * FROM students ORDER BY id").all()).results,
      before,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) AS n FROM academic_operations")
          .first()
      ).n,
      0,
    );
  }
  await sql(
    db,
    "UPDATE admin_sessions SET last_seen_at=?,recent_auth_at=? WHERE id='security-current'",
    now - 1799999,
    now - 299999,
  ).run();
  await attempt("valid-boundaries", true);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM academic_operations").first())
      .n,
    1,
  );
});

test("Phase 16 internal academic adapter cannot replace recent Google evidence with a boolean", async (t) => {
  const db = await fixture(t);
  await sql(
    db,
    "UPDATE academic_state SET current_year_id=NULL WHERE id=1",
  ).run();
  await sql(
    db,
    "UPDATE admin_sessions SET recent_auth_at=0 WHERE id='security-session'",
  ).run();
  const service = new AcademicService({
    db,
    now: () => now,
    authorize: async () => ({
      adminId: "security-owner",
      sessionId: "security-session",
      recentGoogleAuthentication: true,
    }),
  });
  await assert.rejects(
    service.previewClasses("year-115", ["703"], {
      historyReason: "虛構歷史維護",
    }),
    (e) => e.code === "HISTORICAL_YEAR_LOCKED",
  );
  await sql(
    db,
    "UPDATE admin_sessions SET last_seen_at=? WHERE id='security-session'",
    now - 1800000,
  ).run();
  await assert.rejects(
    service.previewClasses("year-115", ["703"], {
      historyReason: "虛構歷史維護",
    }),
    (e) => e.code === "ACCESS_DENIED",
  );
});

test("Phase 16 session revocation between lookup and touch cannot return a valid principal", async () => {
  const row = {
    id: "fictional-session",
    admin_user_id: "fictional-admin",
    role: "super_admin",
    status: "active",
    auth_version: 1,
    session_auth_version: 1,
    authenticated_at: now,
    recent_auth_at: now,
    last_seen_at: now,
    expires_at: now + 60000,
    revoked_at: null,
  };
  let updates = 0;
  const db = {
    prepare(query) {
      return {
        bind() {
          return {
            first: async () => row,
            run: async () => {
              updates++;
              assert.match(query, /a.auth_version=admin_sessions.auth_version/);
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
  const auth = new AuthService({ db, oidc: {}, now: () => now });
  assert.equal(await auth.validateSession("a".repeat(43)), null);
  assert.equal(updates, 1);
});

test("Phase 16 recent Google verification cannot revive a session that expires during its transaction", async (t) => {
  const db = await fixture(t);
  await sql(
    db,
    "UPDATE admin_sessions SET recent_auth_at=0 WHERE id='security-session'",
  ).run();
  const auth = new AuthService({
    now: () => now,
    db: {
      prepare: (statement) => db.prepare(statement),
      batch: async (statements) => {
        await sql(
          db,
          "UPDATE admin_sessions SET last_seen_at=? WHERE id='security-session'",
          now - 1800000,
        ).run();
        return db.batch(statements);
      },
    },
  });
  await assert.rejects(
    auth.reauthenticateGoogle({
      sessionId: "security-session",
      identity: {
        verified: true,
        emailVerified: true,
        subject: "fictional-security-subject",
        email: "security@example.test",
        issuer: "https://accounts.google.com",
        audience: "fictional",
        nonce: "fictional",
        issuedAt: now / 1000,
        authTime: now / 1000,
        expiresAt: now / 1000 + 60,
      },
    }),
  );
  const session = await db
    .prepare(
      "SELECT recent_auth_at,last_seen_at FROM admin_sessions WHERE id='security-session'",
    )
    .first();
  assert.equal(session.recent_auth_at, 0);
  assert.equal(session.last_seen_at, now - 1800000);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM audit_logs WHERE action='ADMIN_REAUTHENTICATED'",
        )
        .first()
    ).n,
    0,
  );
});
