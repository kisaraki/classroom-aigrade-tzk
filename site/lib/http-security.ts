/** Response policy only. Authentication and resource scope remain server responsibilities. */
export const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, private, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
} as const;

export function applySecurityHeaders(headers: Headers, url: URL) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  // This policy does not pretend to provide a nonce-based script policy.
  headers.set(
    "Content-Security-Policy",
    "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  );
  if (url.protocol === "https:")
    headers.set("Strict-Transport-Security", "max-age=31536000");
  if (
    url.pathname === "/admin" ||
    url.pathname.startsWith("/admin/") ||
    url.pathname.startsWith("/api/")
  )
    for (const [key, value] of Object.entries(PRIVATE_HEADERS))
      headers.set(key, value);
}
