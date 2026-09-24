import { examRoute } from "../../../../../lib/server/exams/runtime.ts";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return examRoute(request, "read", (await context.params).id);
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return examRoute(request, "schedule", (await context.params).id);
}
