export const SESSION_COOKIE = "__Host-admin_session";
export const OAUTH_STATE_COOKIE = "__Host-google_oauth_state";

const cookieParts = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return cookieParts(SESSION_COOKIE, token, maxAgeSeconds);
}

export function clearSessionCookie(): string {
  return cookieParts(SESSION_COOKIE, "", 0);
}

export function clearOAuthStateCookie(): string {
  return cookieParts(OAUTH_STATE_COOKIE, "", 0);
}

export function parseCookieHeader(
  header: string | null,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && !(name in result)) result[name] = value;
  }
  return result;
}

export function oauthStateCookie(value: string, maxAgeSeconds: number): string {
  return cookieParts(OAUTH_STATE_COOKIE, value, maxAgeSeconds);
}
