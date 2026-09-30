import { env } from "cloudflare:workers";
import { handlePublicLookup, publicError } from "./http.ts";
import { PublicLookupService } from "./service.ts";
export async function publicLookupRoute(request: Request) {
  // Enable only after verifying the edge replaces CF-Connecting-IP and the <=24h cleanup schedule.
  if (
    env.PUBLIC_LOOKUP_VERIFIED !== "true" ||
    !env.DB ||
    !env.PUBLIC_LOOKUP_HMAC_SECRET
  )
    return publicError(null);
  return handlePublicLookup(request, {
    service: new PublicLookupService({
      db: env.DB,
      hmacSecret: env.PUBLIC_LOOKUP_HMAC_SECRET,
    }),
    trustedIp: request.headers.get("CF-Connecting-IP"),
  });
}
