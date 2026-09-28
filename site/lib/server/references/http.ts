import { ReferenceError } from "../../domain/rag-text.ts";
import { AuthError } from "../auth/types.ts";
import { SESSION_COOKIE, parseCookieHeader } from "../auth/cookies.ts";
import type { AuthService } from "../auth/service.ts";
import type {
  ReferenceService,
  ReferenceMetadata,
  ReferenceSearch,
} from "./service.ts";
import { REFERENCE_LIMITS, fail } from "./parse.ts";
export type ReferenceOperation =
  "upload" | "list" | "update" | "retrieve" | "cleanup" | "pending";
export function referenceHttpError(error: unknown) {
  const known = error instanceof ReferenceError || error instanceof AuthError;
  return Response.json(
    { error: known ? error.code : "REFERENCE_UNAVAILABLE" },
    {
      status: known ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
async function bytes(request: Request, maximum: number) {
  const reader = request.body?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maximum) {
        await reader.cancel();
        fail("REFERENCE_REQUEST_TOO_LARGE", 413);
      }
      chunks.push(next.value);
    }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
export async function handleReferenceRequest(
  request: Request,
  deps: { auth: AuthService; references: ReferenceService },
  operation: ReferenceOperation,
  id = "",
) {
  try {
    const read = operation === "list" || operation === "pending";
    if (request.method !== (read ? "GET" : "POST"))
      fail("METHOD_NOT_ALLOWED", 405);
    if (!read && request.headers.get("Origin") !== new URL(request.url).origin)
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    const session = await deps.auth.validateSession(
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null,
    );
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    const service = deps.references;
    let result: unknown;
    if (operation === "list")
      result = await service.list(
        session,
        new URL(request.url).searchParams.get("after") ?? "",
      );
    else if (operation === "pending") result = await service.pending(session);
    else if (operation === "upload") {
      if (
        request.headers.get("Content-Type")?.split(";", 1)[0] !==
        "application/octet-stream"
      )
        fail("REFERENCE_BINARY_REQUIRED", 415);
      let metadata: ReferenceMetadata, filename: string;
      try {
        const header = request.headers.get("X-Reference-Metadata") ?? "";
        if (header.length > 24000) fail("REFERENCE_INPUT_INVALID");
        metadata = JSON.parse(decodeURIComponent(header));
        filename = decodeURIComponent(
          request.headers.get("X-Reference-Filename") ?? "",
        );
      } catch {
        return referenceHttpError(
          new ReferenceError("REFERENCE_INPUT_INVALID"),
        );
      }
      result = await service.upload(
        session,
        metadata,
        request.headers.get("X-Reference-Format") as "md" | "pdf",
        filename,
        await bytes(request, REFERENCE_LIMITS.bytes),
      );
    } else {
      if (
        request.headers.get("Content-Type")?.split(";", 1)[0] !==
        "application/json"
      )
        fail("REFERENCE_JSON_REQUIRED", 415);
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await bytes(request, 16384),
          ),
        );
      } catch (error) {
        if (error instanceof ReferenceError) throw error;
        return referenceHttpError(
          new ReferenceError("REFERENCE_INPUT_INVALID"),
        );
      }
      const allowed =
        operation === "update"
          ? ["version", "metadata", "status", "privacyReviewed"]
          : operation === "retrieve"
            ? ["query", "subject", "grade", "classId"]
            : [];
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => !allowed.includes(key))
      )
        fail("REFERENCE_INPUT_INVALID");
      if (operation === "update")
        result = await service.update(
          session,
          id,
          body.version as number,
          body.metadata as ReferenceMetadata,
          body.status as "active",
          body.privacyReviewed === true,
        );
      else if (operation === "retrieve")
        result = await service.retrieve(session, body as ReferenceSearch);
      else result = await service.cleanup(session, id);
    }
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return referenceHttpError(error);
  }
}
