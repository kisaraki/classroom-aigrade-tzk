export function GET() {
  return Response.json(
    { status: "ok", phase: 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
