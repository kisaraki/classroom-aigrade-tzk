import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCalendarMonths,
  addCalendarYears,
  assertBusinessDate,
  containsBusinessDate,
  taipeiBusinessDate,
} from "../lib/domain/dates.ts";
import { resolveRankingEligibility } from "../lib/domain/ranking-eligibility.ts";

test("D-11: Taipei midnight, leap years and calendar month/year boundaries", () => {
  assert.equal(
    taipeiBusinessDate(Date.parse("2026-09-22T15:59:59.999Z")),
    "2026-09-22",
  );
  assert.equal(
    taipeiBusinessDate(Date.parse("2026-09-22T16:00:00Z")),
    "2026-09-23",
  );
  assert.equal(addCalendarMonths("2026-12-31", 2), "2027-02-28");
  assert.equal(addCalendarMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addCalendarMonths("2024-03-31", -1), "2024-02-29");
  assert.equal(addCalendarYears("2024-02-29", 1), "2025-02-28");
  assert.equal(addCalendarYears("2024-02-29", 3), "2027-02-28");
  assert.equal(addCalendarYears("2024-02-29", 4), "2028-02-29");
  for (const value of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-1-01",
    "not-a-date",
  ])
    assert.throws(() => assertBusinessDate(value), /INVALID_BUSINESS_DATE/);
  assert.throws(() => taipeiBusinessDate(1.5), /INVALID_TIMESTAMP/);
});

test("D-11: a transfer date belongs only to the new half-open enrollment", () => {
  assert.equal(
    containsBusinessDate("2026-08-01", "2026-10-01", "2026-09-30"),
    true,
  );
  assert.equal(
    containsBusinessDate("2026-08-01", "2026-10-01", "2026-10-01"),
    false,
  );
  assert.equal(containsBusinessDate("2026-10-01", null, "2026-10-01"), true);
  assert.throws(
    () => containsBusinessDate("2026-10-01", "2026-10-01", "2026-10-01"),
    /INVALID_DATE_INTERVAL/,
  );
});

test("D-03: explicit assessment overrides semester, NULL inherits, external is always excluded", () => {
  for (const studentDefault of [true, false])
    for (const termOverride of [true, false, null])
      for (const examOverride of [true, false, null]) {
        const input = {
          studentDefault,
          termOverride,
          examOverride,
          origin: "LOCAL",
        };
        const expected =
          examOverride !== null
            ? examOverride
            : termOverride !== null
              ? termOverride
              : studentDefault;
        assert.equal(resolveRankingEligibility(input), expected);
        assert.equal(
          resolveRankingEligibility({ ...input, origin: "EXTERNAL_TRANSFER" }),
          false,
        );
      }
});
