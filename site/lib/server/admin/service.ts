import {
  AuthorizationService,
  permissionForAcademicAction,
} from "../auth/authorization.ts";
import {
  AuthError,
  type AuthSession,
  type Permission,
  type AdminRole,
} from "../auth/types.ts";
import { AcademicService } from "../academic/service.ts";
import type {
  AccessRequest,
  NewStudent,
  EnrollmentInput,
} from "../academic/types.ts";
import type { IdentityKeys } from "../identity.ts";
import { RankingService } from "../exams/ranking-service.ts";
import { assertBusinessDate, taipeiBusinessDate } from "../../domain/dates.ts";
import { SUBJECTS } from "../../domain/scores.ts";
import { readAudit } from "./audit.ts";
type Row = Record<string, string | number | null>;
type Input = Record<string, unknown>;
const invalid = (): never => {
  throw new AuthError("INVALID_INPUT", 400);
};
const text = (v: unknown): string =>
  typeof v === "string" && v.length > 0 && v.length <= 300 ? v : invalid();
export class AdminWorkspaceService {
  private db: D1Database;
  private now: () => number;
  private authz: AuthorizationService;
  private keys?: () => IdentityKeys;
  constructor(deps: {
    db: D1Database;
    now?: () => number;
    identityKeys?: () => IdentityKeys;
  }) {
    this.db = deps.db;
    this.now = deps.now ?? Date.now;
    this.authz = new AuthorizationService(deps);
    this.keys = deps.identityKeys;
  }
  private async all(sql: string, ...args: (string | number | null)[]) {
    return (
      await this.db
        .prepare(sql)
        .bind(...args)
        .all<Row>()
    ).results;
  }
  private async one(sql: string, ...args: (string | number | null)[]) {
    const rows = await this.all(sql, ...args);
    if (rows.length !== 1) throw new AuthError("RESOURCE_UNAVAILABLE", 404);
    return rows[0];
  }
  private async allowed(
    session: AuthSession,
    permission: Permission,
    resource: Parameters<AuthorizationService["assertPermission"]>[2],
  ) {
    try {
      await this.authz.assertPermission(session, permission, resource);
      return true;
    } catch (e) {
      if (
        e instanceof AuthError &&
        [
          "SCOPE_DENIED",
          "PERMISSION_DENIED",
          "HISTORICAL_SCOPE_DENIED",
          "RECENT_AUTHENTICATION_REQUIRED",
        ].includes(e.code)
      )
        return false;
      throw e;
    }
  }
  async profile(session: AuthSession) {
    const user = await this.one(
      "SELECT id,username,display_name,authorized_email,role,status,auth_version FROM admin_users WHERE id=?",
      session.adminId,
    );
    // validateSession is required by the HTTP boundary; these are only the current user's assignments.
    const assignments = await this.all(
      "SELECT id,academic_term_id,scope_type,grade,class_id,subject,starts_on,ends_on FROM admin_assignments WHERE admin_user_id=?",
      session.adminId,
    );
    return {
      user,
      assignments,
      permissions: this.authz.rolePermissions(user.role as AdminRole),
      recentAuthenticatedAt: session.recentAuthenticatedAt,
      expiresAt: session.expiresAt,
    };
  }
  async terms(session: AuthSession) {
    const terms = await this.all(
      "SELECT t.id,t.academic_year_id,t.term_number,t.starts_on,t.ends_on,y.code AS year_code,CASE WHEN s.current_year_id=y.id THEN 1 ELSE 0 END AS is_current FROM academic_terms t JOIN academic_years y ON y.id=t.academic_year_id CROSS JOIN academic_state s ORDER BY y.starts_on DESC,t.term_number DESC",
    );
    if (session.role === "super_admin") {
      await this.authz.assertPermission(session, "academic.read");
      return terms;
    }
    const assignments = await this.all(
      "SELECT academic_term_id FROM admin_assignments WHERE admin_user_id=?",
      session.adminId,
    );
    return terms.filter((t) =>
      assignments.some((a) => a.academic_term_id === t.id),
    );
  }
  async context(session: AuthSession, input: Input) {
    const term = await this.one(
      "SELECT id,academic_year_id,starts_on,ends_on FROM academic_terms WHERE id=?",
      text(input.termId),
    );
    const date = text(input.onDate);
    assertBusinessDate(date);
    if (date < String(term.starts_on) || date >= String(term.ends_on))
      invalid();
    const classes = await this.all(
      "SELECT id,code,grade,archived_at FROM classes WHERE academic_year_id=? ORDER BY code",
      term.academic_year_id,
    );
    const output = [];
    for (const row of classes) {
      const resource = {
        academicTermId: String(term.id),
        classId: String(row.id),
        onDate: date,
      };
      const capabilities: string[] = [];
      for (const p of [
        "academic.read",
        "academic.write",
        "score.read",
        "score.write",
        "ai.read",
        "ai.manage",
        "archive.read",
        "archive.manage",
      ] as Permission[])
        if (await this.allowed(session, p, resource)) capabilities.push(p);
      const subjects: string[] = [];
      for (const subject of SUBJECTS)
        if (
          capabilities.includes("score.read") ||
          (await this.allowed(session, "score.read", { ...resource, subject }))
        )
          subjects.push(subject);
      if (capabilities.length || subjects.length)
        output.push({ ...row, capabilities, subjects });
    }
    const exams = await this.all(
      "SELECT id,sequence,starts_on,ends_on,version,published_at,locked_at,archived_at FROM exams WHERE academic_term_id=? ORDER BY sequence",
      term.id,
    );
    const visibleExams = [];
    for (const exam of exams) {
      let visible = false;
      for (const c of classes) {
        for (const permission of ["score.read", "ai.read"] as Permission[]) {
          if (
            await this.allowed(session, permission, {
              academicTermId: String(term.id),
              classId: String(c.id),
              onDate: String(exam.starts_on),
            })
          )
            visible = true;
        }
        if (!visible)
          for (const subject of SUBJECTS)
            if (
              await this.allowed(session, "score.read", {
                academicTermId: String(term.id),
                classId: String(c.id),
                onDate: String(exam.starts_on),
                subject,
              })
            )
              visible = true;
      }
      if (visible) visibleExams.push(exam);
    }
    return { classes: output, exams: visibleExams };
  }
  private academic(session: AuthSession) {
    return new AcademicService({
      db: this.db,
      now: this.now,
      identityKeys: this.keys,
      authorize: async (request: AccessRequest) => {
        const permission = permissionForAcademicAction(request.action);
        if (!permission) throw new AuthError("PERMISSION_DENIED", 403);
        if (session.role === "super_admin")
          return this.authz.assertPermission(
            session,
            permission,
            undefined,
            request.resources.historicalYearIds.length > 0,
          );
        let grant;
        if (request.resources.scopeContexts?.length) {
          for (const context of request.resources.scopeContexts) {
            grant = await this.authz.assertPermission(session, permission, {
              academicTermId: context.termId,
              classId: context.classId,
              onDate: context.onDate,
              historyReason: request.historyReason ?? undefined,
            });
          }
        } else {
          const date = taipeiBusinessDate(this.now());
          const term = await this.one(
            "SELECT t.id,t.academic_year_id FROM academic_terms t JOIN academic_state s ON s.current_year_id=t.academic_year_id WHERE t.starts_on<=? AND t.ends_on>?",
            date,
            date,
          );
          if (
            request.resources.yearIds.some(
              (y) => y !== term.academic_year_id,
            ) &&
            request.action !== "CREATE_YEAR"
          )
            throw new AuthError("HISTORICAL_SCOPE_DENIED", 403);
          grant = await this.authz.assertPermission(session, permission, {
            academicTermId: String(term.id),
            onDate: date,
            historyReason: request.historyReason ?? undefined,
          });
        }
        return grant ?? null;
      },
    });
  }
  async execute(session: AuthSession, operation: string, input: Input) {
    if (operation === "audit")
      return readAudit(
        { db: this.db, authorization: this.authz, now: this.now },
        session,
        input,
      );
    if (operation === "user-details") {
      await this.authz.assertPermission(session, "admin.read");
      const user = await this.one(
        "SELECT id,username,display_name,authorized_email,role,status,auth_version FROM admin_users WHERE id=?",
        text(input.id),
      );
      const assignments = await this.all(
        "SELECT id,academic_term_id,scope_type,grade,class_id,subject,starts_on,ends_on FROM admin_assignments WHERE admin_user_id=?",
        text(input.id),
      );
      await this.authz.assertPermission(session, "admin.read");
      return { user, assignments };
    }
    if (operation === "selection") {
      if (!["ai", "score", "archive"].includes(String(input.purpose)))
        invalid();
      const permission = (input.purpose + ".read") as Permission;
      const classId = text(input.classId);
      if (input.examId) {
        const exam = await this.one(
          "SELECT academic_term_id,starts_on FROM exams WHERE id=?",
          text(input.examId),
        );
        const resource = {
          academicTermId: String(exam.academic_term_id),
          classId,
          onDate: String(exam.starts_on),
          ...(typeof input.subject === "string"
            ? { subject: input.subject }
            : {}),
        };
        await this.authz.assertPermission(session, permission, resource);
        const students = await this.all(
          "SELECT p.student_id AS id,s.name,p.seat_number_snapshot AS seat_number FROM exam_participations p JOIN students s ON s.id=p.student_id WHERE p.exam_id=? AND p.class_id_snapshot=? AND p.origin='LOCAL' AND s.deleted_at IS NULL ORDER BY p.seat_number_snapshot",
          text(input.examId),
          classId,
        );
        await this.authz.assertPermission(session, permission, resource);
        return { students };
      }
      const resource = {
        academicTermId: text(input.termId),
        classId,
        onDate: text(input.onDate),
        ...(typeof input.subject === "string"
          ? { subject: input.subject }
          : {}),
      };
      await this.authz.assertPermission(session, permission, resource);
      const students = await this.all(
        "SELECT s.id,s.name,e.seat_number FROM student_enrollments e JOIN students s ON s.id=e.student_id WHERE e.academic_term_id=? AND e.class_id=? AND e.status='valid' AND s.deleted_at IS NULL AND e.effective_from<=? AND (e.effective_to IS NULL OR e.effective_to>?) ORDER BY e.seat_number",
        resource.academicTermId,
        classId,
        resource.onDate,
        resource.onDate,
      );
      await this.authz.assertPermission(session, permission, resource);
      return { students };
    }
    if (operation === "profile") return this.profile(session);
    if (operation === "terms") return { terms: await this.terms(session) };
    if (operation === "context") return this.context(session, input);
    if (operation === "roster") {
      const termId = text(input.termId),
        classId = text(input.classId),
        onDate = text(input.onDate);
      await this.authz.assertPermission(session, "academic.read", {
        academicTermId: termId,
        classId,
        onDate,
      });
      const rows = await this.all(
        "SELECT s.id,s.name,s.student_number,s.birth_date,s.status,e.id AS enrollment_id,e.seat_number,e.effective_from,e.effective_to FROM student_enrollments e JOIN students s ON s.id=e.student_id WHERE e.academic_term_id=? AND e.class_id=? AND e.status='valid' AND s.deleted_at IS NULL AND e.effective_from<=? AND (e.effective_to IS NULL OR e.effective_to>?) ORDER BY e.seat_number",
        termId,
        classId,
        onDate,
        onDate,
      );
      await this.authz.assertPermission(session, "academic.read", {
        academicTermId: termId,
        classId,
        onDate,
      });
      return { students: rows };
    }
    if (
      operation === "rankings" &&
      !["FINAL", "PROVISIONAL"].includes(String(input.mode))
    )
      invalid();
    if (
      operation === "students-preview" &&
      !["new", "transfer_in"].includes(String(input.mode))
    )
      invalid();
    if (operation === "rankings")
      return new RankingService({ db: this.db, now: this.now }).calculate(
        session,
        text(input.examId),
        input.grade
          ? { grade: Number(input.grade) }
          : { classId: text(input.classId) },
        input.mode === "FINAL" ? "FINAL" : "PROVISIONAL",
      );
    const academic = this.academic(session),
      options = {
        historyReason:
          typeof input.historyReason === "string"
            ? input.historyReason
            : undefined,
      };
    switch (operation) {
      case "year-preview":
        return academic.previewAcademicYear(
          input as Parameters<AcademicService["previewAcademicYear"]>[0],
        );
      case "classes-preview":
        return academic.previewClasses(
          text(input.yearId),
          input.codes as string[],
          options,
        );
      case "students-preview":
        return academic.previewNewStudents(
          text(input.termId),
          input.rows as NewStudent[],
          input.mode === "transfer_in" ? "transfer_in" : "new",
          options,
        );
      case "enrollments-preview":
        return academic.previewEnrollments(
          text(input.termId),
          input.rows as EnrollmentInput[],
          options,
        );
      case "move-preview":
        return academic.previewMove(
          input as Parameters<AcademicService["previewMove"]>[0],
          options,
        );
      case "promotion-preview":
        return academic.previewPromotion(
          input as Parameters<AcademicService["previewPromotion"]>[0],
          options,
        );
      case "transfer-preview":
        return academic.previewTransferOut(
          text(input.studentId),
          text(input.effectiveOn),
          options,
        );
      case "undo-preview":
        return academic.previewUndo(text(input.operationId), options);
      case "academic-confirm":
        return academic.confirm(text(input.previewId), {
          confirmed: input.confirmed === true,
        });
      default:
        throw new AuthError("OPERATION_NOT_ALLOWED", 400);
    }
  }
}
