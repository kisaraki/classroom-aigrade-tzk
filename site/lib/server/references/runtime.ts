import { env } from "cloudflare:workers";
import { authService } from "../auth/runtime.ts";
import { ReferenceService } from "./service.ts";
import { fail } from "./parse.ts";
import {
  handleReferenceRequest,
  referenceHttpError,
  type ReferenceOperation,
} from "./http.ts";
export async function referenceRoute(
  request: Request,
  operation: ReferenceOperation,
  id?: string,
) {
  try {
    if (!env.DB || !env.FILES)
      return fail("REFERENCE_STORAGE_NOT_CONFIGURED", 503);
    return await handleReferenceRequest(
      request,
      {
        auth: authService(),
        references: new ReferenceService({ db: env.DB, files: env.FILES }),
      },
      operation,
      id,
    );
  } catch (error) {
    return referenceHttpError(error);
  }
}
