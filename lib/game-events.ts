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
  eventType: GameEventType;
  title: string;
  canonicalSummary: string;
  publicSummary: string | null;
  characterKnowledge: Record<string, string>;
  affectedCharacterIds: number[];
  location: string | null;
  stateChanges: JsonValue[];
};

export type NewGameEvent = Omit<GameEvent, "id" | "recordedAt"> & {
  recordedAt?: string;
};

type GameEventRow = {
  id: number;
  occurred_at: string;
  recorded_at: string;
  event_type: GameEventType;
  title: string;
  canonical_summary: string;
  public_summary: string | null;
  character_knowledge: Record<string, string>;
  affected_character_ids: number[];
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

function toGameEvent(row: GameEventRow): GameEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    eventType: row.event_type,
    title: row.title,
    canonicalSummary: row.canonical_summary,
    publicSummary: row.public_summary,
    characterKnowledge: row.character_knowledge,
    affectedCharacterIds: row.affected_character_ids,
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
      event_type: event.eventType,
      title: event.title,
      canonical_summary: event.canonicalSummary,
      public_summary: event.publicSummary,
      character_knowledge: event.characterKnowledge,
      affected_character_ids: event.affectedCharacterIds,
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
): string {
  const eventLog = events.map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    eventType: event.eventType,
    title: event.title,
    canonicalSummary: event.canonicalSummary,
    publicSummary: event.publicSummary,
    characterKnowledge: event.characterKnowledge,
    affectedCharacterIds: event.affectedCharacterIds,
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
  ].join("\n\n");
}

export async function loadWorldContext(): Promise<string> {
  const [startingReference, events] = await Promise.all([
    readFile(join(process.cwd(), "theclaimant_starting_reference.txt"), "utf8"),
    getGameEvents(),
  ]);

  return buildWorldContext(startingReference, events);
}
