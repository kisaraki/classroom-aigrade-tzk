import { AuthError, type GoogleIdentity } from "./types.ts";

// D-11 approved 2026-09-24. Exact boundary is expired.
export const RECENT_AUTH_WINDOW_MS = 5 * 60_000;
export const IDENTITY_REQUEST_TTL_MS = 5 * 60_000;
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;

export function googleAuthenticationTime(
  identity: GoogleIdentity,
  now: number,
): number {
  const seconds = identity.authTime;
  if (
    typeof seconds !== "number" ||
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    seconds * 1000 > now
  )
    return 0;
  return seconds * 1000;
}

export function assertRecentGoogle(
  identity: GoogleIdentity,
  now: number,
): number {
  const timestamp = googleAuthenticationTime(identity, now);
  if (!timestamp || now - timestamp >= RECENT_AUTH_WINDOW_MS)
    throw new AuthError("RECENT_AUTHENTICATION_REQUIRED", 403);
  return timestamp;
}
