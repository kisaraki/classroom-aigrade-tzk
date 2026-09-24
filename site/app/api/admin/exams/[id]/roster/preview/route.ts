import { examRoute } from "../../../../../../../lib/server/exams/runtime.ts";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return examRoute(request, "preview", (await context.params).id);
}
