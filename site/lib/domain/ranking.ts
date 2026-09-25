import { averageScores, type AverageScore } from "./averages.ts";
import { SUBJECT_SETTINGS, type Subject, type ExamType } from "./scores.ts";

export const CALCULATION_VERSION = "phase7-v1";
export type CalculationMode = "PROVISIONAL" | "FINAL";
export type ScoreOrigin = "LOCAL" | "EXTERNAL_TRANSFER";
export type CalculationScore = AverageScore & {
  examType: ExamType;
  subject: Subject;
};
export type CalculationParticipant = {
  id: string;
  studentId: string;
  origin: ScoreOrigin;
  classIdSnapshot: string | null;
  gradeSnapshot: number | null;
  rankingEligible: boolean;
  scores: readonly CalculationScore[];
};
export type ExamCalculationInput = {
  examId: string;
  academicTermId: string;
  academicYearId: string;
  sourceVersion: number;
  mode: CalculationMode;
  /** D-08: explicit published components; omission preserves the Phase 5 preview API. */
  components?: readonly ExamType[];
  settings: readonly { examType: ExamType; subject: Subject; held: boolean }[];
  /** Caller supplies the enrollment snapshot at the assessment start, never today's roster. */
  enrollmentSnapshot: readonly {
    studentId: string;
    classId: string;
    grade: number;
  }[];
  participants: readonly CalculationParticipant[];
};
type Summary = ReturnType<typeof averageScores>;
export type ParticipantResult = {
  participationId: string;
  studentId: string;
  origin: ScoreOrigin;
  classIdSnapshot: string | null;
  gradeSnapshot: number | null;
  rankingEligible: boolean;
  quiz: Summary;
  midterm: Summary;
  exam: Summary;
  subjects: Record<Subject, Summary>;
  classRank: number | null;
  gradeRank: number | null;
};
const invalid = (): never => {
  throw new Error("INVALID_CALCULATION_INPUT");
};
const isId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= 320;
const isGrade = (v: unknown) => v === 7 || v === 8 || v === 9;
const key = (s: { examType: string; subject: string }) =>
  `${s.examType}:${s.subject}`;
const subjects = SUBJECT_SETTINGS.filter((s) => s.examType === "MIDTERM").map(
  (s) => s.subject,
);

function validate(input: ExamCalculationInput) {
  if (
    input.components !== undefined &&
    (!Array.isArray(input.components) ||
      !input.components.length ||
      new Set(input.components).size !== input.components.length ||
      input.components.some((v) => v !== "QUIZ" && v !== "MIDTERM") ||
      (input.mode === "FINAL") !== (input.components.length === 2))
  )
    invalid();
  if (
    !input ||
    !isId(input.examId) ||
    !isId(input.academicTermId) ||
    !isId(input.academicYearId) ||
    !Number.isSafeInteger(input.sourceVersion) ||
    input.sourceVersion < 1 ||
    !["PROVISIONAL", "FINAL"].includes(input.mode) ||
    !Array.isArray(input.settings) ||
    !Array.isArray(input.participants) ||
    !Array.isArray(input.enrollmentSnapshot)
  )
    invalid();
  const allowed = new Set(SUBJECT_SETTINGS.map(key));
  const settings = new Map<string, boolean>();
  for (const s of input.settings) {
    if (
      !s ||
      !allowed.has(key(s)) ||
      settings.has(key(s)) ||
      typeof s.held !== "boolean"
    )
      invalid();
    settings.set(key(s), s.held);
  }
  if (settings.size !== allowed.size) invalid();
  const classGrades = new Map<string, number>();
  const classGrade = (classId: unknown, grade: unknown) => {
    if (!isId(classId) || !isGrade(grade)) return invalid();
    const previous = classGrades.get(classId);
    if (previous !== undefined && previous !== grade) invalid();
    classGrades.set(classId, grade as number);
  };
  const enrolled = new Set<string>();
  for (const e of input.enrollmentSnapshot) {
    if (!e || !isId(e.studentId) || enrolled.has(e.studentId)) invalid();
    enrolled.add(e.studentId);
    classGrade(e.classId, e.grade);
  }
  const ids = new Set<string>(),
    students = new Set<string>();
  for (const p of input.participants) {
    if (
      !p ||
      !isId(p.id) ||
      !isId(p.studentId) ||
      ids.has(p.id) ||
      !["LOCAL", "EXTERNAL_TRANSFER"].includes(p.origin) ||
      typeof p.rankingEligible !== "boolean" ||
      !Array.isArray(p.scores)
    )
      invalid();
    ids.add(p.id);
    const studentKey = JSON.stringify([p.origin, p.studentId]);
    if (students.has(studentKey)) invalid();
    students.add(studentKey);
    if (p.origin === "LOCAL") classGrade(p.classIdSnapshot, p.gradeSnapshot);
    else if (
      p.classIdSnapshot !== null ||
      p.gradeSnapshot !== null ||
      p.rankingEligible
    )
      invalid();
    const seen = new Set<string>();
    for (const s of p.scores) {
      if (!s || !allowed.has(key(s)) || seen.has(key(s))) invalid();
      seen.add(key(s));
      averageScores([s]);
      if (
        p.origin === "LOCAL" &&
        (settings.get(key(s)) === false) !== (s.scoreStatus === "NOT_HELD")
      )
        invalid();
    }
  }
  return classGrades;
}

