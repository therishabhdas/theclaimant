import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createGroqClient, GROQ_MODEL } from "../ai/groq";

type TableDefinition = {
  name: string;
  group: string;
  columns: string[];
  hideRowCount?: boolean;
};

const tableDefinitions: TableDefinition[] = [
  {
    name: "playable_locations",
    group: "Core catalogue",
    columns: [
      "id smallint PK", "slug text", "name text", "region text",
      "location_type text", "description text", "starting_house text",
      "house text", "top_10_rank smallint", "is_top_10 boolean",
      "is_playable boolean", "created_at timestamptz", "updated_at timestamptz",
      "world_region_id smallint FK",
    ],
  },
  {
    name: "playable_characters",
    group: "Core catalogue",
    columns: [
      "id smallint PK", "slug text", "display_name text", "aliases text[]",
      "playable_group text", "region text", "starting_house text",
      "birth_house text", "opening_title text", "opening_relationships text",
      "gameplay_focus text[]", "opening_status text", "current_status text",
      "opening_life_status text", "current_life_status text", "opening_presence text",
      "is_playable boolean", "opening_location_id smallint FK",
      "current_location_id smallint FK", "opening_claim_target text",
      "current_claim_target text", "opening_claim_basis text", "current_claim_basis text",
      "opening_claim_status text", "current_claim_status text",
      "opening_claim_summary text", "current_claim_summary text",
      "political_power smallint", "military_power smallint", "economic_power smallint",
      "naval_power smallint", "intelligence_power smallint", "diplomatic_power smallint",
      "legitimacy_power smallint", "popular_support smallint", "created_at timestamptz",
      "updated_at timestamptz", "world_region_id smallint FK",
      "starting_house_id bigint FK", "current_house_id bigint FK", "birth_house_id bigint FK",
    ],
  },
  {
    name: "playable_character_state_history",
    group: "Core catalogue",
    columns: [
      "id bigint PK", "character_id smallint FK", "event_type text",
      "old_location_id smallint FK", "new_location_id smallint FK",
      "old_state jsonb", "new_state jsonb", "change_note text", "changed_at timestamptz",
    ],
  },
  {
    name: "playable_character_knowledge",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "character_id smallint PK/FK", "fact_key text PK", "knowledge_state text",
      "private_fact text", "basis text", "updated_at timestamptz",
    ],
  },
  {
    name: "user_character_assignments",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "user_id uuid PK", "character_id integer FK", "assigned_at timestamptz",
      "current_location_id bigint FK", "resources jsonb", "personality jsonb",
      "updated_at timestamptz",
    ],
  },
  {
    name: "game_events",
    group: "Campaign timeline",
    columns: [
      "id bigint PK", "occurred_at timestamptz", "recorded_at timestamptz",
      "event_type text", "title text", "canonical_summary text", "public_summary text",
      "character_knowledge jsonb", "affected_character_ids integer[]", "location text",
      "state_changes jsonb", "world_state_id smallint FK", "world_date_label text",
      "location_id bigint FK", "affected_house_ids bigint[]", "reference_key text",
    ],
  },
  {
    name: "world_state",
    group: "World state",
    columns: [
      "id smallint PK", "world_date date", "date_description text", "season text",
      "current_situation text", "updated_at timestamptz", "opening_situation text",
    ],
  },
  {
    name: "world_regions",
    group: "World state",
    columns: [
      "id smallint PK", "world_state_id smallint FK", "name text",
      "created_at timestamptz", "current_situation text", "opening_situation text",
    ],
  },
  {
    name: "houses",
    group: "World state",
    columns: [
      "id bigint PK", "world_state_id smallint FK", "name text", "region_id smallint FK",
      "seat_location_id bigint FK", "liege_house_id bigint FK", "treasury_amount numeric",
      "army_size integer", "created_at timestamptz", "updated_at timestamptz",
      "seat_name text", "house_words text", "opening_head text", "opening_summary text",
      "current_summary text", "treasury_is_estimate boolean", "treasury_source_note text",
      "debt_amount numeric", "debt_summary text",
    ],
  },
  {
    name: "house_location_relations",
    group: "World state",
    columns: [
      "id bigint PK", "house_id bigint FK", "location_id bigint FK",
      "relation_type text", "source_event_id bigint FK", "created_at timestamptz",
    ],
  },
  {
    name: "character_traits",
    group: "Character state",
    columns: [
      "id bigint PK", "character_id integer FK", "trait text", "details text",
      "source_event_id bigint FK", "created_at timestamptz",
    ],
  },
  {
    name: "character_ambitions",
    group: "Character state",
    columns: [
      "id bigint PK", "character_id integer FK", "ambition text", "status text",
      "priority smallint", "source_event_id bigint FK", "created_at timestamptz",
      "updated_at timestamptz",
    ],
  },
  {
    name: "character_loyalties",
    group: "Character state",
    columns: [
      "id bigint PK", "character_id integer FK", "loyal_to_character_id integer FK",
      "loyal_to_house_id bigint FK", "description text", "strength smallint",
      "source_event_id bigint FK", "created_at timestamptz",
    ],
  },
  {
    name: "character_secrets",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "id bigint PK", "subject_character_id integer FK", "canonical_summary text",
      "public_summary text", "source_event_id bigint FK", "created_at timestamptz",
      "reference_key text",
    ],
  },
  {
    name: "character_secret_knowledge",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "secret_id bigint PK/FK", "character_id integer PK/FK",
      "knowledge_status text", "learned_at_event_id bigint FK", "details text",
    ],
  },
  {
    name: "character_secret_subjects",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "secret_id bigint PK/FK", "character_id integer PK/FK", "role text PK",
    ],
  },
  {
    name: "political_claims",
    group: "Diplomacy and conflict",
    columns: [
      "id bigint PK", "claimant_character_id integer FK", "claimant_house_id bigint FK",
      "target_title text", "claim_status text", "summary text",
      "source_event_id bigint FK", "created_at timestamptz", "updated_at timestamptz",
    ],
  },
  {
    name: "world_wars",
    group: "Diplomacy and conflict",
    columns: [
      "id bigint PK", "world_state_id smallint FK", "name text", "status text",
      "started_on date", "ended_on date", "summary text", "source_event_id bigint FK",
      "created_at timestamptz", "is_public boolean", "public_summary text",
      "reference_key text",
    ],
  },
  {
    name: "war_participants",
    group: "Diplomacy and conflict",
    columns: [
      "war_id bigint PK/FK", "house_id bigint PK/FK", "side text",
      "joined_on date", "left_on date", "source_event_id bigint FK",
    ],
  },
  {
    name: "diplomacy_records",
    group: "Diplomacy and conflict",
    columns: [
      "id bigint PK", "world_state_id smallint FK", "relation_type text", "status text",
      "house_a_id bigint FK", "house_b_id bigint FK", "character_a_id integer FK",
      "character_b_id integer FK", "related_location_id bigint FK", "started_on date",
      "ended_on date", "terms text", "source_event_id bigint FK", "created_at timestamptz",
      "is_public boolean", "public_summary text", "reference_key text",
    ],
  },
  {
    name: "regional_military_estimates",
    group: "Military and finance",
    columns: [
      "id bigint PK", "world_state_id smallint FK", "region_id smallint FK",
      "force_name text", "force_type text", "minimum_strength integer",
      "maximum_strength integer", "strength_unit text", "confidence_level text",
      "readiness_status text", "summary text", "source_note text",
      "is_gameplay_assumption boolean", "source_event_id bigint FK",
      "created_at timestamptz", "updated_at timestamptz",
    ],
  },
  {
    name: "military_muster_rules",
    group: "Military and finance",
    columns: [
      "id bigint PK", "world_state_id smallint FK", "region_id smallint FK",
      "reference_key text", "rule_name text", "force_type text", "minimum_days integer",
      "maximum_days integer", "target_strength integer", "summary text",
      "is_gameplay_assumption boolean", "source_note text", "created_at timestamptz",
      "updated_at timestamptz",
    ],
  },
  {
    name: "world_financial_records",
    group: "Military and finance",
    columns: [
      "id bigint PK", "world_state_id smallint FK", "reference_key text",
      "record_type text", "subject_name text", "creditor_name text", "amount numeric",
      "lower_bound numeric", "amount_qualifier text", "currency text", "summary text",
      "is_gameplay_assumption boolean", "source_note text", "created_at timestamptz",
      "updated_at timestamptz",
    ],
  },
  {
    name: "event_characters",
    group: "Campaign timeline",
    columns: [
      "event_id bigint PK/FK", "character_id integer PK/FK", "role text PK",
      "knowledge text",
    ],
  },
  {
    name: "event_houses",
    group: "Campaign timeline",
    columns: ["event_id bigint PK/FK", "house_id bigint PK/FK", "role text PK"],
  },
  {
    name: "event_locations",
    group: "Campaign timeline",
    columns: ["event_id bigint PK/FK", "location_id bigint PK/FK", "role text PK"],
  },
  {
    name: "event_state_changes",
    group: "Campaign timeline",
    columns: [
      "id bigint PK", "event_id bigint FK", "change_type text", "description text",
      "character_id integer FK", "house_id bigint FK", "location_id bigint FK",
      "war_id bigint FK", "diplomacy_record_id bigint FK", "structured_change jsonb",
      "created_at timestamptz",
    ],
  },
  {
    name: "house_claims",
    group: "Diplomacy and conflict",
    columns: [
      "id bigint PK", "house_id bigint FK", "claim_id bigint FK", "created_at timestamptz",
    ],
  },
];

