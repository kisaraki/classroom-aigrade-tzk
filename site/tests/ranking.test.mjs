import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateExam,
  calculateSemesterAverage,
} from "../lib/domain/ranking.ts";
import { SUBJECT_SETTINGS, parseScore } from "../lib/domain/scores.ts";

const mark = (subject, value, examType = "QUIZ") => ({
  subject,
  examType,
  ...parseScore(value),
});
const participant = (id, scores, extra = {}) => ({
  id,
  studentId: id,
  origin: "LOCAL",
  classIdSnapshot: "class-701",
  gradeSnapshot: 7,
  rankingEligible: true,
  scores,
  ...extra,
});
const input = (participants, extra = {}) => ({
  examId: "exam-1",
  academicTermId: "term-1",
  academicYearId: "year-1",
  sourceVersion: 1,
  mode: "FINAL",
  settings: SUBJECT_SETTINGS.map((s) => ({ ...s, held: true })),
  enrollmentSnapshot: participants
    .filter((p) => p.origin === "LOCAL")
    .map((p) => ({
      studentId: p.studentId,
      classId: p.classIdSnapshot,
      grade: p.gradeSnapshot,
    })),
  participants,
  ...extra,
});
const ranks = (value) =>
  Object.fromEntries(
    calculateExam(value).local.map((p) => [p.participationId, p.classRank]),
  );

test("Phase 5 ranking: rounded average first, total second", () => {
  assert.deepEqual(
    ranks(
      input([
        participant("higher", [mark("CHINESE", 90)]),
        participant("lower", [mark("CHINESE", 80)]),
        participant("total", [mark("CHINESE", 80), mark("ENGLISH", 80)]),
      ]),
    ),
    { higher: 1, lower: 3, total: 2 },
  );
});

test("Phase 5 ranking: Chinese, English and Math totals break ties in that order", () => {
  const cases = [
    [
      [90, 60, 60, 90],
      [80, 80, 80, 60],
    ],
    [
      [80, 90, 60, 70],
      [80, 80, 80, 60],
    ],
    [
      [80, 80, 90, 50],
      [80, 80, 80, 60],
    ],
  ];
  for (const [a, b] of cases) {
    const scores = (values) =>
      values.map((v, i) =>
        mark(["CHINESE", "ENGLISH", "MATH", "SCIENCE"][i], v, "MIDTERM"),
      );
    assert.deepEqual(
      ranks(input([participant("a", scores(a)), participant("b", scores(b))])),
      { a: 1, b: 2 },
    );
  }
});

test("Phase 5 ranking: competition ties are 1,2,2,4 without an identity tiebreak", () => {
  const participants = [90, 80, 80, 70].map((v, i) =>
    participant(`p${i}`, [mark("CHINESE", v)]),
  );
  assert.deepEqual(ranks(input(participants)), { p0: 1, p1: 2, p2: 2, p3: 4 });
  assert.deepEqual(ranks(input([...participants].reverse())), {
    p3: 4,
    p2: 2,
    p1: 2,
    p0: 1,
  });
});

test("Phase 5 D-04: zero beats missing; two missing keys continue to the next subject", () => {
  assert.deepEqual(
    ranks(
      input([
        participant("zero", [mark("CHINESE", 0), mark("ENGLISH", 0)]),
        participant("missing", [mark("ENGLISH", 0), mark("MATH", 0)]),
      ]),
    ),
    { zero: 1, missing: 2 },
  );
  assert.deepEqual(
    ranks(
      input([
        participant("english", [mark("ENGLISH", 80), mark("MATH", 60)]),
        participant("math", [mark("ENGLISH", 60), mark("MATH", 80)]),
      ]),
    ),
    { english: 1, math: 2 },
  );
});