function selected(
  p: CalculationParticipant,
  mode: CalculationMode,
  components?: readonly ExamType[],
) {
  return p.scores.filter((s) =>
    components
      ? components.includes(s.examType)
      : mode === "FINAL" || s.examType === "QUIZ",
  );
}
function summarize(
  p: CalculationParticipant,
  mode: CalculationMode,
  components?: readonly ExamType[],
): ParticipantResult {
  const scores = selected(p, mode, components);
  return {
    participationId: p.id,
    studentId: p.studentId,
    origin: p.origin,
    classIdSnapshot: p.classIdSnapshot,
    gradeSnapshot: p.gradeSnapshot,
    rankingEligible: p.rankingEligible,
    quiz: averageScores(scores.filter((s) => s.examType === "QUIZ")),
    midterm: averageScores(scores.filter((s) => s.examType === "MIDTERM")),
    exam: averageScores(scores),
    subjects: Object.fromEntries(
      subjects.map((subject) => [
        subject,
        averageScores(scores.filter((s) => s.subject === subject)),
      ]),
    ) as Record<Subject, Summary>,
    classRank: null,
    gradeRank: null,
  };
}
function descending(a: number | null, b: number | null) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}
function compare(a: ParticipantResult, b: ParticipantResult) {
  return (
    descending(a.exam.averageHundredths, b.exam.averageHundredths) ||
    descending(a.exam.totalHundredths, b.exam.totalHundredths) ||
    descending(
      a.subjects.CHINESE.totalHundredths,
      b.subjects.CHINESE.totalHundredths,
    ) ||
    descending(
      a.subjects.ENGLISH.totalHundredths,
      b.subjects.ENGLISH.totalHundredths,
    ) ||
    descending(a.subjects.MATH.totalHundredths, b.subjects.MATH.totalHundredths)
  );
}
const eligible = (p: ParticipantResult) =>
  p.origin === "LOCAL" && p.rankingEligible && p.exam.validCount > 0;
function rank(rows: ParticipantResult[], field: "classRank" | "gradeRank") {
  const sorted = rows.filter(eligible).sort(compare);
  let position = 0;
  sorted.forEach((row, i) => {
    if (i === 0 || compare(sorted[i - 1], row) !== 0) position = i + 1;
    row[field] = position;
  });
}
function metrics(rows: ParticipantResult[]) {
  const metric = (read: (p: ParticipantResult) => Summary) => {
    const valid = rows.map(read).filter((s) => s.validCount > 0);
    return {
      validStudentCount: valid.length,
      validScoreCount: valid.reduce((sum, s) => sum + s.validCount, 0),
      maximumAverageHundredths: valid.reduce<number | null>(
        (max, s) =>
          max === null
            ? s.averageHundredths
            : Math.max(max, s.averageHundredths!),
        null,
      ),
    };
  };
  return {
    quiz: metric((p) => p.quiz),
    midterm: metric((p) => p.midterm),
    exam: metric((p) => p.exam),
    subjects: Object.fromEntries(
      subjects.map((subject) => [subject, metric((p) => p.subjects[subject])]),
    ),
  };
}
function cohort(rows: ParticipantResult[], enrollmentCount: number) {
  const ranked = rows.filter(eligible);
  return {
    enrollmentCount,
    participationCount: rows.length,
    eligibleCount: rows.filter((p) => p.rankingEligible).length,
    rankedCount: ranked.length,
    general: metrics(rows),
    ranking: metrics(ranked),
  };
}

/** Pure calculation over one version of one exam. No publication or authorization is implied. */
export function calculateExam(input: ExamCalculationInput) {
  const classGrades = validate(input);
  const summaries = input.participants.map((p) =>
    summarize(p, input.mode, input.components),
  );
  const local = summaries.filter((p) => p.origin === "LOCAL");
  const external = summaries.filter((p) => p.origin === "EXTERNAL_TRANSFER");
  const classes = [...classGrades.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([classId, grade]) => {
      const rows = local.filter((p) => p.classIdSnapshot === classId);
      rank(rows, "classRank");
      return {
        classId,
        grade,
        ...cohort(
          rows,
          input.enrollmentSnapshot.filter((e) => e.classId === classId).length,
        ),
      };
    });
  const grades = [...new Set(classGrades.values())].sort().map((grade) => {
    const rows = local.filter((p) => p.gradeSnapshot === grade);
    rank(rows, "gradeRank");
    return {
      grade,
      ...cohort(
        rows,
        input.enrollmentSnapshot.filter((e) => e.grade === grade).length,
      ),
    };
  });
  return {
    calculationVersion: CALCULATION_VERSION,
    examId: input.examId,
    academicTermId: input.academicTermId,
    academicYearId: input.academicYearId,
    sourceVersion: input.sourceVersion,
    mode: input.mode,
    local,
    external,
    classes,
    grades,
  };
}

/** Do not average rounded exam averages or silently mix local and transfer marks. */
export function calculateSemesterAverage(
  exams: readonly ExamCalculationInput[],
  studentId: string,
  origin: ScoreOrigin,
) {
  if (
    !Array.isArray(exams) ||
    !isId(studentId) ||
    !["LOCAL", "EXTERNAL_TRANSFER"].includes(origin)
  )
    invalid();
  const ids = new Set<string>();
  const scores: CalculationScore[] = [];
  for (const exam of exams) {
    validate(exam);
    if (
      ids.has(exam.examId) ||
      exam.academicTermId !== exams[0].academicTermId ||
      exam.academicYearId !== exams[0].academicYearId
    )
      invalid();
    ids.add(exam.examId);
    for (const p of exam.participants)
      if (p.studentId === studentId && p.origin === origin)
        scores.push(...selected(p, exam.mode, exam.components));
  }
  return averageScores(scores);
}