export type InspectStatus = "connected" | "error" | "not_configured";

export type InspectReport = {
  checkedAt: string;
  supabase: {
    status: InspectStatus;
    projectHost: string | null;
    message: string;
  };
  groq: {
    status: InspectStatus;
    model: string;
    message: string;
    verification: string;
  };
  tables: {
    name: string;
    group: string;
    columns: string[];
    status: "available" | "error";
    estimatedRows: number | null;
    message: string;
  }[];
};

function errorMessage(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
    const code = typeof candidate.code === "string" ? candidate.code : null;
    const status = typeof candidate.status === "number" ? candidate.status : null;

    if (code) return `Request failed (${code}).`;
    if (status) return `Request failed (HTTP ${status}).`;
  }

  return "Request failed. Check the server logs for details.";
}

async function checkGroq(): Promise<InspectReport["groq"]> {
  if (!process.env.GROQ_API_KEY) {
    return {
      status: "not_configured",
      model: GROQ_MODEL,
      message: "GROQ_API_KEY is not configured on the server.",
      verification: "No model request was made.",
    };
  }

  try {
    const model = await createGroqClient().models.retrieve(GROQ_MODEL, {
      timeout: 8_000,
    });
    return {
      status: model.id === GROQ_MODEL ? "connected" : "error",
      model: GROQ_MODEL,
      message: model.id === GROQ_MODEL
        ? "Groq API is reachable and this model is available to the configured key."
        : "Groq API responded, but the configured model identifier did not match.",
      verification: "Model availability checked; no inference or token generation was run.",
    };
  } catch (error) {
    return {
      status: "error",
      model: GROQ_MODEL,
      message: errorMessage(error),
      verification: "Model availability check failed; no inference was run.",
    };
  }
}

