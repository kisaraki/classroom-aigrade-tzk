import { parseCookieHeader, SESSION_COOKIE } from "./cookies.ts";
import { AuthError } from "./types.ts";
import type { AuthService } from "./service.ts";
import type {
  AdminManagementService,
  CreateAdminInput,
  UpdateAdminInput,
  Confirmation,
} from "./admin-management.ts";

export type AuthHttpDependencies = {
  auth: AuthService;
  management: AdminManagementService;
};
type Operation =
  "list" | "create" | "update" | "rebind" | "revoke" | "identity" | "reauth";
const keys: Record<Operation, string[]> = {
  list: [],
  create: [
    "username",
    "displayName",
    "authorizedEmail",
    "role",
    "assignments",
    "confirmed",
  ],
  update: [
    "displayName",
    "role",
    "status",
    "assignments",
    "expectedVersion",
    "confirmed",
  ],
  rebind: ["authorizedEmail", "reason", "expectedVersion", "confirmed"],
  revoke: ["expectedVersion", "confirmed"],
  identity: ["requestToken"],
  reauth: [],
};

export function authHttpError(error: unknown): Response {
  return Response.json(
    { error: error instanceof AuthError ? error.code : "AUTH_UNAVAILABLE" },
    {
      status: error instanceof AuthError ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function handleAuthRequest(
  request: Request,
  dependencies: AuthHttpDependencies,
  operation: Operation,
  targetId?: string,
): Promise<Response> {
  try {
    let body: Record<string, unknown> = {};
    if (operation !== "list") {
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
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 64 * 1024) {
            await reader.cancel();
            throw new AuthError("REQUEST_TOO_LARGE", 413);
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new AuthError("INVALID_JSON", 400);
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => !keys[operation].includes(key))
      )
        throw new AuthError("INVALID_INPUT", 400);
    }
    const token =
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null;
    if (operation === "identity" || operation === "reauth") {
      const start =
        operation === "identity"
          ? await dependencies.auth.beginIdentityVerification(
              body.requestToken as string,
            )
          : await dependencies.auth.beginGoogleReauthentication(token);
      return new Response(null, {
        status: 302,
        headers: {
          Location: start.authorizationUrl,
          "Set-Cookie": start.stateCookie,
          "Cache-Control": "no-store",
        },
      });
    }
    const session = await dependencies.auth.validateSession(token);
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    const management = dependencies.management;
    if (operation === "list")
      return Response.json(
        { admins: await management.listAdmins(session) },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (operation === "create")
      return Response.json(
        await management.createAdmin(session, body as CreateAdminInput),
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    if (!targetId) throw new AuthError("INVALID_INPUT", 400);
    if (operation === "update") {
      if (
        !["displayName", "role", "status", "assignments"].some(
          (key) => key in body,
        )
      )
        throw new AuthError("INVALID_INPUT", 400);
      await management.updateAdmin(session, targetId, body as UpdateAdminInput);
    } else if (operation === "rebind")
      return Response.json(
        await management.approveRebind(
          session,
          targetId,
          body as Confirmation & { authorizedEmail: string; reason: string },
        ),
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    else
      await management.revokeSessions(session, targetId, body as Confirmation);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return authHttpError(error);
  }
}
