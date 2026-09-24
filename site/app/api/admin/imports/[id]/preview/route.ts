import { importRoute } from "../../../../../../lib/server/imports/runtime.ts";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return importRoute(request, "preview", (await context.params).id);
}
