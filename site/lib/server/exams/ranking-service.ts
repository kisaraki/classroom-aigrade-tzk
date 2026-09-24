import {
  calculateExam,
  type CalculationMode,
  type CalculationScore,
  type ExamCalculationInput,
} from "../../domain/ranking.ts";
import { ExamError } from "../../domain/scores.ts";
import { AuthorizationService } from "../auth/authorization.ts";
import type { AuthSession, ScopeResource } from "../auth/types.ts";

type Row = Record<string, string | number | null>;
type CalculationScope =
  { classId: string; grade?: never } | { grade: number; classId?: never };
const fail = (code: string, status = 400): never => {
  throw new ExamError(code, status);
};

/** Internal read-only preview adapter. Publication/persistence belongs to the Phase 7 transaction. */
export class RankingService {
  private readonly db: D1Database;
  private readonly authorization: AuthorizationService;
  constructor(dependencies: { db: D1Database; now?: () => number }) {
    this.db = dependencies.db;
    this.authorization = new AuthorizationService(dependencies);
  }
  private statement(sql: string, ...values: (string | number | null)[]) {
    return this.db.prepare(sql).bind(...values);
  }
  private async exam(examId: string) {
    const row = await this.statement(
      "SELECT e.*,t.academic_year_id,a.revision FROM exams e JOIN academic_terms t ON t.id=e.academic_term_id CROSS JOIN academic_state a WHERE e.id=? AND a.id=1",
      examId,
    ).first<Row>();
    if (!row) return fail("EXAM_NOT_FOUND", 404);
    return row;
  }
  async calculate(
    session: AuthSession,
    examId: string,
    scope: CalculationScope,
    mode: CalculationMode,
  ) {
    if (
      typeof examId !== "string" ||
      !examId.trim() ||
      !["PROVISIONAL", "FINAL"].includes(mode)
    )
      fail("INVALID_CALCULATION_INPUT");
    if (
      !scope ||
      typeof scope !== "object" ||
      Object.keys(scope).length !== 1 ||
      !(
        (typeof scope.classId === "string" && scope.classId.trim()) ||
        [7, 8, 9].includes(scope.grade!)
      )
    )
      fail("INVALID_CALCULATION_SCOPE");
    const exam = await this.exam(examId);
    const resource: ScopeResource = {
      academicTermId: String(exam.academic_term_id),
      onDate: String(exam.starts_on),
      ...scope,
    };
    await this.authorization.assertPermission(session, "score.read", resource);
    const classId = scope.classId ?? null,
      grade = scope.grade ?? null;
    const partFilter =
      "p.exam_id=? AND p.origin='LOCAL' AND (? IS NULL OR p.class_id_snapshot=?) AND (? IS NULL OR p.grade_snapshot=?)";
    const values = [examId, classId, classId, grade, grade];
    // D1 batch executes the source SELECTs in one transaction. Recheck the version and grant after it.
    const [settings, parts, scores, enrollment] = await this.db.batch<Row>([
      this.statement(
        "SELECT exam_type,subject,held FROM exam_subject_settings WHERE exam_id=? ORDER BY exam_type,subject",
        examId,
      ),
      this.statement(
        `SELECT p.* FROM exam_participations p WHERE ${partFilter} ORDER BY p.id`,
        ...values,
      ),
      this.statement(
        `SELECT s.* FROM score_items s JOIN exam_participations p ON p.id=s.participation_id WHERE ${partFilter} ORDER BY s.id`,
        ...values,
      ),
      this.statement(
        "SELECT n.student_id,n.class_id,c.grade FROM student_enrollments n JOIN classes c ON c.id=n.class_id WHERE n.academic_term_id=? AND n.status='valid' AND n.effective_from<=? AND (n.effective_to IS NULL OR n.effective_to>?) AND (? IS NULL OR n.class_id=?) AND (? IS NULL OR c.grade=?) ORDER BY n.student_id",
        String(exam.academic_term_id),
        String(exam.starts_on),
        String(exam.starts_on),
        classId,
        classId,
        grade,
        grade,
      ),
    ]);
    await this.authorization.assertPermission(session, "score.read", resource);
    const current = await this.exam(examId);
    if (current.version !== exam.version || current.revision !== exam.revision)
      fail("CALCULATION_SOURCE_CHANGED", 409);
    const input: ExamCalculationInput = {
      examId,
      academicTermId: String(exam.academic_term_id),
      academicYearId: String(exam.academic_year_id),
      sourceVersion: Number(exam.version),
      mode,
      settings: settings.results.map((s) => ({
        examType: s.exam_type as CalculationScore["examType"],
        subject: s.subject as CalculationScore["subject"],
        held: s.held === 1,
      })),
      enrollmentSnapshot: enrollment.results.map((e) => ({
        studentId: String(e.student_id),
        classId: String(e.class_id),
        grade: Number(e.grade),
      })),
      participants: parts.results.map((p) => ({
        id: String(p.id),
        studentId: String(p.student_id),
        origin: "LOCAL",
        classIdSnapshot: String(p.class_id_snapshot),
        gradeSnapshot: Number(p.grade_snapshot),
        rankingEligible: p.ranking_eligible === 1,
        scores: scores.results
          .filter((s) => s.participation_id === p.id)
          .map((s) => ({
            examType: s.exam_type as CalculationScore["examType"],
            subject: s.subject as CalculationScore["subject"],
            scoreValue: s.score_value === null ? null : Number(s.score_value),
            scoreStatus: s.score_status as CalculationScore["scoreStatus"],
            includeInAverage: s.include_in_average as 0 | 1,
          })),
      })),
    };
    const result = calculateExam(input);
    const common = {
      calculationVersion: result.calculationVersion,
      examId: result.examId,
      academicTermId: result.academicTermId,
      academicYearId: result.academicYearId,
      sourceVersion: result.sourceVersion,
      sourceRevision: Number(exam.revision),
      mode: result.mode,
      published: false as const,
      classes: result.classes,
    };
    // A class-only calculation cannot assert a grade rank and must not expose other classes.
    if (classId !== null)
      return {
        ...common,
        local: result.local.map((p) => {
          const { gradeRank, ...visible } = p;
          void gradeRank;
          return visible;
        }),
      };
    return { ...common, local: result.local, grades: result.grades };
  }
}
