import { referenceRoute } from "../../../../../../lib/server/references/runtime.ts";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return referenceRoute(request, "cleanup", (await context.params).id);
}
