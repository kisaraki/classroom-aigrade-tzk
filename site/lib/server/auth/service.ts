import { addCalendarMonths, taipeiBusinessDate } from "../../domain/dates.ts";
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  oauthStateCookie,
  parseCookieHeader,
  OAUTH_STATE_COOKIE,
  sessionCookie,
} from "./cookies.ts";
import {
  base64UrlDecode,
  GoogleOidcClient,
  randomBase64Url,
  sha256Hex,
} from "./google-oidc.ts";
import {
  AuthError,
  type AuthResult,
  type AuthSession,
  type GoogleIdentity,
  type OAuthStart,
} from "./types.ts";

const STATE_TTL_MS = 10 * 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60_000;

type AdminRow = {
  id: string;
  username: string;
  display_name: string;
  authorized_email: string;
  google_subject_id: string | null;
  role: string;
  status: string;
  auth_version: number;
};

export type AuthDependencies = {
  db: D1Database;
  oidc: GoogleOidcClient;
  bootstrapSecret: string;
  now?: () => number;
  idleTimeoutMs?: number;
  absoluteTimeoutMs?: number;
  idFactory?: (prefix: string) => string;
};

function normalizeEmail(value: string): string {
  const result = value.trim().normalize("NFC").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result) || result.length > 320)
    throw new AuthError("INVALID_AUTHORIZED_EMAIL", 400);
  return result;
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  for (
    let index = 0;
    index < Math.max(leftBytes.length, rightBytes.length);
    index++
  )
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

function sessionCookieMaxAge(absoluteTimeoutMs: number): number {
  return Math.max(1, Math.ceil(absoluteTimeoutMs / 1000));
}

export class AuthService {
  private readonly db: D1Database;
  private readonly oidc: GoogleOidcClient;
  private readonly bootstrapSecret: string;
  private readonly now: () => number;
  private readonly idleTimeoutMs: number;
  private readonly absoluteTimeoutMs: number;
  private readonly idFactory: (prefix: string) => string;

  constructor(dependencies: AuthDependencies) {
    this.db = dependencies.db;
    this.oidc = dependencies.oidc;
    this.bootstrapSecret = dependencies.bootstrapSecret;
    this.now = dependencies.now ?? (() => Date.now());
    this.idleTimeoutMs = dependencies.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.absoluteTimeoutMs =
      dependencies.absoluteTimeoutMs ?? DEFAULT_ABSOLUTE_TIMEOUT_MS;
    this.idFactory =
      dependencies.idFactory ??
      ((prefix) => `${prefix}-${randomBase64Url(18)}`);
    if (
      !Number.isSafeInteger(this.idleTimeoutMs) ||
      this.idleTimeoutMs <= 0 ||
      !Number.isSafeInteger(this.absoluteTimeoutMs) ||
      this.absoluteTimeoutMs <= this.idleTimeoutMs
    )
      throw new AuthError("INVALID_SESSION_POLICY", 500);
  }

  async beginGoogleLogin(
    purpose: "login" | "bootstrap" = "login",
  ): Promise<OAuthStart> {
    const now = this.now();
    const state = randomBase64Url();
    const nonce = randomBase64Url();
    const codeVerifier = randomBase64Url(48);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const [stateHash, nonceHash, codeVerifierHash] = await Promise.all([
      sha256Hex(state),
      sha256Hex(nonce),
      sha256Hex(codeVerifier),
    ]);
    const stateId = this.idFactory("oauth-state");
    await this.db
      .prepare(
        "INSERT INTO auth_oauth_states (id, state_hash, purpose, nonce_hash, code_verifier_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        stateId,
        stateHash,
        purpose,
        nonceHash,
        codeVerifierHash,
        now + STATE_TTL_MS,
        now,
      )
      .run();
    const authorizationUrl = await this.oidc.authorizationUrl({
      state,
      nonce,
      codeChallenge,
    });
    const cookieValue = encodeOAuthCookie({
      state,
      nonce,
      codeVerifier,
      purpose,
      issuedAt: now,
    });
    return {
      authorizationUrl,
      stateCookie: oauthStateCookie(cookieValue, STATE_TTL_MS / 1000),
    };
  }

