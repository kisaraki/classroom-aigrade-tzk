import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { AuthService } from "./service.ts";
import { AuthError, type AuthSession, type AuthResult } from "./types.ts";
import type { SitesIdentity } from "./sites-identity.ts";
import { randomBase64Url, sha256Hex, base64UrlDecode } from "./google-oidc.ts";
import { RECENT_AUTH_WINDOW_MS, SESSION_IDLE_TIMEOUT_MS } from "./policy.ts";
import { addCalendarMonths, taipeiBusinessDate } from "../../domain/dates.ts";

type Credential = {
  admin_user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports_json: string;
  version: number;
};
type Challenge = {
  id: string;
  challenge_hash: string;
  admin_user_id: string;
  session_id: string | null;
  subject: string;
  purpose: string;
  identity_request_id: string | null;
  auth_version: number;
  credential_version: number | null;
  expires_at: number;
  created_at: number;
  used_at: number | null;
};
type IdentityRequest = {
  id: string;
  target_admin_id: string;
  target_auth_version: number;
  sites_subject: string | null;
  authorized_email: string;
  status: string;
  kind: string;
  actor_session_id: string | null;
  expires_at: number;
};
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
const bounded = (value: unknown, max = 512): string => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new AuthError("INVALID_INPUT", 400);
  return value;
};

