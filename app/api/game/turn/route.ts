import { cookies } from "next/headers";
import { createClient } from "../../../../lib/supabase/server";
import { GameActionValidationError } from "../../../../lib/game/engine";
import {
  StaleGameStateError,
  processPlayerTurn,
} from "../../../../lib/game/turn-service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "same-site";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "The request origin could not be verified." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Send the turn as application/json." }, { status: 415 });
  }

  const supabase = createClient(await cookies());
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    if (authError) {
      console.error("Unable to authenticate a gameplay turn:", authError.message);
    }
    return Response.json({ error: "Sign in before submitting a game turn." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    Object.keys(body).length !== 2 ||
    typeof body.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId) ||
    typeof body.playerRequest !== "string" ||
    body.playerRequest.trim().length === 0 ||
    body.playerRequest.length > 6000
  ) {
    return Response.json(
      { error: "Provide a UUID requestId and a playerRequest of 1-6000 characters." },
      { status: 400 },
    );
  }

  try {
    const result = await processPlayerTurn({
      userId: user.id,
      requestId: body.requestId,
      playerRequest: body.playerRequest,
    });
    return Response.json({
      turnId: result.commit.turnId,
      turnNumber: result.commit.turnNumber,
      revision: result.commit.revision,
      eventId: result.commit.eventId,
      narration: result.commit.narration,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof GameActionValidationError) {
      return Response.json({ error: "The proposed actions did not pass validation.", details: error.errors }, {
        status: 422,
      });
    }
    if (error instanceof StaleGameStateError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error(
      "Unable to process the gameplay turn:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json({ error: "The game turn could not be processed. Please try again." }, {
      status: 500,
    });
  }
}
