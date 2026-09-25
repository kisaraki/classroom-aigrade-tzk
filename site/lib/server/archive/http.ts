import { ArchiveService } from "./service.ts";
import type { AuthService } from "../auth/service.ts";
import { AuthError } from "../auth/types.ts";
import { parseCookieHeader, SESSION_COOKIE } from "../auth/cookies.ts";
import { examHttpError } from "../exams/http.ts";
export type ArchiveOperation = "preview" | "confirm" | "read";
export async function handleArchiveRequest(
  request: Request,
  deps: { auth: AuthService; archive: ArchiveService },
  operation: ArchiveOperation,
  id = "",
) {
  try {
    if (
      operation !== "read" &&
      request.headers.get("Origin") !== new URL(request.url).origin
    )
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    const session = await deps.auth.validateSession(
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null,
    );
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    let result: unknown;
    if (operation === "read")
      result = await deps.archive.readBatch(session, id);
    else {
      if (
        request.headers.get("Content-Type")?.split(";")[0].trim() !==
        "application/json"
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
      let body;
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new AuthError("INVALID_JSON", 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new AuthError("INVALID_ARCHIVE_INPUT", 400);
      if (operation === "preview")
        result = await deps.archive.preview(session, body);
      else {
        if (
          Object.keys(body).some(
            (k) => !["previewId", "confirmed"].includes(k),
          ) ||
          typeof body.previewId !== "string"
        )
          throw new AuthError("INVALID_ARCHIVE_INPUT", 400);
        result = await deps.archive.confirm(
          session,
          body.previewId,
          body.confirmed,
        );
      }
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return examHttpError(error);
  }
}
