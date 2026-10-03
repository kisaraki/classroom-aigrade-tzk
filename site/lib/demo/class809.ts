import { calculateExam } from "../domain/ranking.ts";
import { parseScore, SUBJECT_SETTINGS } from "../domain/scores.ts";

// Fixed, explicitly fictional presentation data. Never reads or writes D1.
export const demoSubjects: Record<string, string> = {
  CHINESE: "國文",
  ENGLISH: "英文",
  MATH: "數學",
  SCIENCE: "自然",
  GEOGRAPHY: "地理",
  HISTORY: "歷史",
  CIVICS: "公民",
};
export const demoRoster = Array.from({ length: 25 }, (_, i) => {
  const seat = i + 1;
  const id = `demo-809-${String(seat).padStart(2, "0")}`;
  const scores = SUBJECT_SETTINGS.map((setting, j) => {
    const absent =
      seat === 25 || (seat === 7 && j === 4) || (seat === 18 && j < 3);
    const value = absent
      ? "A"
      : seat === 24 && setting.subject === "MATH"
        ? 0
        : seat <= 2
          ? 96 - (j % 3)
          : seat % 5 === 0
            ? 36 + ((seat + j * 7) % 23)
            : 52 + ((seat * 13 + j * 7) % 47);
    return { ...setting, ...parseScore(value) };
  });
  return { id, seat, name: `模擬學生${String(seat).padStart(2, "0")}`, scores };
});
const calculation = calculateExam({
  examId: "demo-exam-1",
  academicTermId: "demo-term-1",
  academicYearId: "demo-year-115",
  sourceVersion: 1,
  mode: "FINAL",
  components: ["QUIZ", "MIDTERM"],
  settings: SUBJECT_SETTINGS.map((s) => ({ ...s, held: true })),
  enrollmentSnapshot: demoRoster.map((s) => ({
    studentId: s.id,
    classId: "demo-809",
    grade: 8,
  })),
  participants: demoRoster.map((s) => ({
    id: s.id,
    studentId: s.id,
    origin: "LOCAL",
    classIdSnapshot: "demo-809",
    gradeSnapshot: 8,
    rankingEligible: true,
    scores: s.scores,
  })),
});
export const demoStudents = demoRoster.map((s) => {
  const result = calculation.local.find((r) => r.studentId === s.id)!;
  return {
    ...s,
    result,
    absent: s.scores.some((x) => x.scoreStatus === "ABSENT"),
    failing: s.scores.some((x) => x.scoreValue !== null && x.scoreValue < 6000),
  };
});
export function demoScore(value: number | null) {
  return value === null ? "—" : (value / 100).toFixed(2);
}
