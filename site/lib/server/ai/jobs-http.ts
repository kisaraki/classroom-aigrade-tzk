import { AuthError } from "../auth/types.ts";
import type { AuthService } from "../auth/service.ts";
import { SESSION_COOKIE, parseCookieHeader } from "../auth/cookies.ts";
import { AdviceError, adviceFail } from "./advice.ts";
import type { AIJobService } from "./jobs.ts";
export async function handleAIJobRequest(
  request: Request,
  deps: { auth: AuthService; jobs: AIJobService },
) {
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!["GET", "POST"].includes(request.method))
      adviceFail("METHOD_NOT_ALLOWED", 405);
    if (
      request.method === "POST" &&
      request.headers.get("Origin") !== new URL(request.url).origin
    )
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    const session = await deps.auth.validateSession(
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null,
    );
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      return Response.json(
        await deps.jobs.history(
          session,
          params.get("examId") ?? "",
          params.get("studentId") ?? "",
        ),
        { headers },
      );
    }
    if (
      request.headers.get("Content-Type")?.split(";", 1)[0] !==
      "application/json"
    )
      adviceFail("AI_JSON_REQUIRED", 415);
    const reader = request.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 4096) {
          await reader.cancel();
          adviceFail("AI_REQUEST_TOO_LARGE", 413);
        }
        chunks.push(chunk.value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body;
    try {
      body = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      return adviceFail("AI_REQUEST_INVALID", 400);
    }
    return Response.json(await deps.jobs.request(session, body), {
      headers,
      status: 202,
    });
  } catch (error) {
    const known = error instanceof AuthError || error instanceof AdviceError;
    return Response.json(
      { error: known ? error.code : "AI_UNAVAILABLE" },
      { headers, status: known ? error.status : 503 },
    );
  }
}