test("Phase 5 exclusion: special/empty marks never rank, zero does, eligibility is frozen", () => {
  const participants = [
    participant("excluded", [mark("CHINESE", 100)], { rankingEligible: false }),
    participant("empty", [
      mark("CHINESE", "A"),
      mark("ENGLISH", "B"),
      mark("MATH", "C"),
      mark("SCIENCE", "D", "MIDTERM"),
    ]),
    participant("zero", [mark("CHINESE", 0)]),
  ];
  const result = calculateExam(input(participants));
  assert.deepEqual(ranks(input(participants)), {
    excluded: null,
    empty: null,
    zero: 1,
  });
  assert.equal(result.local[1].exam.totalHundredths, null);
  assert.equal(result.local[0].exam.averageHundredths, 10000);
});

test("Phase 5 NOT_HELD: settings create missing marks and inconsistent stored marks fail", () => {
  const value = input([participant("a", [mark("CHINESE", 80)])]);
  value.settings.find(
    (s) => s.examType === "MIDTERM" && s.subject === "CIVICS",
  ).held = false;
  assert.equal(calculateExam(value).local[0].exam.validCount, 1);
  value.participants[0].scores.push(mark("CIVICS", "N", "MIDTERM"));
  assert.equal(calculateExam(value).local[0].exam.validCount, 1);
  value.participants[0].scores.at(-1).scoreStatus = "ABSENT";
  assert.throws(() => calculateExam(value), /INVALID_CALCULATION_INPUT/);
});

test("Phase 5 modes: provisional uses only quiz, final combines original marks", () => {
  const participants = [
    participant("a", [mark("CHINESE", 100), mark("CHINESE", 0, "MIDTERM")]),
    participant("b", [mark("CHINESE", 80), mark("CHINESE", 80, "MIDTERM")]),
  ];
  const provisional = calculateExam(
    input(participants, { mode: "PROVISIONAL" }),
  );
  assert.equal(provisional.local[0].classRank, 1);
  assert.equal(provisional.local[0].midterm.averageHundredths, null);
  assert.equal(provisional.local[0].exam.totalHundredths, 10000);
  const final = calculateExam(input(participants));
  assert.equal(final.local[0].classRank, 2);
  assert.equal(final.local[0].exam.averageHundredths, 5000);
  assert.equal(final.mode, "FINAL");
  assert.equal(final.sourceVersion, 1);
});

test("Phase 5 class/grade: same comparator, separate frozen class and grade groups", () => {
  const result = calculateExam(
    input([
      participant("a", [mark("CHINESE", 80)]),
      participant("b", [mark("CHINESE", 90)], { classIdSnapshot: "class-702" }),
      participant("c", [mark("CHINESE", 100)], {
        classIdSnapshot: "class-801",
        gradeSnapshot: 8,
      }),
    ]),
  );
  assert.deepEqual(
    result.local.map((p) => [p.classRank, p.gradeRank]),
    [
      [1, 2],
      [1, 1],
      [1, 1],
    ],
  );
});

test("Phase 5 history: current class, qualification, transfer-out and graduation do not change snapshot ranks", () => {
  const value = input([
    participant("a", [mark("CHINESE", 80)]),
    participant("b", [mark("CHINESE", 70)]),
  ]);
  const before = calculateExam(value);
  for (const status of ["active", "transferred_out", "graduated", "archived"]) {
    value.participants[0].currentClassId = "class-999";
    value.participants[0].currentRankingEligible = false;
    value.participants[0].currentStatus = status;
    assert.deepEqual(calculateExam(value), before);
  }
});

test("Phase 5 external: marks remain separate from local ranks and all local cohort counts", () => {
  const value = input([
    participant("a", [mark("CHINESE", 80)]),
    participant("external", [mark("CHINESE", 100)], {
      origin: "EXTERNAL_TRANSFER",
      classIdSnapshot: null,
      gradeSnapshot: null,
      rankingEligible: false,
    }),
  ]);
  const result = calculateExam(value);
  assert.equal(result.local[0].classRank, 1);
  assert.equal(result.external[0].classRank, null);
  assert.equal(result.classes[0].participationCount, 1);
  assert.equal(result.classes[0].general.exam.validStudentCount, 1);
});

