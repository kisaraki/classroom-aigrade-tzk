import {
  adminManagementService,
  authService,
} from "../../../../../lib/server/auth/runtime.ts";
import {
  authHttpError,
  handleAuthRequest,
} from "../../../../../lib/server/auth/http.ts";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  try {
    return await handleAuthRequest(
      request,
      { auth: authService(), management: adminManagementService() },
      "update",
      (await context.params).id,
    );
  } catch (error) {
    return authHttpError(error);
  }
}
