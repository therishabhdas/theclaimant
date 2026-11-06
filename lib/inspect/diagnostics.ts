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
      "travel_priority_rank smallint", "is_travel_core boolean",
      "travel_geography_note text",
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
    name: "gameplay_turn_participants",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "world_state_id smallint PK/FK", "turn_number integer PK",
      "user_id uuid PK/FK", "character_id integer FK", "created_at timestamptz",
    ],
  },
  {
    name: "gameplay_turn_orders",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "id bigint PK", "request_id uuid", "world_state_id smallint FK",
      "turn_number integer", "user_id uuid", "character_id integer FK",
      "player_request text", "action_data jsonb", "resolution_status text",
      "resolution_note text", "created_at timestamptz",
    ],
  },
  {
    name: "gameplay_npc_orders",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "world_state_id smallint PK/FK", "turn_number integer PK",
      "character_id integer PK/FK", "action_data jsonb", "resolution_status text",
      "resolution_note text", "created_at timestamptz", "updated_at timestamptz",
    ],
  },
  {
    name: "gameplay_turn_resolutions",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "id bigint PK", "world_state_id smallint FK", "turn_number integer",
      "gameplay_revision bigint", "event_id bigint FK", "canonical_summary text",
      "resolution_data jsonb", "resolved_at timestamptz",
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
      "turn_number integer", "elapsed_days integer", "gameplay_revision bigint",
      "turn_phase text", "planning_deadline_at timestamptz", "resolution_started_at timestamptz",
      "resolution_lease_token uuid", "resolution_lease_owner text",
      "resolution_lease_expires_at timestamptz", "resolution_checkpoint jsonb",
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
    name: "gameplay_order_rate_limits",
    group: "Private game state",
    hideRowCount: true,
    columns: [
      "user_id uuid PK/FK", "window_started_at timestamptz",
      "request_count integer", "updated_at timestamptz",
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
    name: "political_entities",
    group: "Political authority and influence",
    columns: [
      "id bigint PK", "entity_key text", "entity_type text", "name text",
      "house_id bigint FK", "region_id smallint FK", "location_id bigint FK",
      "institution_key text", "created_at timestamptz",
    ],
  },
  {
    name: "political_authority_positions",
    group: "Political authority and influence",
    hideRowCount: true,
    columns: [
      "id bigint PK", "world_state_id smallint FK", "entity_id bigint FK",
      "character_id integer FK", "position_name text", "responsibilities text",
      "scope_region_id smallint FK", "scope_location_id bigint FK",
      "appointment_basis text", "position_status text", "recognition_status text",
      "is_disputed boolean", "is_public boolean", "recognized_by text",
      "recognized_by_character_id integer FK", "valid_from_turn integer",
      "valid_through_turn integer", "source_key text", "source_event_id bigint FK",
      "created_at timestamptz", "updated_at timestamptz",
    ],
  },
  {
    name: "political_authority_recognitions",
    group: "Political authority and influence",
    hideRowCount: true,
    columns: [
      "id bigint PK", "world_state_id smallint FK", "authority_position_id bigint FK",
      "recognized_by_character_id integer FK", "recognition_status text",
      "is_public boolean", "turn_number integer", "source_event_id bigint FK",
      "created_at timestamptz",
    ],
  },
  {
    name: "political_delegations",
    group: "Political authority and influence",
    hideRowCount: true,
    columns: [
      "id bigint PK", "world_state_id smallint FK", "authority_position_id bigint FK",
      "delegator_character_id integer FK", "delegate_character_id integer FK",
      "responsibilities text", "scope_region_id smallint FK",
      "scope_location_id bigint FK", "status text", "recognition_status text",
      "is_public boolean",
      "starts_turn integer", "ends_turn integer", "source_event_id bigint FK",
      "created_at timestamptz", "updated_at timestamptz",
    ],
  },
  {
    name: "political_authority_history",
    group: "Political authority and influence",
    hideRowCount: true,
    columns: [
      "id bigint PK", "authority_position_id bigint FK",
      "changed_by_character_id integer FK", "turn_number integer",
      "change_type text", "old_state jsonb", "new_state jsonb",
      "source_event_id bigint FK", "created_at timestamptz",
    ],
  },
  {
    name: "political_territorial_control_history",
    group: "Political authority and influence",
    hideRowCount: true,
    columns: [
      "id bigint PK", "world_state_id smallint FK", "location_id bigint FK",
      "previous_house_id bigint FK", "new_house_id bigint FK",
      "changed_by_character_id integer FK", "turn_number integer",
      "source_event_id bigint FK", "created_at timestamptz",
    ],
  },
  {
    name: "political_action_outcomes",
    group: "Political authority and influence",
    hideRowCount: true,
    columns: [
      "id bigint PK", "world_state_id smallint FK", "turn_number integer",
      "actor_character_id integer FK", "action_operation text", "action_data jsonb",
      "order_accepted boolean", "execution_status text", "authority_status text",
      "consequence text", "source_event_id bigint FK", "created_at timestamptz",
    ],
  },
  {
    name: "political_detentions",
    group: "Political authority and influence",
    hideRowCount: true,
    columns: [
      "id bigint PK", "world_state_id smallint FK", "prisoner_character_id integer FK",
      "custodian_character_id integer FK", "location_id bigint FK", "status text",
      "reason text", "started_turn integer", "ended_turn integer",
      "source_event_id bigint FK", "created_at timestamptz",
    ],
  },
  {
    name: "character_political_influence",
    group: "Political authority and influence",
    columns: [
      "character_id smallint", "current_house_id bigint FK",
      "political_reputation integer", "diplomatic_reputation integer",
      "legitimacy integer", "associated_house_wealth numeric",
      "associated_house_force integer", "recognized_offices integer",
      "recognized_delegated_responsibilities integer",
      "personal_loyalty_support integer", "active_alliances integer",
      "forces_personally_mustered integer", "controlled_locations integer",
      "known_leverage_facts integer",
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
    name: "travel_workbook_imports",
    group: "Travel reference",
    columns: [
      "id bigint PK", "import_key text", "filename text", "sha256 text",
      "evidence_note text", "imported_at timestamptz",
    ],
  },
  {
    name: "travel_workbook_rows",
    group: "Travel reference",
    columns: [
      "import_id bigint PK/FK", "sheet_name text PK", "row_number integer PK",
      "row_data jsonb",
    ],
  },
  {
    name: "travel_sources",
    group: "Travel reference",
    columns: [
      "id bigint PK", "import_id bigint FK", "source_name text", "source_url text",
      "supports text", "use_limitations text", "source_sheet text",
      "source_row_number integer",
    ],
  },
  {
    name: "travel_location_reference",
    group: "Travel reference",
    columns: [
      "location_id smallint PK/FK", "import_id bigint FK", "region_name text",
      "location_type text", "normalized_starting_house text", "normalized_house text",
      "priority_rank smallint", "is_core10 boolean", "is_playable boolean",
      "geography_note text", "implementation_note text", "source_sheet text",
      "source_row_number integer",
    ],
  },
  {
    name: "travel_corridors",
    group: "Travel network",
    columns: [
      "id bigint PK", "import_id bigint FK", "corridor_name text",
      "network_class text", "edge_modes text[]", "edge_count integer",
      "playable_locations_touched text[]", "edge_keys text[]",
      "waypoint_catalogue text[]", "description text", "confidence_level text",
      "source_url text", "source_id bigint FK", "source_sheet text",
      "source_row_number integer",
    ],
  },
  {
    name: "travel_transit_nodes",
    group: "Travel network",
    columns: [
      "id bigint PK", "import_id bigint FK", "node_name text", "node_type text",
      "geographic_role text", "gameplay_constraints text",
      "is_catalogued_chokepoint boolean", "source_sheet text",
      "source_row_number integer", "created_at timestamptz",
    ],
  },
  {
    name: "travel_route_edges",
    group: "Travel network",
    columns: [
      "id bigint PK", "import_id bigint FK", "edge_key text",
      "from_location_id smallint FK", "to_location_id smallint FK",
      "corridor_id bigint FK", "mode text", "distance_min_miles numeric",
      "distance_max_miles numeric", "distance_midpoint_miles numeric",
      "distance_basis text", "confidence_level text", "top_priority_endpoints text",
      "route_constraint text", "route_notes text", "requires_vessel boolean",
      "is_bidirectional boolean", "availability_status text", "is_open boolean",
      "controller_house_id bigint FK", "requires_permission boolean",
      "toll_status text", "is_blockaded boolean", "is_destroyed boolean",
      "seasonal_status text", "capacity_class text", "current_risk_level text",
      "current_speed_modifier numeric", "terrain text", "road_quality text",
      "base_risk_level text", "base_speed_modifier numeric",
      "last_state_change_event_id bigint FK", "source_sheet text",
      "source_row_number integer", "created_at timestamptz",
      "updated_at timestamptz",
    ],
  },
  {
    name: "travel_route_edge_waypoints",
    group: "Travel network",
    columns: [
      "edge_id bigint PK/FK", "sequence_number smallint PK",
      "transit_node_id bigint FK",
    ],
  },
  {
    name: "travel_route_options",
    group: "Travel network",
    columns: [
      "id bigint PK", "import_id bigint FK", "reference_key text",
      "origin_location_id smallint FK", "destination_location_id smallint FK",
      "option_type text", "catalog_status text", "unavailable_reason text",
      "playable_path text[]", "leg_modes text[]", "corridor_names text[]",
      "distance_min_miles numeric", "distance_max_miles numeric",
      "distance_midpoint_miles numeric", "mounted_party_days integer",
      "foot_party_days integer", "large_army_days integer", "confidence_level text",
      "route_constraints text", "direction_note text", "selection_method text",
      "source_sheet text", "source_row_number integer", "created_at timestamptz",
    ],
  },
  {
    name: "travel_route_option_legs",
    group: "Travel network",
    columns: [
      "id bigint PK", "route_option_id bigint FK", "sequence_number smallint",
      "route_edge_id bigint FK", "from_location_id smallint FK",
      "to_location_id smallint FK",
    ],
  },
  {
    name: "travel_assumptions",
    group: "Travel reference",
    columns: [
      "id bigint PK", "import_id bigint FK", "assumption_name text",
      "value_text text", "minimum_value numeric", "maximum_value numeric",
      "unit text", "classification text", "implementation_detail text",
      "source_sheet text", "source_row_number integer",
    ],
  },
  {
    name: "travel_route_control_fields",
    group: "Travel reference",
    columns: [
      "id bigint PK", "import_id bigint FK", "field_name text",
      "suggested_type text", "purpose text", "source_sheet text",
      "source_row_number integer",
    ],
  },
  {
    name: "travel_distance_conflicts",
    group: "Travel reference",
    columns: [
      "id bigint PK", "import_id bigint FK", "origin_location_id smallint FK",
      "destination_location_id smallint FK", "quoted_or_secondary_value text",
      "map_calibrated_value text", "adopted_network_range text",
      "confidence_level text", "implementation_note text", "source_sheet text",
      "source_row_number integer",
    ],
  },
  {
    name: "travel_legacy_corridor_edges",
    group: "Travel reference",
    columns: [
      "id bigint PK", "import_id bigint FK", "legacy_route_key text",
      "from_location_id smallint FK", "to_location_id smallint FK", "mode text",
      "route_name text", "nonplayable_waypoints text",
      "distance_min_miles numeric", "distance_max_miles numeric",
      "distance_basis text", "confidence_level text", "notes text",
      "source_sheet text", "source_row_number integer",
    ],
  },
  {
    name: "travel_journeys",
    group: "Campaign travel state",
    hideRowCount: true,
    columns: [
      "id bigint PK", "world_state_id smallint FK", "route_option_id bigint FK",
      "origin_location_id smallint FK", "destination_location_id smallint FK",
      "status text", "party_type text", "party_size integer",
      "current_leg_sequence smallint", "current_transit_node_id bigint FK",
      "distance_travelled_miles numeric", "planned_departure_at timestamptz",
      "departed_at timestamptz", "estimated_arrival_at timestamptz",
      "arrived_at timestamptz", "delay_days integer", "delay_reason text",
      "created_by_user_id uuid", "departure_event_id bigint FK",
      "arrival_event_id bigint FK", "state_note text", "created_at timestamptz",
      "updated_at timestamptz",
    ],
  },
  {
    name: "travel_journey_participants",
    group: "Campaign travel state",
    hideRowCount: true,
    columns: [
      "id bigint PK", "journey_id bigint FK", "character_id integer FK",
      "house_id bigint FK", "user_id uuid", "participant_role text",
      "participation_status text", "joined_at timestamptz", "left_at timestamptz",
      "created_at timestamptz",
    ],
  },
  {
    name: "travel_journey_legs",
    group: "Campaign travel state",
    hideRowCount: true,
    columns: [
      "id bigint PK", "journey_id bigint FK", "sequence_number smallint",
      "route_option_leg_id bigint FK", "route_edge_id bigint FK",
      "direction_reversed boolean", "status text", "estimated_days integer",
      "actual_departure_at timestamptz", "actual_arrival_at timestamptz",
      "actual_distance_miles numeric", "delay_days integer", "state_note text",
      "created_at timestamptz", "updated_at timestamptz",
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
