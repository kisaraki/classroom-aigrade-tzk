export const LOOKUP_LIMITS = {
  windowMs: 600_000,
  ip: 30,
  query: 5,
  retentionMs: 86_400_000,
} as const;
export class LookupError extends Error {
  readonly kind: "failed" | "limited" | "unavailable";
  constructor(kind: "failed" | "limited" | "unavailable" = "failed") {
    super("PUBLIC_LOOKUP_" + kind.toUpperCase());
    this.kind = kind;
  }
}
export async function cleanupLookupLimits(db: D1Database, now = Date.now()) {
  await db
    .prepare("DELETE FROM public_lookup_attempts WHERE created_at<=?")
    .bind(now - (LOOKUP_LIMITS.retentionMs - 3_600_000))
    .run();
}
async function keyed(secret: string, domain: string, value: string) {
  if (secret.length < 32) throw new LookupError("unavailable");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(domain + ":" + value),
      ),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function limitLookup(
  db: D1Database,
  secret: string,
  ip: string | null,
  canonical: string,
  now: number,
) {
  if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip))
    throw new LookupError("unavailable");
  let normalizedIp: string;
  try {
    if (ip.includes(":")) normalizedIp = new URL(`http://[${ip}]/`).hostname;
    else {
      const parts = ip.split(".");
      if (
        parts.length !== 4 ||
        parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)
      )
        throw new Error();
      normalizedIp = parts.map(Number).join(".");
    }
  } catch {
    throw new LookupError("unavailable");
  }
  const ipHash = await keyed(secret, "ip", normalizedIp),
    queryHash = await keyed(secret, "query", canonical);
  // One conditional INSERT provides a serialized rolling-window check and consumption.
  const results = await db.batch([
    db
      .prepare("DELETE FROM public_lookup_attempts WHERE created_at<=?")
      .bind(now - LOOKUP_LIMITS.retentionMs),
    db
      .prepare(
        `INSERT INTO public_lookup_attempts(id,ip_hash,query_hash,created_at)
      SELECT ?,?,?,? WHERE (SELECT count(*) FROM public_lookup_attempts WHERE ip_hash=? AND created_at>?)<?
      AND (SELECT count(*) FROM public_lookup_attempts WHERE query_hash=? AND created_at>?)<?`,
      )
      .bind(
        crypto.randomUUID(),
        ipHash,
        queryHash,
        now,
        ipHash,
        now - LOOKUP_LIMITS.windowMs,
        LOOKUP_LIMITS.ip,
        queryHash,
        now - LOOKUP_LIMITS.windowMs,
        LOOKUP_LIMITS.query,
      ),
  ]);
  if (results[1].meta.changes !== 1) throw new LookupError("limited");
}
