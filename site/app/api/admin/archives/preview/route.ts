import { archiveRoute } from "../../../../../lib/server/archive/runtime.ts";
export async function POST(request: Request) {
  return archiveRoute(request, "preview");
}
