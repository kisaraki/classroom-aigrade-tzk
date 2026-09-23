import {
  addCalendarMonths,
  assertBusinessDate,
  taipeiBusinessDate,
} from "../../domain/dates.ts";
import { randomBase64Url, sha256Hex } from "./google-oidc.ts";
import {
  IDENTITY_REQUEST_TTL_MS,
  RECENT_AUTH_WINDOW_MS,
  SESSION_IDLE_TIMEOUT_MS,
  assertRecentGoogle,
} from "./policy.ts";
import { AuthorizationService } from "./authorization.ts";
import {
  AuthError,
  type AdminRole,
  type AuthSession,
  type GoogleIdentity,
} from "./types.ts";

const ROLES: readonly AdminRole[] = [
  "super_admin",
  "system_admin",
  "academic_admin",
  "score_admin",
  "ai_admin",
  "archive_admin",
  "viewer",
];
const SUBJECTS = new Set([
  "CHINESE",
  "ENGLISH",
  "MATH",
  "SCIENCE",
  "GEOGRAPHY",
  "HISTORY",
  "CIVICS",
]);
export type AssignmentInput = {
  academicTermId: string;
  scopeType: "school" | "grade" | "class" | "homeroom" | "teaching_subject";
  grade?: number;
  classId?: string;
  subject?: string;
  startsOn: string;
  endsOn?: string | null;
};
export type Confirmation = { expectedVersion: number; confirmed: true };
export type CreateAdminInput = {
  username: string;
  displayName: string;
  authorizedEmail: string;
  role: AdminRole;
  assignments?: AssignmentInput[];
  confirmed: true;
};
export type UpdateAdminInput = Confirmation & {
  displayName?: string;
  role?: AdminRole;
  status?: "active" | "disabled" | "locked" | "identity_rebind_required";
  assignments?: AssignmentInput[];
};
export type AdminManagementDependencies = {
  db: D1Database;
  authorization: AuthorizationService;
  recoverySecret?: string;
  now?: () => number;
  idFactory?: (prefix: string) => string;
};
type AdminRow = {
  id: string;
  username: string;
  display_name: string;
  authorized_email: string;
  google_subject_id: string | null;
  role: AdminRole;
  status: string;
  identity_bound_at: number | null;
  auth_version: number;
};
type IdentityRequest = {
  id: string;
  kind: "rebind" | "recovery";
  target_admin_id: string;
  target_auth_version: number;
  authorized_email: string;
  actor_session_id: string | null;
  status: string;
  expires_at: number;
};
const text = (value: unknown, code = "INVALID_INPUT"): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 320)
    throw new AuthError(code, 400);
  return value.trim().normalize("NFC");
};
function normalizeEmail(value: unknown): string {
  const email = text(value, "INVALID_AUTHORIZED_EMAIL").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    throw new AuthError("INVALID_AUTHORIZED_EMAIL", 400);
  return email;
}
function confirmation(
  value: { confirmed?: unknown; expectedVersion?: unknown },
  version = true,
): void {
  if (value.confirmed !== true)
    throw new AuthError("CONFIRMATION_REQUIRED", 400);
  if (
    version &&
    (!Number.isSafeInteger(value.expectedVersion) ||
      Number(value.expectedVersion) < 1)
  )
    throw new AuthError("TARGET_VERSION_REQUIRED", 400);
}

