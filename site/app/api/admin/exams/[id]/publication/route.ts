import { publicationRoute } from "../../../../../../lib/server/exams/publication-runtime.ts";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return publicationRoute(request, "read", (await context.params).id);
}
