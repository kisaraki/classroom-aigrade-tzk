import { authService } from "../../../../../lib/server/auth/runtime.ts";
import { AuthError } from "../../../../../lib/server/auth/types.ts";

export async function GET(): Promise<Response> {
  try {
    const result = await authService().beginGoogleLogin();
    return new Response(null, {
      status: 302,
      headers: {
        Location: result.authorizationUrl,
        "Set-Cookie": result.stateCookie,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 503;
    return Response.json(
      { error: error instanceof AuthError ? error.code : "AUTH_UNAVAILABLE" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
