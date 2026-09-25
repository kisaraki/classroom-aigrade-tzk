import { publicationRoute } from "../../../../../../../lib/server/exams/publication-runtime.ts";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return publicationRoute(request, "confirm", (await context.params).id);
}
