import { aiJobsRoute } from "../../../../../lib/server/ai/runtime.ts";
export async function GET(request: Request) {
  return aiJobsRoute(request);
}
export async function POST(request: Request) {
  return aiJobsRoute(request);
}
