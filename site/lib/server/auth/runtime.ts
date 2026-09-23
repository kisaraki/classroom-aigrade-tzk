import { env } from "cloudflare:workers";
import { AuthService } from "./service.ts";
import { GoogleOidcClient } from "./google-oidc.ts";
import { AuthError } from "./types.ts";

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
  });
}
