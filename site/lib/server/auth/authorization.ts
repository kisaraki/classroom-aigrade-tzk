import { assertBusinessDate, taipeiBusinessDate } from "../../domain/dates.ts";
import { RECENT_AUTH_WINDOW_MS, SESSION_IDLE_TIMEOUT_MS } from "./policy.ts";
import {
  AuthError,
  type AdminRole,
  type AuthSession,
  type AuthorizationRequest,
  type Permission,
  type ScopeResource,
} from "./types.ts";

const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  super_admin: [
    "admin.read",
    "admin.manage",
    "admin.rebind",
    "assignment.manage",
    "system.manage",
    "academic.read",
    "academic.write",
    "score.read",
    "score.write",
    "ai.read",
    "ai.manage",
    "archive.read",
    "archive.manage",
  ],
  system_admin: [
    "system.manage",
    "academic.read",
    "score.read",
    "ai.read",
    "archive.read",
  ],
  academic_admin: ["academic.read", "academic.write"],
  score_admin: ["score.read", "score.write"],
  ai_admin: ["ai.read", "ai.manage"],
  archive_admin: ["archive.read", "archive.manage"],
  viewer: ["academic.read", "score.read", "ai.read", "archive.read"],
};
export type AuthorizationGrant = {
  adminId: string;
  sessionId: string;
  role: AdminRole;
  recentGoogleAuthentication: boolean;
};
export type AuthorizationDependencies = { db: D1Database; now?: () => number };
type Row = Record<string, string | number | null>;
const deny = (): never => {
  throw new AuthError("SCOPE_DENIED", 403);
};
const ids = (single?: string, multiple?: string[]) => [
  ...new Set([...(single ? [single] : []), ...(multiple ?? [])]),
];
export function permissionForAcademicAction(action: string): Permission | null {
  if (["READ_YEARS", "READ_ROSTER"].includes(action)) return "academic.read";
  if (
    [
      "CREATE_YEAR",
      "CREATE_CLASSES",
      "NEW_STUDENTS",
      "TRANSFER_IN",
      "ENROLLMENT",
      "MOVE",
      "PROMOTION",
      "TRANSFER_OUT",
      "UNDO",
    ].includes(action)
  )
    return "academic.write";
  return null;
}
/** Inputs are resolved by server domain code, never copied from a client claim. */
export class AuthorizationService {
  private readonly db: D1Database;
  private readonly now: () => number;
  constructor(dependencies: AuthorizationDependencies) {
    this.db = dependencies.db;
    this.now = dependencies.now ?? Date.now;
  }
  async authorize(input: AuthorizationRequest): Promise<AuthorizationGrant> {
    const now = this.now();
    const row = await this.db
      .prepare(
        "SELECT a.id, a.role, a.status, a.google_subject_id, a.auth_version, s.auth_version AS session_auth_version, s.revoked_at, s.expires_at, s.last_seen_at, s.recent_auth_at FROM admin_users a JOIN admin_sessions s ON s.admin_user_id = a.id WHERE a.id = ? AND s.id = ?",
      )
      .bind(input.adminId, input.sessionId)
      .first<Row>();
    if (
      !row ||
      row.status !== "active" ||
      !row.google_subject_id ||
      row.revoked_at !== null ||
      row.auth_version !== row.session_auth_version ||
      Number(row.expires_at) <= now ||
      Number(row.last_seen_at) > now ||
      now - Number(row.last_seen_at) >= SESSION_IDLE_TIMEOUT_MS
    )
      throw new AuthError("ACCESS_DENIED", 403);
    const role = row.role as AdminRole;
    if (!ROLE_PERMISSIONS[role]?.includes(input.permission))
      throw new AuthError("PERMISSION_DENIED", 403);
    const recentGoogleAuthentication =
      Number(row.recent_auth_at) > 0 &&
      Number(row.recent_auth_at) <= now &&
      now - Number(row.recent_auth_at) < RECENT_AUTH_WINDOW_MS;
    const writes = !input.permission.endsWith(".read");
    if (
      (input.requireRecentAuth ||
        [
          "admin.manage",
          "admin.rebind",
          "assignment.manage",
          "system.manage",
          "archive.manage",
        ].includes(input.permission)) &&
      !recentGoogleAuthentication
    )
      throw new AuthError("RECENT_AUTHENTICATION_REQUIRED", 403);
    let historical = input.resource?.historical ?? false;
    if (input.resource)
      historical =
        (await this.assertScope(
          input.adminId,
          role,
          input.resource,
          input.permission === "system.manage",
        )) || historical;
    else if (role !== "super_admin") deny();
    if (
      historical &&
      writes &&
      (role !== "super_admin" ||
        !recentGoogleAuthentication ||
        !input.resource?.historyReason?.trim())
    )
      throw new AuthError("HISTORICAL_SCOPE_DENIED", 403);
    return {
      adminId: String(row.id),
      sessionId: input.sessionId,
      role,
      recentGoogleAuthentication,
    };
  }
  assertPermission(
    session: Pick<AuthSession, "adminId" | "sessionId">,
    permission: Permission,
    resource?: ScopeResource,
    requireRecentAuth = false,
  ) {
    return this.authorize({
      ...session,
      permission,
      resource,
      requireRecentAuth,
    });
  }
  rolePermissions(role: AdminRole): readonly Permission[] {
    return [...ROLE_PERMISSIONS[role]];
  }
  private async assertScope(
    adminId: string,
    role: AdminRole,
    supplied: ScopeResource,
    schoolOnly = false,
  ): Promise<boolean> {
    const resource = { ...supplied };
    if (resource.participationId) {
      const snapshot = await this.db
        .prepare(
          "SELECT p.student_id, p.class_id_snapshot, p.academic_term_id, e.starts_on FROM exam_participations p JOIN exams e ON e.id = p.exam_id WHERE p.id = ?",
        )
        .bind(resource.participationId)
        .first<Row>();
      if (
        !snapshot ||
        (resource.classId && resource.classId !== snapshot.class_id_snapshot) ||
        (resource.studentId && resource.studentId !== snapshot.student_id) ||
        (resource.academicTermId &&
          resource.academicTermId !== snapshot.academic_term_id) ||
        (resource.onDate && resource.onDate !== snapshot.starts_on)
      )
        return deny();
      resource.classId = String(snapshot.class_id_snapshot);
      resource.academicTermId = String(snapshot.academic_term_id);
      resource.onDate = String(snapshot.starts_on);
      delete resource.studentId;
      if (resource.studentIds?.length) deny();
    }
    const onDate = resource.onDate ?? taipeiBusinessDate(this.now());
    try {
      assertBusinessDate(onDate);
    } catch {
      deny();
    }
    const term = resource.academicTermId
      ? await this.db
          .prepare(
            "SELECT t.id, t.academic_year_id, t.starts_on, t.ends_on, (SELECT current_year_id FROM academic_state WHERE id = 1) AS current_year_id FROM academic_terms t WHERE t.id = ?",
          )
          .bind(resource.academicTermId)
          .first<Row>()
      : null;
    if (
      !term ||
      onDate < String(term.starts_on) ||
      onDate >= String(term.ends_on)
    )
      return deny();
    const years = ids(resource.academicYearId, resource.academicYearIds);
    if (years.some((year) => year !== term.academic_year_id)) deny();
    const historical = term.academic_year_id !== term.current_year_id;
    const classIds = ids(resource.classId, resource.classIds);
    const studentIds = ids(resource.studentId, resource.studentIds);
    const explicitClasses = [...classIds];
    for (const studentId of studentIds) {
      const rows = (
        await this.db
          .prepare(
            "SELECT class_id FROM student_enrollments WHERE student_id = ? AND academic_term_id = ? AND status = 'valid' AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)",
          )
          .bind(studentId, term.id, onDate, onDate)
          .all<Row>()
      ).results;
      if (
        rows.length !== 1 ||
        (explicitClasses.length &&
          !explicitClasses.includes(String(rows[0].class_id)))
      )
        deny();
      if (!classIds.includes(String(rows[0].class_id)))
        classIds.push(String(rows[0].class_id));
    }
    const classes: Row[] = [];
    for (const classId of classIds) {
      const row = await this.db
        .prepare("SELECT id, grade, academic_year_id FROM classes WHERE id = ?")
        .bind(classId)
        .first<Row>();
      if (
        !row ||
        row.academic_year_id !== term.academic_year_id ||
        (resource.grade !== undefined && resource.grade !== Number(row.grade))
      )
        return deny();
      classes.push(row);
    }
    if (resource.grade !== undefined && ![7, 8, 9].includes(resource.grade))
      deny();
    if (role === "super_admin") return historical;
    const assignments = (
      await this.db
        .prepare(
          "SELECT scope_type, grade, class_id, subject FROM admin_assignments WHERE admin_user_id = ? AND academic_term_id = ? AND starts_on <= ? AND (ends_on IS NULL OR ends_on > ?)",
        )
        .bind(adminId, term.id, onDate, onDate)
        .all<Row>()
    ).results;
    if (schoolOnly && !assignments.some((a) => a.scope_type === "school"))
      deny();
    const covered = (classId?: string, grade?: number) =>
      assignments.some(
        (a) =>
          a.scope_type === "school" ||
          (a.scope_type === "grade" &&
            grade !== undefined &&
            Number(a.grade) === grade) ||
          (["class", "homeroom"].includes(String(a.scope_type)) &&
            classId !== undefined &&
            a.class_id === classId) ||
          (a.scope_type === "teaching_subject" &&
            classId !== undefined &&
            a.class_id === classId &&
            !!resource.subject &&
            a.subject === resource.subject),
      );
    if (classes.length) {
      for (const row of classes)
        if (!covered(String(row.id), Number(row.grade))) deny();
    } else if (resource.grade !== undefined) {
      if (!covered(undefined, resource.grade)) deny();
    } else if (!assignments.some((a) => a.scope_type === "school")) deny();
    return historical;
  }
}
