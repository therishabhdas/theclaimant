import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { inferStructuredGameTurn } from "../ai/groq";
import {
  GameActionValidationError,
  simulateGameTurn,
  type DiplomacyRelationType,
  type EngineDiplomacyRecord,
  type EngineJourney,
  type EngineMusterOrder,
  type EngineRoute,
  type EngineSnapshot,
  type EngineWar,
  type StructuredGameTurn,
} from "./engine";
import { loadGroqGamePrompt } from "./events";

type DatabaseRow = Record<string, unknown>;
type DatabaseResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
};

type TurnCommit = {
  turnId: number;
  turnNumber: number;
  revision: number;
  eventId: number;
  narration: string;
};

export class StaleGameStateError extends Error {
  constructor() {
    super("The world changed while this turn was being processed. Please submit it again.");
    this.name = "StaleGameStateError";
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
  userId: string,
  client: ReturnType<typeof getAdminClient>,
): Promise<{ snapshot: EngineSnapshot; characterId: number }> {
  const [assignmentRows, stateRows, characterRows, assignments, houses, routeRows,
    routeLegRows, edgeRows, journeyRows, participantRows, estimateRows, ruleRows, musterRows, diplomacyRows,
    warRows, warParticipantRows] = await Promise.all([
    readRows(
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

  if (assignmentRows.length !== 1) {
    throw new Error("The authenticated player must have exactly one assigned character.");
  }
  if (stateRows.length !== 1) {
    throw new Error("The world state record has not been initialized.");
  }
  const characterId = numberField(assignmentRows[0], "character_id", "assignment");
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
  if (!characters.some((character) => character.id === characterId)) {
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

function readTurnCommit(value: unknown): TurnCommit {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("The database returned an invalid turn result.");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.turnId !== "number" ||
    typeof row.turnNumber !== "number" ||
    typeof row.revision !== "number" ||
    typeof row.eventId !== "number" ||
    typeof row.narration !== "string"
  ) {
    throw new Error("The database returned an incomplete turn result.");
  }
  return {
    turnId: row.turnId,
    turnNumber: row.turnNumber,
    revision: row.revision,
    eventId: row.eventId,
    narration: row.narration,
  };
}

export async function processPlayerTurn(input: {
  userId: string;
  requestId: string;
  playerRequest: string;
}): Promise<{ commit: TurnCommit; plan: StructuredGameTurn }> {
  const client = getAdminClient();
  const existingRows = await readRows(
    client.from("gameplay_turns")
      .select("id, turn_number, gameplay_revision, event_id, narration")
      .eq("request_id", input.requestId)
      .eq("user_id", input.userId),
    "the prior turn request",
  );
  if (existingRows[0]) {
    const existing = existingRows[0];
    return {
      commit: {
        turnId: numberField(existing, "id", "gameplay turn"),
        turnNumber: numberField(existing, "turn_number", "gameplay turn"),
        revision: numberField(existing, "gameplay_revision", "gameplay turn"),
        eventId: numberField(existing, "event_id", "gameplay turn"),
        narration: stringField(existing, "narration", "gameplay turn"),
      },
      plan: {
        narration: stringField(existing, "narration", "gameplay turn"),
        eventTitle: "Turn already processed",
        eventType: "decision",
        eventSummary: "An idempotent request returned its existing result.",
        actions: [],
      },
    };
  }

  const { snapshot, characterId } = await loadEngineSnapshot(input.userId, client);
  const prompt = await loadGroqGamePrompt(input.userId, input.playerRequest);
  const plan = await inferStructuredGameTurn(prompt);
  simulateGameTurn(snapshot, plan);

  const { data, error } = await client.rpc("commit_game_turn", {
    p_user_id: input.userId,
    p_character_id: characterId,
    p_request_id: input.requestId,
    p_expected_revision: snapshot.revision,
    p_player_request: input.playerRequest,
    p_narration: plan.narration,
    p_event_title: plan.eventTitle,
    p_event_type: plan.eventType,
    p_event_summary: plan.eventSummary,
    p_actions: plan.actions,
  });
  if (error) {
    if (error.message.includes("GAME_STALE_STATE")) {
      throw new StaleGameStateError();
    }
    if (error.message.includes("GAME_INVALID_ACTION")) {
      throw new GameActionValidationError([error.message.split(": ").slice(1).join(": ")]);
    }
    throw new Error(`Unable to commit the game turn: ${error.message}`);
  }

  return { commit: readTurnCommit(data), plan };
}
