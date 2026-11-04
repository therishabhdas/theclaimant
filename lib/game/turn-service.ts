import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  inferStructuredGameTurn,
  inferStructuredWorldTurnResolution,
} from "../ai/groq";
import type { GameAction } from "./engine";
import {
  GameActionValidationError,
  parseStructuredGameTurn,
  simulateSimultaneousWorldTurn,
  type DiplomacyRelationType,
  type EngineDiplomacyRecord,
  type EngineJourney,
  type EngineMusterOrder,
  type EngineRoute,
  type EngineSnapshot,
  type EngineWar,
} from "./engine";
import {
  loadGroqCharacterPrompts,
  loadGroqGamePrompt,
  loadGroqWorldTurnResolutionPrompt,
} from "./events";

type DatabaseRow = Record<string, unknown>;
type DatabaseResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
};

type TurnCommit = {
  turnNumber: number;
  revision: number;
  resolutionStatus: string;
  deadlineAt: string;
  idempotent: boolean;
};

export class StaleGameStateError extends Error {
  constructor() {
    super("The world changed while this turn was being processed. Please submit it again.");
    this.name = "StaleGameStateError";
  }
}

export class GamePlanningClosedError extends Error {
  constructor(message = "The planning window for this world turn is closed.") {
    super(message);
    this.name = "GamePlanningClosedError";
  }
}

