export async function GET() {
  return Response.json(
    { status: 'ok', service: 'unask' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
