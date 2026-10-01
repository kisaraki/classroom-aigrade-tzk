import { env } from "cloudflare:workers";
import { authService } from "../../../../lib/server/auth/runtime.ts";
import { AdminWorkspaceService } from "../../../../lib/server/admin/service.ts";
import {
  handleWorkspace,
  workspaceError,
} from "../../../../lib/server/admin/http.ts";
import { importIdentityKeys } from "../../../../lib/server/imports/keys.ts";
export async function POST(request: Request) {
  try {
    if (!env.DB) throw new Error();
    return await handleWorkspace(request, {
      auth: authService(),
      workspace: new AdminWorkspaceService({
        db: env.DB,
        identityKeys: () =>
          importIdentityKeys(
            env.IDENTITY_ENCRYPTION_KEY,
            env.IDENTITY_HMAC_SECRET,
          ),
      }),
    });
  } catch (e) {
    return workspaceError(e);
  }
}