export class GameOrderAlreadySubmittedError extends Error {
  constructor(message = "An order has already been submitted for this world turn.") {
    super(message);
    this.name = "GameOrderAlreadySubmittedError";
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function readRows(
  query: PromiseLike<DatabaseResponse>,
  context: string,
): Promise<DatabaseRow[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Unable to load ${context}: ${error.message}`);
  if (data === null) throw new Error(`Supabase returned no data while loading ${context}.`);
  return data as DatabaseRow[];
}

function numberField(row: DatabaseRow, key: string, context: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`The ${context} record has an invalid ${key}.`);
  }
  return value;
}

function nullableNumberField(row: DatabaseRow, key: string, context: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`The ${context} record has an invalid ${key}.`);
  }
  return value;
}

function stringField(row: DatabaseRow, key: string, context: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`The ${context} record has an invalid ${key}.`);
  }
  return value;
}

function nullableStringField(row: DatabaseRow, key: string, context: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`The ${context} record has an invalid ${key}.`);
  }
  return value;
}

function nullableBooleanField(row: DatabaseRow, key: string, context: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "boolean") {
    throw new Error(`The ${context} record has an invalid ${key}.`);
  }
  return value;
}

async function loadEngineSnapshot(
  userId: string | null,
  client: ReturnType<typeof getAdminClient>,
): Promise<{ snapshot: EngineSnapshot; characterId: number | null }> {
  const [assignmentRows, stateRows, characterRows, assignments, houses, routeRows,
    routeLegRows, edgeRows, journeyRows, participantRows, estimateRows, ruleRows, musterRows, diplomacyRows,
    warRows, warParticipantRows] = await Promise.all([
    userId === null
      ? Promise.resolve([])
      : readRows(
          client.from("user_character_assignments").select("character_id").eq("user_id", userId),
          "the player's character assignment",
        ),
    readRows(
      client.from("world_state").select("turn_number, elapsed_days, gameplay_revision").eq("id", 1),
      "the current world state",
    ),
    readRows(
      client.from("playable_characters")
        .select("id, current_location_id, current_house_id, starting_house_id"),
      "playable characters",
    ),
    readRows(
      client.from("user_character_assignments").select("character_id"),
      "character assignments",
    ),
    readRows(client.from("houses").select("id, region_id"), "houses"),
    readRows(
      client.from("travel_route_options")
        .select("id, origin_location_id, destination_location_id, catalog_status, mounted_party_days, foot_party_days"),
      "travel route options",
    ),
    readRows(
      client.from("travel_route_option_legs")
        .select("route_option_id, route_edge_id"),
      "travel route legs",
    ),
    readRows(
      client.from("travel_route_edges")
        .select("id, availability_status, is_blockaded, is_destroyed, requires_permission, seasonal_status"),
      "travel route conditions",
    ),
    readRows(
      client.from("travel_journeys")
        .select("id, destination_location_id, status, elapsed_days, estimated_duration_days")
        .in("status", ["planned", "awaiting_permission", "ready", "in_progress", "delayed"]),
      "active journeys",
    ),
    readRows(
      client.from("travel_journey_participants")
        .select("journey_id, character_id, participation_status")
        .in("participation_status", ["travelling", "joined"]),
      "journey participants",
    ),
    readRows(
      client.from("regional_military_estimates")
        .select("region_id, force_type, maximum_strength"),
      "regional military estimates",
    ),
    readRows(
      client.from("military_muster_rules")
        .select("id, region_id, force_type, minimum_days, maximum_days"),
      "military muster rules",
    ),
    readRows(
      client.from("game_muster_orders")
        .select("id, house_id, region_id, force_size, required_days, elapsed_days, status"),
      "military muster orders",
    ),
    readRows(
      client.from("diplomacy_records")
        .select("id, relation_type, status, house_a_id, house_b_id, character_a_id, character_b_id"),
      "diplomacy records",
    ),
    readRows(
      client.from("world_wars").select("id, name, status"),
      "wars",
    ),
    readRows(
      client.from("war_participants").select("war_id, house_id, side"),
      "war participants",
    ),
  ]);

  if (userId !== null && assignmentRows.length !== 1) {
    throw new Error("The authenticated player must have exactly one assigned character.");
  }
  if (stateRows.length !== 1) {
    throw new Error("The world state record has not been initialized.");
  }
  const characterId = assignmentRows.length > 0
    ? numberField(assignmentRows[0], "character_id", "assignment")
    : null;
  const assignmentByCharacter = new Map<number, boolean>(
    assignments.map((assignment) => [
      numberField(assignment, "character_id", "assignment"),
      true,
    ]),
  );
  const characters = characterRows.map((row) => {
    const id = numberField(row, "id", "character");
    const currentHouseId = nullableNumberField(row, "current_house_id", "character")
      ?? nullableNumberField(row, "starting_house_id", "character");
    return {
      id,
      currentLocationId: nullableNumberField(row, "current_location_id", "character"),
      currentHouseId,
      controller: id === characterId
        ? "player" as const
        : assignmentByCharacter.has(id)
          ? "other" as const
          : "ai" as const,
    };
  });
  if (
    characterId !== null &&
    !characters.some((character) => character.id === characterId)
  ) {
    throw new Error("The player's assigned character is missing from the roster.");
  }

  const activeCharacterIds = new Set(
    participantRows
      .filter((row) => ["travelling", "joined"].includes(stringField(row, "participation_status", "journey participant")))
      .map((row) => nullableNumberField(row, "character_id", "journey participant"))
      .filter((id): id is number => id !== null),
  );
  const journeys: EngineJourney[] = journeyRows.flatMap((row) => {
    const id = numberField(row, "id", "journey");
    const characterIds = participantRows
      .filter(
        (entry) =>
          numberField(entry, "journey_id", "journey participant") === id &&
          nullableNumberField(entry, "character_id", "journey participant") !== null,
      )
      .map((entry) => nullableNumberField(entry, "character_id", "journey participant"))
      .filter((participantId): participantId is number => participantId !== null);
    if (characterIds.length === 0) return [];
    const status = stringField(row, "status", "journey");
    if (!["planned", "awaiting_permission", "ready", "in_progress", "delayed"].includes(status)) {
      throw new Error(`Journey ${id} has an unsupported status.`);
    }
    const estimatedDays = nullableNumberField(row, "estimated_duration_days", "journey");
    if (
      ["in_progress", "delayed"].includes(status) &&
      (estimatedDays === null || estimatedDays < 1)
    ) {
      throw new Error(`Active journey ${id} has no duration for deterministic turn processing.`);
    }
    return [{
      id,
      characterIds,
      destinationLocationId: numberField(row, "destination_location_id", "journey"),
      status: status as EngineJourney["status"],
      elapsedDays: numberField(row, "elapsed_days", "journey"),
      estimatedDays: estimatedDays ?? 0,
    }];
  });
  for (const characterIdWithJourney of activeCharacterIds) {
    if (!journeys.some((journey) => journey.characterIds.includes(characterIdWithJourney))) {
      throw new Error(`An active journey for character ${characterIdWithJourney} is incomplete.`);
    }
  }

  const routes: EngineRoute[] = routeRows.map((row) => {
    const catalogStatus = stringField(row, "catalog_status", "travel route");
    if (catalogStatus !== "available" && catalogStatus !== "unavailable") {
      throw new Error("A travel route has an unsupported catalog status.");
    }
    const routeId = numberField(row, "id", "travel route");
    const routeLegs = routeLegRows.filter(
      (leg) => numberField(leg, "route_option_id", "travel route leg") === routeId,
    );
    if (catalogStatus === "available" && routeLegs.length === 0) {
      throw new Error(`Available route ${routeId} has no route legs.`);
    }
    const routeEdges = routeLegs.map((leg) => {
      const edgeId = numberField(leg, "route_edge_id", "travel route leg");
      const edge = edgeRows.find(
        (candidate) => numberField(candidate, "id", "travel route condition") === edgeId,
      );
      if (!edge) throw new Error(`Route leg ${edgeId} references a missing route edge.`);
      const availability = stringField(edge, "availability_status", "travel route condition");
      const seasonalStatus = stringField(edge, "seasonal_status", "travel route condition");
      if (!["open", "restricted", "closed", "unknown"].includes(availability)) {
        throw new Error(`Route edge ${edgeId} has an unsupported availability status.`);
      }
      return {
        blocked:
          availability === "closed" ||
          availability === "restricted" ||
          seasonalStatus === "closed" ||
          nullableBooleanField(edge, "is_blockaded", "travel route condition") === true ||
          nullableBooleanField(edge, "is_destroyed", "travel route condition") === true,
        permissionRequired:
          nullableBooleanField(edge, "requires_permission", "travel route condition") === true,
      };
    });
    return {
      id: routeId,
      originLocationId: numberField(row, "origin_location_id", "travel route"),
      destinationLocationId: numberField(row, "destination_location_id", "travel route"),
      catalogStatus,
      blocked: routeEdges.some((edge) => edge.blocked),
      permissionRequired: routeEdges.some((edge) => edge.permissionRequired),
      partyDays: {
        mounted_party: nullableNumberField(row, "mounted_party_days", "travel route"),
        foot_party: nullableNumberField(row, "foot_party_days", "travel route"),
      },
    };
  });

  const diplomacy: EngineDiplomacyRecord[] = diplomacyRows.map((row) => {
    const relationType = stringField(row, "relation_type", "diplomacy record");
    const status = stringField(row, "status", "diplomacy record");
    const supportedRelations: DiplomacyRelationType[] = [
      "alliance", "rivalry", "marriage", "hostage", "treaty", "promise",
      "fealty", "neutrality", "other",
    ];
    if (!supportedRelations.includes(relationType as DiplomacyRelationType)) {
      throw new Error("A diplomacy record has an unsupported relation type.");
    }
    if (!["proposed", "active", "broken", "fulfilled", "ended"].includes(status)) {
      throw new Error("A diplomacy record has an unsupported status.");
    }
    return {
      id: numberField(row, "id", "diplomacy record"),
      relationType: relationType as DiplomacyRelationType,
      status: status as EngineDiplomacyRecord["status"],
      houseAId: nullableNumberField(row, "house_a_id", "diplomacy record"),
      houseBId: nullableNumberField(row, "house_b_id", "diplomacy record"),
      characterAId: nullableNumberField(row, "character_a_id", "diplomacy record"),
      characterBId: nullableNumberField(row, "character_b_id", "diplomacy record"),
    };
  });
  const wars: EngineWar[] = warRows.map((row) => {
    const warId = numberField(row, "id", "war");
    const participants = warParticipantRows
      .filter((participant) => numberField(participant, "war_id", "war participant") === warId)
      .map((participant) => ({
        houseId: numberField(participant, "house_id", "war participant"),
        side: nullableStringField(participant, "side", "war participant"),
      }));
    const status = stringField(row, "status", "war");
    if (!["active", "ended", "suspended", "rumored"].includes(status)) {
      throw new Error("A war has an unsupported status.");
    }
    return {
      id: warId,
      name: stringField(row, "name", "war"),
      status: status as EngineWar["status"],
      participants,
    };
  });

  const state = stateRows[0];
  const snapshot: EngineSnapshot = {
    revision: numberField(state, "gameplay_revision", "world state"),
    turnNumber: numberField(state, "turn_number", "world state"),
    elapsedDays: numberField(state, "elapsed_days", "world state"),
    characters,
    houses: houses.map((row) => ({
      id: numberField(row, "id", "house"),
      regionId: nullableNumberField(row, "region_id", "house"),
    })),
    routes,
    journeys,
    regionalEstimates: estimateRows.map((row) => ({
      regionId: numberField(row, "region_id", "regional military estimate"),
      forceType: stringField(row, "force_type", "regional military estimate"),
      maximumStrength: nullableNumberField(row, "maximum_strength", "regional military estimate"),
    })),
    musterRules: ruleRows.map((row) => ({
      id: numberField(row, "id", "muster rule"),
      regionId: nullableNumberField(row, "region_id", "muster rule"),
      forceType: stringField(row, "force_type", "muster rule"),
      minimumDays: numberField(row, "minimum_days", "muster rule"),
      maximumDays: numberField(row, "maximum_days", "muster rule"),
    })),
    musterOrders: musterRows.map((row): EngineMusterOrder => {
      const status = stringField(row, "status", "muster order");
      if (!["mustering", "ready", "cancelled"].includes(status)) {
        throw new Error("A muster order has an unsupported status.");
      }
      return {
        id: numberField(row, "id", "muster order"),
        houseId: numberField(row, "house_id", "muster order"),
        regionId: numberField(row, "region_id", "muster order"),
        forceSize: numberField(row, "force_size", "muster order"),
        requiredDays: numberField(row, "required_days", "muster order"),
        elapsedDays: numberField(row, "elapsed_days", "muster order"),
        status: status as EngineMusterOrder["status"],
      };
    }),
    diplomacy,
    wars,
  };
  return { snapshot, characterId };
}

function objectField(value: unknown, context: string): DatabaseRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The database returned an invalid ${context}.`);
  }
  return value as DatabaseRow;
}

