import {
  authAttempt,
  authService,
  adminManagementService,
} from "../../../../../lib/server/auth/runtime.ts";
import {
  handleAuthRequest,
  authHttpError,
} from "../../../../../lib/server/auth/http.ts";
export async function POST(request: Request) {
  try {
    await authAttempt(request, true);
    return await handleAuthRequest(
      request,
      { auth: authService(), management: adminManagementService() },
      "bootstrap",
    );
  } catch (e) {
    return authHttpError(e);
  }
}
