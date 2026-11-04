import { cookies } from "next/headers";
import { createClient } from "../../../../lib/supabase/server";
import { GameActionValidationError } from "../../../../lib/game/engine";
import {
  GameOrderAlreadySubmittedError,
  GameOrderRateLimitError,
  GameNotAssignedError,
  GamePlanningClosedError,
  StaleGameStateError,
  getPlayerTurnStatus,
  processPlayerTurn,
} from "../../../../lib/game/turn-service";

export const maxDuration = 300;
const MAX_BODY_BYTES = 32_000;

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

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    throw new RangeError("The request body is too large.");
  }
  if (!request.body) throw new SyntaxError("The request body is empty.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("The request body is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
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
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RangeError) {
      return Response.json({ error: error.message }, { status: 413 });
    }
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
      turnNumber: result.turnNumber,
      revision: result.revision,
      resolutionStatus: result.resolutionStatus,
      deadlineAt: result.deadlineAt,
      idempotent: result.idempotent,
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
    if (error instanceof GamePlanningClosedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof GameOrderAlreadySubmittedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof GameNotAssignedError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof GameOrderRateLimitError) {
      return Response.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": "600" } },
      );
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

export async function GET(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "The request origin could not be verified." }, { status: 403 });
  }
  const supabase = createClient(await cookies());
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    if (error) console.error("Unable to authenticate a gameplay status request:", error.message);
    return Response.json({ error: "Sign in before checking game-turn status." }, { status: 401 });
  }
  try {
    const status = await getPlayerTurnStatus(user.id);
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (statusError) {
    if (statusError instanceof GameNotAssignedError) {
      return Response.json({ error: statusError.message }, { status: 403 });
    }
    console.error(
      "Unable to load gameplay turn status:",
      statusError instanceof Error ? statusError.message : "Unknown error",
    );
    return Response.json({ error: "The game-turn status could not be loaded." }, { status: 500 });
  }
}
