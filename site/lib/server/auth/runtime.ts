import { env } from "cloudflare:workers";
import { AdminManagementService } from "./admin-management.ts";
import { AuthorizationService } from "./authorization.ts";
import { AuthService } from "./service.ts";
import { GoogleOidcClient } from "./google-oidc.ts";
import { AuthError } from "./types.ts";
import { guardAuthAttempt } from "./limit.ts";

export async function authAttempt(request: Request, restricted = false) {
  await guardAuthAttempt(
    request,
    {
      db: env.DB,
      secret: env.AUTH_RATE_HMAC_SECRET,
      verified: env.AUTH_RATE_VERIFIED,
    },
    restricted,
  );
}

export function authService(): AuthService {
  if (!env.DB) throw new AuthError("AUTH_DATABASE_UNAVAILABLE", 503);
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
  const bootstrapSecret = env.ADMIN_BOOTSTRAP_SECRET;
  if (!clientId || !clientSecret || !redirectUri || !bootstrapSecret)
    throw new AuthError("AUTH_NOT_CONFIGURED", 503);
  return new AuthService({
    db: env.DB,
    oidc: new GoogleOidcClient({ clientId, clientSecret, redirectUri }),
    bootstrapSecret,
    identityRequests: adminManagementService(),
  });
}

export function authorizationService(): AuthorizationService {
  if (!env.DB) throw new AuthError("AUTH_DATABASE_UNAVAILABLE", 503);
  return new AuthorizationService({ db: env.DB });
}

export function adminManagementService(): AdminManagementService {
  if (!env.DB) throw new AuthError("AUTH_DATABASE_UNAVAILABLE", 503);
  const recoverySecret = env.ADMIN_RECOVERY_SECRET;
  return new AdminManagementService({
    db: env.DB,
    authorization: authorizationService(),
    recoverySecret,
  });
}
