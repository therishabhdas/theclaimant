import { randomUUID } from "node:crypto";
import { resolveGlobalWorldTurn } from "../../../../../lib/game/turn-service";
import { isAuthorizedGameWorkerRequest } from "../../../../../lib/game/worker-auth";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorizedGameWorkerRequest(
    request.headers.get("authorization"),
    process.env.GAME_WORKER_SECRET,
  )) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await resolveGlobalWorldTurn(`worker:${randomUUID()}`);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(
      "Unable to process the background world-turn resolution:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json({ error: "World-turn resolution failed." }, { status: 500 });
  }
}
