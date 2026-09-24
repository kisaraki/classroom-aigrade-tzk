import { AuthError } from "../auth/types.ts";
import { parseCookieHeader, SESSION_COOKIE } from "../auth/cookies.ts";
import type { AuthService } from "../auth/service.ts";
import { ExamError } from "../../domain/scores.ts";
import type { ExamService } from "./service.ts";

export type ExamOperation =
  | "create"
  | "read"
  | "schedule"
  | "subject"
  | "preview"
  | "confirm"
  | "external"
  | "scores"
  | "participation";
const commandKeys = ["operationId", "expectedVersion", "confirmed"];
const fields: Record<ExamOperation, string[]> = {
  create: [
    "operationId",
    "academicTermId",
    "sequence",
    "startsOn",
    "endsOn",
    "confirmed",
  ],
  read: [],
  participation: [],
  schedule: [...commandKeys, "startsOn", "endsOn"],
  subject: [...commandKeys, "settingId", "settingVersion", "held"],
  preview: ["classId", "overrides"],
  confirm: [...commandKeys, "previewId"],
  external: [...commandKeys, "studentId", "schoolLabel"],
  scores: ["operationId", "expectedVersion", "scores", "reason"],
};
export function examHttpError(error: unknown): Response {
  const known = error instanceof ExamError || error instanceof AuthError;
  return Response.json(
    { error: known ? error.code : "EXAM_UNAVAILABLE" },
    {
      status: known ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function handleExamRequest(
  request: Request,
  dependencies: { auth: AuthService; exams: ExamService },
  operation: ExamOperation,
  targetId?: string,
): Promise<Response> {
  try {
    const read = operation === "read" || operation === "participation";
    if (!read && request.headers.get("Origin") !== new URL(request.url).origin)
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    const token =
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null;
    const session = await dependencies.auth.validateSession(token);
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    let body: Record<string, unknown> = {};
    if (!read) {
      if (
        request.headers
          .get("Content-Type")
          ?.split(";", 1)[0]
          .trim()
          .toLowerCase() !== "application/json"
      )
        throw new ExamError("JSON_REQUIRED", 415);
      const reader = request.body?.getReader(),
        chunks: Uint8Array[] = [];
      let length = 0;
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 64 * 1024) {
            await reader.cancel();
            throw new ExamError("REQUEST_TOO_LARGE", 413);
          }
          chunks.push(value);
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
        throw new ExamError("INVALID_JSON");
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((k) => !fields[operation].includes(k))
      )
        throw new ExamError("INVALID_INPUT");
    }
    const service = dependencies.exams,
      id = targetId ?? "";
    let result: unknown;
    switch (operation) {
      case "create":
        result = await service.createExam(
          session,
          body as Parameters<ExamService["createExam"]>[1],
        );
        break;
      case "schedule":
        result = await service.updateSchedule(
          session,
          id,
          body as Parameters<ExamService["updateSchedule"]>[2],
        );
        break;
      case "subject":
        result = await service.setSubjectHeld(
          session,
          id,
          body as Parameters<ExamService["setSubjectHeld"]>[2],
        );
        break;
      case "preview":
        result = await service.previewRoster(
          session,
          id,
          body as Parameters<ExamService["previewRoster"]>[2],
        );
        break;
      case "confirm":
        result = await service.confirmRoster(
          session,
          id,
          body as Parameters<ExamService["confirmRoster"]>[2],
        );
        break;
      case "external":
        result = await service.addExternalParticipation(
          session,
          id,
          body as Parameters<ExamService["addExternalParticipation"]>[2],
        );
        break;
      case "scores":
        result = await service.writeDraftScores(
          session,
          id,
          body as Parameters<ExamService["writeDraftScores"]>[2],
        );
        break;
      case "read":
      case "participation": {
        const search = new URL(request.url).searchParams;
        const allowed =
          operation === "read" ? ["classId", "subject"] : ["subject"];
        if (
          [...search.keys()].some(
            (k) => !allowed.includes(k) || search.getAll(k).length !== 1,
          )
        )
          throw new ExamError("INVALID_INPUT");
        const subject = search.get("subject") ?? undefined;
        result =
          operation === "read"
            ? await service.readExam(session, id, {
                classId: search.get("classId") ?? "",
                subject,
              })
            : await service.readParticipation(session, id, subject);
      }
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return examHttpError(error);
  }
}
