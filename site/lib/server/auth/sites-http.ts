import { AuthError } from "./types.ts";
import type { SitesAuthService } from "./sites-service.ts";
import { parseCookieHeader, SESSION_COOKIE } from "./cookies.ts";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";
const keys: Record<string, string[]> = {
  login: [],
  bootstrap: ["secret", "displayName", "contactEmail"],
  "register-options": ["confirmed"],
  "reauth-options": [],
  "register-verify": ["challengeId", "response"],
  "reauth-verify": ["challengeId", "response"],
  "identity-options": ["requestToken"],
  "identity-verify": ["requestToken", "challengeId", "response"],
};
export async function handleSitesAuth(
  request: Request,
  serviceOrFactory: SitesAuthService | (() => SitesAuthService),
  guardAttempt?: (restricted: boolean) => Promise<void>,
): Promise<Response> {
  let attemptGuarded = false;
  const guard = async (restricted: boolean) => {
    attemptGuarded = true;
    await guardAttempt?.(restricted);
  };
  try {
    if (request.method !== "POST")
      throw new AuthError("METHOD_NOT_ALLOWED", 405);
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    if (
      request.headers
        .get("Content-Type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      throw new AuthError("JSON_REQUIRED", 415);
    const reader = request.body?.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 65536) {
          await reader.cancel();
          throw new AuthError("REQUEST_TOO_LARGE", 413);
        }
        chunks.push(value);
      }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new AuthError("INVALID_JSON", 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.operation !== "string" ||
      !Object.hasOwn(keys, body.operation) ||
      Object.keys(body).some(
        (k) => k !== "operation" && !keys[body.operation as string].includes(k),
      )
    )
      throw new AuthError("INVALID_INPUT", 400);
    const operation = body.operation,
      token =
        parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ??
        null;
    await guard(operation === "bootstrap" || operation.startsWith("identity-"));
    const service =
      typeof serviceOrFactory === "function"
        ? serviceOrFactory()
        : serviceOrFactory;
    const headers = new Headers({ "Cache-Control": "no-store" });
    let result: unknown;
    if (operation === "login" || operation === "bootstrap") {
      const session =
        operation === "login"
          ? await service.loginSites()
          : await service.bootstrapSites(
              body as unknown as {
                secret: string;
                displayName: string;
                contactEmail: string;
              },
            );
      headers.set("Set-Cookie", service.cookieForSession(session.token));
      result = { ok: true };
    } else if (
      operation === "register-options" ||
      operation === "reauth-options"
    )
      result = await service.passkeyOptions(
        token,
        operation === "register-options" ? "register" : "reauth",
        body.confirmed === true,
      );
    else if (operation === "register-verify" || operation === "reauth-verify")
      result = await service.verifyPasskey(
        token,
        operation === "register-verify" ? "register" : "reauth",
        body.challengeId as string,
        body.response as RegistrationResponseJSON | AuthenticationResponseJSON,
      );
    else if (operation === "identity-options")
      result = await service.identityOptions(body.requestToken as string);
    else
      result = await service.verifyIdentity(
        body.requestToken as string,
        body.challengeId as string,
        body.response as RegistrationResponseJSON,
      );
    return Response.json(result, { headers });
  } catch (error) {
    if (!attemptGuarded) {
      try {
        await guard(false);
      } catch (rateError) {
        error = rateError;
      }
    }
    return Response.json(
      { error: error instanceof AuthError ? error.code : "AUTH_UNAVAILABLE" },
      {
        status: error instanceof AuthError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