  async beginGoogleBootstrap(input: { secret: string }): Promise<OAuthStart> {
    if (!equalSecret(input.secret, this.bootstrapSecret))
      throw new AuthError("BOOTSTRAP_SECRET_INVALID");
    return this.beginGoogleLogin("bootstrap");
  }

  async completeGoogleLogin(input: {
    code: string;
    state: string;
    cookieHeader: string | null;
  }): Promise<AuthResult> {
    const state = await this.consumeOAuthState(input.state, input.cookieHeader);
    const idToken = await this.oidc.exchangeCode(
      input.code,
      state.codeVerifier,
    );
    const identity = await this.oidc.verifyIdToken(idToken, state.nonce);
    return state.purpose === "bootstrap"
      ? this.bootstrap({ secret: this.bootstrapSecret, identity })
      : this.loginVerifiedGoogle(identity);
  }

  async bootstrap(input: {
    secret: string;
    identity: GoogleIdentity;
  }): Promise<AuthResult> {
    this.assertVerifiedIdentity(input.identity);
    if (!equalSecret(input.secret, this.bootstrapSecret))
      throw new AuthError("BOOTSTRAP_SECRET_INVALID");
    const alreadyInitialized = await this.db
      .prepare(
        "SELECT (SELECT count(*) FROM admin_users) AS admins, (SELECT count(*) FROM bootstrap_state) AS bootstrap",
      )
      .first<{ admins: number; bootstrap: number }>();
    if (
      !alreadyInitialized ||
      Number(alreadyInitialized.admins) !== 0 ||
      Number(alreadyInitialized.bootstrap) !== 0
    )
      throw new AuthError("BOOTSTRAP_CLOSED", 409);
    const now = this.now();
    const email = normalizeEmail(input.identity.email);
    const adminId = this.idFactory("admin");
    const session = await this.newSession(adminId, 1, "super_admin", now);
    const operationId = this.idFactory("auth-operation");
    try {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO admin_users (id, username, display_name, authorized_email, google_subject_id, role, status, identity_bound_at, last_login_at, created_at, updated_at) VALUES (?, 'admin', ?, ?, ?, 'super_admin', 'active', ?, ?, ?, ?)",
          )
          .bind(
            adminId,
            input.identity.name?.trim() || email,
            email,
            input.identity.subject,
            now,
            now,
            now,
            now,
          ),
        this.db
          .prepare(
            "INSERT INTO bootstrap_state (id, initialized_by, initialized_at) VALUES (1, ?, ?)",
          )
          .bind(adminId, now),
        this.db
          .prepare(
            "INSERT INTO admin_sessions (id, admin_user_id, token_hash, auth_version, authenticated_at, last_seen_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            session.sessionId,
            adminId,
            session.tokenHash,
            1,
            now,
            now,
            session.expiresAt,
            now,
          ),
        this.audit(operationId, adminId, "ADMIN_BOOTSTRAP", adminId, now),
      ]);
    } catch {
      throw new AuthError("BOOTSTRAP_CONFLICT", 409);
    }
    return { ...session.result, token: session.token, isFirstBinding: true };
  }

  async loginVerifiedGoogle(identity: GoogleIdentity): Promise<AuthResult> {
    this.assertVerifiedIdentity(identity);
    const email = normalizeEmail(identity.email);
    const rows = (
      await this.db
        .prepare(
          "SELECT id, username, display_name, authorized_email, google_subject_id, role, status, auth_version FROM admin_users WHERE lower(authorized_email) = lower(?)",
        )
        .bind(email)
        .all<AdminRow>()
    ).results;
    if (rows.length === 0) throw new AuthError("AUTHORIZED_EMAIL_REQUIRED");
    if (rows.length !== 1)
      throw new AuthError("AUTHORIZED_EMAIL_AMBIGUOUS", 409);
    const admin = rows[0];
    if (
      admin.status !== "active" &&
      admin.status !== "pending_identity_binding"
    )
      throw new AuthError("ADMIN_STATUS_NOT_ALLOWED");
    let firstBinding = false;
    if (admin.status === "pending_identity_binding") {
      if (admin.google_subject_id !== null)
        throw new AuthError("IDENTITY_REBIND_REQUIRED");
      firstBinding = true;
    } else if (admin.google_subject_id !== identity.subject) {
      throw new AuthError("GOOGLE_SUBJECT_MISMATCH");
    }
    const now = this.now();
    const session = await this.newSession(
      admin.id,
      Number(admin.auth_version),
      admin.role,
      now,
    );
    const operationId = this.idFactory("auth-operation");
    const statements: D1PreparedStatement[] = [];
    if (firstBinding)
      statements.push(
        this.db
          .prepare(
            "UPDATE admin_users SET google_subject_id = ?, identity_bound_at = ?, status = 'active', last_login_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_identity_binding' AND google_subject_id IS NULL",
          )
          .bind(identity.subject, now, now, now, admin.id),
      );
    else
      statements.push(
        this.db
          .prepare(
            "UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ? AND status = 'active' AND google_subject_id = ?",
          )
          .bind(now, now, admin.id, identity.subject),
      );
    statements.push(
      this.db
        .prepare(
          "INSERT INTO admin_sessions (id, admin_user_id, token_hash, auth_version, authenticated_at, last_seen_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          session.sessionId,
          admin.id,
          session.tokenHash,
          admin.auth_version,
          now,
          now,
          session.expiresAt,
          now,
        ),
      this.audit(operationId, admin.id, "ADMIN_LOGIN", admin.id, now),
    );
    try {
      await this.db.batch(statements);
    } catch {
      throw new AuthError("LOGIN_CONFLICT", 409);
    }
    return {
      ...session.result,
      token: session.token,
      isFirstBinding: firstBinding,
    };
  }

  async validateSession(token: string | null): Promise<AuthSession | null> {
    if (!token || token.length < 32 || token.length > 256) return null;
    const tokenHash = await sha256Hex(token);
    const row = await this.db
      .prepare(
        "SELECT s.id, s.admin_user_id, s.auth_version AS session_auth_version, s.authenticated_at, s.last_seen_at, s.expires_at, s.revoked_at, a.role, a.status, a.auth_version FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_user_id WHERE s.token_hash = ?",
      )
      .bind(tokenHash)
      .first<{
        id: string;
        admin_user_id: string;
        session_auth_version: number;
        authenticated_at: number;
        last_seen_at: number;
        expires_at: number;
        revoked_at: number | null;
        role: string;
        status: string;
        auth_version: number;
      }>();
    if (!row) return null;
    const now = this.now();
    const invalid =
      row.revoked_at !== null ||
      row.status !== "active" ||
      Number(row.session_auth_version) !== Number(row.auth_version) ||
      now >= Number(row.expires_at) ||
      now - Number(row.last_seen_at) > this.idleTimeoutMs;
    if (invalid) {
      if (row.revoked_at === null)
        await this.db
          .prepare(
            "UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
          )
          .bind(now, row.id)
          .run();
      return null;
    }
    const lastSeenAt = Math.min(now, Number(row.expires_at));
    await this.db
      .prepare(
        "UPDATE admin_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL",
      )
      .bind(lastSeenAt, row.id)
      .run();
    return {
      adminId: row.admin_user_id,
      sessionId: row.id,
      role: row.role,
      authenticatedAt: Number(row.authenticated_at),
      lastSeenAt,
      expiresAt: Number(row.expires_at),
    };
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    const tokenHash = await sha256Hex(token);
    const row = await this.db
      .prepare(
        "SELECT id, admin_user_id FROM admin_sessions WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .bind(tokenHash)
      .first<{ id: string; admin_user_id: string }>();
    if (!row) return;
    const now = this.now();
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        )
        .bind(now, row.id),
      this.audit(
        this.idFactory("auth-operation"),
        row.admin_user_id,
        "ADMIN_LOGOUT",
        row.admin_user_id,
        now,
      ),
    ]);
  }

  cookieForSession(token: string): string {
    return sessionCookie(token, sessionCookieMaxAge(this.absoluteTimeoutMs));
  }

  clearCookies(): string[] {
    return [clearSessionCookie(), clearOAuthStateCookie()];
  }

  private async consumeOAuthState(
    state: string,
    cookieHeader: string | null,
  ): Promise<{
    nonce: string;
    codeVerifier: string;
    purpose: "login" | "bootstrap";
  }> {
    const cookieValue = parseCookieHeader(cookieHeader)[OAUTH_STATE_COOKIE];
    if (!cookieValue || !state) throw new AuthError("OAUTH_STATE_MISMATCH");
    let cookie: {
      state?: unknown;
      nonce?: unknown;
      codeVerifier?: unknown;
      purpose?: unknown;
      issuedAt?: unknown;
    };
    try {
      cookie = JSON.parse(
        new TextDecoder().decode(base64UrlDecode(cookieValue)),
      ) as typeof cookie;
    } catch {
      throw new AuthError("OAUTH_STATE_MISMATCH");
    }
    if (
      cookie.state !== state ||
      typeof cookie.nonce !== "string" ||
      typeof cookie.codeVerifier !== "string" ||
      (cookie.purpose !== "login" && cookie.purpose !== "bootstrap") ||
      typeof cookie.issuedAt !== "number"
    )
      throw new AuthError("OAUTH_STATE_MISMATCH");
    const now = this.now();
    if (now - cookie.issuedAt < 0 || now - cookie.issuedAt > STATE_TTL_MS)
      throw new AuthError("OAUTH_STATE_EXPIRED");
    const stateHash = await sha256Hex(state);
    const row = await this.db
      .prepare(
        "SELECT purpose, nonce_hash, code_verifier_hash, expires_at, used_at FROM auth_oauth_states WHERE state_hash = ?",
      )
      .bind(stateHash)
      .first<{
        nonce_hash: string;
        code_verifier_hash: string;
        purpose: "login" | "bootstrap";
        expires_at: number;
        used_at: number | null;
      }>();
    if (
      !row ||
      row.used_at !== null ||
      row.purpose !== cookie.purpose ||
      Number(row.expires_at) <= now ||
      row.nonce_hash !== (await sha256Hex(cookie.nonce)) ||
      row.code_verifier_hash !== (await sha256Hex(cookie.codeVerifier))
    )
      throw new AuthError("OAUTH_STATE_MISMATCH");
    const consumed = await this.db
      .prepare(
        "UPDATE auth_oauth_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at > ?",
      )
      .bind(now, stateHash, now)
      .run();
    if (consumed.meta.changes !== 1)
      throw new AuthError("OAUTH_CALLBACK_REPLAY");
    return {
      nonce: cookie.nonce,
      codeVerifier: cookie.codeVerifier,
      purpose: cookie.purpose,
    };
  }

  private assertVerifiedIdentity(identity: GoogleIdentity): void {
    if (
      identity.verified !== true ||
      identity.emailVerified !== true ||
      !identity.subject ||
      !identity.email
    )
      throw new AuthError("GOOGLE_VERIFICATION_REQUIRED");
  }

  private async newSession(
    adminId: string,
    authVersion: number,
    role: string,
    now: number,
  ) {
    const token = randomBase64Url(48);
    const expiresAt = now + this.absoluteTimeoutMs;
    const sessionId = this.idFactory("session");
    return {
      token,
      tokenHash: await sha256Hex(token),
      sessionId,
      expiresAt,
      result: {
        adminId,
        sessionId,
        role,
        authenticatedAt: now,
        lastSeenAt: now,
        expiresAt,
      },
      authVersion,
    } as {
      token: string;
      tokenHash: string;
      sessionId: string;
      expiresAt: number;
      result: AuthSession;
      authVersion: number;
    };
  }

  private audit(
    operationId: string,
    actorId: string,
    action: string,
    entityId: string,
    now: number,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        "INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, operation_id, outcome, metadata_json, created_at, retention_until) VALUES (?, ?, ?, 'admin_auth', ?, ?, 'success', '{}', ?, ?)",
      )
      .bind(
        this.idFactory("audit"),
        actorId,
        action,
        entityId,
        operationId,
        now,
        addCalendarMonths(taipeiBusinessDate(now), 2),
      );
  }
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function encodeOAuthCookie(value: {
  state: string;
  nonce: string;
  codeVerifier: string;
  purpose: "login" | "bootstrap";
  issuedAt: number;
}): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
