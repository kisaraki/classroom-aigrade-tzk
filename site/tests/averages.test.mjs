import assert from "node:assert/strict";
import { test } from "node:test";
import { averageScores } from "../lib/domain/averages.ts";

const normal = (scoreValue) => ({
  scoreValue,
  scoreStatus: "NORMAL",
  includeInAverage: 1,
});
const missing = (scoreStatus) => ({
  scoreValue: null,
  scoreStatus,
  includeInAverage: 0,
});

test("Phase 5 averages: zero is valid; missing values and special statuses are not zero", () => {
  assert.deepEqual(averageScores([normal(0), normal(10000)]), {
    averageHundredths: 5000,
    totalHundredths: 10000,
    validCount: 2,
  });
  const statuses = [
    "UNENTERED",
    "ABSENT",
    "OFFICIAL_LEAVE",
    "SICK_LEAVE",
    "EXEMPT",
    "NOT_HELD",
  ].map(missing);
  assert.deepEqual(averageScores([normal(8000), ...statuses]), {
    averageHundredths: 8000,
    totalHundredths: 8000,
    validCount: 1,
  });
  assert.deepEqual(averageScores(statuses), {
    averageHundredths: null,
    totalHundredths: null,
    validCount: 0,
  });
  assert.deepEqual(averageScores([]), {
    averageHundredths: null,
    totalHundredths: null,
    validCount: 0,
  });
});

test("Phase 5 averages: original marks determine exam and semester denominators", () => {
  assert.deepEqual(averageScores([normal(10000), normal(5000), normal(5000)]), {
    averageHundredths: 6667,
    totalHundredths: 20000,
    validCount: 3,
  });
  assert.deepEqual(
    averageScores([normal(10000), normal(0), normal(0), normal(0)]),
    { averageHundredths: 2500, totalHundredths: 10000, validCount: 4 },
  );
  assert.deepEqual(averageScores([normal(8000), normal(8025)]), {
    averageHundredths: 8013,
    totalHundredths: 16025,
    validCount: 2,
  });
  assert.equal(averageScores([normal(0), normal(1)]).averageHundredths, 1);
  assert.equal(
    averageScores([normal(0), normal(0), normal(1)]).averageHundredths,
    0,
  );
  assert.equal(
    averageScores([normal(0), normal(1), normal(1)]).averageHundredths,
    1,
  );
});

test("Phase 5 totals: valid zeros stay numeric and excluded marks do not contribute", () => {
  assert.deepEqual(averageScores([normal(0), normal(0), missing("ABSENT")]), {
    averageHundredths: 0,
    totalHundredths: 0,
    validCount: 2,
  });
  assert.deepEqual(averageScores([{ ...normal(9000), includeInAverage: 0 }]), {
    averageHundredths: null,
    totalHundredths: null,
    validCount: 0,
  });
  assert.equal(
    averageScores(Array.from({ length: 30 }, () => normal(10000)))
      .totalHundredths,
    300000,
  );
});

test("Phase 5 averages: corrupt numeric/status combinations fail instead of being silently counted", () => {
  for (const scoreValue of [-1, 10001, 80.25, NaN, Infinity, null, "8000"])
    assert.throws(
      () => averageScores([normal(scoreValue)]),
      /INVALID_AVERAGE_SCORE/,
    );
  assert.throws(
    () => averageScores([{ ...missing("ABSENT"), includeInAverage: 1 }]),
    /INVALID_AVERAGE_SCORE/,
  );
  assert.throws(
    () => averageScores([{ ...missing("NOT_HELD"), scoreValue: 0 }]),
    /INVALID_AVERAGE_SCORE/,
  );
  assert.throws(
    () => averageScores([missing("UNKNOWN")]),
    /INVALID_AVERAGE_SCORE/,
  );
});
