import { examRoute } from "../../../../lib/server/exams/runtime.ts";
export async function POST(request: Request) {
  return examRoute(request, "create");
}
