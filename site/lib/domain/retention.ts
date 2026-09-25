import { assertBusinessDate } from "./dates.ts";
export type RetentionEvent = {
  public_until: string;
  retention_until: string;
  revoked_at: number | null;
};
export function retentionDeadlines(
  events: readonly RetentionEvent[],
  active = false,
) {
  let publicUntil: string | null = null,
    retentionUntil: string | null = null;
  for (const event of events) {
    assertBusinessDate(event.public_until);
    assertBusinessDate(event.retention_until);
    if (event.public_until > event.retention_until)
      throw new Error("INVALID_RETENTION_EVENT");
    if (event.revoked_at !== null) continue;
    if (publicUntil === null || event.public_until > publicUntil)
      publicUntil = event.public_until;
    if (retentionUntil === null || event.retention_until > retentionUntil)
      retentionUntil = event.retention_until;
  }
  return {
    publicUntil: active ? null : publicUntil,
    retentionUntil: active ? null : retentionUntil,
  };
}
/** Internal eligibility only; public identity matching and authorization belong to Phase 13. */
export function withinPublicDeadline(
  student: {
    deleted_at: number | null;
    public_query_until: string | null;
    retention_until: string | null;
  },
  onDate: string,
) {
  assertBusinessDate(onDate);
  if (student.deleted_at !== null) return false;
  for (const date of [student.public_query_until, student.retention_until]) {
    if (date !== null) {
      assertBusinessDate(date);
      if (onDate >= date) return false;
    }
  }
  return true;
}
