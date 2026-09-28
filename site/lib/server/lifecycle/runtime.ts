import { env } from "cloudflare:workers";
import { authService } from "../auth/runtime.ts";
import { AuthError } from "../auth/types.ts";
import { examHttpError } from "../exams/http.ts";
import { LifecycleService } from "./service.ts";
import { handleLifecycleRequest, type LifecycleOperation } from "./http.ts";
export async function lifecycleRoute(
  request: Request,
  operation: LifecycleOperation,
  id = "",
) {
  try {
    if (!env.DB) throw new AuthError("AUTH_DATABASE_UNAVAILABLE", 503);
    // Intentionally no copy adapter: production backup/copy capabilities remain unverified.
    // A request body or environment flag must never bypass this integration gate.
    return await handleLifecycleRequest(
      request,
      { auth: authService(), lifecycle: new LifecycleService({ db: env.DB }) },
      operation,
      id,
    );
  } catch (error) {
    return examHttpError(error);
  }
}
