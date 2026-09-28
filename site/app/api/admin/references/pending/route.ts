import { referenceRoute } from "../../../../../lib/server/references/runtime.ts";
export async function GET(request: Request) {
  return referenceRoute(request, "pending");
}
