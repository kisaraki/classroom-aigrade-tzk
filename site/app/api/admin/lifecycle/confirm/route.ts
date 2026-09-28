import { lifecycleRoute } from "../../../../../lib/server/lifecycle/runtime.ts";
export async function POST(request: Request) {
  return lifecycleRoute(request, "confirm");
}
