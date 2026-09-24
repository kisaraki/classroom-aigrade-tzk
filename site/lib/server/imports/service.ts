import {
  IMPORT_LIMITS,
  ImportError,
  parseCsv,
} from "../../domain/import-csv.ts";
import {
  createWorkbook,
  parseXlsx,
  type ImportSheet,
} from "../../domain/import-xlsx.ts";
import {
  parseScore,
  SUBJECTS,
  type Subject,
  type ExamType,
} from "../../domain/scores.ts";
import { addCalendarMonths, taipeiBusinessDate } from "../../domain/dates.ts";
import { identityLookupHash, type IdentityKeys } from "../identity.ts";
import { AuthorizationService } from "../auth/authorization.ts";
import { SESSION_IDLE_TIMEOUT_MS } from "../auth/policy.ts";
import type { AuthSession } from "../auth/types.ts";
import { AcademicService } from "../academic/service.ts";
import { ExamService } from "../exams/service.ts";

type Row = Record<string, string | number | null>;
export type ImportTarget =
  | {
      kind: "SCORES";
      examId: string;
      classId: string;
      examType: ExamType;
      subjects: Subject[];
    }
  | { kind: "NEW_STUDENTS"; academicTermId: string; classId: string };
type Issue = {
  row: number;
  code: string;
  expectedVersion?: number;
  currentVersion?: number | null;
};
type Mapping = {
  target: ImportTarget;
  format: "csv" | "xlsx";
  revision?: number;
  examVersion?: number;
  academicPreviewId?: string;
  committedRevision?: number;
  committedExamVersion?: number;
  rollbackRevision?: number;
  rollbackExamVersion?: number;
};
type Item = {
  row: number;
  studentId: string;
  entityId: string | null;
  before: Row | null;
  after: {
    participationId?: string;
    settingId?: string;
    value?: string;
    studentId?: string;
    enrollmentId?: string;
  };
  version: number;
  display?: Row;
};
function fail(code: string, status = 400): never {
  throw new ImportError(code, status);
}
const scoreHeaders = [
  "學年度",
  "學期",
  "評量次序",
  "評量分類",
  "班級",
  "姓名",
  "座號",
  "學號",
  "身分證字號",
  "科目",
  "分數",
  "成績來源",
  "原校名稱",
];
const studentHeaders = [
  "姓名",
  "生日",
  "班級",
  "座號",
  "學號",
  "身分證字號",
  "生效日期",
];
const subjectNames: Record<Subject, string> = {
  CHINESE: "國文",
  ENGLISH: "英文",
  MATH: "數學",
  SCIENCE: "自然",
  GEOGRAPHY: "地理",
  HISTORY: "歷史",
  CIVICS: "公民",
};
const duration = 30 * 24 * 60 * 60 * 1000;
const string = (value: unknown) =>
  typeof value === "string" && value.trim()
    ? value.trim().normalize("NFC")
    : fail("INVALID_IMPORT_INPUT");

