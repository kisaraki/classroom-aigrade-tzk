import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archivePreflight,
  ARCHIVE_WARNINGS,
} from "../lib/domain/archive-preflight.ts";
const counts = () =>
  Object.fromEntries(ARCHIVE_WARNINGS.map((code) => [code, 0]));

test("Phase 8 preflight: all required warnings are preserved; force never grants authorization", () => {
  const input = counts();
  for (const code of ARCHIVE_WARNINGS) input[code] = 2;
  const report = archivePreflight(input, {
    force: false,
    reason: "虛構封存原因",
  });
  assert.equal(report.warnings.length, 5);
  assert.equal(report.warningsAcknowledged, false);
  const forced = archivePreflight(input, {
    force: true,
    reason: "虛構強制原因",
  });
  assert.deepEqual(forced.warnings, report.warnings);
  assert.equal(forced.warningsAcknowledged, true);
  assert.equal("authorized" in forced, false);
  assert.equal("canCommit" in forced, false);
});

test("Phase 8 preflight: even clean and forced requests need a reason", () => {
  for (const force of [true, false]) {
    const result = archivePreflight(counts(), { force, reason: "  " });
    assert.equal(result.reasonRequired, true);
    assert.equal(result.warningsAcknowledged, true);
  }
  const input = counts();
  input.MISSING_SCORES = 1;
  assert.equal(
    archivePreflight(input, { force: true, reason: "" }).reasonRequired,
    true,
  );
});

test("Phase 8 preflight: malformed or omitted counts and forged force values fail closed", () => {
  for (const value of [-1, 1.5, NaN, Infinity, "1", null]) {
    assert.throws(
      () =>
        archivePreflight(
          { ...counts(), AI_FAILED: value },
          { force: false, reason: "虛構" },
        ),
      /INVALID_ARCHIVE_PREFLIGHT/,
    );
  }
  assert.throws(
    () => archivePreflight({}, { force: false, reason: "虛構" }),
    /INVALID_ARCHIVE_PREFLIGHT/,
  );
  assert.throws(
    () => archivePreflight(counts(), { force: "true", reason: "虛構" }),
    /INVALID_ARCHIVE_PREFLIGHT/,
  );
});
