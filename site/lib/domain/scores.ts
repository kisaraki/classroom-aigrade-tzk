export const SUBJECTS = [
  "CHINESE",
  "ENGLISH",
  "MATH",
  "SCIENCE",
  "GEOGRAPHY",
  "HISTORY",
  "CIVICS",
] as const;
export type Subject = (typeof SUBJECTS)[number];
export type ExamType = "QUIZ" | "MIDTERM";
export const SUBJECT_SETTINGS = ["QUIZ", "MIDTERM"].flatMap((type) =>
  SUBJECTS.slice(0, type === "QUIZ" ? 3 : 7).map((subject) => ({
    examType: type as ExamType,
    subject,
  })),
);
export type ScoreStatus =
  | "NORMAL"
  | "UNENTERED"
  | "ABSENT"
  | "OFFICIAL_LEAVE"
  | "SICK_LEAVE"
  | "EXEMPT"
  | "NOT_HELD";
const CODES: Record<string, ScoreStatus> = {
  A: "ABSENT",
  B: "OFFICIAL_LEAVE",
  C: "SICK_LEAVE",
  D: "EXEMPT",
  N: "NOT_HELD",
};
export class ExamError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "ExamError";
  }
}
export function parseScore(value: unknown): {
  scoreValue: number | null;
  scoreStatus: ScoreStatus;
  includeInAverage: 0 | 1;
} {
  if (value === null || value === "")
    return { scoreValue: null, scoreStatus: "UNENTERED", includeInAverage: 0 };
  if (typeof value !== "string" && typeof value !== "number")
    throw new ExamError("INVALID_SCORE");
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Object.is(value, -0))
  )
    throw new ExamError("INVALID_SCORE");
  const source = String(value).trim();
  if (!source)
    return { scoreValue: null, scoreStatus: "UNENTERED", includeInAverage: 0 };
  if (Object.hasOwn(CODES, source))
    return {
      scoreValue: null,
      scoreStatus: CODES[source],
      includeInAverage: 0,
    };
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u.test(source))
    throw new ExamError("INVALID_SCORE");
  const [whole, fraction = ""] = source.split(".");
  const scoreValue = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (scoreValue > 10000) throw new ExamError("INVALID_SCORE");
  return { scoreValue, scoreStatus: "NORMAL", includeInAverage: 1 };
}
export function scoreDisplay(value: number | null): string | null {
  return value === null
    ? null
    : `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