/** Server-only. Verified identities come from AuthService's OIDC callback. */
export class AdminManagementService {
  private readonly db: D1Database;
  private readonly authorization: AuthorizationService;
  private readonly recoverySecret?: string;
  private readonly now: () => number;
  private readonly idFactory: (prefix: string) => string;
  constructor(dependencies: AdminManagementDependencies) {
    this.db = dependencies.db;
    this.authorization = dependencies.authorization;
    this.recoverySecret = dependencies.recoverySecret;
    this.now = dependencies.now ?? Date.now;
    this.idFactory =
      dependencies.idFactory ??
      ((prefix) => `${prefix}-${crypto.randomUUID()}`);
  }
  async listAdmins(session: AuthSession) {
    await this.authorization.assertPermission(session, "admin.read");
    const admins = (
      await this.db
        .prepare(
          "SELECT id, username, display_name, authorized_email, role, status, auth_version FROM admin_users ORDER BY username",
        )
        .all()
    ).results;
    return admins;
  }
  async createAdmin(session: AuthSession, input: CreateAdminInput) {
    await this.authorization.assertPermission(session, "admin.manage");
    confirmation(input, false);
    const username = text(input.username, "INVALID_USERNAME");
    if (username === "admin" || !/^[a-z0-9][a-z0-9._-]{1,63}$/u.test(username))
      throw new AuthError("INVALID_USERNAME", 400);
    const displayName = text(input.displayName, "INVALID_DISPLAY_NAME");
    const email = normalizeEmail(input.authorizedEmail);
    this.assertRole(input.role);
    const assignments = await this.validateAssignments(input.assignments ?? []);
    if (input.role !== "super_admin" && !assignments.length)
      throw new AuthError("ASSIGNMENT_REQUIRED", 400);
    const id = this.idFactory("admin");
    const now = this.now();
    await this.commit([
      this.guardAudit(session, null, "ADMIN_CREATED", id, now),
      this.db
        .prepare(
          "INSERT INTO admin_users (id, username, display_name, authorized_email, role, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending_identity_binding', ?, ?, ?)",
        )
        .bind(
          id,
          username,
          displayName,
          email,
          input.role,
          session.adminId,
          now,
          now,
        ),
      ...assignments.map((a) => this.assignmentInsert(id, a)),
    ]);
    return { id, status: "pending_identity_binding" as const, authVersion: 1 };
  }
  async updateAdmin(
    session: AuthSession,
    targetId: string,
    input: UpdateAdminInput,
  ): Promise<void> {
    await this.authorization.assertPermission(session, "admin.manage");
    confirmation(input);
    const target = await this.admin(targetId);
    if (target.auth_version !== input.expectedVersion)
      throw new AuthError("ADMIN_VERSION_CONFLICT", 409);
    if (
      target.id === session.adminId &&
      (input.role !== undefined ||
        input.status !== undefined ||
        input.assignments !== undefined)
    )
      throw new AuthError("SELF_ADMIN_CHANGE", 409);
    const role = input.role ?? target.role;
    this.assertRole(role);
    const status = input.status ?? target.status;
    if (
      input.status !== undefined &&
      !["active", "disabled", "locked", "identity_rebind_required"].includes(
        input.status,
      )
    )
      throw new AuthError("INVALID_ADMIN_STATUS", 400);
    if (status === "active" && !target.google_subject_id)
      throw new AuthError("GOOGLE_BINDING_REQUIRED", 409);
    if (target.status === "identity_rebind_required" && status === "active")
      throw new AuthError("IDENTITY_REBIND_REQUIRED", 409);
    const displayName =
      input.displayName === undefined
        ? target.display_name
        : text(input.displayName, "INVALID_DISPLAY_NAME");
    const assignments =
      input.assignments === undefined
        ? undefined
        : await this.validateAssignments(input.assignments);
    const assignmentCount =
      assignments?.length ??
      Number(
        (
          await this.db
            .prepare(
              "SELECT count(*) AS n FROM admin_assignments WHERE admin_user_id = ?",
            )
            .bind(target.id)
            .first<{ n: number }>()
        )?.n,
      );
    if (role !== "super_admin" && !assignmentCount)
      throw new AuthError("ASSIGNMENT_REQUIRED", 400);
    const now = this.now();
    await this.commit([
      this.guardAudit(session, target, "ADMIN_UPDATED", target.id, now),
      this.db
        .prepare(
          "UPDATE admin_users SET display_name = ?, role = ?, status = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?",
        )
        .bind(displayName, role, status, now, target.id),
      ...(assignments === undefined
        ? []
        : [
            this.db
              .prepare("DELETE FROM admin_assignments WHERE admin_user_id = ?")
              .bind(target.id),
            ...assignments.map((a) => this.assignmentInsert(target.id, a)),
          ]),
    ]);
  }
  async replaceAssignments(
    session: AuthSession,
    targetId: string,
    assignments: AssignmentInput[],
    confirmed: Confirmation,
  ): Promise<void> {
    await this.updateAdmin(session, targetId, { ...confirmed, assignments });
  }
  async revokeSessions(
    session: AuthSession,
    targetId: string,
    confirmed: Confirmation,
  ): Promise<void> {
    await this.authorization.assertPermission(session, "admin.manage");
    confirmation(confirmed);
    const target = await this.admin(targetId);
    if (target.auth_version !== confirmed.expectedVersion)
      throw new AuthError("ADMIN_VERSION_CONFLICT", 409);
    const now = this.now();
    await this.commit([
      this.guardAudit(
        session,
        target,
        "ADMIN_SESSIONS_REVOKED",
        target.id,
        now,
      ),
      this.db
        .prepare(
          "UPDATE admin_users SET auth_version = auth_version + 1, updated_at = ? WHERE id = ?",
        )
        .bind(now, target.id),
    ]);
  }
  async approveRebind(
    session: AuthSession,
    targetId: string,
    input: Confirmation & { authorizedEmail: string; reason: string },
  ) {
    await this.authorization.assertPermission(session, "admin.rebind");
    confirmation(input);
    if (session.adminId === targetId)
      throw new AuthError("PERMISSION_DENIED", 403);
    const target = await this.admin(targetId);
    if (target.auth_version !== input.expectedVersion)
      throw new AuthError("ADMIN_VERSION_CONFLICT", 409);
    text(input.reason, "REASON_REQUIRED");
    return this.approveIdentityRequest(
      target,
      normalizeEmail(input.authorizedEmail),
      "rebind",
      session,
      "interactive-super-admin",
      text(input.reason),
    );
  }
  /** Maintenance-only entry point: intentionally not exposed by any HTTP route. */
  async approveRecovery(
    input: Confirmation & {
      targetAdminId: string;
      authorizedEmail: string;
      approvalSecret: string;
      approvedBy: string;
      evidenceReference: string;
    },
  ) {
    confirmation(input);
    if (!this.recoverySecret)
      throw new AuthError("RECOVERY_NOT_CONFIGURED", 503);
    // Digest both strings before a fixed-length comparison; never store the maintenance secret.
    const expected = await sha256Hex(this.recoverySecret);
    const actual = await sha256Hex(
      typeof input.approvalSecret === "string" ? input.approvalSecret : "",
    );
    let difference = 0;
    for (let i = 0; i < 64; i++)
      difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
    if (difference) throw new AuthError("RECOVERY_APPROVAL_INVALID");
    const target = await this.admin(input.targetAdminId);
    if (target.username !== "admin")
      throw new AuthError("RECOVERY_TARGET_INVALID", 409);
    if (target.auth_version !== input.expectedVersion)
      throw new AuthError("ADMIN_VERSION_CONFLICT", 409);
    const approvedBy = text(input.approvedBy, "APPROVAL_EVIDENCE_REQUIRED");
    const evidence = text(
      input.evidenceReference,
      "APPROVAL_EVIDENCE_REQUIRED",
    );
    // Opaque case/operator references, not names, email, free-form personal data or secret values.
    if (
      ![approvedBy, evidence].every((value) =>
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(value),
      )
    )
      throw new AuthError("APPROVAL_EVIDENCE_REQUIRED", 400);
    return this.approveIdentityRequest(
      target,
      normalizeEmail(input.authorizedEmail),
      "recovery",
      null,
      approvedBy,
      evidence,
    );
  }
  async requestForToken(token: string): Promise<IdentityRequest> {
    if (typeof token !== "string" || token.length < 32 || token.length > 256)
      throw new AuthError("IDENTITY_REQUEST_INVALID", 409);
    const row = await this.db
      .prepare(
        "SELECT * FROM auth_identity_requests WHERE approval_hash = ? AND status = 'approved' AND expires_at > ?",
      )
      .bind(await sha256Hex(token), this.now())
      .first<IdentityRequest>();
    if (!row) throw new AuthError("IDENTITY_REQUEST_INVALID", 409);
    return row;
  }
  /** Only AuthService calls this after signature/nonce/PKCE verification. */
  async completeIdentityRequest(
    requestId: string,
    identity: GoogleIdentity,
  ): Promise<void> {
    if (
      identity.verified !== true ||
      identity.emailVerified !== true ||
      !identity.subject ||
      !identity.email
    )
      throw new AuthError("GOOGLE_VERIFICATION_REQUIRED");
    assertRecentGoogle(identity, this.now());
    const request = await this.db
      .prepare("SELECT * FROM auth_identity_requests WHERE id = ?")
      .bind(text(requestId))
      .first<IdentityRequest>();
    const now = this.now();
    if (
      !request ||
      request.status !== "approved" ||
      request.expires_at <= now ||
      normalizeEmail(identity.email) !== request.authorized_email
    )
      throw new AuthError("IDENTITY_REQUEST_INVALID", 409);
    const target = await this.admin(request.target_admin_id);
    if (
      target.auth_version !== request.target_auth_version ||
      (request.kind === "recovery" && target.username !== "admin")
    )
      throw new AuthError("IDENTITY_REQUEST_INVALID", 409);
    let actor: AuthSession | null = null;
    if (request.kind === "rebind") {
      const session = await this.db
        .prepare("SELECT admin_user_id FROM admin_sessions WHERE id = ?")
        .bind(request.actor_session_id)
        .first<{ admin_user_id: string }>();
      if (!session) throw new AuthError("ACCESS_DENIED", 403);
      actor = {
        adminId: session.admin_user_id,
        sessionId: String(request.actor_session_id),
      } as AuthSession;
      await this.authorization.assertPermission(actor, "admin.rebind");
    }
    await this.commit(
      [
        this.guardAudit(
          actor,
          target,
          request.kind === "rebind"
            ? "ADMIN_IDENTITY_REBOUND"
            : "ADMIN_RECOVERY_COMPLETED",
          target.id,
          now,
          "EXISTS (SELECT 1 FROM auth_identity_requests WHERE id = ? AND status = 'approved' AND expires_at > ? AND target_auth_version = ?)",
          [request.id, now, target.auth_version],
        ),
        this.db
          .prepare(
            "UPDATE auth_identity_requests SET status = 'consumed', consumed_at = ? WHERE id = ?",
          )
          .bind(now, request.id),
        this.db
          .prepare(
            "UPDATE admin_users SET authorized_email = ?, google_subject_id = ?, identity_bound_at = ?, status = 'active', auth_version = auth_version + 1, updated_at = ? WHERE id = ?",
          )
          .bind(
            request.authorized_email,
            identity.subject,
            now,
            now,
            target.id,
          ),
      ],
      "IDENTITY_REQUEST_CONFLICT",
    );
  }
  private async approveIdentityRequest(
    target: AdminRow,
    email: string,
    kind: "rebind" | "recovery",
    actor: AuthSession | null,
    approvedBy: string,
    evidence: string,
  ) {
    const duplicate = await this.db
      .prepare(
        "SELECT id FROM admin_users WHERE lower(authorized_email) = ? AND id <> ?",
      )
      .bind(email, target.id)
      .first();
    if (duplicate) throw new AuthError("IDENTITY_ALREADY_BOUND", 409);
    const now = this.now();
    const requestId = this.idFactory("identity-request");
    const token = randomBase64Url(48);
    const expiresAt = now + IDENTITY_REQUEST_TTL_MS;
    await this.commit([
      this.guardAudit(
        actor,
        target,
        kind === "rebind" ? "ADMIN_REBIND_APPROVED" : "ADMIN_RECOVERY_APPROVED",
        target.id,
        now,
      ),
      this.db
        .prepare(
          "UPDATE auth_identity_requests SET status = 'expired' WHERE target_admin_id = ? AND status = 'approved'",
        )
        .bind(target.id),
      this.db
        .prepare(
          "INSERT INTO auth_identity_requests (id, target_admin_id, authorized_email, approval_hash, status, expires_at, approved_at, created_at, kind, target_auth_version, actor_session_id, approved_by, evidence_reference) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          requestId,
          target.id,
          email,
          await sha256Hex(token),
          expiresAt,
          now,
          now,
          kind,
          target.auth_version,
          actor?.sessionId ?? null,
          approvedBy,
          evidence,
        ),
    ]);
    return { requestId, requestToken: token, expiresAt };
  }
  private async admin(id: string): Promise<AdminRow> {
    const row = await this.db
      .prepare(
        "SELECT id, username, display_name, authorized_email, google_subject_id, role, status, identity_bound_at, auth_version FROM admin_users WHERE id = ?",
      )
      .bind(text(id))
      .first<AdminRow>();
    if (!row) throw new AuthError("ADMIN_NOT_FOUND", 404);
    return row;
  }
  private assertRole(role: string): asserts role is AdminRole {
    if (!ROLES.includes(role as AdminRole))
      throw new AuthError("INVALID_ROLE", 400);
  }
  private async validateAssignments(
    assignments: AssignmentInput[],
  ): Promise<AssignmentInput[]> {
    if (!Array.isArray(assignments) || assignments.length > 100)
      throw new AuthError("INVALID_ASSIGNMENTS", 400);
    const seen = new Set<string>();
    const result: AssignmentInput[] = [];
    for (const a of assignments) {
      if (!a || typeof a !== "object")
        throw new AuthError("INVALID_ASSIGNMENTS", 400);
      const term = await this.db
        .prepare(
          "SELECT id, starts_on, ends_on, academic_year_id FROM academic_terms WHERE id = ?",
        )
        .bind(text(a.academicTermId))
        .first<{
          id: string;
          starts_on: string;
          ends_on: string;
          academic_year_id: string;
        }>();
      if (!term) throw new AuthError("TERM_NOT_FOUND", 404);
      const start = text(a.startsOn);
      const end = a.endsOn == null ? term.ends_on : text(a.endsOn);
      try {
        assertBusinessDate(start);
        assertBusinessDate(end);
      } catch {
        throw new AuthError("INVALID_ASSIGNMENT_DATE", 400);
      }
      if (
        start < term.starts_on ||
        start >= term.ends_on ||
        end <= start ||
        end > term.ends_on
      )
        throw new AuthError("INVALID_ASSIGNMENT_DATE", 400);
      const shape =
        a.scopeType === "school"
          ? a.grade === undefined && !a.classId && !a.subject
          : a.scopeType === "grade"
            ? [7, 8, 9].includes(Number(a.grade)) &&
              typeof a.grade === "number" &&
              !a.classId &&
              !a.subject
            : ["class", "homeroom"].includes(a.scopeType)
              ? !!a.classId && a.grade === undefined && !a.subject
              : a.scopeType === "teaching_subject" &&
                !!a.classId &&
                a.grade === undefined &&
                !!a.subject &&
                SUBJECTS.has(a.subject);
      if (!shape) throw new AuthError("INVALID_ASSIGNMENT_SHAPE", 400);
      if (
        a.classId &&
        !(await this.db
          .prepare(
            "SELECT id FROM classes WHERE id = ? AND academic_year_id = ?",
          )
          .bind(text(a.classId), term.academic_year_id)
          .first())
      )
        throw new AuthError("CLASS_TERM_MISMATCH", 409);
      const normalized = {
        academicTermId: term.id,
        scopeType: a.scopeType,
        grade: a.grade,
        classId: a.classId,
        subject: a.subject,
        startsOn: start,
        endsOn: end,
      };
      const key = JSON.stringify(normalized);
      if (seen.has(key)) throw new AuthError("DUPLICATE_ASSIGNMENT", 409);
      seen.add(key);
      result.push(normalized);
    }
    return result;
  }
  private assignmentInsert(adminId: string, a: AssignmentInput) {
    return this.db
      .prepare(
        "INSERT INTO admin_assignments (id, admin_user_id, academic_term_id, scope_type, grade, class_id, subject, starts_on, ends_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        this.idFactory("assignment"),
        adminId,
        a.academicTermId,
        a.scopeType,
        a.grade ?? null,
        a.classId ?? null,
        a.subject ?? null,
        a.startsOn,
        a.endsOn ?? null,
      );
  }
  // NOT NULL violation aborts the entire D1 batch if a principal/target/request
  // changes after preflight. Audit and all writes share one transaction.
  private guardAudit(
    actor: AuthSession | null,
    target: AdminRow | null,
    action: string,
    entityId: string,
    now: number,
    extra = "1",
    extraValues: (string | number)[] = [],
  ) {
    const conditions = [extra];
    const values: (string | number)[] = [...extraValues];
    if (actor) {
      conditions.push(
        "EXISTS (SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id = a.id WHERE a.id = ? AND s.id = ? AND a.role = 'super_admin' AND a.status = 'active' AND a.google_subject_id IS NOT NULL AND a.auth_version = s.auth_version AND s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen_at > ? AND s.last_seen_at <= ? AND s.recent_auth_at > ? AND s.recent_auth_at <= ?)",
      );
      values.push(
        actor.adminId,
        actor.sessionId,
        now,
        now - SESSION_IDLE_TIMEOUT_MS,
        now,
        now - RECENT_AUTH_WINDOW_MS,
        now,
      );
    }
    if (target) {
      conditions.push(
        "EXISTS (SELECT 1 FROM admin_users WHERE id = ? AND auth_version = ?)",
      );
      values.push(target.id, target.auth_version);
    }
    return this.db
      .prepare(
        `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, operation_id, outcome, metadata_json, created_at, retention_until) VALUES (CASE WHEN ${conditions.join(" AND ")} THEN ? ELSE NULL END, ?, ?, 'admin_authorization', ?, ?, 'success', '{}', ?, ?)`,
      )
      .bind(
        ...values,
        this.idFactory("audit"),
        actor?.adminId ?? null,
        action,
        entityId,
        this.idFactory("admin-operation"),
        now,
        addCalendarMonths(taipeiBusinessDate(now), 2),
      );
  }
  private async commit(
    statements: D1PreparedStatement[],
    code = "ADMIN_CONFLICT",
  ): Promise<void> {
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (String(error).includes("LAST_ACTIVE_SUPER_ADMIN"))
        throw new AuthError("LAST_ACTIVE_SUPER_ADMIN", 409);
      throw new AuthError(code, 409);
    }
  }
}
