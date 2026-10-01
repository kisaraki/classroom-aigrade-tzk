import { AuthError } from "../auth/types.ts";
import type { AuthService } from "../auth/service.ts";
import { SESSION_COOKIE, parseCookieHeader } from "../auth/cookies.ts";
import { ReportService, type ReportInput } from "./service.ts";
import {
  csv,
  xlsx,
  bounded,
  ReportError,
  validateReportSource,
} from "./formats.ts";
import { pdf, type parseFont } from "./pdf.ts";
const headers = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
export async function handleReport(
  request: Request,
  deps: {
    auth: AuthService;
    reports: ReportService;
    font: () => Promise<ReturnType<typeof parseFont>>;
  },
) {
  try {
    if (request.method !== "POST")
      throw new AuthError("METHOD_NOT_ALLOWED", 405);
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      throw new AuthError("CSRF_ORIGIN_MISMATCH", 403);
    const token =
        parseCookieHeader(request.headers.get("Cookie"))[SESSION_COOKIE] ??
        null,
      session = await deps.auth.validateSession(token);
    if (!session) throw new AuthError("AUTHENTICATION_REQUIRED");
    if (
      request.headers.get("Content-Type")?.split(";")[0].trim() !==
      "application/json"
    )
      throw new AuthError("JSON_REQUIRED", 415);
    const reader = request.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.length;
        if (size > 65536) {
          await reader.cancel();
          throw new ReportError("REPORT_REQUEST_TOO_LARGE", 413);
        }
        chunks.push(r.value);
      }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    let body;
    try {
      body = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new ReportError("INVALID_JSON");
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) =>
          ![
            "kind",
            "examId",
            "classId",
            "grade",
            "studentId",
            "expectedVersion",
            "format",
          ].includes(k),
      ) ||
      !["preview", "csv", "xlsx", "pdf"].includes(body.format)
    )
      throw new ReportError("INVALID_REPORT_INPUT");
    const { format, ...input } = body;
    const prepared = await deps.reports.prepare(session, input as ReportInput);
    validateReportSource(prepared.report);
    let output: Uint8Array | undefined;
    if (format === "csv") output = csv(prepared.report);
    else if (format === "xlsx") output = xlsx(prepared.report);
    else if (format === "pdf") output = pdf(prepared.report, await deps.font());
    await prepared.revalidate();
    const final = await deps.auth.validateSession(token);
    if (
      !final ||
      final.adminId !== session.adminId ||
      final.sessionId !== session.sessionId
    )
      throw new AuthError("AUTHENTICATION_REQUIRED");
    if (format === "preview")
      return new Response(
        bounded(
          new TextEncoder().encode(
            JSON.stringify({
              report: prepared.report,
              version: prepared.version,
            }),
          ),
        ) as Uint8Array<ArrayBuffer>,
        { headers: { ...headers, "Content-Type": "application/json" } },
      );
    return new Response(output as Uint8Array<ArrayBuffer>, {
      headers: {
        ...headers,
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : format === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/pdf",
        "Content-Disposition": `attachment; filename="report-${input.kind}.${format}"`,
      },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AuthError || e instanceof ReportError
            ? e.code
            : "REPORT_UNAVAILABLE",
      },
      {
        status:
          e instanceof AuthError || e instanceof ReportError ? e.status : 503,
        headers,
      },
    );
  }
}
