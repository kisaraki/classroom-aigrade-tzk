import { lifecycleRoute } from "../../../../../../../lib/server/lifecycle/runtime.ts";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return lifecycleRoute(request, "retry", (await context.params).id);
}
