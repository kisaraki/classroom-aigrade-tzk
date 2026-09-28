import { AuthError } from "../auth/types.ts";
import type { AuthService } from "../auth/service.ts";
import { SESSION_COOKIE, parseCookieHeader } from "../auth/cookies.ts";
import { AIProviderError } from "./provider.ts";
import { AISettingsError, type AISettingsService } from "./settings.ts";
const headers = { "Cache-Control": "no-store" };
export function aiHttpError(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof AuthError ||
        error instanceof AISettingsError ||
        error instanceof AIProviderError
          ? error.code
          : "AI_UNAVAILABLE",
    },
    {
      status:
        error instanceof AuthError || error instanceof AISettingsError
          ? error.status
          : error instanceof AIProviderError
            ? 400
            : 503,
      headers,
    },
  );
}
export async function handleAISettingsRequest(
  request: Request,
  deps: { auth: AuthService; settings: AISettingsService },
) {
  try {
    if (!["GET", "POST"].includes(request.method))
      throw new AISettingsError("METHOD_NOT_ALLOWED", 405);
    if (
      request.method === "POST" &&
      request.headers.get("Origin") !== new URL(request.url).origin
    )
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    const session = await deps.auth.validateSession(
      parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ?? null,
    );
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    if (request.method === "GET")
      return Response.json(await deps.settings.read(session), { headers });
    if (
      request.headers.get("Content-Type")?.split(";", 1)[0] !==
      "application/json"
    )
      throw new AISettingsError("AI_JSON_REQUIRED", 415);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 4096) {
          await reader.cancel();
          throw new AISettingsError("AI_REQUEST_TOO_LARGE", 413);
        }
        chunks.push(chunk.value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let input;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new AISettingsError("AI_SETTINGS_INPUT_INVALID", 400);
    }
    return Response.json(await deps.settings.update(session, input), {
      headers,
    });
  } catch (error) {
    return aiHttpError(error);
  }
}
