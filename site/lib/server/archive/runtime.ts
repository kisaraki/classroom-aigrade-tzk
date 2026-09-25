import { env } from "cloudflare:workers";
import { authService } from "../auth/runtime.ts";
import { AuthError } from "../auth/types.ts";
import { examHttpError } from "../exams/http.ts";
import { ArchiveService } from "./service.ts";
import { handleArchiveRequest, type ArchiveOperation } from "./http.ts";
export async function archiveRoute(
  request: Request,
  operation: ArchiveOperation,
  id = "",
) {
  try {
    if (!env.DB) throw new AuthError("AUTH_DATABASE_UNAVAILABLE", 503);
    return await handleArchiveRequest(
      request,
      { auth: authService(), archive: new ArchiveService({ db: env.DB }) },
      operation,
      id,
    );
  } catch (error) {
    return examHttpError(error);
  }
}