test("Phase 5 D-04 populations: enrollment, participation, qualification and metric denominators stay distinct", () => {
  const value = input([
    participant("excluded", [mark("CHINESE", 100)], { rankingEligible: false }),
    participant("empty", []),
    participant("zero", [mark("CHINESE", 0)]),
  ]);
  value.enrollmentSnapshot.push({
    studentId: "nonparticipant",
    classId: "class-701",
    grade: 7,
  });
  const cohort = calculateExam(value).classes[0];
  assert.deepEqual(
    [
      cohort.enrollmentCount,
      cohort.participationCount,
      cohort.eligibleCount,
      cohort.rankedCount,
    ],
    [4, 3, 2, 1],
  );
  assert.equal(cohort.general.exam.validStudentCount, 2);
  assert.equal(cohort.ranking.exam.validStudentCount, 1);
  assert.equal(cohort.general.midterm.validStudentCount, 0);
  assert.equal(cohort.general.exam.maximumAverageHundredths, 10000);
});

test("Phase 5 rounding: raw unequal averages equal at two decimals then use total", () => {
  const value = input([
    participant("a", [mark("CHINESE", 80), mark("ENGLISH", 80.25)]),
    participant("b", [
      mark("CHINESE", 80.12),
      mark("ENGLISH", 80.13),
      mark("MATH", 80.14),
    ]),
  ]);
  const result = calculateExam(value);
  assert.deepEqual(
    result.local.map((p) => p.exam.averageHundredths),
    [8013, 8013],
  );
  assert.deepEqual(
    result.local.map((p) => p.classRank),
    [2, 1],
  );
});

test("Phase 5 semester: original scores across exams, same term and origin only", () => {
  const exams = [
    input([participant("a", [mark("CHINESE", 100)])]),
    input(
      [
        participant("a", [
          mark("CHINESE", 0),
          mark("ENGLISH", 0),
          mark("MATH", 0),
        ]),
      ],
      { examId: "exam-2" },
    ),
  ];
  assert.deepEqual(calculateSemesterAverage(exams, "a", "LOCAL"), {
    averageHundredths: 2500,
    totalHundredths: 10000,
    validCount: 4,
  });
  assert.equal(
    calculateSemesterAverage(exams, "missing", "LOCAL").averageHundredths,
    null,
  );
  assert.throws(
    () => calculateSemesterAverage([exams[0], exams[0]], "a", "LOCAL"),
    /INVALID_CALCULATION_INPUT/,
  );
  assert.throws(
    () =>
      calculateSemesterAverage(
        [exams[0], { ...exams[1], academicTermId: "other" }],
        "a",
        "LOCAL",
      ),
    /INVALID_CALCULATION_INPUT/,
  );
});

test("Phase 5 integrity: reject duplicates, invalid subjects/origins and malformed snapshot fields", () => {
  const base = input([participant("a", [mark("CHINESE", 80)])]);
  for (const mutate of [
    (v) => v.participants.push(v.participants[0]),
    (v) => v.participants[0].scores.push(mark("CHINESE", 90)),
    (v) => v.participants[0].scores.push(mark("SCIENCE", 90)),
    (v) => (v.participants[0].origin = "OTHER"),
    (v) => (v.participants[0].rankingEligible = 1),
    (v) => (v.participants[0].classIdSnapshot = null),
    (v) => v.settings.pop(),
    (v) => (v.mode = "OTHER"),
    (v) => (v.sourceVersion = 0),
    (v) => v.enrollmentSnapshot.push(v.enrollmentSnapshot[0]),
  ]) {
    const value = structuredClone(base);
    mutate(value);
    assert.throws(() => calculateExam(value), /INVALID_CALCULATION_INPUT/);
  }
  const frozen = structuredClone(base);
  calculateExam(base);
  assert.deepEqual(base, frozen);
});
