import { importRoute } from "../../../../../lib/server/imports/runtime.ts";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return importRoute(request, "read", (await context.params).id);
}
