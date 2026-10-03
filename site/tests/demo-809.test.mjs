import test from "node:test";
import assert from "node:assert/strict";
import { demoStudents, demoScore } from "../lib/demo/class809.ts";

test("809 demonstration has exactly 25 fictional students, absences and failing scores", () => {
  assert.equal(demoStudents.length, 25);
  assert.equal(new Set(demoStudents.map((s) => s.id)).size, 25);
  assert.ok(
    demoStudents.every(
      (s) => /^模擬學生\d{2}$/.test(s.name) && s.scores.length === 10,
    ),
  );
  assert.equal(demoStudents.filter((s) => s.absent).length, 3);
  assert.ok(demoStudents.filter((s) => s.failing).length >= 4);
});
test("absence is null and excluded; real zero remains a valid score", () => {
  const absent = demoStudents[24];
  assert.equal(absent.result.exam.averageHundredths, null);
  assert.equal(absent.result.exam.totalHundredths, null);
  assert.equal(absent.result.classRank, null);
  assert.equal(demoScore(null), "—");
  assert.equal(demoStudents[6].result.exam.validCount, 9);
  assert.equal(demoStudents[17].result.exam.validCount, 7);
  const zero = demoStudents[23];
  assert.equal(zero.result.exam.validCount, 10);
  assert.equal(zero.scores.filter((s) => s.scoreValue === 0).length, 2);
  assert.equal(demoScore(0), "0.00");
});
test("shared first place skips second and rounded averages match effective marks", () => {
  assert.equal(demoStudents[0].result.classRank, 1);
  assert.equal(demoStudents[1].result.classRank, 1);
  assert.ok(!demoStudents.some((s) => s.result.classRank === 2));
  for (const s of demoStudents) {
    const values = s.scores
      .filter((x) => x.scoreValue !== null)
      .map((x) => x.scoreValue);
    if (!values.length) continue;
    assert.equal(
      s.result.exam.totalHundredths,
      values.reduce((a, b) => a + b, 0),
    );
    assert.equal(
      s.result.exam.averageHundredths,
      Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    );
  }
});
