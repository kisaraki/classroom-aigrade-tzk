import { env } from "cloudflare:workers";
import { authService } from "../../../../lib/server/auth/runtime.ts";
import { ReportService } from "../../../../lib/server/reports/service.ts";
import { handleReport } from "../../../../lib/server/reports/http.ts";
import { parseFont } from "../../../../lib/server/reports/pdf.ts";
let font: ReturnType<typeof parseFont> | undefined;
export async function POST(request: Request) {
  try {
    if (!env.DB)
      return Response.json(
        { error: "REPORT_UNAVAILABLE" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    return handleReport(request, {
      auth: authService(),
      reports: new ReportService({ db: env.DB }),
      font: async () => {
        if (!font) {
          const { default: data } =
            await import("../../../../assets/reports/NotoSansTC-Regular.ttf?inline");
          font = parseFont(
            Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) =>
              c.charCodeAt(0),
            ),
          );
        }
        return font;
      },
    });
  } catch {
    return Response.json(
      { error: "REPORT_UNAVAILABLE" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, private",
          "X-Robots-Tag": "noindex, nofollow",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}
