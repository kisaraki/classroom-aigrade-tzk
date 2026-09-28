import type { LifecycleService, LifecycleRequest } from "./service.ts";
import type { AuthService } from "../auth/service.ts";
import { AuthError } from "../auth/types.ts";
import { parseCookieHeader, SESSION_COOKIE } from "../auth/cookies.ts";
import { examHttpError } from "../exams/http.ts";
export type LifecycleOperation =
  "preview" | "confirm" | "read" | "list" | "retry";
export async function handleLifecycleRequest(
  request: Request,
  deps: { auth: AuthService; lifecycle: LifecycleService },
  operation: LifecycleOperation,
  id = "",
) {
  try {
    const read = ["read", "list"].includes(operation);
    if (request.method !== (read ? "GET" : "POST"))
      throw new AuthError("METHOD_NOT_ALLOWED", 405);
    if (!read && request.headers.get("Origin") !== new URL(request.url).origin)
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    const session = await deps.auth.validateSession(
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null,
    );
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    let result: unknown;
    if (operation === "read")
      result = await deps.lifecycle.readJob(session, id);
    else if (operation === "list") result = await deps.lifecycle.list(session);
    else {
      if (
        request.headers.get("Content-Type")?.split(";")[0].trim() !==
        "application/json"
      )
        throw new AuthError("JSON_REQUIRED", 415);
      const reader = request.body?.getReader(),
        chunks: Uint8Array[] = [];
      let length = 0;
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 1024 * 1024) {
            await reader.cancel();
            throw new AuthError("REQUEST_TOO_LARGE", 413);
          }
          chunks.push(value);
        }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new AuthError("INVALID_JSON", 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new AuthError("INVALID_LIFECYCLE_INPUT", 400);
      if (operation === "preview")
        result = await deps.lifecycle.preview(
          session,
          body as LifecycleRequest,
        );
      else if (operation === "retry") {
        if (
          Object.keys(body).some((k) => k !== "confirmed") ||
          body.confirmed !== true
        )
          throw new AuthError("CONFIRMATION_REQUIRED", 400);
        result = await deps.lifecycle.retry(session, id);
      } else {
        if (
          Object.keys(body).some(
            (k) => !["previewId", "confirmed", "confirmation"].includes(k),
          ) ||
          typeof body.previewId !== "string" ||
          (body.confirmation !== undefined &&
            typeof body.confirmation !== "string")
        )
          throw new AuthError("INVALID_LIFECYCLE_INPUT", 400);
        result = await deps.lifecycle.confirm(
          session,
          body.previewId,
          body.confirmed === true,
          body.confirmation as string | undefined,
        );
      }
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return examHttpError(error);
  }
}
