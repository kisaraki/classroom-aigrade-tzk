import assert from "node:assert/strict";
import { test } from "node:test";
import { publicResult } from "../lib/server/public/result.ts";
import { calculateExam } from "../lib/domain/ranking.ts";
import { SUBJECT_SETTINGS } from "../lib/domain/scores.ts";
function record(sequence = 1, components = ["QUIZ"], value = 0, term = 1) {
  const input = {
    examId: `fictional-${term}-${sequence}`,
    academicTermId: `fictional-term-${term}`,
    academicYearId: "fictional-year",
    sourceVersion: 1,
    mode: components.length === 2 ? "FINAL" : "PROVISIONAL",
    components,
    settings: SUBJECT_SETTINGS.map((s) => ({
      ...s,
      held: !(s.subject === "HISTORY" && s.examType === "MIDTERM"),
    })),
    enrollmentSnapshot: [
      { studentId: "fictional-a", classId: "fictional-class", grade: 7 },
      { studentId: "fictional-b", classId: "fictional-class", grade: 7 },
    ],
    participants: ["a", "b", "external"].map((id) => ({
      id: `fictional-part-${id}`,
      studentId: `fictional-${id}`,
      classIdSnapshot: id === "external" ? null : "fictional-class",
      gradeSnapshot: id === "external" ? null : 7,
      origin: id === "external" ? "EXTERNAL_TRANSFER" : "LOCAL",
      rankingEligible: id !== "external",
      scores: SUBJECT_SETTINGS.filter((s) => s.subject !== "HISTORY").map(
        (s) => ({
          ...s,
          scoreValue: id === "a" ? value : 10000,
          scoreStatus: "NORMAL",
          includeInAverage: 1,
        }),
      ),
    })),
  };
  return {
    year: "115",
    term,
    sequence,
    snapshot: { input, components, result: calculateExam(input) },
  };
}
test("Phase 13 result projection preserves zero, absent/unheld/unpublished and excludes other student identities", () => {
  const r = record();
  const output = publicResult(r, [r], "fictional-a");
  assert.equal(output.quiz.average, 0);
  assert.equal(output.exam.total, 0);
  assert.equal(output.midterm.average, null);
  assert.equal(output.scores[0].quiz.value, 0);
  assert.equal(output.scores[0].midterm.status, "UNPUBLISHED");
  assert.equal(output.classStatistics.average, 5000);
  assert.equal(output.gradeStatistics.average, 5000);
  assert.ok(!JSON.stringify(output).includes("fictional"));
  assert.ok(!JSON.stringify(output).includes("gradeRank"));
  const final = record(1, ["QUIZ", "MIDTERM"]);
  const score = final.snapshot.input.participants[0].scores.find(
    (s) => s.subject === "ENGLISH" && s.examType === "QUIZ",
  );
  score.scoreValue = null;
  score.scoreStatus = "ABSENT";
  score.includeInAverage = 0;
  final.snapshot.result = calculateExam(final.snapshot.input);
  const result = publicResult(final, [final], "fictional-a");
  assert.equal(result.scores[1].quiz.status, "ABSENT");
  assert.equal(
    result.scores.find((s) => s.subject === "HISTORY").midterm.status,
    "NOT_HELD",
  );
  assert.equal(
    result.scores.find((s) => s.subject === "SCIENCE").quiz.status,
    "NOT_APPLICABLE",
  );
});
test("Phase 13 semester averages raw published marks only and trends retain gaps and term boundaries", () => {
  const a = record(1, ["QUIZ"], 0),
    b = record(2, ["QUIZ", "MIDTERM"], 10000),
    other = record(1, ["QUIZ"], 9999, 2);
  const result = publicResult(b, [a, b, other], "fictional-a");
  assert.equal(result.semester.average, 7500);
  assert.equal(result.trends[0].midterm, null);
  assert.equal(result.trends[2].term, 2);
  const external = record(3, ["QUIZ"], 9000);
  external.snapshot.input.participants =
    external.snapshot.input.participants.filter(
      (p) => p.origin === "EXTERNAL_TRANSFER",
    );
  external.snapshot.input.participants[0].studentId = "fictional-a";
  external.snapshot.result = calculateExam(external.snapshot.input);
  const separated = publicResult(b, [a, b, external], "fictional-a");
  assert.equal(separated.externalTrends.length, 1);
  assert.equal(separated.externalTrends[0].quiz, 10000);
  assert.equal(separated.trends.length, 2);
  assert.equal(separated.semester.average, 7500);
  assert.equal(separated.classStatistics.participationCount, 2);
  const rows = Array.from({ length: 20 }, (_, i) => ({
    ...record((i % 3) + 1),
    year: String(110 + Math.floor(i / 6)),
    term: (Math.floor(i / 3) % 2) + 1,
  }));
  assert.equal(publicResult(rows[19], rows, "fictional-a").trends.length, 18);
});
test("Phase 13 result rendering escapes advice and provides accessible tables and null-safe charts", async () => {
  const { build } = await import("esbuild");
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const output = resolve(".wrangler/phase13-ui-check.mjs");
  await mkdir(".wrangler", { recursive: true });
  const bundle = await build({
    entryPoints: ["app/public/result.tsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
    jsx: "automatic",
  });
  await writeFile(output, bundle.outputFiles[0].contents);
  try {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const Result = (await import(pathToFileURL(output).href)).default;
    const r = record();
    const result = {
      ...publicResult(r, [r], "fictional-a"),
      advice: {
        status: "ready",
        parent: {
          summary: "<script>fictional()</script>",
          diagnosis: "測試",
          improvements: "測試",
          plan: "測試",
          encouragement: "測試",
          parentSupport: "測試",
        },
      },
    };
    const html = renderToStaticMarkup(React.createElement(Result, { result }));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>fictional"));
    assert.match(html, /scope="col"/);
    assert.match(html, /role="img"/);
    assert.match(html, /0\.00/);
    assert.match(html, /尚未發布/);
    assert.match(html, /全年段統計/);
  } finally {
    await rm(output, { force: true });
  }
});
