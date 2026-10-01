import {
  adminManagementService,
  authAttempt,
  authService,
} from "../../../../../lib/server/auth/runtime.ts";
import {
  authHttpError,
  handleAuthRequest,
} from "../../../../../lib/server/auth/http.ts";
export async function POST(request: Request): Promise<Response> {
  try {
    await authAttempt(request, false);
    return await handleAuthRequest(
      request,
      { auth: authService(), management: adminManagementService() },
      "reauth",
    );
  } catch (error) {
    return authHttpError(error);
  }
}
