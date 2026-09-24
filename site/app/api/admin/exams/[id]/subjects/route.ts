import { examRoute } from "../../../../../../lib/server/exams/runtime.ts";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return examRoute(request, "subject", (await context.params).id);
}
