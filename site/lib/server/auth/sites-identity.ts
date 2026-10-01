import { AuthError } from "./types.ts";

/** Identity only. Application membership, sessions and recent authentication are separate. */
export type SitesIdentity = Readonly<{ provider: "sites"; subject: string }>;
export type SitesIdentityPolicy = Readonly<{ trustedGatewayVerified: boolean }>;

/** The policy is deployment-owned; never derive it from request headers or JSON. */
export function readSitesIdentity(
  request: Request,
  policy: SitesIdentityPolicy = { trustedGatewayVerified: false },
): SitesIdentity {
  if (policy.trustedGatewayVerified !== true)
    throw new AuthError("SITES_IDENTITY_NOT_VERIFIED", 503);
  const subject = request.headers.get("oai-authenticated-user-id");
  if (!subject) throw new AuthError("UNAUTHENTICATED", 401);
  // Keep the opaque identifier exactly; commas also reject joined duplicate headers.
  if (subject.length > 512 || /[\s,\u0000-\u001f\u007f]/u.test(subject))
    throw new AuthError("INVALID_SITES_IDENTITY", 401);
  return Object.freeze({ provider: "sites", subject });
}

const reservedPaths = new Set([
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
]);

/** Sites dispatch owns sign-in. Use this as a top-level browser link, never fetch(). */
export function sitesSignInPath(returnTo = "/admin"): string {
  let safe = "/admin";
  if (
    typeof returnTo === "string" &&
    returnTo.startsWith("/") &&
    !returnTo.startsWith("//") &&
    !/[\u0000-\u0020\u007f]/u.test(returnTo)
  ) {
    try {
      const parsed = new URL(returnTo, "https://sites-return.invalid");
      const decodedPath = decodeURIComponent(parsed.pathname).replace(
        /\\/gu,
        "/",
      );
      if (
        parsed.origin === "https://sites-return.invalid" &&
        !decodedPath.startsWith("//") &&
        !reservedPaths.has(decodedPath.replace(/\/+$/u, ""))
      )
        safe = parsed.pathname + parsed.search + parsed.hash;
    } catch {
      /* Invalid targets use the fixed admin path. */
    }
  }
  return "/signin-with-chatgpt?return_to=" + encodeURIComponent(safe);
}