export class ImportService {
  private readonly db: D1Database;
  private readonly files: R2Bucket;
  private readonly keys: () => IdentityKeys;
  private readonly now: () => number;
  private readonly authorization: AuthorizationService;
  constructor(dependencies: {
    db: D1Database;
    files: R2Bucket;
    identityKeys: () => IdentityKeys;
    now?: () => number;
  }) {
    this.db = dependencies.db;
    this.files = dependencies.files;
    this.keys = dependencies.identityKeys;
    this.now = dependencies.now ?? Date.now;
    this.authorization = new AuthorizationService({
      db: this.db,
      now: this.now,
    });
  }
  private sql(query: string, ...values: (string | number | null)[]) {
    return this.db.prepare(query).bind(...values);
  }
  private async one(
    query: string,
    ...values: (string | number | null)[]
  ): Promise<Row> {
    return (
      (await this.sql(query, ...values).first<Row>()) ??
      fail("IMPORT_NOT_FOUND", 404)
    );
  }
  private async revision() {
    return Number(
      (await this.one("SELECT revision FROM academic_state WHERE id=1"))
        .revision,
    );
  }
  private async access(session: AuthSession, target: ImportTarget) {
    if (!target || !["SCORES", "NEW_STUDENTS"].includes(target.kind))
      fail("INVALID_IMPORT_TARGET");
    const allowed =
      target.kind === "SCORES"
        ? ["kind", "examId", "classId", "examType", "subjects"]
        : ["kind", "academicTermId", "classId"];
    if (Object.keys(target).some((k) => !allowed.includes(k)))
      fail("INVALID_IMPORT_TARGET");
    const classId = string(target.classId);
    if (target.kind === "SCORES") {
      if (
        !Array.isArray(target.subjects) ||
        !target.subjects.length ||
        new Set(target.subjects).size !== target.subjects.length ||
        !["QUIZ", "MIDTERM"].includes(target.examType) ||
        target.subjects.some(
          (s) =>
            !SUBJECTS.slice(0, target.examType === "QUIZ" ? 3 : 7).includes(s),
        )
      )
        fail("INVALID_IMPORT_TARGET");
      const exam = await this.one(
        "SELECT e.*,t.term_number,t.academic_year_id,y.code AS year_code,c.code AS class_code FROM exams e JOIN academic_terms t ON t.id=e.academic_term_id JOIN academic_years y ON y.id=t.academic_year_id JOIN classes c ON c.academic_year_id=y.id WHERE e.id=? AND c.id=?",
        string(target.examId),
        classId,
      );
      for (const subject of target.subjects)
        await this.authorization.assertPermission(session, "score.write", {
          academicTermId: String(exam.academic_term_id),
          classId,
          subject,
          onDate: String(exam.starts_on),
        });
      return exam;
    }
    const term = await this.one(
      "SELECT t.*,c.code AS class_code,c.grade FROM academic_terms t JOIN classes c ON c.academic_year_id=t.academic_year_id WHERE t.id=? AND c.id=?",
      string(target.academicTermId),
      classId,
    );
    await this.authorization.assertPermission(session, "academic.write", {
      academicTermId: String(term.id),
      classId,
      onDate: String(term.starts_on),
    });
    if (term.grade !== 7) fail("NEW_STUDENT_REQUIRES_GRADE_7");
    return term;
  }
  private academic(
    session: AuthSession,
    target: Extract<ImportTarget, { kind: "NEW_STUDENTS" }>,
    startsOn: string,
  ) {
    return new AcademicService({
      db: this.db,
      now: this.now,
      identityKeys: this.keys,
      authorize: async (request) => {
        const grant = await this.authorization.assertPermission(
          session,
          "academic.write",
          {
            academicTermId: target.academicTermId,
            classIds: request.resources.classIds,
            academicYearIds: request.resources.yearIds,
            onDate: startsOn,
          },
        );
        return {
          adminId: grant.adminId,
          sessionId: grant.sessionId,
          recentGoogleAuthentication: grant.recentGoogleAuthentication,
        };
      },
    });
  }
  private async job(session: AuthSession, id: string) {
    const job = await this.one(
      "SELECT * FROM import_jobs WHERE id=?",
      string(id),
    );
    if (job.actor_id !== session.adminId) fail("IMPORT_ACCESS_DENIED", 403);
    const mapping: Mapping = JSON.parse(String(job.mapping_json));
    const context = await this.access(session, mapping.target);
    return { job, mapping, context };
  }
  private audit(
    session: AuthSession,
    id: string,
    action: string,
    count: number,
  ) {
    const now = this.now();
    return this.sql(
      "INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until) VALUES (?,?,?,'import_job',?,?,'success',?,?,?)",
      crypto.randomUUID(),
      session.adminId,
      action,
      id,
      `${action}-${id}`,
      JSON.stringify({ count }),
      now,
      addCalendarMonths(taipeiBusinessDate(now), 2),
    );
  }
  private guard(session: AuthSession, id: string, revision: number) {
    const now = this.now();
    return this.sql(
      "UPDATE import_jobs SET status=CASE WHEN (SELECT revision FROM academic_state WHERE id=1)=? AND EXISTS (SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id WHERE a.id=? AND s.id=? AND a.status='active' AND a.google_subject_id IS NOT NULL AND a.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=?) THEN status ELSE NULL END WHERE id=?",
      revision,
      session.adminId,
      session.sessionId,
      now,
      now - SESSION_IDLE_TIMEOUT_MS,
      now,
      id,
    );
  }
  async upload(
    session: AuthSession,
    target: ImportTarget,
    format: "csv" | "xlsx",
    bytes: Uint8Array,
  ) {
    await this.access(session, target);
    if (!["csv", "xlsx"].includes(format)) fail("IMPORT_FORMAT_NOT_SUPPORTED");
    if (!bytes.length || bytes.length > IMPORT_LIMITS.maxBytes)
      fail("IMPORT_FILE_TOO_LARGE");
    const id = crypto.randomUUID(),
      key = `imports/${id}/source`,
      now = this.now();
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    await this.sql(
      "INSERT INTO import_jobs (id,actor_id,kind,status,object_key,file_hash,mapping_json,created_at,updated_at) VALUES (?,?,?,'UPLOADING',?,?,?,?,?)",
      id,
      session.adminId,
      target.kind,
      key,
      hash,
      JSON.stringify({ target, format }),
      now,
      now,
    ).run();
    try {
      await this.files.put(key, new Uint8Array(bytes), {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "private, no-store",
        },
      });
      await this.sql(
        "UPDATE import_jobs SET status='UPLOADED',updated_at=? WHERE id=?",
        this.now(),
        id,
      ).run();
    } catch {
      await this.sql(
        "UPDATE import_jobs SET status='FAILED',error_code='IMPORT_STORAGE_FAILED' WHERE id=?",
        id,
      ).run();
      return fail("IMPORT_STORAGE_FAILED", 503);
    }
    return { jobId: id, status: "UPLOADED" };
  }
  async template(session: AuthSession, target: ImportTarget) {
    await this.access(session, target);
    return createWorkbook(
      target.kind === "SCORES"
        ? target.subjects.map((subject) => ({
            name: subjectNames[subject],
            rows: [scoreHeaders],
          }))
        : [{ name: "七年級新生", rows: [studentHeaders] }],
    );
  }
  private decode(
    sheets: ImportSheet[],
    target: ImportTarget,
    mapping: Record<string, string>,
  ) {
    const headers = target.kind === "SCORES" ? scoreHeaders : studentHeaders;
    if (
      !mapping ||
      typeof mapping !== "object" ||
      Object.entries(mapping).some(
        ([k, v]) => !headers.includes(k) || typeof v !== "string" || !v.trim(),
      )
    )
      fail("INVALID_COLUMN_MAPPING");
    const result: {
      row: number;
      sheet: string;
      values: Record<string, string>;
    }[] = [];
    let rowNumber = 0;
    const usedSubjects = new Set<string>();
    for (const sheet of sheets) {
      if (sheet.rows.some((row) => row.some((c) => /^[\s]*[=+@-]/u.test(c))))
        fail("IMPORT_FORMULA_NOT_ALLOWED");
      const names = (sheet.rows[0] ?? []).map((h) => h.trim());
      if (!names.length || new Set(names).size !== names.length)
        fail("INVALID_IMPORT_HEADERS");
      const indexes = headers.map((h) => names.indexOf(mapping[h] ?? h));
      const optional =
        target.kind === "SCORES"
          ? new Set([
              "學年度",
              "學期",
              "評量次序",
              "評量分類",
              "成績來源",
              "原校名稱",
            ])
          : new Set<string>();
      if (indexes.some((v, i) => v < 0 && !optional.has(headers[i])))
        fail("MISSING_IMPORT_COLUMN");
      let sheetSubject: string | null = null;
      for (const cells of sheet.rows.slice(1)) {
        if (cells.every((c) => !c.trim())) continue;
        rowNumber++;
        if (cells.length > names.length) fail("INVALID_IMPORT_ROW");
        const values = Object.fromEntries(
          headers.map((h, i) => [
            h,
            (cells[indexes[i]] ?? "").trim().normalize("NFC"),
          ]),
        );
        if (target.kind === "SCORES") {
          if (sheetSubject !== null && sheetSubject !== values["科目"])
            fail("ONE_SUBJECT_PER_SHEET_REQUIRED");
          sheetSubject = values["科目"];
        }
        result.push({ row: rowNumber, sheet: sheet.name, values });
      }
      if (sheetSubject !== null) {
        const subject =
          SUBJECTS.find(
            (s) => s === sheetSubject || subjectNames[s] === sheetSubject,
          ) ?? sheetSubject;
        if (usedSubjects.has(subject)) fail("ONE_SUBJECT_PER_SHEET_REQUIRED");
        usedSubjects.add(subject);
      }
    }
    if (!result.length) fail("EMPTY_IMPORT");
    return result;
  }
  async preview(
    session: AuthSession,
    id: string,
    columns: Record<string, string> = {},
  ) {
    const { job, mapping, context } = await this.job(session, id);
    if (!["UPLOADED", "PREVIEW", "INVALID"].includes(String(job.status)))
      fail("IMPORT_STATE_CONFLICT", 409);
    const revision = await this.revision();
    const issues: Issue[] = [],
      items: Item[] = [];
    try {
      if (
        mapping.target.kind === "SCORES" &&
        (context.published_at !== null ||
          context.locked_at !== null ||
          context.archived_at !== null)
      )
        fail("IMPORT_TARGET_READ_ONLY");
      const object = await this.files.get(String(job.object_key));
      if (!object || object.size > IMPORT_LIMITS.maxBytes)
        fail("IMPORT_SOURCE_MISSING");
      const bytes = new Uint8Array(await object.arrayBuffer());
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== job.file_hash) fail("IMPORT_SOURCE_CHANGED");
      const sheets =
        mapping.format === "csv"
          ? [{ name: "CSV", rows: parseCsv(bytes, IMPORT_LIMITS) }]
          : parseXlsx(bytes);
      const rows = this.decode(sheets, mapping.target, columns);
      if (mapping.target.kind === "NEW_STUDENTS") {
        const target = mapping.target;
        if (sheets.length !== 1) fail("NEW_STUDENT_SINGLE_SHEET_REQUIRED");
        const students = rows.map((r) => {
          if (r.values["班級"] !== context.class_code)
            fail("IMPORT_CLASS_MISMATCH");
          if (!/^[1-9]\d*$/u.test(r.values["座號"]))
            fail("INVALID_SEAT_NUMBER");
          return {
            name: r.values["姓名"],
            birthDate: r.values["生日"],
            classId: target.classId,
            seatNumber: Number(r.values["座號"]),
            studentNumber: r.values["學號"],
            identityNumber: r.values["身分證字號"],
            effectiveFrom: r.values["生效日期"],
          };
        });
        const preview = await this.academic(
          session,
          target,
          String(context.starts_on),
        ).previewNewStudents(target.academicTermId, students);
        mapping.academicPreviewId = preview.id;
        const plan = JSON.parse(
          String(
            (
              await this.one(
                "SELECT payload_json FROM academic_previews WHERE id=?",
                preview.id,
              )
            ).payload_json,
          ),
        );
        const profiles: { after: Row }[] = plan.changes.filter(
          (c: { table: string }) => c.table === "students",
        );
        profiles.forEach((p, i) => {
          const enrollment = plan.changes.find(
            (c: { table: string; after: Row }) =>
              c.table === "student_enrollments" &&
              c.after.student_id === p.after.id,
          );
          items.push({
            row: i + 1,
            studentId: String(p.after.id),
            entityId: null,
            before: null,
            after: {
              studentId: String(p.after.id),
              enrollmentId: String(enrollment.after.id),
            },
            version: 0,
            display: preview.rows[i],
          });
        });
      } else {
        const target = mapping.target,
          seen = new Set<string>();
        for (const row of rows) {
          try {
            const v = row.values;
            if (
              v["班級"] !== context.class_code ||
              (v["學年度"] && v["學年度"] !== context.year_code) ||
              (v["學期"] && v["學期"] !== String(context.term_number)) ||
              (v["評量次序"] && v["評量次序"] !== String(context.sequence)) ||
              (v["評量分類"] && v["評量分類"] !== target.examType)
            )
              fail("IMPORT_TARGET_MISMATCH");
            const subject = SUBJECTS.find(
              (s) => s === v["科目"] || subjectNames[s] === v["科目"],
            );
            if (!subject || !target.subjects.includes(subject))
              fail("IMPORT_SUBJECT_MISMATCH");
            const matches = new Set<string>();
            for (const key of this.keys().lookup) {
              const hash = await identityLookupHash(
                string(v["身分證字號"]).toUpperCase(),
                key,
              );
              const match = await this.sql(
                "SELECT student_id FROM student_identity_lookup_hashes WHERE key_version=? AND identity_number_lookup_hash=?",
                key.version,
                hash,
              ).first<Row>();
              if (match) matches.add(String(match.student_id));
            }
            if (matches.size !== 1) fail("IMPORT_IDENTITY_MISMATCH");
            const studentId = [...matches][0];
            const student = await this.one(
              "SELECT * FROM students WHERE id=?",
              studentId,
            );
            if (
              student.name !== v["姓名"] ||
              student.student_number !== v["學號"] ||
              student.status !== "active" ||
              student.deleted_at !== null
            )
              fail("IMPORT_IDENTITY_MISMATCH");
            const origin = v["成績來源"] || "LOCAL";
            if (!["LOCAL", "EXTERNAL_TRANSFER"].includes(origin))
              fail("IMPORT_ORIGIN_MISMATCH");
            const part = await this.sql(
              "SELECT * FROM exam_participations WHERE exam_id=? AND student_id=? AND origin=?",
              target.examId,
              studentId,
              origin,
            ).first<Row>();
            if (!part) fail("IMPORT_PARTICIPATION_MISSING");
            if (origin === "LOCAL") {
              if (
                part.class_id_snapshot !== target.classId ||
                String(part.seat_number_snapshot) !== v["座號"]
              )
                fail("IMPORT_IDENTITY_MISMATCH");
            } else {
              const today = taipeiBusinessDate(this.now());
              const enrollment = await this.sql(
                "SELECT seat_number FROM student_enrollments WHERE student_id=? AND class_id=? AND academic_term_id=? AND status='valid' AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)",
                studentId,
                target.classId,
                context.academic_term_id,
                today,
                today,
              ).first<Row>();
              if (
                !enrollment ||
                String(enrollment.seat_number) !== v["座號"] ||
                v["原校名稱"] !== part.external_school_label
              )
                fail("IMPORT_IDENTITY_MISMATCH");
            }
            const setting = await this.one(
              "SELECT * FROM exam_subject_settings WHERE exam_id=? AND exam_type=? AND subject=?",
              target.examId,
              target.examType,
              subject,
            );
            const parsed = parseScore(v["分數"]);
            if (
              origin === "LOCAL" &&
              (setting.held === 0) !== (parsed.scoreStatus === "NOT_HELD")
            )
              fail("SCORE_HELD_MISMATCH");
            const key = `${part.id}:${setting.id}`;
            if (seen.has(key)) fail("DUPLICATE_IMPORT_ROW");
            seen.add(key);
            const old = await this.sql(
              "SELECT * FROM score_items WHERE participation_id=? AND setting_id=?",
              part.id,
              setting.id,
            ).first<Row>();
            items.push({
              row: row.row,
              studentId,
              entityId: old ? String(old.id) : null,
              before: old,
              after: {
                participationId: String(part.id),
                settingId: String(setting.id),
                value: v["分數"],
              },
              version: Number(old?.version ?? 0),
              display: {
                name: String(student.name),
                studentNumber: String(student.student_number),
                classCode: String(context.class_code),
                seatNumber: v["座號"],
                subject,
                origin,
              },
            });
          } catch (error) {
            issues.push({
              row: row.row,
              code:
                error instanceof Error && "code" in error
                  ? String(error.code)
                  : "IMPORT_VALIDATION_FAILED",
            });
          }
        }
        mapping.examVersion = Number(context.version);
      }
    } catch (error) {
      issues.push({
        row: 0,
        code:
          error instanceof Error && "code" in error
            ? String(error.code)
            : "IMPORT_VALIDATION_FAILED",
      });
    }
    if ((await this.revision()) !== revision)
      fail("IMPORT_SOURCE_CHANGED", 409);
    mapping.revision = revision;
    await this.access(session, mapping.target);
    const status = issues.length ? "INVALID" : "PREVIEW";
    const version = Number(job.preview_version) + 1;
    const statements = [
      this.guard(session, id, revision),
      this.sql(
        "UPDATE import_jobs SET status=CASE WHEN preview_version=? AND status IN ('UPLOADED','PREVIEW','INVALID') THEN ? ELSE NULL END,preview_version=?,mapping_json=?,error_code=?,updated_at=? WHERE id=?",
        job.preview_version,
        status,
        version,
        JSON.stringify(mapping),
        issues[0]?.code ?? null,
        this.now(),
        id,
      ),
      this.sql("DELETE FROM import_job_items WHERE job_id=?", id),
    ];
    for (const item of items)
      statements.push(
        this.sql(
          "INSERT INTO import_job_items (id,job_id,row_number,entity_type,entity_id,student_id,status,source_version,before_json,after_json) VALUES (?,?,?,?,?,?, 'VALID',?,?,?)",
          crypto.randomUUID(),
          id,
          item.row,
          mapping.target.kind === "SCORES" ? "score" : "student",
          item.entityId,
          mapping.target.kind === "SCORES" ? item.studentId : null,
          item.version,
          JSON.stringify(item.before),
          JSON.stringify(item.after),
        ),
      );
    for (const issue of issues)
      statements.push(
        this.sql(
          "INSERT INTO import_job_items (id,job_id,row_number,entity_type,status,error_code) VALUES (?,?,?,'error','INVALID',?)",
          crypto.randomUUID(),
          id,
          issue.row || IMPORT_LIMITS.maxDataRows + 1,
          issue.code,
        ),
      );
    await this.db.batch(statements);
    const duplicate = await this.sql(
      "SELECT id FROM import_jobs WHERE id<>? AND actor_id=? AND file_hash=? AND kind=? AND status IN ('COMMITTED','ROLLBACK_PREVIEW') AND json_extract(mapping_json,'$.target.classId')=? AND json_extract(mapping_json,'$.target.examId') IS ? AND json_extract(mapping_json,'$.target.academicTermId') IS ? AND json_extract(mapping_json,'$.target.examType') IS ? ORDER BY committed_at DESC LIMIT 1",
      id,
      session.adminId,
      job.file_hash,
      mapping.target.kind,
      mapping.target.classId,
      mapping.target.kind === "SCORES" ? mapping.target.examId : null,
      mapping.target.kind === "NEW_STUDENTS"
        ? mapping.target.academicTermId
        : null,
      mapping.target.kind === "SCORES" ? mapping.target.examType : null,
    ).first<Row>();
    return {
      jobId: id,
      status,
      previewVersion: version,
      count: items.length,
      issues,
      duplicateOf: duplicate?.id ?? null,
      target: mapping.target,
      rows: items.map((i) => ({
        row: i.row,
        studentId: i.studentId,
        display: i.display,
        change: i.before ? "UPDATE" : "INSERT",
        before: i.before
          ? {
              scoreValue: i.before.score_value,
              scoreStatus: i.before.score_status,
            }
          : null,
        value: i.after.value ?? null,
      })),
    };
  }
  private async items(id: string) {
    return (
      await this.sql(
        "SELECT * FROM import_job_items WHERE job_id=? AND status='VALID' ORDER BY row_number",
        id,
      ).all<Row>()
    ).results;
  }
  async commit(
    session: AuthSession,
    id: string,
    previewVersion: number,
    confirmed: boolean,
  ) {
    const { job, mapping, context } = await this.job(session, id);
    if (confirmed !== true) fail("CONFIRMATION_REQUIRED");
    if (job.status === "COMMITTED" || job.status === "ROLLBACK_PREVIEW")
      return { jobId: id, status: job.status, replayed: true };
    if (job.status !== "PREVIEW" || job.preview_version !== previewVersion)
      fail("IMPORT_PREVIEW_CONFLICT", 409);
    if (mapping.revision !== (await this.revision()))
      fail("IMPORT_SOURCE_CHANGED", 409);
    const items = await this.items(id);
    if (!items.length) fail("EMPTY_IMPORT");
    const now = this.now();
    const writes: D1PreparedStatement[] = [
      this.sql(
        "UPDATE import_jobs SET status=CASE WHEN status='PREVIEW' AND preview_version=? THEN 'COMMITTED' ELSE NULL END,confirmed_at=?,committed_at=?,rollback_until=?,updated_at=? WHERE id=?",
        previewVersion,
        now,
        now,
        now + duration,
        now,
        id,
      ),
    ];
    for (const item of items) {
      const after = JSON.parse(String(item.after_json));
      if (mapping.target.kind === "SCORES")
        writes.push(
          this.sql(
            "UPDATE import_job_items SET entity_id=(SELECT id FROM score_items WHERE participation_id=? AND setting_id=?),committed_version=source_version+1 WHERE id=?",
            after.participationId,
            after.settingId,
            item.id,
          ),
        );
      else
        writes.push(
          this.sql(
            "UPDATE import_job_items SET entity_id=?,student_id=?,committed_version=1 WHERE id=?",
            after.studentId,
            after.studentId,
            item.id,
          ),
        );
    }
    writes.push(this.audit(session, id, "IMPORT_COMMIT", items.length));
    if (mapping.target.kind === "SCORES") {
      mapping.committedExamVersion = Number(mapping.examVersion) + 1;
      writes.push(
        this.sql(
          "UPDATE import_jobs SET mapping_json=?,status=CASE WHEN (SELECT revision FROM academic_state WHERE id=1)=? THEN status ELSE NULL END WHERE id=?",
          JSON.stringify(mapping),
          mapping.revision!,
          id,
        ),
      );
      await new ExamService({ db: this.db, now: this.now }).writeDraftScores(
        session,
        mapping.target.examId,
        {
          operationId: `import-commit-${id}`,
          expectedVersion: mapping.examVersion!,
          reason: "Confirmed score import",
          scores: items.map((item) => ({
            ...JSON.parse(String(item.after_json)),
            expectedVersion: Number(item.source_version),
          })),
        },
        writes,
      );
    } else {
      writes.push(
        this.sql(
          "UPDATE import_jobs SET mapping_json=json_set(mapping_json,'$.committedRevision',(SELECT revision FROM academic_state WHERE id=1)) WHERE id=?",
          id,
        ),
      );
      await this.academic(
        session,
        mapping.target,
        String(context.starts_on),
      ).confirm(mapping.academicPreviewId!, { confirmed: true }, writes);
    }
    return {
      jobId: id,
      status: "COMMITTED",
      replayed: false,
      rollbackUntil: now + duration,
    };
  }
  private async rollbackIssues(
    job: Row,
    mapping: Mapping,
    context: Row,
    items: Row[],
  ): Promise<Issue[]> {
    const issues: Issue[] = [];
    if (Number(job.rollback_until) <= this.now())
      issues.push({ row: 0, code: "IMPORT_ROLLBACK_EXPIRED" });
    if (mapping.target.kind === "SCORES") {
      if (
        context.published_at !== null ||
        context.locked_at !== null ||
        context.archived_at !== null ||
        (await this.sql(
          "SELECT id FROM exam_result_versions WHERE exam_id=? AND published_at IS NOT NULL",
          mapping.target.examId,
        ).first())
      )
        issues.push({ row: 0, code: "IMPORT_ROLLBACK_SOURCE_CONFLICT" });
      for (const item of items) {
        const current = await this.sql(
          "SELECT s.version,p.status,p.deleted_at FROM score_items s JOIN students p ON p.id=s.student_id WHERE s.id=?",
          item.entity_id,
        ).first<Row>();
        if (
          !current ||
          current.version !== item.committed_version ||
          current.status !== "active" ||
          current.deleted_at !== null
        )
          issues.push({
            row: Number(item.row_number),
            code: "IMPORT_ROLLBACK_ITEM_CONFLICT",
            expectedVersion: Number(item.committed_version),
            currentVersion: current ? Number(current.version) : null,
          });
      }
    } else {
      for (const item of items) {
        const after = JSON.parse(String(item.after_json));
        const current = await this.sql(
          "SELECT s.version,s.status,s.deleted_at,e.version AS enrollment_version,e.status AS enrollment_status,(SELECT count(*) FROM student_enrollments n WHERE n.student_id=s.id) AS enrollment_count FROM students s JOIN student_enrollments e ON e.student_id=s.id WHERE s.id=? AND e.id=?",
          item.student_id,
          after.enrollmentId,
        ).first<Row>();
        if (
          !current ||
          current.version !== item.committed_version ||
          current.status !== "active" ||
          current.deleted_at !== null ||
          current.enrollment_version !== 1 ||
          current.enrollment_status !== "valid" ||
          current.enrollment_count !== 1
        )
          issues.push({
            row: Number(item.row_number),
            code: "IMPORT_ROLLBACK_ITEM_CONFLICT",
            expectedVersion: Number(item.committed_version),
            currentVersion: current ? Number(current.version) : null,
          });
        if (
          await this.sql(
            "SELECT id FROM exam_participations WHERE student_id=? LIMIT 1",
            item.student_id,
          ).first()
        )
          issues.push({
            row: Number(item.row_number),
            code: "IMPORT_ROLLBACK_DEPENDENCY_CONFLICT",
          });
      }
    }
    return issues;
  }
  async previewRollback(session: AuthSession, id: string) {
    const { job, mapping, context } = await this.job(session, id);
    if (!["COMMITTED", "ROLLBACK_PREVIEW"].includes(String(job.status)))
      fail("IMPORT_STATE_CONFLICT", 409);
    const items = await this.items(id),
      issues = await this.rollbackIssues(job, mapping, context, items);
    if (issues.length) return { jobId: id, canRollback: false, issues };
    mapping.rollbackRevision = await this.revision();
    mapping.rollbackExamVersion = Number(context.version);
    const previewVersion = Number(job.preview_version) + 1;
    await this.db.batch([
      this.guard(session, id, mapping.rollbackRevision),
      this.sql(
        "UPDATE import_jobs SET status=CASE WHEN preview_version=? AND status IN ('COMMITTED','ROLLBACK_PREVIEW') THEN 'ROLLBACK_PREVIEW' ELSE NULL END,preview_version=?,mapping_json=? WHERE id=?",
        job.preview_version,
        previewVersion,
        JSON.stringify(mapping),
        id,
      ),
    ]);
    return {
      jobId: id,
      canRollback: true,
      previewVersion,
      count: items.length,
      issues,
      rows: items.map((item) => ({
        row: item.row_number,
        entityId: item.entity_id,
        from: JSON.parse(String(item.after_json)),
        to: JSON.parse(String(item.before_json)),
      })),
    };
  }
  async rollback(
    session: AuthSession,
    id: string,
    previewVersion: number,
    confirmed: boolean,
  ) {
    const { job, mapping, context } = await this.job(session, id);
    if (confirmed !== true) fail("CONFIRMATION_REQUIRED");
    if (job.status === "ROLLED_BACK")
      return { jobId: id, status: "ROLLED_BACK", replayed: true };
    if (
      job.status !== "ROLLBACK_PREVIEW" ||
      job.preview_version !== previewVersion
    )
      fail("IMPORT_PREVIEW_CONFLICT", 409);
    const items = await this.items(id);
    if (
      (await this.rollbackIssues(job, mapping, context, items)).length ||
      mapping.rollbackRevision !== (await this.revision())
    )
      fail("IMPORT_ROLLBACK_CONFLICT", 409);
    const now = this.now();
    const guard = this.sql(
      "UPDATE import_jobs SET status=CASE WHEN status='ROLLBACK_PREVIEW' AND preview_version=? AND rollback_until>? AND (SELECT revision FROM academic_state WHERE id=1)=? THEN 'ROLLED_BACK' ELSE NULL END,updated_at=? WHERE id=?",
      previewVersion,
      now,
      mapping.rollbackRevision!,
      now,
      id,
    );
    if (mapping.target.kind === "SCORES") {
      const codes: Record<string, string> = {
        UNENTERED: "",
        ABSENT: "A",
        OFFICIAL_LEAVE: "B",
        SICK_LEAVE: "C",
        EXEMPT: "D",
        NOT_HELD: "N",
      };
      const scores = items.map((item) => {
        const after = JSON.parse(String(item.after_json)),
          before = JSON.parse(String(item.before_json));
        return {
          participationId: after.participationId,
          settingId: after.settingId,
          expectedVersion: Number(item.committed_version),
          value:
            before?.score_status === "NORMAL"
              ? (Number(before.score_value) / 100).toFixed(2)
              : before
                ? codes[before.score_status]
                : after.value === "N"
                  ? "N"
                  : "",
        };
      });
      await new ExamService({ db: this.db, now: this.now }).writeDraftScores(
        session,
        mapping.target.examId,
        {
          operationId: `import-rollback-${id}`,
          expectedVersion: mapping.rollbackExamVersion!,
          reason: "Confirmed import rollback",
          scores,
        },
        [guard, this.audit(session, id, "IMPORT_ROLLBACK", items.length)],
      );
    } else {
      const writes = [
        guard,
        this.sql(
          "UPDATE import_jobs SET status=CASE WHEN EXISTS (SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id WHERE a.id=? AND s.id=? AND a.role IN ('super_admin','academic_admin') AND a.status='active' AND a.google_subject_id IS NOT NULL AND a.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=?) THEN status ELSE NULL END WHERE id=?",
          session.adminId,
          session.sessionId,
          now,
          now - SESSION_IDLE_TIMEOUT_MS,
          now,
          id,
        ),
      ];
      for (const item of items) {
        const after = JSON.parse(String(item.after_json));
        writes.push(
          this.sql(
            "UPDATE student_enrollments SET status='voided',version=version+1 WHERE id=?",
            after.enrollmentId,
          ),
          this.sql(
            "UPDATE students SET deleted_at=?,version=version+1,updated_at=? WHERE id=?",
            now,
            now,
            item.student_id,
          ),
        );
      }
      writes.push(this.audit(session, id, "IMPORT_ROLLBACK", items.length));
      try {
        await this.db.batch(writes);
      } catch {
        const current = await this.job(session, id);
        if (current.job.status === "ROLLED_BACK")
          return { jobId: id, status: "ROLLED_BACK", replayed: true };
        fail("IMPORT_ROLLBACK_CONFLICT", 409);
      }
    }
    return { jobId: id, status: "ROLLED_BACK", replayed: false };
  }
  async read(session: AuthSession, id: string) {
    const { job, mapping } = await this.job(session, id);
    const issues = (
      await this.sql(
        "SELECT row_number,error_code FROM import_job_items WHERE job_id=? AND status='INVALID' ORDER BY row_number",
        id,
      ).all<Row>()
    ).results;
    return {
      jobId: id,
      status: job.status,
      target: mapping.target,
      previewVersion: job.preview_version,
      rollbackUntil: job.rollback_until,
      issues,
    };
  }
  async errorReport(session: AuthSession, id: string) {
    const result = await this.read(session, id);
    return (
      "row,code\r\n" +
      result.issues
        .map(
          (i) =>
            `${Number(i.row_number)},${String(i.error_code).replace(/[^A-Z0-9_]/gu, "")}`,
        )
        .join("\r\n")
    );
  }
}
