import assert from "node:assert/strict";
import { test } from "node:test";
import {
  retentionDeadlines,
  withinPublicDeadline,
} from "../lib/domain/retention.ts";
import { addCalendarYears } from "../lib/domain/dates.ts";
test("Phase 8 D-05: independent maxima, revoked events, active suspension and leap year", () => {
  const events = [
    {
      public_until: "2029-09-24",
      retention_until: "2030-09-24",
      revoked_at: null,
    },
    {
      public_until: "2027-09-24",
      retention_until: "2027-09-24",
      revoked_at: null,
    },
    {
      public_until: "2035-01-01",
      retention_until: "2035-01-01",
      revoked_at: 1,
    },
  ];
  assert.deepEqual(retentionDeadlines(events), {
    publicUntil: "2029-09-24",
    retentionUntil: "2030-09-24",
  });
  assert.deepEqual(retentionDeadlines(events, true), {
    publicUntil: null,
    retentionUntil: null,
  });
  assert.equal(addCalendarYears("2028-02-29", 1), "2029-02-28");
  assert.throws(
    () =>
      retentionDeadlines([
        {
          public_until: "2030-01-01",
          retention_until: "2029-01-01",
          revoked_at: null,
        },
      ]),
    /INVALID_RETENTION_EVENT/,
  );
});
test("Phase 8 public deadline: expiry day is excluded; soft deletion always denies", () => {
  const s = {
    deleted_at: null,
    public_query_until: "2029-09-24",
    retention_until: "2030-09-24",
  };
  assert.equal(withinPublicDeadline(s, "2029-09-23"), true);
  assert.equal(withinPublicDeadline(s, "2029-09-24"), false);
  assert.equal(
    withinPublicDeadline({ ...s, deleted_at: 1 }, "2026-01-01"),
    false,
  );
});
