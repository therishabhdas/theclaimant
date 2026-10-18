import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const GAME_EVENT_TYPES = [
  "political",
  "military",
  "personal",
  "movement",
  "information",
  "assassination",
  "betrayal",
  "battle",
  "promise",
  "decision",
  "other",
] as const;

export type GameEventType = (typeof GAME_EVENT_TYPES)[number];
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type GameEvent = {
  id: number;
  occurredAt: string;
  recordedAt: string;
  worldDateLabel: string | null;
  eventType: GameEventType;
  title: string;
  canonicalSummary: string;
  publicSummary: string | null;
  characterKnowledge: Record<string, string>;
  affectedCharacterIds: number[];
  affectedHouseIds: number[];
  locationId: number | null;
  location: string | null;
  stateChanges: JsonValue[];
};

export type GameStateChange = {
  changeType: string;
  description: string;
  target:
    | { type: "character"; id: number }
    | { type: "house"; id: number }
    | { type: "location"; id: number }
    | { type: "war"; id: number }
    | { type: "diplomacy"; id: number };
  structuredChange?: Record<string, JsonValue>;
};

export type NewGameEvent = Omit<
  GameEvent,
  "id" | "recordedAt" | "worldDateLabel" | "affectedHouseIds" | "locationId" | "stateChanges"
> & {
  recordedAt?: string;
  worldDateLabel?: string | null;
  affectedHouseIds?: number[];
  locationId?: number | null;
  stateChanges: GameStateChange[];
};

type GameEventRow = {
  id: number;
  occurred_at: string;
  recorded_at: string;
  world_date_label: string | null;
  event_type: GameEventType;
  title: string;
  canonical_summary: string;
  public_summary: string | null;
  character_knowledge: Record<string, string>;
  affected_character_ids: number[];
  affected_house_ids: number[];
  location_id: number | null;
  location: string | null;
  state_changes: JsonValue[];
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

type QueryResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
};

async function readRows(
  query: PromiseLike<QueryResponse>,
  table: string,
): Promise<unknown[]> {
  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load ${table}: ${error.message}`);
  }

  if (data === null) {
    throw new Error(`Supabase returned no data while loading ${table}.`);
  }

  return data;
}

function toGameEvent(row: GameEventRow): GameEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    worldDateLabel: row.world_date_label,
    eventType: row.event_type,
    title: row.title,
    canonicalSummary: row.canonical_summary,
    publicSummary: row.public_summary,
    characterKnowledge: row.character_knowledge,
    affectedCharacterIds: row.affected_character_ids,
    affectedHouseIds: row.affected_house_ids,
    locationId: row.location_id,
    location: row.location,
    stateChanges: row.state_changes,
  };
}

export async function appendGameEvent(event: NewGameEvent): Promise<GameEvent> {
  const { data, error } = await getAdminClient()
    .from("game_events")
    .insert({
      occurred_at: event.occurredAt,
      recorded_at: event.recordedAt,
      world_date_label: event.worldDateLabel,
      event_type: event.eventType,
      title: event.title,
      canonical_summary: event.canonicalSummary,
      public_summary: event.publicSummary,
      character_knowledge: event.characterKnowledge,
      affected_character_ids: event.affectedCharacterIds,
      affected_house_ids: event.affectedHouseIds ?? [],
      location_id: event.locationId ?? null,
      location: event.location,
      state_changes: event.stateChanges,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Unable to append game event: ${error.message}`);
  }

  return toGameEvent(data as GameEventRow);
}

export async function getGameEvents(): Promise<GameEvent[]> {
  const { data, error } = await getAdminClient()
    .from("game_events")
    .select("*")
    .order("occurred_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(`Unable to load the game event log: ${error.message}`);
  }

  return (data as GameEventRow[]).map(toGameEvent);
}

