import {
  clearOAuthStateCookie,
  clearSessionCookie,
  parseCookieHeader,
  SESSION_COOKIE,
} from "../../../../lib/server/auth/cookies.ts";
import { authService } from "../../../../lib/server/auth/runtime.ts";
import { AuthError } from "../../../../lib/server/auth/types.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin)
      return Response.json(
        { error: "CSRF_ORIGIN_MISMATCH" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    await authService().logout(
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null,
    );
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", clearSessionCookie());
    headers.append("Set-Cookie", clearOAuthStateCookie());
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 503;
    return Response.json(
      { error: error instanceof AuthError ? error.code : "AUTH_UNAVAILABLE" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
