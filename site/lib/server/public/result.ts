import { averageScores } from "../../domain/averages.ts";
import { SUBJECTS } from "../../domain/scores.ts";
import type {
  ExamCalculationInput,
  calculateExam,
  ParticipantResult,
} from "../../domain/ranking.ts";

export type PublishedSnapshot = {
  purged?: boolean;
  input: ExamCalculationInput;
  result: ReturnType<typeof calculateExam>;
  components: ("QUIZ" | "MIDTERM")[];
};
export type PublishedRecord = {
  year: string;
  term: number;
  sequence: number;
  snapshot: PublishedSnapshot;
};
function summary(s: ParticipantResult["exam"]) {
  return {
    average: s.averageHundredths,
    total: s.totalHundredths,
    count: s.validCount,
  };
}
function statistics(rows: ParticipantResult[], population: number) {
  const count = rows.reduce((n, r) => n + BigInt(r.exam.validCount), BigInt(0));
  const total = rows.reduce(
    (n, r) => n + BigInt(r.exam.totalHundredths ?? 0),
    BigInt(0),
  );
  const valid = rows.filter((r) => r.exam.averageHundredths !== null);
  return {
    population,
    participationCount: rows.length,
    eligibleCount: rows.filter((r) => r.rankingEligible).length,
    rankedCount: rows.filter((r) => r.rankingEligible && r.exam.validCount > 0)
      .length,
    quizValidStudents: rows.filter((r) => r.quiz.validCount > 0).length,
    midtermValidStudents: rows.filter((r) => r.midterm.validCount > 0).length,
    validStudents: valid.length,
    average: count
      ? Number((BigInt(2) * total + count) / (BigInt(2) * count))
      : null,
    maximum: valid.length
      ? Math.max(...valid.map((r) => r.exam.averageHundredths!))
      : null,
  };
}
/** Explicit public projection. Never spread a snapshot, participant or database row. */
export function publicResult(
  current: PublishedRecord,
  history: PublishedRecord[],
  studentId: string,
) {
  const { snapshot } = current;
  const row = snapshot.result.local.find((r) => r.studentId === studentId);
  const part = snapshot.input.participants?.find(
    (r) => r.studentId === studentId && r.origin === "LOCAL",
  );
  if (!row || (!part && !snapshot.purged)) throw new Error("LOOKUP_FAILED");
  const classes = snapshot.result.local.filter(
    (r) => r.classIdSnapshot === row.classIdSnapshot,
  );
  const grades = snapshot.result.local.filter(
    (r) => r.gradeSnapshot === row.gradeSnapshot,
  );
  const own = history
    .flatMap((record) => {
      const person = record.snapshot.result.local.find(
        (r) => r.studentId === studentId,
      );
      return person
        ? [
            {
              year: record.year,
              term: record.term,
              sequence: record.sequence,
              quiz: person.quiz.averageHundredths,
              midterm: person.midterm.averageHundredths,
              exam: person.exam.averageHundredths,
              provisional: record.snapshot.result.mode === "PROVISIONAL",
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        Number(a.year) - Number(b.year) ||
        a.term - b.term ||
        a.sequence - b.sequence,
    )
    .slice(-18);
  const termScores = history
    .filter((r) => r.year === current.year && r.term === current.term)
    .flatMap((r) =>
      (r.snapshot.input.participants ?? [])
        .filter((p) => p.studentId === studentId && p.origin === "LOCAL")
        .flatMap((p) =>
          p.scores.filter((s) => r.snapshot.components.includes(s.examType)),
        ),
    );
  return {
    historicalInputsRemoved: !!snapshot.purged,
    semesterInputsRemoved: history.some(
      (r) =>
        r.year === current.year && r.term === current.term && r.snapshot.purged,
    ),
    year: current.year,
    term: current.term,
    sequence: current.sequence,
    provisional: snapshot.result.mode === "PROVISIONAL",
    components: [...snapshot.components],
    scores: SUBJECTS.map((subject) => ({
      subject,
      quiz: mark("QUIZ", subject),
      midterm: mark("MIDTERM", subject),
    })),
    quiz: summary(row.quiz),
    midterm: summary(row.midterm),
    exam: summary(row.exam),
    semester: history.some(
      (r) =>
        r.year === current.year && r.term === current.term && r.snapshot.purged,
    )
      ? { average: null, total: null, count: 0 }
      : summary(averageScores(termScores)),
    classRank: row.classRank,
    classStatistics: snapshot.purged
      ? {
          population: null,
          participationCount: null,
          eligibleCount: null,
          rankedCount: null,
          quizValidStudents: null,
          midtermValidStudents: null,
          validStudents: null,
          average: null,
          maximum: null,
        }
      : statistics(
          classes,
          snapshot.result.classes.find((c) => c.classId === row.classIdSnapshot)
            ?.enrollmentCount ?? classes.length,
        ),
    gradeStatistics: snapshot.purged
      ? {
          population: null,
          participationCount: null,
          eligibleCount: null,
          rankedCount: null,
          quizValidStudents: null,
          midtermValidStudents: null,
          validStudents: null,
          average: null,
          maximum: null,
        }
      : statistics(
          grades,
          snapshot.result.grades.find((g) => g.grade === row.gradeSnapshot)
            ?.enrollmentCount ?? grades.length,
        ),
    trends: own,
    externalTrends: history
      .flatMap((record) =>
        record.snapshot.result.external
          .filter((r) => r.studentId === studentId)
          .map((r) => ({
            year: record.year,
            term: record.term,
            sequence: record.sequence,
            quiz: r.quiz.averageHundredths,
            midterm: r.midterm.averageHundredths,
            exam: r.exam.averageHundredths,
          })),
      )
      .sort(
        (a, b) =>
          Number(a.year) - Number(b.year) ||
          a.term - b.term ||
          a.sequence - b.sequence,
      )
      .slice(-18),
  };
  function mark(
    component: "QUIZ" | "MIDTERM",
    subject: (typeof SUBJECTS)[number],
  ) {
    if (!snapshot.components.includes(component))
      return { status: "UNPUBLISHED", value: null };
    if (snapshot.purged)
      return { status: "HISTORICAL_UNAVAILABLE", value: null };
    const score = part!.scores.find(
      (s) => s.examType === component && s.subject === subject,
    );
    const setting = snapshot.input.settings.find(
      (s) => s.examType === component && s.subject === subject,
    );
    if (!setting) return { status: "NOT_APPLICABLE", value: null };
    if (!setting.held) return { status: "NOT_HELD", value: null };
    return {
      status: score?.scoreStatus ?? "UNENTERED",
      value: score?.scoreValue ?? null,
    };
  }
}
export type PublicResult = ReturnType<typeof publicResult>;
