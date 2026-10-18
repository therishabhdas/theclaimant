import { getInspectReport } from "../../../lib/inspect/diagnostics";

export async function GET() {
  const report = await getInspectReport();

  return Response.json(report, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
