import { lifecycleRoute } from "../../../../../lib/server/lifecycle/runtime.ts";
export async function GET(request: Request) {
  return lifecycleRoute(request, "list");
}
