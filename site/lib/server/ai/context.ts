import type {
  ExamCalculationInput,
  ParticipantResult,
  calculateExam,
} from "../../domain/ranking.ts";
import { SUBJECTS } from "../../domain/scores.ts";
import {
  adviceFail,
  assertAIPrivacy,
  adviceInstructions,
  type AdviceAudience,
} from "./advice.ts";
import { AI_LIMITS, type AIInput } from "./provider.ts";

export type AdviceSnapshot = {
  sequence: number;
  input: ExamCalculationInput;
  result: ReturnType<typeof calculateExam>;
};
const number = (v: unknown, nullable = false): number | null => {
  if (nullable && v === null) return null;
  if (!Number.isSafeInteger(v) || Number(v) < 0)
    return adviceFail("AI_CONTEXT_INVALID");
  return Number(v);
};
function summary(value: ParticipantResult["exam"]) {
  return {
    averageHundredths: number(value.averageHundredths, true),
    totalHundredths: number(value.totalHundredths, true),
    validCount: number(value.validCount),
  };
}
function aggregate(rows: ParticipantResult[]) {
  const count = rows.reduce(
    (total, row) => total + BigInt(number(row.exam.validCount)!),
    BigInt(0),
  );
  const total = rows.reduce(
    (sum, row) => sum + BigInt(number(row.exam.totalHundredths, true) ?? 0),
    BigInt(0),
  );
  return {
    averageHundredths: count
      ? Number((BigInt(2) * total + count) / (BigInt(2) * count))
      : null,
    validStudentCount: rows.filter((row) => row.exam.validCount > 0).length,
    validScoreCount: Number(count),
  };
}
function personal(snapshot: AdviceSnapshot, studentId: string) {
  const results = snapshot.result.local.filter(
    (row) => row.studentId === studentId,
  );
  const participants = snapshot.input.participants.filter(
    (row) => row.studentId === studentId && row.origin === "LOCAL",
  );
  if (results.length !== 1 || participants.length !== 1)
    return adviceFail("AI_LOCAL_PARTICIPATION_REQUIRED");
  const row = results[0];
  if (![7, 8, 9].includes(row.gradeSnapshot!))
    return adviceFail("AI_CONTEXT_INVALID");
  const components =
    snapshot.input.components ??
    (snapshot.input.mode === "FINAL" ? ["QUIZ", "MIDTERM"] : ["QUIZ"]);
  return {
    row,
    data: {
      scores: participants[0].scores
        .filter((score) => components.includes(score.examType))
        .map((score) => {
          if (
            !SUBJECTS.includes(score.subject) ||
            !["QUIZ", "MIDTERM"].includes(score.examType) ||
            ![
              "NORMAL",
              "UNENTERED",
              "ABSENT",
              "OFFICIAL_LEAVE",
              "SICK_LEAVE",
              "EXEMPT",
              "NOT_HELD",
            ].includes(score.scoreStatus)
          )
            return adviceFail("AI_CONTEXT_INVALID");
          return {
            component: score.examType,
            subject: score.subject,
            valueHundredths: number(score.scoreValue, true),
            status: score.scoreStatus,
          };
        }),
      quiz: summary(row.quiz),
      midterm: summary(row.midterm),
      exam: summary(row.exam),
      subjects: Object.fromEntries(
        SUBJECTS.map((subject) => [subject, summary(row.subjects[subject])]),
      ),
    },
  };
}
/** Only caller-authorized immutable publication snapshots enter this function. IDs stay server-side. */
export function assembleAdviceContext(
  current: AdviceSnapshot,
  studentId: string,
  previous: AdviceSnapshot | null,
) {
  if (
    ![1, 2, 3].includes(current.sequence) ||
    !["PROVISIONAL", "FINAL"].includes(current.result.mode)
  )
    return adviceFail("AI_CONTEXT_INVALID");
  const target = personal(current, studentId);
  let prior: ReturnType<typeof personal>["data"] | null = null;
  if (current.sequence > 1 && previous) {
    if (
      previous.sequence !== current.sequence - 1 ||
      previous.input.academicTermId !== current.input.academicTermId ||
      previous.input.academicYearId !== current.input.academicYearId
    )
      return adviceFail("AI_PREVIOUS_EXAM_MISMATCH");
    if (previous.result.local.some((row) => row.studentId === studentId))
      prior = personal(previous, studentId).data;
  }
  const difference = (a: number | null, b: number | null) =>
    a === null || b === null ? null : a - b;
  return {
    schemaVersion: "phase12-context-v1",
    scoreUnit: "hundredth-point",
    sequence: current.sequence,
    grade: target.row.gradeSnapshot,
    mode: current.result.mode,
    current: target.data,
    classRank: number(target.row.classRank, true),
    classStatistics: aggregate(
      current.result.local.filter(
        (row) => row.classIdSnapshot === target.row.classIdSnapshot,
      ),
    ),
    gradeStatistics: aggregate(
      current.result.local.filter(
        (row) => row.gradeSnapshot === target.row.gradeSnapshot,
      ),
    ),
    previous: prior,
    differences: prior
      ? {
          examAverageHundredths: difference(
            target.data.exam.averageHundredths,
            prior.exam.averageHundredths,
          ),
          quizAverageHundredths: difference(
            target.data.quiz.averageHundredths,
            prior.quiz.averageHundredths,
          ),
          midtermAverageHundredths: difference(
            target.data.midterm.averageHundredths,
            prior.midterm.averageHundredths,
          ),
          subjects: Object.fromEntries(
            SUBJECTS.map((subject) => [
              subject,
              difference(
                target.data.subjects[subject].averageHundredths,
                prior.subjects[subject].averageHundredths,
              ),
            ]),
          ),
        }
      : null,
  };
}
export type AdviceContext = ReturnType<typeof assembleAdviceContext>;
/** Reference identifiers and file metadata are deliberately excluded from the model envelope. */
export function adviceInput(
  context: AdviceContext,
  audience: AdviceAudience,
  references: readonly { text: string }[],
  identifiers: readonly string[],
): AIInput {
  if (
    references.length > 8 ||
    references.reduce((sum, r) => sum + [...r.text].length, 0) > 8000
  )
    return adviceFail("AI_REFERENCE_LIMIT");
  for (const reference of references)
    assertAIPrivacy(reference.text, identifiers);
  const text = JSON.stringify({
    context,
    untrustedReferences: references.map((r, i) => ({
      label: `R${i + 1}`,
      text: r.text,
    })),
  });
  assertAIPrivacy(text, identifiers);
  const instructions = adviceInstructions(audience);
  if ([...instructions].length + [...text].length > AI_LIMITS.inputCharacters)
    return adviceFail("AI_INPUT_LIMIT");
  return { instructions, text };
}
