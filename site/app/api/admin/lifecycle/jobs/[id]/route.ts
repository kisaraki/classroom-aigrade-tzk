import { lifecycleRoute } from "../../../../../../lib/server/lifecycle/runtime.ts";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return lifecycleRoute(request, "read", (await context.params).id);
}
