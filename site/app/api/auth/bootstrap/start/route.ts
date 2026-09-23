import { authService } from "../../../../../lib/server/auth/runtime.ts";
import { AuthError } from "../../../../../lib/server/auth/types.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin)
      return Response.json(
        { error: "CSRF_ORIGIN_MISMATCH" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    const body = (await request.json()) as { secret?: unknown };
    if (typeof body.secret !== "string" || body.secret.length === 0)
      return Response.json(
        { error: "BOOTSTRAP_SECRET_INVALID" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    const result = await authService().beginGoogleBootstrap({
      secret: body.secret,
    });
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
