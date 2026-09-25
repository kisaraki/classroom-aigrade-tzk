import {
  archivePreflight,
  type ArchiveWarningCode,
} from "../../domain/archive-preflight.ts";
import {
  retentionDeadlines,
  withinPublicDeadline,
  type RetentionEvent,
} from "../../domain/retention.ts";
import {
  addCalendarMonths,
  addCalendarYears,
  assertBusinessDate,
  taipeiBusinessDate,
} from "../../domain/dates.ts";
import { AuthorizationService } from "../auth/authorization.ts";
import {
  RECENT_AUTH_WINDOW_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from "../auth/policy.ts";
import type { AuthSession, ScopeResource } from "../auth/types.ts";
import { ExamError } from "../../domain/scores.ts";
type Row = Record<string, string | number | null>;
type Change = {
  table: "students" | "classes" | "student_enrollments" | "retention_events";
  before: Row | null;
  after: Row;
};
type Target = {
  academicTermId: string;
  onDate: string;
  studentId?: string;
  classId?: string;
  grade?: number;
};
export type ArchiveRequest =
  | {
      action: "ARCHIVE" | "GRADUATE" | "EXTEND" | "READMIT";
      target: Target;
      reason: string;
      force?: boolean;
      until?: string;
      seatNumber?: number;
    }
  | { action: "UNDO" | "RESTORE"; batchId: string; reason: string };
type Plan = {
  request: ArchiveRequest;
  resources: ScopeResource[];
  changes: Change[];
  students: string[];
  batchId: string | null;
  restoreBatchId: string | null;
  warnings: ReturnType<typeof archivePreflight> | null;
};
const fail = (code: string, status = 409): never => {
  throw new ExamError(code, status);
};
const studentFields =
  "id,status,transferred_out_on,graduated_on,retention_until,public_query_until,deleted_at,archived_at,version,updated_at";
const validDate = (s: unknown) => {
  if (typeof s !== "string") return fail("INVALID_BUSINESS_DATE", 400);
  try {
    assertBusinessDate(s);
  } catch {
    fail("INVALID_BUSINESS_DATE", 400);
  }
  return s;
};
export class ArchiveService {
  private db: D1Database;
  private now: () => number;
  private authorization: AuthorizationService;
  constructor(deps: { db: D1Database; now?: () => number }) {
    this.db = deps.db;
    this.now = deps.now ?? Date.now;
    this.authorization = new AuthorizationService(deps);
  }
  private sql(q: string, ...v: (string | number | null)[]) {
    return this.db.prepare(q).bind(...v);
  }
  private async rows(q: string, ...v: (string | number | null)[]) {
    return (await this.sql(q, ...v).all<Row>()).results;
  }
  private async state() {
    return (
      (await this.sql(
        "SELECT a.revision AS academic_revision,r.revision AS archive_revision FROM academic_state a CROSS JOIN archive_state r WHERE a.id=1 AND r.id=1",
      ).first<Row>()) ?? fail("ARCHIVE_STATE_UNAVAILABLE", 503)
    );
  }
  private async access(s: AuthSession, p: Plan, write = true) {
    for (const resource of p.resources) {
      await this.authorization.assertPermission(
        s,
        write ? "archive.manage" : "archive.read",
        resource,
        write,
      );
      if (write && p.request.action === "READMIT")
        await this.authorization.assertPermission(
          s,
          "academic.write",
          resource,
          true,
        );
    }
  }
  private change(
    p: Plan,
    table: Change["table"],
    before: Row | null,
    patch: Row,
  ) {
    p.changes.push({
      table,
      before,
      after: before ? { ...before, ...patch } : patch,
    });
  }
  private async events(studentId: string) {
    return await this.rows(
      "SELECT * FROM retention_events WHERE student_id=?",
      studentId,
    );
  }
  private event(
    s: AuthSession,
    studentId: string,
    kind: string,
    on: string,
    until: string,
    reason: string,
  ): Row {
    return {
      id: crypto.randomUUID(),
      student_id: studentId,
      kind,
      effective_on: on,
      public_until: until,
      retention_until: until,
      actor_id: s.adminId,
      reason,
      revoked_at: null,
      version: 1,
      created_at: this.now(),
    };
  }
  private validate(r: ArchiveRequest) {
    if (
      !r ||
      typeof r !== "object" ||
      typeof r.reason !== "string" ||
      !r.reason.trim() ||
      r.reason.length > 320
    )
      fail("ARCHIVE_REASON_REQUIRED", 400);
    const keys =
      r.action === "UNDO" || r.action === "RESTORE"
        ? ["action", "batchId", "reason"]
        : ["action", "target", "reason", "force", "until", "seatNumber"];
    if (Object.keys(r).some((k) => !keys.includes(k)))
      fail("INVALID_ARCHIVE_INPUT", 400);
    if (r.action === "UNDO" || r.action === "RESTORE") {
      if (typeof r.batchId !== "string") fail("INVALID_ARCHIVE_INPUT", 400);
      return;
    }
    if (!["ARCHIVE", "GRADUATE", "EXTEND", "READMIT"].includes(r.action))
      fail("INVALID_ARCHIVE_INPUT", 400);
    if (!("target" in r)) return fail("INVALID_ARCHIVE_INPUT", 400);
    const t = r.target;
    if (
      !t ||
      typeof t.academicTermId !== "string" ||
      Object.keys(t).some(
        (k) =>
          ![
            "academicTermId",
            "onDate",
            "studentId",
            "classId",
            "grade",
          ].includes(k),
      )
    )
      fail("INVALID_ARCHIVE_TARGET", 400);
    validDate(t.onDate);
    if (t.onDate > taipeiBusinessDate(this.now()))
      fail("FUTURE_ARCHIVE_NOT_SUPPORTED", 400);
    if (r.force !== undefined && typeof r.force !== "boolean")
      fail("INVALID_ARCHIVE_INPUT", 400);
    if (r.action === "READMIT") {
      if (
        typeof t.studentId !== "string" ||
        typeof t.classId !== "string" ||
        t.grade !== undefined ||
        !Number.isSafeInteger(r.seatNumber) ||
        Number(r.seatNumber) < 1
      )
        fail("INVALID_READMISSION", 400);
    } else if (
      [t.studentId, t.classId, t.grade].filter((v) => v !== undefined)
        .length !== 1
    )
      fail("INVALID_ARCHIVE_TARGET", 400);
    if (
      (t.studentId !== undefined && typeof t.studentId !== "string") ||
      (t.classId !== undefined && typeof t.classId !== "string") ||
      (t.grade !== undefined && ![7, 8, 9].includes(t.grade))
    )
      fail("INVALID_ARCHIVE_TARGET", 400);
    if (r.action === "GRADUATE" && t.grade !== 9)
      fail("GRADUATION_REQUIRES_GRADE_NINE", 400);
    if (r.action === "EXTEND" && (!t.studentId || !r.until))
      fail("EXTENSION_REQUIRES_STUDENT", 400);
  }
  private async resolve(t: Target, reason: string, readmit = false) {
    const term = await this.sql(
      "SELECT * FROM academic_terms WHERE id=?",
      t.academicTermId,
    ).first<Row>();
    if (
      !term ||
      t.onDate < String(term.starts_on) ||
      t.onDate >= String(term.ends_on)
    )
      return fail("INVALID_ARCHIVE_TERM", 400);
    let classes: Row[];
    if (t.studentId && !readmit) {
      const enrollment = await this.sql(
        "SELECT class_id FROM student_enrollments WHERE student_id=? AND academic_term_id=? AND status='valid' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1",
        t.studentId,
        t.academicTermId,
        t.onDate,
      ).first<Row>();
      if (!enrollment) return fail("STUDENT_SCOPE_UNAVAILABLE", 404);
      classes = await this.rows(
        "SELECT id,archived_at,grade,academic_year_id FROM classes WHERE id=?",
        enrollment.class_id,
      );
    } else
      classes = await this.rows(
        "SELECT id,archived_at,grade,academic_year_id FROM classes WHERE academic_year_id=? AND (? IS NULL OR id=?) AND (? IS NULL OR grade=?) ORDER BY id",
        term.academic_year_id,
        t.classId ?? null,
        t.classId ?? null,
        t.grade ?? null,
        t.grade ?? null,
      );
    if (!classes.length) fail("ARCHIVE_TARGET_NOT_FOUND", 404);
    const resources = classes.map((c) => ({
      academicTermId: t.academicTermId,
      classId: String(c.id),
      onDate: t.onDate,
      historyReason: reason,
    }));
    return { term, classes, resources };
  }
  private async warnings(ids: string[], classIds: string[], termId: string) {
    const counts: Record<ArchiveWarningCode, number> = {
      MISSING_SCORES: 0,
      AI_INCOMPLETE: 0,
      UNPUBLISHED_EXAMS: 0,
      IMPORT_INCOMPLETE: 0,
      AI_FAILED: 0,
    };
    const exams = new Set<string>(
      (
        await this.rows("SELECT id FROM exams WHERE academic_term_id=?", termId)
      ).map((e) => String(e.id)),
    );
    for (const id of ids) {
      const missing = await this.sql(
        "SELECT count(*) AS n FROM exam_participations p JOIN exams e ON e.id=p.exam_id JOIN exam_subject_settings s ON s.exam_id=p.exam_id LEFT JOIN score_items v ON v.participation_id=p.id AND v.setting_id=s.id WHERE p.student_id=? AND p.academic_term_id=? AND p.origin='LOCAL' AND s.held=1 AND (v.id IS NULL OR v.score_status='UNENTERED')",
        id,
        termId,
      ).first<Row>();
      counts.MISSING_SCORES += Number(missing?.n ?? 0);
      for (const e of await this.rows(
        "SELECT DISTINCT exam_id FROM exam_participations WHERE student_id=? AND academic_term_id=?",
        id,
        termId,
      ))
        exams.add(String(e.exam_id));
      for (const j of await this.rows(
        "SELECT j.status,count(*) AS n FROM ai_jobs j JOIN exams e ON e.id=j.exam_id WHERE j.student_id=? AND e.academic_term_id=? GROUP BY j.status",
        id,
        termId,
      )) {
        if (j.status === "pending" || j.status === "processing")
          counts.AI_INCOMPLETE += Number(j.n);
        if (j.status === "failed") counts.AI_FAILED += Number(j.n);
      }
    }
    for (const id of exams) {
      const v = await this.sql(
        "SELECT provisional FROM exam_result_versions WHERE exam_id=? AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1",
        id,
      ).first<Row>();
      if (!v || v.provisional === 1) counts.UNPUBLISHED_EXAMS++;
    }
    const jobs = await this.rows(
      "SELECT id,status,mapping_json FROM import_jobs WHERE status NOT IN ('COMMITTED','ROLLED_BACK','FAILED')",
    );
    for (const j of jobs) {
      const target = JSON.parse(String(j.mapping_json ?? "{}"))?.target;
      if (target && classIds.includes(target.classId))
        counts.IMPORT_INCOMPLETE++;
    }
    return counts;
  }
  async preview(session: AuthSession, request: ArchiveRequest) {
    this.validate(request);
    const base = await this.state();
    const p: Plan = {
      request,
      resources: [],
      changes: [],
      students: [],
      batchId: null,
      restoreBatchId: null,
      warnings: null,
    };
    if (request.action === "UNDO" || request.action === "RESTORE") {
      const batch = await this.sql(
        "SELECT * FROM archive_batches WHERE id=?",
        request.batchId,
      ).first<Row>();
      if (!batch) return fail("ARCHIVE_BATCH_NOT_FOUND", 404);
      const manifest = JSON.parse(String(batch.manifest_json)) as {
        resources: ScopeResource[];
      };
      p.resources = manifest.resources.map((r) => ({
        ...r,
        historyReason: request.reason,
      }));
      await this.access(session, p);
      if (batch.status !== "archived") fail("ARCHIVE_ALREADY_RESTORED");
      if (request.action === "UNDO" && this.now() >= Number(batch.undo_until))
        fail("ARCHIVE_UNDO_EXPIRED");
      const items = await this.rows(
        "SELECT * FROM archive_items WHERE batch_id=? ORDER BY id",
        batch.id,
      );
      if (
        !items.length ||
        items.some((i) => i.purged_at !== null || i.status !== "archived")
      )
        fail("ARCHIVE_NOT_RESTORABLE");
      for (const item of items) {
        const c: Change = JSON.parse(String(item.snapshot_json));
        if (
          ![
            "students",
            "classes",
            "student_enrollments",
            "retention_events",
          ].includes(c.table)
        )
          fail("INVALID_ARCHIVE_MANIFEST");
        const current = await this.sql(
          `SELECT * FROM ${c.table} WHERE id=?`,
          c.after.id,
        ).first<Row>();
        if (
          !current ||
          Object.entries(c.after).some(([k, v]) => current[k] !== v)
        )
          return fail("ARCHIVE_RESTORE_CONFLICT");
        const before = Object.fromEntries(
          Object.keys(c.after).map((k) => [k, current[k]]),
        );
        const after: Row = c.before
          ? { ...c.before }
          : c.table === "retention_events"
            ? { ...before, revoked_at: this.now() }
            : { ...before, status: "voided" };
        if ("version" in before) after.version = Number(before.version) + 1;
        if ("updated_at" in before) after.updated_at = this.now();
        this.change(p, c.table, before, after);
        if (item.student_id) p.students.push(String(item.student_id));
      }
      // Void inserted enrollment segments before restoring the originals to avoid overlap.
      p.changes.sort(
        (a, b) =>
          Number(
            b.table === "student_enrollments" && b.after.status === "voided",
          ) -
          Number(
            a.table === "student_enrollments" && a.after.status === "voided",
          ),
      );
      p.restoreBatchId = String(batch.id);
    } else {
      if (!("target" in request)) return fail("INVALID_ARCHIVE_INPUT", 400);
      const t = request.target,
        { term, classes, resources } = await this.resolve(
          t,
          request.reason,
          request.action === "READMIT",
        );
      p.resources = resources;
      await this.access(session, p);
      const ids: string[] = [];
      if (t.studentId) ids.push(t.studentId);
      else
        for (const c of classes) {
          for (const n of await this.rows(
            "SELECT n.student_id FROM student_enrollments n WHERE n.academic_term_id=? AND n.class_id=? AND n.status='valid' AND n.effective_from<=? AND NOT EXISTS (SELECT 1 FROM student_enrollments newer WHERE newer.student_id=n.student_id AND newer.academic_term_id=n.academic_term_id AND newer.status='valid' AND newer.effective_from<=? AND newer.effective_from>n.effective_from)",
            t.academicTermId,
            c.id,
            t.onDate,
            t.onDate,
          ))
            ids.push(String(n.student_id));
        }
      p.students = [...new Set(ids)];
      if (!p.students.length) fail("EMPTY_ARCHIVE_TARGET");
      if (request.action === "ARCHIVE" || request.action === "GRADUATE") {
        p.batchId = crypto.randomUUID();
        p.warnings = archivePreflight(
          await this.warnings(
            p.students,
            classes.map((c) => String(c.id)),
            t.academicTermId,
          ),
          { force: request.force === true, reason: request.reason },
        );
        if (!t.studentId)
          for (const c of classes) {
            if (c.archived_at !== null) fail("CLASS_ALREADY_ARCHIVED");
            this.change(
              p,
              "classes",
              { id: c.id, archived_at: c.archived_at },
              { archived_at: this.now() },
            );
          }
      }
      for (const id of p.students) {
        const student = await this.sql(
          `SELECT ${studentFields} FROM students WHERE id=?`,
          id,
        ).first<Row>();
        if (!student || student.deleted_at !== null)
          return fail("STUDENT_UNAVAILABLE");
        const events = await this.events(id);
        if (request.action === "EXTEND") {
          const until = validDate(request.until);
          const current = retentionDeadlines(
            events as unknown as RetentionEvent[],
          );
          if (
            student.status === "active" ||
            !current.publicUntil ||
            until <= current.publicUntil ||
            until <= taipeiBusinessDate(this.now())
          )
            fail("EXTENSION_MUST_LENGTHEN");
          const event = this.event(
            session,
            id,
            "EXTENSION",
            taipeiBusinessDate(this.now()),
            until,
            request.reason,
          );
          this.change(p, "retention_events", null, event);
          const deadlines = retentionDeadlines([
            ...events,
            event,
          ] as unknown as RetentionEvent[]);
          this.change(p, "students", student, {
            public_query_until: deadlines.publicUntil,
            retention_until: deadlines.retentionUntil,
            version: Number(student.version) + 1,
            updated_at: this.now(),
          });
        } else if (request.action === "READMIT") {
          if (student.status === "active" || classes[0].archived_at !== null)
            fail("READMISSION_NOT_ALLOWED");
          if (
            (
              await this.rows(
                "SELECT id FROM student_enrollments WHERE student_id=? AND status='valid' AND (effective_to IS NULL OR effective_to>?)",
                id,
                t.onDate,
              )
            ).length
          )
            fail("READMISSION_ENROLLMENT_CONFLICT");
          this.change(p, "students", student, {
            status: "active",
            archived_at: null,
            retention_until: null,
            public_query_until: null,
            version: Number(student.version) + 1,
            updated_at: this.now(),
          });
          this.change(p, "student_enrollments", null, {
            id: crypto.randomUUID(),
            student_id: id,
            academic_year_id: term.academic_year_id,
            academic_term_id: term.id,
            class_id: classes[0].id,
            seat_number: Number(request.seatNumber),
            effective_from: t.onDate,
            effective_to: null,
            ranking_eligible: 1,
            change_source: "READMIT",
            status: "valid",
            version: 1,
            created_at: this.now(),
          });
        } else {
          if (student.archived_at !== null) fail("STUDENT_ALREADY_ARCHIVED");
          const patch: Row = {
            archived_at: this.now(),
            version: Number(student.version) + 1,
            updated_at: this.now(),
          };
          if (request.action === "GRADUATE") {
            const event = this.event(
              session,
              id,
              "GRADUATION",
              t.onDate,
              addCalendarYears(t.onDate, 1),
              request.reason,
            );
            this.change(p, "retention_events", null, event);
            const deadlines = retentionDeadlines([
              ...events,
              event,
            ] as unknown as RetentionEvent[]);
            Object.assign(patch, {
              status: "graduated",
              graduated_on: t.onDate,
              public_query_until: deadlines.publicUntil,
              retention_until: deadlines.retentionUntil,
            });
            for (const n of await this.rows(
              "SELECT * FROM student_enrollments WHERE student_id=? AND status='valid' AND (effective_to IS NULL OR effective_to>?)",
              id,
              t.onDate,
            )) {
              // Never mutate an enrollment referenced by an assessment; preserve it as voided and create its closed prefix.
              this.change(p, "student_enrollments", n, {
                status: "voided",
                version: Number(n.version) + 1,
              });
              if (String(n.effective_from) < t.onDate)
                this.change(p, "student_enrollments", null, {
                  ...n,
                  id: crypto.randomUUID(),
                  effective_to: t.onDate,
                  change_source: "GRADUATION",
                  version: 1,
                  created_at: this.now(),
                });
            }
          }
          this.change(p, "students", student, patch);
        }
      }
    }
    p.students = [...new Set(p.students)];
    // Archiving a person affects their current activity, even when the request selected an older roster.
    for (const studentId of p.students) {
      const today = taipeiBusinessDate(this.now());
      for (const n of await this.rows(
        "SELECT n.class_id,n.academic_term_id FROM student_enrollments n JOIN academic_terms t ON t.id=n.academic_term_id WHERE n.student_id=? AND n.status='valid' AND n.effective_from<=? AND (n.effective_to IS NULL OR n.effective_to>?) AND t.starts_on<=? AND t.ends_on>?",
        studentId,
        today,
        today,
        today,
        today,
      ))
        p.resources.push({
          academicTermId: String(n.academic_term_id),
          classId: String(n.class_id),
          onDate: today,
          historyReason: request.reason,
        });
    }
    for (const c of p.changes)
      if (c.table === "student_enrollments" && c.before)
        p.resources.push({
          academicTermId: String(c.before.academic_term_id),
          classId: String(c.before.class_id),
          onDate: String(c.before.effective_from),
          historyReason: request.reason,
        });
    await this.access(session, p);
    const current = await this.state();
    if (
      current.academic_revision !== base.academic_revision ||
      current.archive_revision !== base.archive_revision
    )
      fail("ARCHIVE_SOURCE_CHANGED");
    const id = crypto.randomUUID();
    await this.sql(
      "INSERT INTO archive_previews (id,actor_id,academic_revision,archive_revision,payload_json,created_at) VALUES (?,?,?,?,?,?)",
      id,
      session.adminId,
      base.academic_revision,
      base.archive_revision,
      JSON.stringify(p),
      this.now(),
    ).run();
    return {
      previewId: id,
      action: request.action,
      studentIds: p.students,
      warnings: p.warnings?.warnings ?? [],
      requiresForce: p.warnings ? !p.warnings.warningsAcknowledged : false,
      changes: p.changes
        .filter((c) => c.table === "students")
        .map((c) => ({
          studentId: c.after.id,
          before: c.before,
          after: c.after,
        })),
    };
  }
  private statement(c: Change) {
    const keys = Object.keys(c.after);
    if (
      ![
        "students",
        "classes",
        "student_enrollments",
        "retention_events",
      ].includes(c.table) ||
      keys.some((k) => !/^[a-z_]+$/.test(k))
    )
      fail("INVALID_ARCHIVE_MANIFEST");
    if (!c.before)
      return this.sql(
        `INSERT INTO ${c.table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        ...Object.values(c.after),
      );
    return this.sql(
      `UPDATE ${c.table} SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`,
      ...Object.values(c.after),
      c.before.id,
    );
  }
  async confirm(session: AuthSession, id: string, confirmed: boolean) {
    if (confirmed !== true) fail("CONFIRMATION_REQUIRED", 400);
    const preview = await this.sql(
      "SELECT * FROM archive_previews WHERE id=? AND actor_id=?",
      id,
      session.adminId,
    ).first<Row>();
    if (!preview) return fail("ARCHIVE_PREVIEW_NOT_FOUND", 404);
    const p: Plan = JSON.parse(String(preview.payload_json));
    await this.access(session, p);
    if (preview.result_json)
      return { ...JSON.parse(String(preview.result_json)), replayed: true };
    if (
      p.warnings &&
      (!p.warnings.warningsAcknowledged || p.warnings.reasonRequired)
    )
      fail("ARCHIVE_WARNINGS_REQUIRE_FORCE");
    if (p.request.action === "UNDO") {
      const b = await this.sql(
        "SELECT undo_until FROM archive_batches WHERE id=?",
        p.restoreBatchId,
      ).first<Row>();
      if (!b || this.now() >= Number(b.undo_until))
        fail("ARCHIVE_UNDO_EXPIRED");
    }
    const now = this.now(),
      result = {
        previewId: id,
        batchId: p.batchId ?? p.restoreBatchId,
        action: p.request.action,
        replayed: false,
      };
    const writes = [
      this.sql(
        "INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until) VALUES (CASE WHEN EXISTS(SELECT 1 FROM academic_state a CROSS JOIN archive_state r WHERE a.id=1 AND r.id=1 AND a.revision=? AND r.revision=?) AND EXISTS(SELECT 1 FROM archive_previews WHERE id=? AND result_json IS NULL) AND EXISTS(SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id WHERE a.id=? AND s.id=? AND a.status='active' AND a.google_subject_id IS NOT NULL AND a.role IN ('super_admin','archive_admin') AND a.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=? AND s.recent_auth_at>? AND s.recent_auth_at<=?) THEN ? ELSE NULL END,?,?, 'archive',?,?,'success',?,?,?)",
        preview.academic_revision,
        preview.archive_revision,
        id,
        session.adminId,
        session.sessionId,
        now,
        now - SESSION_IDLE_TIMEOUT_MS,
        now,
        now - RECENT_AUTH_WINDOW_MS,
        now,
        crypto.randomUUID(),
        session.adminId,
        `ARCHIVE_${p.request.action}`,
        p.batchId ?? p.restoreBatchId ?? id,
        id,
        JSON.stringify({
          count: p.students.length,
          force: "force" in p.request && p.request.force === true,
        }),
        now,
        addCalendarMonths(taipeiBusinessDate(now), 2),
      ),
    ];
    if (p.batchId) {
      writes.push(
        this.sql(
          "INSERT INTO archive_batches (id,actor_id,reason,status,manifest_json,undo_until,created_at) VALUES (?,?,?,'archived',?,?,?)",
          p.batchId,
          session.adminId,
          p.request.reason,
          JSON.stringify({
            resources: p.resources,
            action: p.request.action,
            studentIds: p.students,
            warnings: p.warnings?.warnings,
          }),
          now + 30 * 86400000,
          now,
        ),
      );
      for (const c of p.changes)
        writes.push(
          this.sql(
            "INSERT INTO archive_items (id,batch_id,entity_type,entity_id,student_id,source_version,snapshot_json,status,purge_eligible_on) VALUES (?,?,?,?,?,?,?,'archived',?)",
            crypto.randomUUID(),
            p.batchId,
            c.table,
            c.after.id,
            c.table === "students" ? c.after.id : (c.after.student_id ?? null),
            Number(c.before?.version ?? 1),
            JSON.stringify(c),
            c.table === "students" ? (c.after.retention_until ?? null) : null,
          ),
        );
    }
    writes.push(...p.changes.map((c) => this.statement(c)));
    if (p.restoreBatchId)
      writes.push(
        this.sql(
          "UPDATE archive_batches SET status='restored',restored_at=? WHERE id=?",
          now,
          p.restoreBatchId,
        ),
        this.sql(
          "UPDATE archive_items SET status='restored' WHERE batch_id=?",
          p.restoreBatchId,
        ),
      );
    writes.push(
      this.sql(
        "UPDATE archive_previews SET result_json=? WHERE id=?",
        JSON.stringify(result),
        id,
      ),
    );
    try {
      await this.db.batch(writes);
    } catch {
      await this.access(session, p);
      const replay = await this.sql(
        "SELECT result_json FROM archive_previews WHERE id=?",
        id,
      ).first<Row>();
      if (replay?.result_json)
        return { ...JSON.parse(String(replay.result_json)), replayed: true };
      fail("ARCHIVE_CONFLICT");
    }
    return result;
  }
  async readBatch(session: AuthSession, id: string) {
    const b = await this.sql(
      "SELECT * FROM archive_batches WHERE id=?",
      id,
    ).first<Row>();
    if (!b) return fail("ARCHIVE_BATCH_NOT_FOUND", 404);
    const manifest = JSON.parse(String(b.manifest_json));
    for (const r of manifest.resources)
      await this.authorization.assertPermission(session, "archive.read", r);
    return {
      batchId: b.id,
      actorId: b.actor_id,
      reason: b.reason,
      createdAt: b.created_at,
      status: b.status,
      undoUntil: b.undo_until,
      restoredAt: b.restored_at,
      manifest,
    };
  }
  async publicEligibility(
    studentId: string,
    onDate = taipeiBusinessDate(this.now()),
  ) {
    const s = await this.sql(
      "SELECT deleted_at,public_query_until,retention_until FROM students WHERE id=?",
      studentId,
    ).first();
    return (
      !!s &&
      withinPublicDeadline(
        s as {
          deleted_at: number | null;
          public_query_until: string | null;
          retention_until: string | null;
        },
        onDate,
      )
    );
  }
}
