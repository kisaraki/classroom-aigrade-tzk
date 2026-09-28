import { assertBusinessDate } from "./dates.ts";

export const RESTORE_WINDOW_MS = 30 * 86400000;
export type PurgeEligibilityInput = {
  status: string;
  deletedAt: number | null;
  retentionUntil: string | null;
  publicUntil: string | null;
  promises: readonly number[];
};
/** Policy only; never a substitute for authorization or full-copy preflight. */
export function purgeBlockers(
  input: PurgeEligibilityInput,
  now: number,
  today: string,
) {
  assertBusinessDate(today);
  const blockers: string[] = [];
  if (!Number.isSafeInteger(now) || now < 0)
    throw new Error("INVALID_PURGE_TIME");
  if (input.status === "active" && input.deletedAt === null)
    blockers.push("ACTIVE_STUDENT");
  if (!["active", "transferred_out", "graduated"].includes(input.status))
    blockers.push("UNKNOWN_STATUS");
  if (input.deletedAt !== null) {
    if (
      !Number.isSafeInteger(input.deletedAt) ||
      input.deletedAt < 0 ||
      input.deletedAt > now
    )
      blockers.push("UNKNOWN_DELETION_TIME");
    else if (now < input.deletedAt + RESTORE_WINDOW_MS)
      blockers.push("RECYCLE_PROMISE");
  }
  if (
    !input.retentionUntil &&
    (input.deletedAt === null || input.status !== "active")
  )
    blockers.push("UNKNOWN_RETENTION");
  for (const date of [input.retentionUntil, input.publicUntil]) {
    if (date === null) continue;
    try {
      assertBusinessDate(date);
      if (today < date) blockers.push("RETENTION_NOT_EXPIRED");
    } catch {
      blockers.push("UNKNOWN_RETENTION");
    }
  }
  for (const until of input.promises) {
    if (!Number.isSafeInteger(until) || until < 0)
      blockers.push("UNKNOWN_PROMISE");
    else if (now < until) blockers.push("RESTORE_PROMISE");
  }
  return [...new Set(blockers)];
}
