export function GET() {
  return Response.json(
    { status: "ok", phase: 1 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
