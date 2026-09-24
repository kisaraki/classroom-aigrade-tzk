import { examRoute } from "../../../../../lib/server/exams/runtime.ts";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return examRoute(request, "participation", (await context.params).id);
}