function rpcNumber(row: DatabaseRow, key: string, context: string) {
  return numberField(row, key, context);
}

function rpcString(row: DatabaseRow, key: string, context: string) {
  return stringField(row, key, context);
}

function parseStoredAction(value: unknown, actorId: number): GameAction {
  const parsed = parseStructuredGameTurn({
    narration: "Stored order.",
    eventTitle: "Stored order",
    eventType: "other",
    eventSummary: "Stored order.",
    actions: value,
  });
  if (parsed.actions.length !== 1 || parsed.actions[0].actorCharacterId !== actorId) {
    throw new Error(`The stored order for character ${actorId} is invalid.`);
  }
  return parsed.actions[0];
}

function raiseRpcError(message: string, context: string): never {
  if (message.includes("GAME_STALE_STATE")) throw new StaleGameStateError();
  if (message.includes("GAME_DEADLINE") || message.includes("GAME_TURN_CLOSED")) {
    throw new GamePlanningClosedError();
  }
  if (message.includes("GAME_ALREADY_SUBMITTED")) {
    throw new GameOrderAlreadySubmittedError();
  }
  if (message.includes("Request ID was already used")) {
    throw new GameOrderAlreadySubmittedError(
      "The request ID was already used for a different order.",
    );
  }
  if (message.includes("GAME_INVALID_ACTION")) {
    throw new GameActionValidationError([message.split(": ").slice(1).join(": ")]);
  }
  throw new Error(`${context}: ${message}`);
}

