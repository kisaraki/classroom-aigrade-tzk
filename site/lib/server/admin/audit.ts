import { taipeiBusinessDate } from "../../domain/dates.ts";
import { AuthError, type AuthSession } from "../auth/types.ts";
import type { AuthorizationService } from "../auth/authorization.ts";

export type AuditCursor = { createdAt: number; id: string };
export type AuditRow = {
  id: string;
  createdAt: number;
  actor: string | null;
  action: string;
  entityType: string;
  outcome: string;
};
export type AuditPage = { rows: AuditRow[]; nextCursor: AuditCursor | null };
const pageSize = 50;
const identifier = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(v);

export async function readAudit(
  deps: {
    db: D1Database;
    authorization: AuthorizationService;
    now: () => number;
  },
  session: AuthSession,
  input: Record<string, unknown>,
): Promise<AuditPage> {
  const authorize = async () => {
    const grant = await deps.authorization.assertPermission(
      session,
      "audit.read",
    );
    if (grant.role !== "super_admin")
      throw new AuthError("PERMISSION_DENIED", 403);
  };
  await authorize();
  const now = deps.now();
  const businessDate = taipeiBusinessDate(now);
  let cursor: AuditCursor | null = null;
  if (Object.keys(input).some((k) => k !== "cursor"))
    throw new AuthError("INVALID_INPUT", 400);
  if (input.cursor !== undefined && input.cursor !== null) {
    const c = input.cursor as Partial<AuditCursor>;
    if (
      typeof c !== "object" ||
      Array.isArray(c) ||
      Object.keys(c).some((k) => !["createdAt", "id"].includes(k)) ||
      !Number.isSafeInteger(c.createdAt) ||
      Number(c.createdAt) < 0 ||
      Number(c.createdAt) > now ||
      !identifier(c.id)
    )
      throw new AuthError("INVALID_INPUT", 400);
    cursor = { createdAt: Number(c.createdAt), id: c.id };
  }
  // Never select payload, entity/student identifiers, OAuth or credential fields.
  const result = await deps.db
    .prepare(
      `SELECT l.id,l.created_at,l.action,l.entity_type,l.outcome,a.username AS actor
    FROM audit_logs l LEFT JOIN admin_users a ON a.id=l.actor_id
    WHERE l.retention_until>? AND l.created_at>=0 AND l.created_at<=?
    ${cursor ? "AND (l.created_at<? OR (l.created_at=? AND l.id<?))" : ""}
    ORDER BY l.created_at DESC,l.id DESC LIMIT ?`,
    )
    .bind(
      businessDate,
      now,
      ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
      pageSize + 1,
    )
    .all<{
      id: string;
      created_at: number;
      action: string;
      entity_type: string;
      outcome: string;
      actor: string | null;
    }>();
  const selected = result.results.slice(0, pageSize);
  const rows = selected.map((r) => {
    if (!identifier(r.id) || !Number.isSafeInteger(r.created_at))
      throw new AuthError("AUDIT_UNAVAILABLE", 503);
    return {
      id: r.id,
      createdAt: r.created_at,
      actor:
        r.actor && /^[a-z0-9][a-z0-9._-]{1,63}$/u.test(r.actor)
          ? r.actor
          : null,
      action: /^[A-Z][A-Z0-9_]{0,79}$/u.test(r.action)
        ? r.action
        : "UNKNOWN_ACTION",
      entityType: /^[a-z][a-z0-9_]{0,47}$/u.test(r.entity_type)
        ? r.entity_type
        : "unknown",
      outcome: ["success", "failure", "denied", "error"].includes(r.outcome)
        ? r.outcome
        : "unknown",
    };
  });
  await authorize();
  if (taipeiBusinessDate(deps.now()) !== businessDate)
    throw new AuthError("AUDIT_SOURCE_CHANGED", 409);
  const last = rows.at(-1);
  return {
    rows,
    nextCursor:
      result.results.length > pageSize && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}
