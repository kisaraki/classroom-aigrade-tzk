import { importRoute } from "../../../../../lib/server/imports/runtime.ts";
export async function POST(request: Request) {
  return importRoute(request, "template");
}
