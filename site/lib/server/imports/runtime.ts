import { env } from "cloudflare:workers";
import { ImportError } from "../../domain/import-csv.ts";
import { authService } from "../auth/runtime.ts";
import { ImportService } from "./service.ts";
import { importIdentityKeys } from "./keys.ts";
import {
  handleImportRequest,
  importHttpError,
  type ImportOperation,
} from "./http.ts";
export async function importRoute(
  request: Request,
  operation: ImportOperation,
  id?: string,
) {
  try {
    if (!env.DB || !env.FILES)
      throw new ImportError("IMPORT_STORAGE_NOT_CONFIGURED", 503);
    const imports = new ImportService({
      db: env.DB,
      files: env.FILES,
      identityKeys: () =>
        importIdentityKeys(
          env.IDENTITY_ENCRYPTION_KEY,
          env.IDENTITY_HMAC_SECRET,
        ),
    });
    return await handleImportRequest(
      request,
      { auth: authService(), imports },
      operation,
      id,
    );
  } catch (error) {
    return importHttpError(error);
  }
}
