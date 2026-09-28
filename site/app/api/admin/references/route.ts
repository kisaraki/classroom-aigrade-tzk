import { referenceRoute } from "../../../../lib/server/references/runtime.ts";
export async function GET(request: Request) {
  return referenceRoute(request, "list");
}
export async function POST(request: Request) {
  return referenceRoute(request, "upload");
}