async function inferNpcOrders(
  client: ReturnType<typeof getAdminClient>,
  turnNumber: number,
  npcRows: DatabaseRow[],
) {
  const pending = npcRows.filter((row) => row.action_data === null).slice(0, 4);
  const storedOrders = new Map<number, GameAction[]>();
  for (const row of npcRows) {
    const actorId = numberField(row, "character_id", "NPC turn order");
    if (row.action_data !== null) {
      storedOrders.set(actorId, [parseStoredAction(row.action_data, actorId)]);
    }
  }
  if (pending.length === 0) return storedOrders;

  const prompts = await loadGroqCharacterPrompts(
    pending.map((row) => ({
      actorCharacterId: numberField(row, "character_id", "NPC turn order"),
      playerRequest:
        `Choose exactly one plausible primary order for this AI-controlled character ` +
        `during shared world turn ${turnNumber}. Use only the character's own known ` +
        `facts and current situation. Do not invent a successful outcome.`,
    })),
  );
  const pendingActors = pending.map((row) => numberField(row, "character_id", "NPC turn order"));
  const inferred = new Map<number, GameAction[]>();
  const concurrency = 4;
  for (let offset = 0; offset < pendingActors.length; offset += concurrency) {
    const batch = pendingActors.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (actorId) => {
      const prompt = prompts.get(actorId);
      if (!prompt) throw new Error(`The AI prompt for character ${actorId} was not loaded.`);
      const plan = await inferStructuredGameTurn(prompt);
      if (plan.actions.length !== 1 || plan.actions[0].actorCharacterId !== actorId) {
        throw new GameActionValidationError([
          `The AI did not return exactly one order for character ${actorId}.`,
        ]);
      }
      return [actorId, plan.actions] as const;
    }));
    for (const [actorId, actions] of results) inferred.set(actorId, actions);
  }

  const savedOrders = [...inferred.entries()].map(([actorCharacterId, actions]) => ({
    actorCharacterId,
    actionData: actions,
  }));
  const { error } = await client.rpc("save_npc_game_orders", {
    p_turn_number: turnNumber,
    p_orders: savedOrders,
  });
  if (error) raiseRpcError(error.message, "Unable to save AI orders");

  for (const [actorId, actions] of inferred) storedOrders.set(actorId, actions);
  return storedOrders;
}

