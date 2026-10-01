import {
  authService,
  authAttempt,
} from "../../../../lib/server/auth/runtime.ts";
import { handleSitesAuth } from "../../../../lib/server/auth/sites-http.ts";
import { authHttpError } from "../../../../lib/server/auth/http.ts";
export async function POST(request: Request): Promise<Response> {
  try {
    return await handleSitesAuth(
      request,
      () => authService(request),
      (restricted) => authAttempt(request, restricted),
    );
  } catch (error) {
    return authHttpError(error);
  }
}
export async function GET(request: Request): Promise<Response> {
  try {
    const service = authService(request);
    return Response.json(
      { subject: service.identity.subject },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authHttpError(error);
  }
}
