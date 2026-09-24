import { importRoute } from "../../../../../../../lib/server/imports/runtime.ts";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return importRoute(request, "rollback", (await context.params).id);
}