export async function resolveGlobalWorldTurn(): Promise<{
  resolved: boolean;
  turnNumber: number;
}> {
  const client = getAdminClient();
  const { data: claimData, error: claimError } = await client.rpc(
    "claim_game_turn_resolution",
  );
  if (claimError) raiseRpcError(claimError.message, "Unable to claim world-turn resolution");
  const claim = objectField(claimData, "world-turn claim");
  const turnNumber = rpcNumber(claim, "turnNumber", "world-turn claim");
  if (claim.claimed !== true) return { resolved: false, turnNumber };
  const revision = rpcNumber(claim, "revision", "world-turn claim");

  try {
    const { snapshot } = await loadEngineSnapshot(null, client);
    if (snapshot.revision !== revision || snapshot.turnNumber + 1 !== turnNumber) {
      throw new StaleGameStateError();
    }
    const [participantRows, playerOrderRows, npcRows] = await Promise.all([
      readRows(client.from("gameplay_turn_participants")
        .select("user_id, character_id")
        .eq("world_state_id", 1)
        .eq("turn_number", turnNumber), "world-turn participants"),
      readRows(client.from("gameplay_turn_orders")
        .select("user_id, character_id, action_data, player_request, resolution_status")
        .eq("world_state_id", 1)
        .eq("turn_number", turnNumber), "player world-turn orders"),
      readRows(client.from("gameplay_npc_orders")
        .select("character_id, action_data, resolution_status")
        .eq("world_state_id", 1)
        .eq("turn_number", turnNumber), "AI world-turn orders"),
    ]);
    if (participantRows.length === 0) {
      throw new Error("The world turn cannot resolve without a player participant.");
    }

    const playerOrders = new Map(
      playerOrderRows.map((row) => [
        numberField(row, "character_id", "player world-turn order"),
        row,
      ] as const),
    );
    const allOrders: Array<{
      actorCharacterId: number;
      controller: "player" | "ai";
      action: GameAction;
    }> = [];
    for (const participant of participantRows) {
      const actorId = numberField(participant, "character_id", "world-turn participant");
      const storedOrder = playerOrders.get(actorId);
      allOrders.push({
        actorCharacterId: actorId,
        controller: "player",
        action: storedOrder
          ? parseStoredAction(storedOrder.action_data, actorId)
          : {
              type: "wait",
              actorCharacterId: actorId,
              reason: "No order was submitted before the planning deadline.",
            },
      });
    }

    const npcOrders = await inferNpcOrders(client, turnNumber, npcRows);
    if (npcOrders.size < npcRows.length) {
      const { error: releaseError } = await client.rpc("release_game_turn_resolution", {
        p_turn_number: turnNumber,
      });
      if (releaseError) {
        throw new Error(
          `NPC orders were saved, but the world-turn resolution lease could not be released: ${releaseError.message}`,
        );
      }
      return { resolved: false, turnNumber };
    }
    for (const [actorId, actions] of npcOrders) {
      allOrders.push({
        actorCharacterId: actorId,
        controller: "ai",
        action: actions[0],
      });
    }

    const prompt = await loadGroqWorldTurnResolutionPrompt({
      worldTurn: turnNumber,
      orders: allOrders,
    });
    const resolution = await inferStructuredWorldTurnResolution(
      prompt,
      allOrders.map((order) => order.actorCharacterId),
    );
    const decisionByActor = new Map(
      resolution.decisions.map((decision) => [decision.actorCharacterId, decision]),
    );
    const resolutionSnapshot = structuredClone(snapshot);
    for (const order of allOrders) {
      const actor = resolutionSnapshot.characters.find(
        (character) => character.id === order.actorCharacterId,
      );
      if (!actor) {
        throw new Error(`Character ${order.actorCharacterId} is missing from the world snapshot.`);
      }
      actor.controller = order.controller;
    }
    const simulation = simulateSimultaneousWorldTurn(
      resolutionSnapshot,
      allOrders.map((order) => {
        const decision = decisionByActor.get(order.actorCharacterId);
        if (!decision) {
          throw new Error(`The master resolution omitted character ${order.actorCharacterId}.`);
        }
        return {
          action: order.action,
          decision: decision.decision,
          reason: decision.reason,
        };
      }),
    );
    const validatedDecisions = simulation.orderResults.map((result) => ({
      actorCharacterId: result.actorCharacterId,
      decision: result.status === "rejected" ? "reject" : "accept",
      reason: result.reason,
    }));
    const { data: resolutionData, error: resolutionError } = await client.rpc(
      "resolve_game_turn",
      {
        p_turn_number: turnNumber,
        p_expected_revision: revision,
        p_decisions: validatedDecisions,
        p_event_title: resolution.eventTitle,
        p_event_type: resolution.eventType,
        p_canonical_summary: resolution.canonicalSummary,
      },
    );
    if (resolutionError) {
      raiseRpcError(resolutionError.message, "Unable to commit the resolved world turn");
    }
    const committed = objectField(resolutionData, "resolved world turn");
    return {
      resolved: committed.status === "resolved",
      turnNumber: rpcNumber(committed, "resolvedTurn", "resolved world turn"),
    };
  } catch (error) {
    const { error: releaseError } = await client.rpc("release_game_turn_resolution", {
      p_turn_number: turnNumber,
    });
    if (releaseError) {
      throw new Error(
        `World-turn resolution failed and its lease could not be released: ${releaseError.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function processPlayerTurn(input: {
  userId: string;
  requestId: string;
  playerRequest: string;
}): Promise<TurnCommit> {
  const client = getAdminClient();
  const existingRows = await readRows(
    client.from("gameplay_turn_orders")
      .select("character_id, turn_number, resolution_status, player_request")
      .eq("request_id", input.requestId)
      .eq("user_id", input.userId),
    "the prior order request",
  );
  if (existingRows[0]) {
    if (stringField(existingRows[0], "player_request", "player order") !== input.playerRequest) {
      throw new GameOrderAlreadySubmittedError(
        "The request ID was already used for a different order.",
      );
    }
    await resolveGlobalWorldTurn();
    const [orderRows, stateRows] = await Promise.all([
      readRows(client.from("gameplay_turn_orders")
        .select("resolution_status")
        .eq("request_id", input.requestId)
        .eq("user_id", input.userId), "the prior order status"),
      readRows(client.from("world_state")
        .select("gameplay_revision, planning_deadline_at")
        .eq("id", 1), "the current world state"),
    ]);
    if (orderRows.length !== 1 || stateRows.length !== 1) {
      throw new Error("The prior order or current world state is missing.");
    }
    return {
      turnNumber: numberField(existingRows[0], "turn_number", "player order"),
      revision: numberField(stateRows[0], "gameplay_revision", "world state"),
      resolutionStatus: stringField(orderRows[0], "resolution_status", "player order"),
      deadlineAt: stringField(stateRows[0], "planning_deadline_at", "world state"),
      idempotent: true,
    };
  }

  const { snapshot, characterId } = await loadEngineSnapshot(input.userId, client);
  if (characterId === null) {
    throw new Error("The authenticated player has no assigned character.");
  }
  const prompt = await loadGroqGamePrompt(input.userId, input.playerRequest);
  const plan = await inferStructuredGameTurn(prompt);
  if (plan.actions.length !== 1 || plan.actions[0].actorCharacterId !== characterId) {
    throw new GameActionValidationError([
      "The AI must return exactly one primary order for the player's assigned character.",
    ]);
  }
  const simulation = simulateSimultaneousWorldTurn(snapshot, [{
    action: plan.actions[0],
    decision: "accept",
    reason: "Proposed player order.",
  }]);
  if (simulation.orderResults[0].status === "rejected") {
    throw new GameActionValidationError([simulation.orderResults[0].reason]);
  }

  const { data, error } = await client.rpc("submit_game_order", {
    p_user_id: input.userId,
    p_character_id: characterId,
    p_request_id: input.requestId,
    p_expected_revision: snapshot.revision,
    p_player_request: input.playerRequest,
    p_action_data: plan.actions,
  });
  if (error?.message.includes("GAME_DEADLINE")) {
    await resolveGlobalWorldTurn();
    throw new GamePlanningClosedError();
  }
  if (error) raiseRpcError(error.message, "Unable to submit the world-turn order");
  const result = objectField(data, "submitted player order");
  const submission: TurnCommit = {
    turnNumber: rpcNumber(result, "turnNumber", "submitted player order"),
    revision: snapshot.revision,
    resolutionStatus: rpcString(result, "resolutionStatus", "submitted player order"),
    deadlineAt: rpcString(result, "deadlineAt", "submitted player order"),
    idempotent: result.idempotent === true,
  };
  if (
    typeof result.submittedCount === "number" &&
    typeof result.requiredCount === "number" &&
    result.submittedCount === result.requiredCount
  ) {
    const resolution = await resolveGlobalWorldTurn();
    if (resolution.resolved) {
      const statusRows = await readRows(client.from("gameplay_turn_orders")
        .select("resolution_status")
        .eq("request_id", input.requestId)
        .eq("user_id", input.userId), "the resolved player order");
      if (statusRows.length !== 1) throw new Error("The resolved player order is missing.");
      submission.resolutionStatus = stringField(
        statusRows[0],
        "resolution_status",
        "resolved player order",
      );
    }
  }
  return submission;
}

export async function getPlayerTurnStatus(userId: string): Promise<{
  turnNumber: number;
  phase: string;
  deadlineAt: string;
  participating: boolean;
  ownOrderStatus: string;
  previousTurnStatus: string | null;
}> {
  const client = getAdminClient();
  const [assignmentRows, stateRows] = await Promise.all([
    readRows(client.from("user_character_assignments")
      .select("character_id")
      .eq("user_id", userId), "the player's character assignment"),
    readRows(client.from("world_state")
      .select("turn_number, turn_phase, planning_deadline_at")
      .eq("id", 1), "the current world state"),
  ]);
  if (assignmentRows.length !== 1 || stateRows.length !== 1) {
    throw new Error("The player assignment or world state is not initialized.");
  }
  const characterId = numberField(assignmentRows[0], "character_id", "assignment");
  const world = stateRows[0];
  const completedTurn = numberField(world, "turn_number", "world state");
  const turnNumber = completedTurn + 1;
  const [participantRows, currentRows, previousRows] = await Promise.all([
    readRows(client.from("gameplay_turn_participants")
      .select("character_id")
      .eq("world_state_id", 1)
      .eq("turn_number", turnNumber)
      .eq("user_id", userId)
      .eq("character_id", characterId), "current-turn participation"),
    readRows(client.from("gameplay_turn_orders")
      .select("resolution_status")
      .eq("world_state_id", 1)
      .eq("turn_number", turnNumber)
      .eq("user_id", userId), "the player's current order"),
    completedTurn > 0
      ? readRows(client.from("gameplay_turn_orders")
          .select("resolution_status")
          .eq("world_state_id", 1)
          .eq("turn_number", completedTurn)
          .eq("user_id", userId), "the player's previous order")
      : Promise.resolve([]),
  ]);
  const participating = participantRows.length === 1;
  const phase = stringField(world, "turn_phase", "world state");
  if (phase !== "planning" && phase !== "resolving") {
    throw new Error("The world state has an unsupported turn phase.");
  }
  return {
    turnNumber,
    phase,
    deadlineAt: stringField(world, "planning_deadline_at", "world state"),
    participating,
    ownOrderStatus: !participating
      ? "not_participating"
      : currentRows.length > 0
        ? stringField(currentRows[0], "resolution_status", "player order")
        : "not_submitted",
    previousTurnStatus: previousRows.length > 0
      ? stringField(previousRows[0], "resolution_status", "previous player order")
      : null,
  };
}