/** Production identity comes exclusively from the deployment-verified Sites gateway. */
export class SitesAuthService extends AuthService {
  readonly identity: SitesIdentity;
  private readonly sitesDb: D1Database;
  private readonly clock: () => number;
  private readonly initialSecret: string;
  private readonly origin: string;
  private readonly rpID: string;
  constructor(deps: {
    db: D1Database;
    identity: SitesIdentity;
    origin: string;
    bootstrapSecret: string;
    now?: () => number;
  }) {
    super({
      db: deps.db,
      bootstrapSecret: deps.bootstrapSecret,
      now: deps.now,
    });
    if (deps.identity.provider !== "sites")
      throw new AuthError("INVALID_SITES_IDENTITY", 401);
    this.identity = deps.identity;
    this.sitesDb = deps.db;
    this.clock = deps.now ?? Date.now;
    this.initialSecret = deps.bootstrapSecret;
    const origin = new URL(deps.origin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== deps.origin ||
      origin.username ||
      origin.password
    )
      throw new AuthError("PASSKEY_CONFIGURATION_INVALID", 503);
    this.origin = origin.origin;
    this.rpID = origin.hostname;
  }
  private statement(sql: string, ...values: (string | number | null)[]) {
    return this.sitesDb.prepare(sql).bind(...values);
  }
  private sitesAudit(
    action: string,
    adminId: string,
    now: number,
    condition = "1",
    values: (string | number | null)[] = [],
    actorId: string | null = adminId,
  ) {
    return this.statement(
      `INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until) VALUES (CASE WHEN ${condition} THEN ? ELSE NULL END,?,?,'admin_auth',?,?,'success','{}',?,?)`,
      ...values,
      crypto.randomUUID(),
      actorId,
      action,
      adminId,
      crypto.randomUUID(),
      now,
      addCalendarMonths(taipeiBusinessDate(now), 2),
    );
  }
  private async commit(statements: D1PreparedStatement[]) {
    try {
      await this.sitesDb.batch(statements);
    } catch {
      throw new AuthError("AUTH_CONFLICT", 409);
    }
  }
  private async sessionResult(
    adminId: string,
    role: string,
    version: number,
    now: number,
  ) {
    const token = randomBase64Url(48),
      sessionId = crypto.randomUUID();
    const result: AuthResult = {
      adminId,
      role,
      sessionId,
      token,
      authenticatedAt: now,
      recentAuthenticatedAt: 0,
      lastSeenAt: now,
      expiresAt: now + 8 * 60 * 60_000,
      isFirstBinding: false,
    };
    return {
      result,
      insert: this.statement(
        "INSERT INTO admin_sessions(id,admin_user_id,token_hash,auth_version,authenticated_at,recent_auth_at,last_seen_at,expires_at,created_at) VALUES (?,?,?,?,?,0,?,?,?)",
        sessionId,
        adminId,
        await sha256Hex(token),
        version,
        now,
        now,
        result.expiresAt,
        now,
      ),
    };
  }
  async loginSites(): Promise<AuthResult> {
    const row = await this.statement(
      "SELECT a.id,a.role,a.status,a.auth_version FROM admin_users a JOIN admin_sites_bindings b ON b.admin_user_id=a.id WHERE b.subject=?",
      this.identity.subject,
    ).first<{
      id: string;
      role: string;
      status: string;
      auth_version: number;
    }>();
    if (!row || !["active", "pending_identity_binding"].includes(row.status))
      throw new AuthError("SITES_ADMIN_NOT_AUTHORIZED", 403);
    const now = this.clock(),
      session = await this.sessionResult(
        row.id,
        row.role,
        row.auth_version,
        now,
      );
    await this.commit([
      this.sitesAudit(
        "ADMIN_SITES_LOGIN",
        row.id,
        now,
        "EXISTS(SELECT 1 FROM admin_users a JOIN admin_sites_bindings b ON b.admin_user_id=a.id WHERE a.id=? AND b.subject=? AND a.auth_version=? AND a.status IN ('active','pending_identity_binding'))",
        [row.id, this.identity.subject, row.auth_version],
      ),
      this.statement(
        "UPDATE admin_users SET google_subject_id=COALESCE(google_subject_id,?),identity_bound_at=COALESCE(identity_bound_at,?),status='active',last_login_at=?,updated_at=? WHERE id=?",
        "sites-binding:" + row.id,
        now,
        now,
        now,
        row.id,
      ),
      session.insert,
    ]);
    return {
      ...session.result,
      isFirstBinding: row.status === "pending_identity_binding",
    };
  }
  async bootstrapSites(input: {
    secret: string;
    displayName: string;
    contactEmail: string;
  }): Promise<AuthResult> {
    const left = await sha256Hex(bounded(input.secret, 4096)),
      right = await sha256Hex(this.initialSecret);
    let difference = 0;
    for (let i = 0; i < 64; i++)
      difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
    if (!this.initialSecret || difference)
      throw new AuthError("BOOTSTRAP_SECRET_INVALID", 401);
    const displayName = bounded(input.displayName, 128).trim(),
      email = bounded(input.contactEmail, 320).trim().toLowerCase();
    if (!displayName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
      throw new AuthError("INVALID_INPUT", 400);
    const existing = await this.statement(
      "SELECT (SELECT count(*) FROM admin_users)+(SELECT count(*) FROM bootstrap_state) AS count",
    ).first<{ count: number }>();
    if (!existing || existing.count)
      throw new AuthError("BOOTSTRAP_CLOSED", 409);
    const now = this.clock(),
      id = crypto.randomUUID(),
      session = await this.sessionResult(id, "super_admin", 1, now);
    await this.commit([
      this.statement(
        "INSERT INTO admin_users(id,username,display_name,authorized_email,google_subject_id,role,status,identity_bound_at,created_at,updated_at) VALUES (?,'admin',?,?,?,'super_admin','active',?,?,?)",
        id,
        displayName,
        email,
        "sites-binding:" + id,
        now,
        now,
        now,
      ),
      this.statement(
        "INSERT INTO bootstrap_state(id,initialized_by,initialized_at) VALUES (1,?,?)",
        id,
        now,
      ),
      this.statement(
        "INSERT INTO admin_sites_bindings(admin_user_id,subject,created_at) VALUES (?,?,?)",
        id,
        this.identity.subject,
        now,
      ),
      session.insert,
      this.sitesAudit("ADMIN_SITES_BOOTSTRAP", id, now),
    ]);
    return { ...session.result, isFirstBinding: true };
  }
  override async validateSession(
    token: string | null,
  ): Promise<AuthSession | null> {
    if (!token) return null;
    const bound = await this.statement(
      "SELECT s.id FROM admin_sessions s JOIN admin_sites_bindings b ON b.admin_user_id=s.admin_user_id WHERE s.token_hash=? AND b.subject=?",
      await sha256Hex(token),
      this.identity.subject,
    ).first();
    if (!bound) return null;
    const session = await super.validateSession(token);
    if (!session) return null;
    const final = await this.statement(
      "SELECT a.id FROM admin_users a JOIN admin_sites_bindings b ON b.admin_user_id=a.id JOIN admin_sessions s ON s.admin_user_id=a.id WHERE s.id=? AND b.subject=? AND a.status='active' AND s.revoked_at IS NULL AND s.auth_version=a.auth_version AND s.expires_at>?",
      session.sessionId,
      this.identity.subject,
      this.clock(),
    ).first();
    return final ? session : null;
  }
  private async requireSession(token: string | null) {
    const session = await this.validateSession(token);
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED", 401);
    return session;
  }
  private async credential(adminId: string) {
    return this.statement(
      "SELECT * FROM admin_passkeys WHERE admin_user_id=?",
      adminId,
    ).first<Credential>();
  }
  private fresh(session: AuthSession) {
    const now = this.clock();
    if (
      session.recentAuthenticatedAt <= 0 ||
      session.recentAuthenticatedAt > now ||
      now - session.recentAuthenticatedAt >= RECENT_AUTH_WINDOW_MS
    )
      throw new AuthError("RECENT_AUTHENTICATION_REQUIRED", 403);
  }
  private sessionGuard(
    session: AuthSession,
    action: string,
    credentialVersion: number | null,
    requireRecent = false,
  ) {
    const now = this.clock();
    return this.sitesAudit(
      action,
      session.adminId,
      now,
      `EXISTS(SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id JOIN admin_sites_bindings b ON b.admin_user_id=a.id WHERE a.id=? AND s.id=? AND b.subject=? AND a.status='active' AND s.revoked_at IS NULL AND s.auth_version=a.auth_version AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=? ${requireRecent ? "AND s.recent_auth_at>? AND s.recent_auth_at<=?" : ""}) AND ${credentialVersion === null ? "NOT EXISTS(SELECT 1 FROM admin_passkeys WHERE admin_user_id=?)" : "EXISTS(SELECT 1 FROM admin_passkeys WHERE admin_user_id=? AND version=?)"}`,
      [
        session.adminId,
        session.sessionId,
        this.identity.subject,
        now,
        now - SESSION_IDLE_TIMEOUT_MS,
        now,
        ...(requireRecent ? [now - RECENT_AUTH_WINDOW_MS, now] : []),
        session.adminId,
        ...(credentialVersion === null ? [] : [credentialVersion]),
      ],
    );
  }
  private async saveChallenge(
    challenge: string,
    session: AuthSession,
    purpose: string,
    credential: Credential | null,
    identityRequestId: string | null = null,
  ) {
    const row = await this.statement(
      "SELECT auth_version FROM admin_users WHERE id=?",
      session.adminId,
    ).first<{ auth_version: number }>();
    if (!row) throw new AuthError("AUTHENTICATION_REQUIRED", 401);
    const now = this.clock(),
      id = crypto.randomUUID();
    await this.statement(
      "INSERT INTO auth_sites_challenges(id,challenge_hash,admin_user_id,session_id,subject,purpose,identity_request_id,auth_version,credential_version,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      id,
      await sha256Hex(challenge),
      session.adminId,
      identityRequestId ? null : session.sessionId,
      this.identity.subject,
      purpose,
      identityRequestId,
      row.auth_version,
      credential?.version ?? null,
      now + RECENT_AUTH_WINDOW_MS,
      now,
    ).run();
    return id;
  }
  async passkeyOptions(
    token: string | null,
    purpose: "register" | "reauth",
    confirmed: boolean,
  ) {
    const session = await this.requireSession(token),
      credential = await this.credential(session.adminId);
    if (purpose === "register") {
      if (confirmed !== true) throw new AuthError("CONFIRMATION_REQUIRED", 400);
      if (credential) this.fresh(session);
    } else if (!credential) throw new AuthError("PASSKEY_NOT_REGISTERED", 409);
    const options =
      purpose === "register"
        ? await generateRegistrationOptions({
            rpName: "Classroom AIGrade",
            rpID: this.rpID,
            userName: session.adminId,
            userID: new TextEncoder().encode(session.adminId),
            attestationType: "none",
            authenticatorSelection: {
              residentKey: "preferred",
              userVerification: "required",
            },
            supportedAlgorithmIDs: [-7, -257],
            timeout: RECENT_AUTH_WINDOW_MS,
            excludeCredentials: credential
              ? [{ id: credential.credential_id }]
              : [],
          })
        : await generateAuthenticationOptions({
            rpID: this.rpID,
            userVerification: "required",
            timeout: RECENT_AUTH_WINDOW_MS,
            allowCredentials: [{ id: credential!.credential_id }],
          });
    const challengeId = await this.saveChallenge(
      options.challenge,
      session,
      purpose,
      credential,
    );
    await this.requireSession(token);
    return { challengeId, options };
  }
  private async consumeChallenge(
    id: string,
    purpose: string,
    session: AuthSession | null,
  ): Promise<Challenge> {
    const now = this.clock();
    const row = await this.statement(
      "SELECT * FROM auth_sites_challenges WHERE id=? AND purpose=? AND subject=? AND used_at IS NULL AND expires_at>? AND created_at<=?",
      bounded(id, 128),
      purpose,
      this.identity.subject,
      now,
      now,
    ).first<Challenge>();
    if (
      !row ||
      (session &&
        (row.session_id !== session.sessionId ||
          row.admin_user_id !== session.adminId)) ||
      (!session && row.session_id !== null)
    )
      throw new AuthError("PASSKEY_CHALLENGE_INVALID", 409);
    const claimed = await this.statement(
      "UPDATE auth_sites_challenges SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?",
      now,
      row.id,
      now,
    ).run();
    if (claimed.meta.changes !== 1)
      throw new AuthError("PASSKEY_CHALLENGE_INVALID", 409);
    return row;
  }
  private clientData(
    response: RegistrationResponseJSON | AuthenticationResponseJSON,
  ) {
    try {
      const data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          base64UrlDecode(response.response.clientDataJSON),
        ),
      );
      if (
        (data.crossOrigin !== undefined && data.crossOrigin !== false) ||
        data.topOrigin !== undefined
      )
        throw new Error();
    } catch {
      throw new AuthError("PASSKEY_INVALID", 401);
    }
  }
  private async registration(response: RegistrationResponseJSON, c: Challenge) {
    this.clientData(response);
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: async (value) =>
          (await sha256Hex(value)) === c.challenge_hash,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
      if (
        !result.verified ||
        !result.registrationInfo?.userVerified ||
        result.registrationInfo.credential.id !== response.id
      )
        throw new Error();
      return result.registrationInfo.credential;
    } catch {
      throw new AuthError("PASSKEY_INVALID", 401);
    }
  }
  private credentialWrite(
    adminId: string,
    credential: { id: string; publicKey: Uint8Array; counter: number },
    transports: unknown,
    now: number,
  ) {
    const allowed = new Set([
      "ble",
      "cable",
      "hybrid",
      "internal",
      "nfc",
      "smart-card",
      "usb",
    ]);
    const safeTransports = Array.isArray(transports)
      ? transports.filter((x) => typeof x === "string" && allowed.has(x))
      : [];
    return this.statement(
      "INSERT INTO admin_passkeys(admin_user_id,credential_id,public_key,counter,transports_json,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(admin_user_id) DO UPDATE SET credential_id=excluded.credential_id,public_key=excluded.public_key,counter=excluded.counter,transports_json=excluded.transports_json,version=admin_passkeys.version+1,updated_at=excluded.updated_at",
      adminId,
      credential.id,
      encode(credential.publicKey),
      credential.counter,
      JSON.stringify(safeTransports),
      now,
      now,
    );
  }
  async verifyPasskey(
    token: string | null,
    purpose: "register" | "reauth",
    challengeId: string,
    response: RegistrationResponseJSON | AuthenticationResponseJSON,
  ) {
    const session = await this.requireSession(token),
      c = await this.consumeChallenge(challengeId, purpose, session);
    const current = await this.credential(session.adminId);
    if ((current?.version ?? null) !== c.credential_version)
      throw new AuthError("PASSKEY_CHALLENGE_INVALID", 409);
    this.clientData(response);
    let write: D1PreparedStatement;
    if (purpose === "register") {
      if (current) this.fresh(session);
      const credential = await this.registration(
        response as RegistrationResponseJSON,
        c,
      );
      write = this.credentialWrite(
        session.adminId,
        credential,
        (response as RegistrationResponseJSON).response.transports,
        this.clock(),
      );
    } else {
      if (!current) throw new AuthError("PASSKEY_NOT_REGISTERED", 409);
      try {
        if (response.id !== current.credential_id) throw new Error();
        const userHandle = (response as AuthenticationResponseJSON).response
          .userHandle;
        if (
          userHandle &&
          userHandle !== encode(new TextEncoder().encode(session.adminId))
        )
          throw new Error();
        const result = await verifyAuthenticationResponse({
          response: response as AuthenticationResponseJSON,
          expectedChallenge: async (value) =>
            (await sha256Hex(value)) === c.challenge_hash,
          expectedOrigin: this.origin,
          expectedRPID: this.rpID,
          requireUserVerification: true,
          credential: {
            id: current.credential_id,
            publicKey: new Uint8Array(base64UrlDecode(current.public_key)),
            counter: current.counter,
          },
        });
        if (!result.verified || !result.authenticationInfo.userVerified)
          throw new Error();
        write = this.statement(
          "UPDATE admin_passkeys SET counter=?,version=version+1,updated_at=? WHERE admin_user_id=?",
          result.authenticationInfo.newCounter,
          this.clock(),
          session.adminId,
        );
      } catch {
        throw new AuthError("PASSKEY_INVALID", 401);
      }
    }
    const now = this.clock();
    if (now >= c.expires_at)
      throw new AuthError("PASSKEY_CHALLENGE_INVALID", 409);
    const actual = await this.requireSession(token);
    const account = await this.statement(
      "SELECT auth_version FROM admin_users WHERE id=?",
      session.adminId,
    ).first<{ auth_version: number }>();
    if (account?.auth_version !== c.auth_version)
      throw new AuthError("PASSKEY_CHALLENGE_INVALID", 409);
    await this.commit([
      this.sessionGuard(
        actual,
        purpose === "register"
          ? "ADMIN_PASSKEY_REGISTERED"
          : "ADMIN_PASSKEY_REAUTHENTICATED",
        c.credential_version,
        purpose === "register" && current !== null,
      ),
      write,
      ...(purpose === "register"
        ? [
            this.statement(
              "UPDATE admin_sessions SET recent_auth_at=0 WHERE admin_user_id=?",
              session.adminId,
            ),
          ]
        : []),
      this.statement(
        "UPDATE admin_sessions SET recent_auth_at=? WHERE id=? AND revoked_at IS NULL",
        now,
        session.sessionId,
      ),
    ]);
    return { ok: true, recentAuthenticatedAt: now };
  }
  private async identityRequest(token: string) {
    const now = this.clock();
    const request = await this.statement(
      "SELECT r.* FROM auth_identity_requests r JOIN admin_users a ON a.id=r.target_admin_id WHERE r.approval_hash=? AND r.status='approved' AND r.expires_at>? AND r.sites_subject=? AND a.auth_version=r.target_auth_version AND (r.kind<>'recovery' OR a.username='admin')",
      await sha256Hex(bounded(token, 256)),
      now,
      this.identity.subject,
    ).first<IdentityRequest>();
    if (!request) throw new AuthError("IDENTITY_REQUEST_INVALID", 409);
    return request;
  }
  async identityOptions(requestToken: string) {
    const request = await this.identityRequest(requestToken),
      credential = await this.credential(request.target_admin_id);
    const options = await generateRegistrationOptions({
      rpName: "Classroom AIGrade",
      rpID: this.rpID,
      userName: request.target_admin_id,
      userID: new TextEncoder().encode(request.target_admin_id),
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      supportedAlgorithmIDs: [-7, -257],
      timeout: RECENT_AUTH_WINDOW_MS,
      excludeCredentials: credential ? [{ id: credential.credential_id }] : [],
    });
    const challengeId = await this.saveChallenge(
      options.challenge,
      { adminId: request.target_admin_id } as AuthSession,
      "identity",
      credential,
      request.id,
    );
    return { challengeId, options };
  }
  async verifyIdentity(
    requestToken: string,
    challengeId: string,
    response: RegistrationResponseJSON,
  ) {
    const request = await this.identityRequest(requestToken),
      c = await this.consumeChallenge(challengeId, "identity", null);
    if (
      c.identity_request_id !== request.id ||
      c.admin_user_id !== request.target_admin_id ||
      c.auth_version !== request.target_auth_version
    )
      throw new AuthError("IDENTITY_REQUEST_INVALID", 409);
    const credential = await this.registration(response, c),
      now = this.clock();
    if (now >= c.expires_at)
      throw new AuthError("PASSKEY_CHALLENGE_INVALID", 409);
    const actorCondition =
      request.kind === "rebind"
        ? "AND EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.id=r.actor_session_id AND a.role='super_admin' AND a.status='active' AND s.auth_version=a.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=? AND s.recent_auth_at>? AND s.recent_auth_at<=?)"
        : "";
    await this.commit([
      this.sitesAudit(
        request.kind === "rebind"
          ? "ADMIN_SITES_REBOUND"
          : "ADMIN_SITES_RECOVERY",
        request.target_admin_id,
        now,
        `EXISTS(SELECT 1 FROM auth_identity_requests r JOIN admin_users a ON a.id=r.target_admin_id WHERE r.id=? AND r.status='approved' AND r.expires_at>? AND r.sites_subject=? AND a.auth_version=? AND a.auth_version=r.target_auth_version AND (r.kind<>'recovery' OR a.username='admin') ${actorCondition}) AND ${c.credential_version === null ? "NOT EXISTS(SELECT 1 FROM admin_passkeys WHERE admin_user_id=?)" : "EXISTS(SELECT 1 FROM admin_passkeys WHERE admin_user_id=? AND version=?)"}`,
        [
          request.id,
          now,
          this.identity.subject,
          c.auth_version,
          ...(request.kind === "rebind"
            ? [
                now,
                now - SESSION_IDLE_TIMEOUT_MS,
                now,
                now - RECENT_AUTH_WINDOW_MS,
                now,
              ]
            : []),
          request.target_admin_id,
          ...(c.credential_version === null ? [] : [c.credential_version]),
        ],
        request.actor_session_id
          ? ((
              await this.statement(
                "SELECT admin_user_id FROM admin_sessions WHERE id=?",
                request.actor_session_id,
              ).first<{ admin_user_id: string }>()
            )?.admin_user_id ?? null)
          : null,
      ),
      this.statement(
        "UPDATE auth_identity_requests SET status='consumed',consumed_at=? WHERE id=?",
        now,
        request.id,
      ),
      this.statement(
        "UPDATE admin_users SET google_subject_id=?,authorized_email=?,identity_bound_at=?,status='active',auth_version=auth_version+1,updated_at=? WHERE id=?",
        "sites-binding:" + request.target_admin_id,
        request.authorized_email,
        now,
        now,
        request.target_admin_id,
      ),
      this.statement(
        "INSERT INTO admin_sites_bindings(admin_user_id,subject,created_at) VALUES (?,?,?) ON CONFLICT(admin_user_id) DO UPDATE SET subject=excluded.subject",
        request.target_admin_id,
        this.identity.subject,
        now,
      ),
      this.credentialWrite(
        request.target_admin_id,
        credential,
        response.response.transports,
        now,
      ),
      this.statement(
        "UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?),recent_auth_at=0 WHERE admin_user_id=?",
        now,
        request.target_admin_id,
      ),
      this.statement(
        "UPDATE auth_sites_challenges SET used_at=COALESCE(used_at,?) WHERE admin_user_id=?",
        now,
        request.target_admin_id,
      ),
    ]);
    return { ok: true };
  }
}
