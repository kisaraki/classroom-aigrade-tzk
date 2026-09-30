import { LookupError } from "./limit.ts";
import type { PublicLookupService } from "./service.ts";
export const PUBLIC_HEADERS = {
  "Cache-Control": "no-store, private, max-age=0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Vary: "Origin",
};
export function publicError(error: unknown) {
  const kind = error instanceof LookupError ? error.kind : "unavailable";
  return Response.json(
    {
      error:
        kind === "failed"
          ? "請核對資料，仍無法查詢請聯絡校方。"
          : "查詢服務暫時無法使用，請稍後再試。",
    },
    {
      status: kind === "failed" ? 400 : kind === "limited" ? 429 : 503,
      headers: PUBLIC_HEADERS,
    },
  );
}
export async function handlePublicLookup(
  request: Request,
  deps: { service: PublicLookupService; trustedIp: string | null },
) {
  try {
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      url.search ||
      request.headers.get("Origin") !== url.origin ||
      request.headers.get("Content-Type")?.split(";")[0] !== "application/json"
    )
      throw new LookupError();
    const reader = request.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.length;
        if (size > 4096) {
          await reader.cancel();
          throw new LookupError();
        }
        chunks.push(item.value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new LookupError();
    }
    return Response.json(await deps.service.lookup(input, deps.trustedIp), {
      headers: PUBLIC_HEADERS,
    });
  } catch (error) {
    return publicError(error);
  }
}
