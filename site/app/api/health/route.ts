export function GET() {
  return Response.json(
    { status: "ok", phase: 2 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
