import { AuthError } from "./types.ts";

export const AUTH_LIMITS = {
  windowMs: 600_000,
  attempts: 60,
  restrictedStarts: 5,
  retentionMs: 86_400_000,
} as const;

export async function cleanupAuthLimits(db: D1Database, now = Date.now()) {
  await db
    .prepare("DELETE FROM auth_rate_attempts WHERE created_at<=?")
    .bind(now - AUTH_LIMITS.retentionMs + 3_600_000)
    .run();
}

export async function guardAuthAttempt(
  request: Request,
  deps: { db?: D1Database; secret?: string; verified?: string; now?: number },
  restricted = false,
) {
  try {
    if (
      deps.verified !== "true" ||
      !deps.db ||
      !deps.secret ||
      deps.secret.length < 32
    )
      throw new AuthError("AUTH_RATE_UNAVAILABLE", 503);
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip))
      throw new AuthError("AUTH_RATE_UNAVAILABLE", 503);
    let normalized: string;
    if (ip.includes(":")) normalized = new URL(`http://[${ip}]/`).hostname;
    else {
      const pieces = ip.split(".");
      if (
        pieces.length !== 4 ||
        pieces.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)
      )
        throw new AuthError("AUTH_RATE_UNAVAILABLE", 503);
      normalized = pieces.map(Number).join(".");
    }
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(deps.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode("auth-ip:" + normalized),
        ),
      ),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    const now = deps.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0)
      throw new AuthError("AUTH_RATE_UNAVAILABLE", 503);
    const results = await deps.db.batch([
      deps.db
        .prepare("DELETE FROM auth_rate_attempts WHERE created_at<=?")
        .bind(now - AUTH_LIMITS.retentionMs),
      deps.db
        .prepare(
          `INSERT INTO auth_rate_attempts(id,ip_hash,restricted_start,created_at)
        SELECT ?,?,?,? WHERE (SELECT count(*) FROM auth_rate_attempts WHERE ip_hash=? AND created_at>?)<?
        AND (?=0 OR (SELECT count(*) FROM auth_rate_attempts WHERE ip_hash=? AND restricted_start=1 AND created_at>?)<?)`,
        )
        .bind(
          crypto.randomUUID(),
          hash,
          restricted ? 1 : 0,
          now,
          hash,
          now - AUTH_LIMITS.windowMs,
          AUTH_LIMITS.attempts,
          restricted ? 1 : 0,
          hash,
          now - AUTH_LIMITS.windowMs,
          AUTH_LIMITS.restrictedStarts,
        ),
    ]);
    if (results[1].meta.changes !== 1)
      throw new AuthError("AUTH_RATE_LIMITED", 429);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("AUTH_RATE_UNAVAILABLE", 503);
  }
}
