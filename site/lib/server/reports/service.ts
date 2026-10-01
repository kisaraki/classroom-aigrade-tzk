import { AuthorizationService } from "../auth/authorization.ts";
import type { AuthSession, ScopeResource } from "../auth/types.ts";
import { validateAdvice, ADVICE_SECTIONS } from "../ai/advice.ts";
import type {
  ExamCalculationInput,
  ParticipantResult,
} from "../../domain/ranking.ts";
import { SUBJECT_SETTINGS } from "../../domain/scores.ts";
import {
  ReportError,
  ReportSourceBudget,
  MAX_REPORT_BYTES,
  validateReportSource,
  type Report,
  type Cell,
} from "./formats.ts";
import { taipeiBusinessDate } from "../../domain/dates.ts";
export type ReportKind =
  "class" | "grade" | "individual" | "class-ranking" | "grade-ranking" | "ai";
export type ReportInput = {
  kind: ReportKind;
  examId: string;
  classId?: string;
  grade?: number;
  studentId?: string;
  expectedVersion?: number;
};
type Row = Record<string, string | number | null>;
type Snapshot = {
  input: ExamCalculationInput;
  result: {
    mode: string;
    local: ParticipantResult[];
    external: ParticipantResult[];
  };
  components: string[];
};
const subjects: Record<string, string> = {
  CHINESE: "國文",
  ENGLISH: "英文",
  MATH: "數學",
  SCIENCE: "自然",
  GEOGRAPHY: "地理",
  HISTORY: "歷史",
  CIVICS: "公民",
};
const statuses: Record<string, string> = {
  UNENTERED: "未輸入",
  ABSENT: "缺考",
  OFFICIAL_LEAVE: "公假",
  SICK_LEAVE: "病假",
  EXEMPT: "免試",
  NOT_HELD: "未舉行",
};
const titles: Record<ReportKind, string> = {
  class: "班級成績總表",
  grade: "全年段成績總表",
  individual: "個人成績單",
  "class-ranking": "班級排名表",
  "grade-ranking": "全年段排名表",
  ai: "AI 建議總表",
};
const scaled = (v: number | null): Cell => (v === null ? null : v / 100);
export class ReportService {
  private authz: AuthorizationService;
  private deps: { db: D1Database; now?: () => number };
  constructor(deps: { db: D1Database; now?: () => number }) {
    this.deps = deps;
    this.authz = new AuthorizationService(deps);
  }
  private query(sql: string, ...args: (string | number | null)[]) {
    return this.deps.db.prepare(sql).bind(...args);
  }
  async prepare(session: AuthSession, input: ReportInput) {
    if (
      !Object.hasOwn(titles, input.kind) ||
      typeof input.examId !== "string" ||
      !input.examId.trim()
    )
      throw new ReportError("INVALID_REPORT_INPUT");
    const gradeKind = input.kind === "grade" || input.kind === "grade-ranking",
      individual = input.kind === "individual";
    if (
      gradeKind
        ? ![7, 8, 9].includes(input.grade!) ||
          input.classId !== undefined ||
          input.studentId !== undefined
        : individual
          ? typeof input.studentId !== "string" ||
            !input.studentId ||
            input.grade !== undefined ||
            input.classId !== undefined
          : typeof input.classId !== "string" ||
            !input.classId ||
            input.grade !== undefined ||
            input.studentId !== undefined
    )
      throw new ReportError("INVALID_REPORT_SCOPE");
    if (
      input.expectedVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1)
    )
      throw new ReportError("INVALID_REPORT_VERSION");
    const exam = await this.query(
      "SELECT e.id,e.academic_term_id,e.starts_on,e.sequence,t.term_number,y.code AS year_code FROM exams e JOIN academic_terms t ON t.id=e.academic_term_id JOIN academic_years y ON y.id=t.academic_year_id WHERE e.id=?",
      input.examId,
    ).first<Row>();
    if (!exam) throw new ReportError("REPORT_UNAVAILABLE", 404);
    const resource: ScopeResource = {
      academicTermId: String(exam.academic_term_id),
      onDate: String(exam.starts_on),
      ...(gradeKind
        ? { grade: input.grade }
        : individual
          ? { studentId: input.studentId }
          : { classId: input.classId }),
    };
    const permission = input.kind === "ai" ? "ai.read" : "score.read";
    const resources = [resource];
    if (individual) {
      const origins = (
        await this.query(
          "SELECT id,origin FROM exam_participations WHERE exam_id=? AND student_id=?",
          input.examId,
          input.studentId!,
        ).all<Row>()
      ).results;
      const local = origins.find((p) => p.origin === "LOCAL");
      if (local)
        resources[0] = {
          academicTermId: String(exam.academic_term_id),
          participationId: String(local.id),
        };
      if (origins.some((p) => p.origin === "EXTERNAL_TRANSFER")) {
        const date = taipeiBusinessDate(this.deps.now?.() ?? Date.now());
        const current = await this.query(
          "SELECT academic_term_id FROM student_enrollments WHERE student_id=? AND status='valid' AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)",
          input.studentId!,
          date,
          date,
        ).first<Row>();
        if (!current) throw new ReportError("REPORT_UNAVAILABLE", 404);
        const externalScope = {
          academicTermId: String(current.academic_term_id),
          studentId: input.studentId,
          onDate: date,
        };
        if (local) resources.push(externalScope);
        else resources[0] = externalScope;
      }
    }
    const access = async () => {
      for (const scope of resources)
        await this.authz.assertPermission(session, permission, scope);
    };
    await access();
    const versionQuery = this.query(
      `SELECT v.id,v.version,length(CAST(s.snapshot_json AS BLOB)) AS source_bytes,CASE WHEN length(CAST(s.snapshot_json AS BLOB))<=${MAX_REPORT_BYTES} THEN s.snapshot_json ELSE NULL END AS snapshot_json FROM exam_result_versions v JOIN publication_snapshots s ON s.result_version_id=v.id WHERE v.exam_id=? AND v.published_at IS NOT NULL ORDER BY v.version DESC LIMIT 1`,
      input.examId,
    );
    const partsQuery = this.query(
      "SELECT p.id,p.student_id,p.origin,p.external_school_label,p.class_id_snapshot,p.class_code_snapshot,p.seat_number_snapshot,p.grade_snapshot,s.name,s.birth_date,s.student_number,s.version AS profile_version FROM exam_participations p JOIN students s ON s.id=p.student_id WHERE p.exam_id=? AND (p.origin='LOCAL' OR ?=1) AND s.deleted_at IS NULL AND (? IS NULL OR p.class_id_snapshot=?) AND (? IS NULL OR p.grade_snapshot=?) AND (? IS NULL OR p.student_id=?) ORDER BY p.class_code_snapshot,p.seat_number_snapshot,p.id LIMIT 1001",
      input.examId,
      individual ? 1 : 0,
      input.classId ?? null,
      input.classId ?? null,
      input.grade ?? null,
      input.grade ?? null,
      input.studentId ?? null,
      input.studentId ?? null,
    );
    const [versionRows, partRows] = await this.deps.db.batch<Row>([
      versionQuery,
      partsQuery,
    ]);
    const version = versionRows.results[0],
      parts = partRows.results;
    if (!version) throw new ReportError("REPORT_NOT_PUBLISHED", 409);
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== version.version
    )
      throw new ReportError("REPORT_VERSION_CHANGED", 409);
    if (parts.length > 1000)
      throw new ReportError("REPORT_TOO_MANY_STUDENTS", 413);
    if (individual && parts.length === 0)
      throw new ReportError("REPORT_UNAVAILABLE", 404);
    const sourceBudget = new ReportSourceBudget();
    sourceBudget.addBytes(Number(version.source_bytes));
    const snapshot = JSON.parse(String(version.snapshot_json)) as Snapshot;
    const selected = parts
      .map((part) => ({
        part,
        result: [
          ...snapshot.result.local,
          ...(individual ? snapshot.result.external : []),
        ].find((p) => p.participationId === part.id),
        raw: snapshot.input.participants.find((p) => p.id === part.id),
      }))
      .filter((p) => p.result && p.raw);
    if (selected.length !== parts.length)
      throw new ReportError("REPORT_SOURCE_INCOMPLETE", 409);
    const columns = ["班級", "座號", "姓名", "學號"],
      rows: Cell[][] = [];
    const scoreSettings = SUBJECT_SETTINGS.filter((s) =>
      snapshot.components.includes(s.examType),
    );
    const rankKind = input.kind.endsWith("ranking");
    if (individual) columns.push("成績來源");
    if (input.kind === "ai") columns.push("建議狀態", "家長版", "學生版");
    else if (rankKind)
      columns.push(
        "定評平均",
        "總分",
        input.kind === "grade-ranking" ? "全年段名次" : "班級名次",
      );
    else {
      columns.push(
        ...scoreSettings.map(
          (s) =>
            (s.examType === "QUIZ" ? "檢測" : "段考") +
            "・" +
            subjects[s.subject],
        ),
        "檢測平均",
        "段考平均",
        "定評平均",
        "總分",
        "班級名次",
      );
      if (gradeKind) columns.push("全年段名次");
    }
    const adviceQuery = this.query(
      "SELECT a.id,a.student_id,a.audience,a.version,length(CAST(a.content AS BLOB)) AS content_bytes,a.stale_at,j.result_version_id,j.status FROM ai_advices a JOIN students rs ON rs.id=a.student_id AND rs.deleted_at IS NULL JOIN ai_jobs j ON j.id=a.job_id JOIN exam_participations p ON p.exam_id=a.exam_id AND p.student_id=a.student_id WHERE a.exam_id=? AND a.version=(SELECT MAX(version) FROM ai_advices WHERE student_id=a.student_id AND exam_id=a.exam_id) AND p.origin='LOCAL' AND (? IS NULL OR p.class_id_snapshot=?) ORDER BY a.student_id,a.audience",
      input.examId,
      input.classId ?? null,
      input.classId ?? null,
    );
    const advice =
      input.kind === "ai" ? (await adviceQuery.all<Row>()).results : [];
    for (const { part, result, raw } of selected) {
      const row: Cell[] = [
        part.class_code_snapshot === null
          ? "原校"
          : String(part.class_code_snapshot),
        part.seat_number_snapshot === null
          ? null
          : Number(part.seat_number_snapshot),
        String(part.name),
        String(part.student_number),
      ];
      if (individual)
        row.push(
          part.origin === "EXTERNAL_TRANSFER"
            ? `原校：${part.external_school_label}`
            : "本校",
        );
      for (const value of row)
        sourceBudget.add(value === null ? "—" : String(value));
      if (input.kind === "ai") {
        const pair = advice.filter((a) => a.student_id === part.student_id);
        let parent: Cell = "尚無有效建議",
          student: Cell = "尚無有效建議",
          state = "尚無有效建議";
        if (
          pair.length === 2 &&
          pair[0].version === pair[1].version &&
          pair.every(
            (a) =>
              a.stale_at === null &&
              a.result_version_id === version.id &&
              a.status === "completed",
          )
        ) {
          // Immutable advice content is fetched only after its byte size fits.
          for (const a of pair) sourceBudget.addBytes(Number(a.content_bytes));
          const contentRows = await this.query(
            "SELECT id,content FROM ai_advices WHERE id IN (?,?) ORDER BY id",
            String(pair[0].id),
            String(pair[1].id),
          ).all<Row>();
          if (contentRows.results.length !== 2)
            throw new ReportError("REPORT_VERSION_CHANGED", 409);
          try {
            const content = (audience: "parent" | "student") => {
              const a = pair.find((a) => a.audience === audience);
              if (!a) throw new Error();
              const text = contentRows.results.find(
                (r) => r.id === a.id,
              )?.content;
              if (typeof text !== "string") throw new Error();
              const valid = validateAdvice(text, audience, [
                String(part.name),
                String(part.birth_date),
                String(part.student_id),
                String(part.student_number),
              ]);
              return [
                ...ADVICE_SECTIONS,
                ...(audience === "parent" ? ["parentSupport" as const] : []),
              ]
                .map((key) => valid[key])
                .join("\n\n");
            };
            parent = content("parent");
            student = content("student");
            state = "有效";
          } catch {
            parent = "尚無有效建議";
            student = "尚無有效建議";
          }
        }
        row.push(state, parent, student);
      } else if (rankKind)
        row.push(
          scaled(result!.exam.averageHundredths),
          scaled(result!.exam.totalHundredths),
          input.kind === "grade-ranking"
            ? result!.gradeRank
            : result!.classRank,
        );
      else {
        row.push(
          ...scoreSettings.map((setting) => {
            const score = raw!.scores.find(
              (s) =>
                s.examType === setting.examType &&
                s.subject === setting.subject,
            );
            return score
              ? score.scoreStatus === "NORMAL"
                ? scaled(score.scoreValue)
                : (statuses[score.scoreStatus] ?? "—")
              : "—";
          }),
          scaled(result!.quiz.averageHundredths),
          scaled(result!.midterm.averageHundredths),
          scaled(result!.exam.averageHundredths),
          scaled(result!.exam.totalHundredths),
          result!.classRank,
        );
        if (gradeKind) row.push(result!.gradeRank);
      }
      rows.push(row);
    }
    if (rankKind) {
      const index = columns.length - 1;
      rows.sort(
        (a, b) =>
          (a[index] === null ? Infinity : Number(a[index])) -
          (b[index] === null ? Infinity : Number(b[index])),
      );
    }
    const report: Report = {
      title: titles[input.kind],
      subtitle: `${exam.year_code} 學年度・第 ${exam.term_number} 學期・第 ${exam.sequence} 次評量・${snapshot.result.mode === "PROVISIONAL" ? "暫時排名" : "正式排名"}・發布版本 ${version.version}`,
      columns,
      rows,
    };
    sourceBudget.add(report.title);
    sourceBudget.add(report.subtitle);
    for (const column of columns) sourceBudget.add(column);
    validateReportSource(report);
    // Advice content is immutable. Hash the bounded snapshot as Purge may replace
    // a sanitized snapshot; do not retain an additional serialized source copy.
    const versionStamp = async (v: Row | undefined) => {
      if (!v) return null;
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(String(v.snapshot_json)),
      );
      return [
        v.id,
        v.version,
        v.source_bytes,
        [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      ];
    };
    const fingerprint = JSON.stringify([
      await versionStamp(version),
      parts,
      advice,
    ]);
    const revalidate = async () => {
      await access();
      const [versions, students, ai] = await this.deps.db.batch<Row>([
        versionQuery,
        partsQuery,
        ...(input.kind === "ai" ? [adviceQuery] : []),
      ]);
      if (
        JSON.stringify([
          await versionStamp(versions.results[0]),
          students.results,
          ai?.results ?? [],
        ]) !== fingerprint
      )
        throw new ReportError("REPORT_VERSION_CHANGED", 409);
      await access();
    };
    await revalidate();
    return { report, version: Number(version.version), revalidate };
  }
}
