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
    await authAttempt(request, true);
    return await handleAuthRequest(
      request,
      { auth: authService(), management: adminManagementService() },
      "identity",
    );
  } catch (error) {
    return authHttpError(error);
  }
}