export function buildWorldContext(
  startingReference: string,
  events: GameEvent[],
  campaignState: Record<string, unknown[]> = {},
): string {
  const eventLog = events.map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    worldDateLabel: event.worldDateLabel,
    eventType: event.eventType,
    title: event.title,
    canonicalSummary: event.canonicalSummary,
    publicSummary: event.publicSummary,
    characterKnowledge: event.characterKnowledge,
    affectedCharacterIds: event.affectedCharacterIds,
    affectedHouseIds: event.affectedHouseIds,
    locationId: event.locationId,
    location: event.location,
    stateChanges: event.stateChanges,
  })).sort((first, second) => {
    const timeDifference =
      Date.parse(first.occurredAt) - Date.parse(second.occurredAt);
    return timeDifference || first.id - second.id;
  });

  return [
    "WORLD REFERENCE",
    "The following reference is the authoritative opening world state. It includes confidential canonical information.",
    startingReference.trim(),
    "CHRONOLOGICAL EVENT LOG",
    "Events are ordered by in-world time. Canonical summaries are authoritative; public summaries and character knowledge describe who may know what.",
    JSON.stringify(eventLog, null, 2),
    "CONNECTED CURRENT CAMPAIGN STATE",
    "The relational records below describe the current world, houses, characters, diplomacy, wars, and event links. Null values and empty collections mean the fact has not been established.",
    JSON.stringify(campaignState, null, 2),
  ].join("\n\n");
}

export async function loadWorldContext(playerUserId?: string): Promise<string> {
  const supabase = getAdminClient();
  const playerState = playerUserId
    ? readRows(
        supabase
          .from("user_character_assignments")
          .select("user_id, character_id, current_location_id, resources, personality")
          .eq("user_id", playerUserId),
        "the requested player's state",
      )
    : Promise.resolve([]);

  const [
    startingReference,
    events,
    worldState,
    regions,
    houses,
    houseLocationRelations,
    locations,
    characters,
    traits,
    ambitions,
    loyalties,
    secrets,
    secretKnowledge,
    claims,
    wars,
    warParticipants,
    diplomacy,
    eventCharacters,
    eventHouses,
    eventLocations,
    eventStateChanges,
    player,
  ] = await Promise.all([
    readFile(join(process.cwd(), "theclaimant_starting_reference.txt"), "utf8"),
    getGameEvents(),
    readRows(supabase.from("world_state").select("*"), "world state"),
    readRows(supabase.from("world_regions").select("*"), "world regions"),
    readRows(supabase.from("houses").select("*"), "houses"),
    readRows(
      supabase.from("house_location_relations").select("*"),
      "house and location relationships",
    ),
    readRows(supabase.from("playable_locations").select("*"), "locations"),
    readRows(supabase.from("playable_characters").select("*"), "characters"),
    readRows(supabase.from("character_traits").select("*"), "character traits"),
    readRows(
      supabase.from("character_ambitions").select("*"),
      "character ambitions",
    ),
    readRows(
      supabase.from("character_loyalties").select("*"),
      "character loyalties",
    ),
    readRows(supabase.from("character_secrets").select("*"), "character secrets"),
    readRows(
      supabase.from("character_secret_knowledge").select("*"),
      "character secret knowledge",
    ),
    readRows(supabase.from("political_claims").select("*"), "political claims"),
    readRows(supabase.from("world_wars").select("*"), "wars"),
    readRows(supabase.from("war_participants").select("*"), "war participants"),
    readRows(
      supabase.from("diplomacy_records").select("*"),
      "diplomacy records",
    ),
    readRows(supabase.from("event_characters").select("*"), "event characters"),
    readRows(supabase.from("event_houses").select("*"), "event houses"),
    readRows(supabase.from("event_locations").select("*"), "event locations"),
    readRows(
      supabase.from("event_state_changes").select("*"),
      "event state changes",
    ),
    playerState,
  ]);

  return buildWorldContext(startingReference, events, {
    worldState,
    regions,
    houses,
    houseLocationRelations,
    locations,
    characters,
    traits,
    ambitions,
    loyalties,
    secrets,
    secretKnowledge,
    claims,
    wars,
    warParticipants,
    diplomacy,
    eventCharacters,
    eventHouses,
    eventLocations,
    eventStateChanges,
    playerState: player,
  });
}
