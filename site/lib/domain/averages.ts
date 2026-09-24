import type { ScoreStatus } from "./scores.ts";

export type AverageScore = {
  scoreValue: number | null;
  scoreStatus: ScoreStatus;
  includeInAverage: 0 | 1;
};
const special = new Set([
  "UNENTERED",
  "ABSENT",
  "OFFICIAL_LEAVE",
  "SICK_LEAVE",
  "EXEMPT",
  "NOT_HELD",
]);

/** Average original hundredth-point marks; round once, half up, with integer arithmetic. */
export function averageScores(scores: readonly AverageScore[]): {
  averageHundredths: number | null;
  totalHundredths: number | null;
  validCount: number;
} {
  const zero = BigInt(0);
  const two = BigInt(2);
  let sum = zero;
  let count = zero;
  for (const score of scores) {
    if (!score || ![0, 1].includes(score.includeInAverage))
      throw new Error("INVALID_AVERAGE_SCORE");
    if (score.scoreStatus === "NORMAL") {
      if (
        !Number.isSafeInteger(score.scoreValue) ||
        score.scoreValue === null ||
        score.scoreValue < 0 ||
        score.scoreValue > 10000
      )
        throw new Error("INVALID_AVERAGE_SCORE");
      if (score.includeInAverage === 1) {
        sum += BigInt(score.scoreValue);
        count++;
      }
    } else if (
      !special.has(score.scoreStatus) ||
      score.scoreValue !== null ||
      score.includeInAverage !== 0
    ) {
      throw new Error("INVALID_AVERAGE_SCORE");
    }
  }
  if (sum > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("AVERAGE_TOTAL_OVERFLOW");
  return {
    averageHundredths:
      count === zero ? null : Number((two * sum + count) / (two * count)),
    totalHundredths: count === zero ? null : Number(sum),
    validCount: Number(count),
  };
}