export async function getInspectReport(): Promise<InspectReport> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let projectHost: string | null = null;

  if (supabaseUrl) {
    try {
      projectHost = new URL(supabaseUrl).host;
    } catch {
      projectHost = null;
    }
  }

  const tables: InspectReport["tables"] = [];
  let supabaseStatus: InspectStatus = "not_configured";
  let supabaseMessage = "Supabase URL or server service-role key is not configured.";

  if (supabaseUrl && serviceRoleKey && projectHost) {
    const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    for (let index = 0; index < tableDefinitions.length; index += 5) {
      const batch = tableDefinitions.slice(index, index + 5);
      const batchResults = await Promise.all(batch.map(async (table) => {
        try {
          const { count, error } = await supabase
            .from(table.name)
            .select(
              table.columns.map((column) => column.split(" ")[0]).join(","),
              { count: "estimated", head: true },
            );

          return {
            name: table.name,
            group: table.group,
            columns: table.columns,
            status: error ? "error" as const : "available" as const,
            estimatedRows: error || table.hideRowCount ? null : count,
            message: error
              ? `${error.code ? `${error.code}: ` : ""}${error.message}`
              : table.hideRowCount
                ? "Table is reachable; row count hidden because it contains private character or account data."
                : "Table and registered columns are reachable.",
          };
        } catch {
          return {
            name: table.name,
            group: table.group,
            columns: table.columns,
            status: "error" as const,
            estimatedRows: null,
            message: "Request failed. Check the server logs for details.",
          };
        }
      }));
      tables.push(...batchResults);
    }

    const worldStateTable = tables.find((table) => table.name === "world_state");
    if (worldStateTable?.status === "available") {
      supabaseStatus = "connected";
      supabaseMessage = "Supabase REST API is reachable using the server-side service key.";
    } else if (supabaseUrl && serviceRoleKey) {
      supabaseStatus = "error";
      supabaseMessage = "NEXT_PUBLIC_SUPABASE_URL is not a valid URL.";
      for (const table of tableDefinitions) {
        tables.push({
          name: table.name,
          group: table.group,
          columns: table.columns,
          status: "error",
          estimatedRows: null,
          message: "Not checked because the Supabase URL is invalid.",
        });
      }
    } else {
      supabaseStatus = "error";
      supabaseMessage = "Supabase was configured, but the world_state health check failed.";
    }
  } else {
    for (const table of tableDefinitions) {
      tables.push({
        ...table,
        status: "error",
        estimatedRows: null,
        message: "Not checked because Supabase server configuration is incomplete.",
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    supabase: {
      status: supabaseStatus,
      projectHost,
      message: supabaseMessage,
    },
    groq: await checkGroq(),
    tables,
  };
}
