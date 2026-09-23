import {
  clearOAuthStateCookie,
  clearSessionCookie,
} from "../../../../../lib/server/auth/cookies.ts";
import { authService } from "../../../../../lib/server/auth/runtime.ts";
import { AuthError } from "../../../../../lib/server/auth/types.ts";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state)
    return Response.json(
      { error: "OAUTH_CALLBACK_INVALID" },
      {
        status: 400,
        headers: {
          "Set-Cookie": clearOAuthStateCookie(),
          "Cache-Control": "no-store",
        },
      },
    );
  try {
    const service = authService();
    const result = await service.completeGoogleLogin({
      code,
      state,
      cookieHeader: request.headers.get("Cookie"),
    });
    const headers = new Headers({
      Location: "/admin",
      "Cache-Control": "no-store",
    });
    if (result?.token)
      headers.append("Set-Cookie", service.cookieForSession(result.token));
    if (!result) headers.append("Set-Cookie", clearSessionCookie());
    headers.append("Set-Cookie", clearOAuthStateCookie());
    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return Response.json(
      { error: error instanceof AuthError ? error.code : "AUTH_FAILED" },
      {
        status,
        headers: {
          "Set-Cookie": clearOAuthStateCookie(),
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
