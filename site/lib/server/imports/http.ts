import { ImportError, IMPORT_LIMITS } from "../../domain/import-csv.ts";
import { ExamError } from "../../domain/scores.ts";
import { AcademicError } from "../academic/types.ts";
import { AuthError } from "../auth/types.ts";
import { SESSION_COOKIE, parseCookieHeader } from "../auth/cookies.ts";
import type { AuthService } from "../auth/service.ts";
import type { ImportService, ImportTarget } from "./service.ts";

export type ImportOperation =
  | "upload"
  | "template"
  | "read"
  | "preview"
  | "commit"
  | "rollback-preview"
  | "rollback"
  | "errors";
const fields: Record<ImportOperation, string[]> = {
  upload: [],
  template: ["target"],
  read: [],
  preview: ["columns"],
  commit: ["previewVersion", "confirmed"],
  "rollback-preview": [],
  rollback: ["previewVersion", "confirmed"],
  errors: [],
};
export function importHttpError(error: unknown) {
  const known =
    error instanceof ImportError ||
    error instanceof AuthError ||
    error instanceof ExamError ||
    error instanceof AcademicError;
  return Response.json(
    { error: known ? error.code : "IMPORT_UNAVAILABLE" },
    {
      status:
        known && "status" in error ? Number(error.status) : known ? 409 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
async function bodyBytes(request: Request, maximum: number) {
  const reader = request.body?.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  if (reader)
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) {
        await reader.cancel();
        throw new ImportError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function handleImportRequest(
  request: Request,
  dependencies: { auth: AuthService; imports: ImportService },
  operation: ImportOperation,
  id = "",
) {
  try {
    const read = operation === "read" || operation === "errors";
    if (!read && request.headers.get("Origin") !== new URL(request.url).origin)
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    const token =
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null;
    const session = await dependencies.auth.validateSession(token);
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    const imports = dependencies.imports;
    let result: unknown;
    const type = request.headers
      .get("Content-Type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (operation === "upload") {
      if (type !== "application/octet-stream")
        throw new ImportError("BINARY_UPLOAD_REQUIRED", 415);
      let target: ImportTarget;
      try {
        target = JSON.parse(request.headers.get("X-Import-Target") ?? "null");
      } catch {
        throw new ImportError("INVALID_IMPORT_TARGET");
      }
      result = await imports.upload(
        session,
        target,
        request.headers.get("X-Import-Format") as "csv" | "xlsx",
        await bodyBytes(request, IMPORT_LIMITS.maxBytes),
      );
    } else {
      let body: Record<string, unknown> = {};
      if (!read) {
        if (type !== "application/json")
          throw new ImportError("JSON_REQUIRED", 415);
        try {
          body = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              await bodyBytes(request, 64 * 1024),
            ),
          );
        } catch (error) {
          if (error instanceof ImportError) throw error;
          throw new ImportError("INVALID_JSON");
        }
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).some((k) => !fields[operation].includes(k))
        )
          throw new ImportError("INVALID_IMPORT_INPUT");
      }
      switch (operation) {
        case "template":
          return new Response(
            new Uint8Array(
              await imports.template(session, body.target as ImportTarget),
            ),
            {
              headers: {
                "Content-Type":
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition":
                  'attachment; filename="import-template.xlsx"',
                "Cache-Control": "no-store",
              },
            },
          );
        case "read":
          result = await imports.read(session, id);
          break;
        case "preview":
          result = await imports.preview(
            session,
            id,
            body.columns as Record<string, string> | undefined,
          );
          break;
        case "commit":
          result = await imports.commit(
            session,
            id,
            body.previewVersion as number,
            body.confirmed as boolean,
          );
          break;
        case "rollback-preview":
          result = await imports.previewRollback(session, id);
          break;
        case "rollback":
          result = await imports.rollback(
            session,
            id,
            body.previewVersion as number,
            body.confirmed as boolean,
          );
          break;
        case "errors":
          return new Response(await imports.errorReport(session, id), {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="import-errors.csv"',
              "Cache-Control": "no-store",
            },
          });
      }
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return importHttpError(error);
  }
}
