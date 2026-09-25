import { archiveRoute } from "../../../../../lib/server/archive/runtime.ts";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return archiveRoute(request, "read", (await context.params).id);
}
