import { aiSettingsRoute } from "../../../../../lib/server/ai/runtime.ts";
export async function GET(request: Request) {
  return aiSettingsRoute(request);
}
export async function POST(request: Request) {
  return aiSettingsRoute(request);
}
