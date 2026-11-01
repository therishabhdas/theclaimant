import { resolveGlobalWorldTurn } from "../../../../lib/game/turn-service";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Scheduled resolution is not configured." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await resolveGlobalWorldTurn();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(
      "Unable to resolve the scheduled world turn:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json({ error: "World-turn resolution failed." }, { status: 500 });
  }
}
