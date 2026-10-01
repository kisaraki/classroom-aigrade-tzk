export function GET(): Response {
  return Response.json(
    { error: "AUTH_PROVIDER_REMOVED" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
export const POST = GET;
