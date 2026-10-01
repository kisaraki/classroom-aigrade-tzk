import { AuthError } from "../auth/types.ts";
import { AcademicError } from "../academic/types.ts";
import { ExamError } from "../../domain/scores.ts";
import { SESSION_COOKIE, parseCookieHeader } from "../auth/cookies.ts";
import type { AuthService } from "../auth/service.ts";
import type { AdminWorkspaceService } from "./service.ts";
const fields: Record<string, string[]> = {
  audit: ["cursor"],
  profile: [],
  terms: [],
  context: ["termId", "onDate"],
  roster: ["termId", "classId", "onDate"],
  selection: ["purpose", "termId", "classId", "onDate", "examId", "subject"],
  rankings: ["examId", "classId", "grade", "mode"],
  "user-details": ["id"],
  "year-preview": ["code", "startsOn", "secondTermStartsOn", "endsOn"],
  "classes-preview": ["yearId", "codes", "historyReason"],
  "students-preview": ["termId", "mode", "rows", "historyReason"],
  "enrollments-preview": ["termId", "rows", "historyReason"],
  "move-preview": [
    "enrollmentId",
    "targetClassId",
    "seatNumber",
    "effectiveFrom",
    "historyReason",
  ],
  "promotion-preview": [
    "sourceTermId",
    "targetTermId",
    "overrides",
    "historyReason",
  ],
  "transfer-preview": ["studentId", "effectiveOn", "historyReason"],
  "undo-preview": ["operationId", "historyReason"],
  "academic-confirm": ["previewId", "confirmed"],
};
export const ADMIN_HEADERS = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
export function workspaceError(e: unknown) {
  const known =
    e instanceof AuthError ||
    e instanceof AcademicError ||
    e instanceof ExamError;
  return Response.json(
    { error: known ? e.code : "ADMIN_UNAVAILABLE" },
    {
      status:
        e instanceof AuthError || e instanceof ExamError
          ? e.status
          : e instanceof AcademicError
            ? 400
            : 503,
      headers: ADMIN_HEADERS,
    },
  );
}
export async function handleWorkspace(
  request: Request,
  deps: { auth: AuthService; workspace: AdminWorkspaceService },
) {
  try {
    if (request.method !== "POST")
      throw new AuthError("METHOD_NOT_ALLOWED", 405);
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    const session = await deps.auth.validateSession(
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null,
    );
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    if (
      request.headers.get("Content-Type")?.split(";")[0] !== "application/json"
    )
      throw new AuthError("JSON_REQUIRED", 415);
    const reader = request.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const c = await reader.read();
        if (c.done) break;
        size += c.value.length;
        if (size > 65536) {
          await reader.cancel();
          throw new AuthError("REQUEST_TOO_LARGE", 413);
        }
        chunks.push(c.value);
      }
    const bytes = new Uint8Array(size);
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
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => !["operation", "input"].includes(k)) ||
      typeof body.operation !== "string" ||
      !body.input ||
      typeof body.input !== "object" ||
      Array.isArray(body.input)
    )
      throw new AuthError("INVALID_INPUT", 400);
    if (
      !Object.hasOwn(fields, body.operation) ||
      Object.keys(body.input).some((k) => !fields[body.operation].includes(k))
    )
      throw new AuthError("INVALID_INPUT", 400);
    const result = await deps.workspace.execute(
      session,
      body.operation,
      body.input,
    );
    const finalSession = await deps.auth.validateSession(
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null,
    );
    if (
      !finalSession ||
      finalSession.adminId !== session.adminId ||
      finalSession.sessionId !== session.sessionId
    )
      throw new AuthError("AUTHENTICATION_REQUIRED");
    return Response.json(result, { headers: ADMIN_HEADERS });
  } catch (e) {
    return workspaceError(e);
  }
}
