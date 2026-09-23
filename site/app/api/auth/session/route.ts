import {
  parseCookieHeader,
  SESSION_COOKIE,
} from "../../../../lib/server/auth/cookies.ts";
import { authService } from "../../../../lib/server/auth/runtime.ts";
import { AuthError } from "../../../../lib/server/auth/types.ts";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await authService().validateSession(
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null,
    );
    return Response.json(
      session ? { authenticated: true, ...session } : { authenticated: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 503;
    return Response.json(
      { error: error instanceof AuthError ? error.code : "AUTH_UNAVAILABLE" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
