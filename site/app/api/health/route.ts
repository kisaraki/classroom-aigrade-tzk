export function GET() {
  return Response.json(
    { status: "ok", phase: "3A" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
