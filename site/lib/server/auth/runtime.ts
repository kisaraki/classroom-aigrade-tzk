import { env } from "cloudflare:workers";
import { AdminManagementService } from "./admin-management.ts";
import { AuthorizationService } from "./authorization.ts";
import { SitesAuthService } from "./sites-service.ts";
import { readSitesIdentity } from "./sites-identity.ts";
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

export function authService(request: Request): SitesAuthService {
  if (!env.DB) throw new AuthError("AUTH_DATABASE_UNAVAILABLE", 503);
  const identity = readSitesIdentity(request, {
    trustedGatewayVerified: env.SITES_AUTH_VERIFIED === "true",
  });
  if (!env.WEBAUTHN_ORIGIN || !env.ADMIN_BOOTSTRAP_SECRET)
    throw new AuthError("AUTH_NOT_CONFIGURED", 503);
  return new SitesAuthService({
    db: env.DB,
    identity,
    origin: env.WEBAUTHN_ORIGIN,
    bootstrapSecret: env.ADMIN_BOOTSTRAP_SECRET,
  });
}

export function authorizationService(): AuthorizationService {
  if (!env.DB) throw new AuthError("AUTH_DATABASE_UNAVAILABLE", 503);
  return new AuthorizationService({ db: env.DB, requireSitesBinding: true });
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
