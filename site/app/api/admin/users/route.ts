import {
  adminManagementService,
  authService,
} from "../../../../lib/server/auth/runtime.ts";
import {
  authHttpError,
  handleAuthRequest,
} from "../../../../lib/server/auth/http.ts";
export async function GET(request: Request): Promise<Response> {
  try {
    return await handleAuthRequest(
      request,
      {
        auth: authService(request),
        management: adminManagementService(),
        requireSitesBinding: true,
      },
      "list",
    );
  } catch (error) {
    return authHttpError(error);
  }
}
export async function POST(request: Request): Promise<Response> {
  try {
    return await handleAuthRequest(
      request,
      {
        auth: authService(request),
        management: adminManagementService(),
        requireSitesBinding: true,
      },
      "create",
    );
  } catch (error) {
    return authHttpError(error);
  }
}
