import { env } from "cloudflare:workers";
import { authService } from "../auth/runtime.ts";
import { AuthError } from "../auth/types.ts";
import { examHttpError } from "./http.ts";
import { PublicationService } from "./publication.ts";
import {
  handlePublicationRequest,
  type PublicationOperation,
} from "./publication-http.ts";
export async function publicationRoute(
  request: Request,
  operation: PublicationOperation,
  examId: string,
) {
  try {
    if (!env.DB) throw new AuthError("AUTH_DATABASE_UNAVAILABLE", 503);
    return await handlePublicationRequest(
      request,
      {
        auth: authService(),
        publication: new PublicationService({ db: env.DB }),
      },
      operation,
      examId,
    );
  } catch (error) {
    return examHttpError(error);
  }
}
