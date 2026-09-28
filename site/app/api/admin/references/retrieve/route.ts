import { referenceRoute } from "../../../../../lib/server/references/runtime.ts";
export async function POST(request: Request) {
  return referenceRoute(request, "retrieve");
}
