import assert from "node:assert/strict";
import { test } from "node:test";
import { purgeBlockers, RESTORE_WINDOW_MS } from "../lib/domain/purge.ts";
const now = Date.UTC(2026, 8, 26);
const base = {
  status: "graduated",
  deletedAt: null,
  retentionUntil: "2026-09-26",
  publicUntil: "2026-09-26",
  promises: [],
};
test("Purge: all retention and restoration promises, exact exclusive boundaries", () => {
  assert.deepEqual(purgeBlockers(base, now, "2026-09-26"), []);
  assert.ok(
    purgeBlockers(
      { ...base, retentionUntil: "2026-09-27" },
      now,
      "2026-09-26",
    ).includes("RETENTION_NOT_EXPIRED"),
  );
  for (const until of [now + 1, now + RESTORE_WINDOW_MS])
    assert.ok(
      purgeBlockers({ ...base, promises: [until] }, now, "2026-09-26").includes(
        "RESTORE_PROMISE",
      ),
    );
  assert.deepEqual(
    purgeBlockers({ ...base, promises: [now] }, now, "2026-09-26"),
    [],
  );
  assert.ok(
    purgeBlockers(
      { ...base, deletedAt: now - RESTORE_WINDOW_MS + 1 },
      now,
      "2026-09-26",
    ).includes("RECYCLE_PROMISE"),
  );
  assert.deepEqual(
    purgeBlockers(
      { ...base, deletedAt: now - RESTORE_WINDOW_MS },
      now,
      "2026-09-26",
    ),
    [],
  );
});
test("Purge: active and ambiguous eligibility fail closed; soft delete cannot shorten retention", () => {
  assert.ok(
    purgeBlockers({ ...base, status: "active" }, now, "2026-09-26").includes(
      "ACTIVE_STUDENT",
    ),
  );
  assert.ok(
    purgeBlockers(
      { ...base, retentionUntil: null },
      now,
      "2026-09-26",
    ).includes("UNKNOWN_RETENTION"),
  );
  assert.ok(
    purgeBlockers(
      {
        ...base,
        deletedAt: now - RESTORE_WINDOW_MS,
        retentionUntil: "2029-01-01",
      },
      now,
      "2026-09-26",
    ).includes("RETENTION_NOT_EXPIRED"),
  );
  for (const patch of [
    { status: "unknown" },
    { retentionUntil: "2026-02-30" },
    { promises: [NaN] },
    { deletedAt: now + 1 },
  ])
    assert.ok(purgeBlockers({ ...base, ...patch }, now, "2026-09-26").length);
});
