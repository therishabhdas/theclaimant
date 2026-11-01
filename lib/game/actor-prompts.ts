import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { buildGroqGamePrompt } from "../ai/prompt-template";
import { projectCharacterKnowledge, projectEventsForCharacter } from "./knowledge";

type Row = Record<string, unknown>;

export type CharacterPromptRequest = {
  actorCharacterId: number;
  playerRequest: string;
  playerUserId?: string;
};

type QueryResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
};

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
  query: PromiseLike<QueryResponse>,
  context: string,
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Unable to load ${context}: ${error.message}`);
  if (data === null || !data.every(isRecord)) {
    throw new Error(`Supabase returned invalid data while loading ${context}.`);
  }
  return data;
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(row: Row, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function stringField(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function rowsForCharacter(rows: Row[], characterId: number) {
  return rows.filter((row) => numberField(row, "character_id") === characterId);
}

function pick(row: Row, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
}

function format(value: unknown) {
  return JSON.stringify(value);
}

function findMentionedLocationIds(request: string, locations: Row[]) {
  const normalizedRequest = request.toLocaleLowerCase();
  return new Set(
    locations.flatMap((location) => {
      const id = numberField(location, "id");
      const name = stringField(location, "name");
      return id !== null && name !== null &&
          normalizedRequest.includes(name.toLocaleLowerCase())
        ? [id]
        : [];
    }),
  );
}

function buildTravelContext(input: {
  actorCharacterId: number;
  actorLocationId: number | null;
  request: string;
  locations: Row[];
  routes: Row[];
  routeLegs: Row[];
  routeEdges: Row[];
  journeys: Row[];
  journeyParticipants: Row[];
}) {
  const locationNameById = new Map(
    input.locations.flatMap((location) => {
      const id = numberField(location, "id");
      const name = stringField(location, "name");
      return id !== null && name !== null ? [[id, name] as const] : [];
    }),
  );
  const mentionedIds = findMentionedLocationIds(input.request, input.locations);
  const routes = input.actorLocationId === null
    ? []
    : input.routes.filter((route) => {
        const originId = numberField(route, "origin_location_id");
        const destinationId = numberField(route, "destination_location_id");
        const otherId = originId === input.actorLocationId
          ? destinationId
          : originId;
        return (
          (originId === input.actorLocationId || destinationId === input.actorLocationId) &&
          (mentionedIds.size === 0 || otherId === null || mentionedIds.has(otherId))
        );
      });

  const availableRoutes = routes.map((route) => {
    const routeId = numberField(route, "id");
    const legs = input.routeLegs
      .filter((leg) => numberField(leg, "route_option_id") === routeId)
      .sort((left, right) =>
        (numberField(left, "sequence_number") ?? 0) -
        (numberField(right, "sequence_number") ?? 0),
      )
      .map((leg) => {
        const edgeId = numberField(leg, "route_edge_id");
        const edge = input.routeEdges.find((candidate) =>
          numberField(candidate, "id") === edgeId,
        );
        return {
          sequence: numberField(leg, "sequence_number"),
          from: locationNameById.get(numberField(leg, "from_location_id") ?? -1) ?? null,
          to: locationNameById.get(numberField(leg, "to_location_id") ?? -1) ?? null,
          mode: edge ? stringField(edge, "mode") : null,
          availability: edge ? stringField(edge, "availability_status") : null,
          seasonalStatus: edge ? stringField(edge, "seasonal_status") : null,
          blockaded: edge?.is_blockaded ?? null,
          destroyed: edge?.is_destroyed ?? null,
          requiresPermission: edge?.requires_permission ?? null,
        };
      });
    const originId = numberField(route, "origin_location_id");
    const destinationId = numberField(route, "destination_location_id");
    return {
      routeOptionId: routeId,
      origin: locationNameById.get(originId ?? -1) ?? null,
      destination: locationNameById.get(destinationId ?? -1) ?? null,
      catalogStatus: route.catalog_status,
      mountedPartyDays: route.mounted_party_days,
      footPartyDays: route.foot_party_days,
      landOrSea: route.leg_modes,
      path: route.playable_path,
      routeConstraints: route.route_constraints,
      legs,
    };
  });

  const actorJourneyIds = new Set(
    input.journeyParticipants
      .filter((participant) =>
        numberField(participant, "character_id") === input.actorCharacterId,
      )
      .map((participant) => numberField(participant, "journey_id"))
      .filter((id): id is number => id !== null),
  );
  const activeJourneys = input.journeys
    .filter((journey) => actorJourneyIds.has(numberField(journey, "id") ?? -1))
    .map((journey) => ({
      journeyId: numberField(journey, "id"),
      status: journey.status,
      origin:
        locationNameById.get(numberField(journey, "origin_location_id") ?? -1) ?? null,
      destination:
        locationNameById.get(numberField(journey, "destination_location_id") ?? -1) ?? null,
      partyType: journey.party_type,
      partySize: journey.party_size,
      elapsedDays: journey.elapsed_days,
      estimatedDays: journey.estimated_duration_days,
      participationStatus: input.journeyParticipants.find((participant) =>
        numberField(participant, "character_id") === input.actorCharacterId &&
        numberField(participant, "journey_id") === numberField(journey, "id"),
      )?.participation_status ?? null,
    }));

  return {
    characterLocation:
      locationNameById.get(input.actorLocationId ?? -1) ?? null,
    availableRoutes,
    activeJourneys,
    alreadyTravelling: activeJourneys.some((journey) =>
      ["planned", "awaiting_permission", "ready", "in_progress", "delayed"].includes(
        String(journey.status),
      ),
    ),
  };
}

export async function loadGroqCharacterPrompts(
  requests: CharacterPromptRequest[],
): Promise<Map<number, ReturnType<typeof buildGroqGamePrompt>>> {
  if (requests.length === 0) return new Map();
  if (requests.some((request) =>
    !Number.isSafeInteger(request.actorCharacterId) ||
    request.actorCharacterId < 1 ||
    !request.playerRequest.trim(),
  )) {
    throw new Error("Every character prompt requires an actor and a non-empty instruction.");
  }

  const client = getAdminClient();
  const actorIds = [...new Set(requests.map((request) => request.actorCharacterId))];
  const userIds = [...new Set(
    requests.flatMap((request) => request.playerUserId ? [request.playerUserId] : []),
  )];
  const [
    eventResponse,
    worldState,
    regions,
    houses,
    locations,
    characters,
    assignments,
    traits,
    ambitions,
    loyalties,
    secrets,
    secretKnowledge,
    characterKnowledge,
    claims,
    wars,
    warParticipants,
    estimates,
    musterRules,
    diplomacy,
    journeyParticipants,
  ] = await Promise.all([
    client.from("game_events").select(
      "id, occurred_at, world_date_label, event_type, title, public_summary, character_knowledge",
    ).order("occurred_at", { ascending: true }).order("id", { ascending: true }),
    readRows(client.from("world_state").select(
      "turn_number, elapsed_days, date_description, season, current_situation, opening_situation",
    ), "world state"),
    readRows(client.from("world_regions").select(
      "id, name, current_situation, opening_situation",
    ), "world regions"),
    readRows(client.from("houses").select(
      "id, name, region_id, seat_name, house_words, opening_head, opening_summary, current_summary",
    ), "houses"),
    readRows(client.from("playable_locations").select(
      "id, name, region, location_type, world_region_id",
    ), "locations"),
    readRows(client.from("playable_characters").select(
      "id, display_name, aliases, playable_group, region, starting_house, opening_title, " +
      "opening_relationships, gameplay_focus, opening_status, current_status, opening_life_status, " +
      "current_life_status, opening_presence, current_location_id, current_house_id, " +
      "starting_house_id, world_region_id",
    ).in("id", actorIds), "acting characters"),
    readRows(client.from("user_character_assignments").select(
      "user_id, character_id, current_location_id, resources, personality",
    ).in(
      "user_id",
      userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"],
    ), "player character assignments"),
    readRows(client.from("character_traits").select(
      "character_id, trait, details",
    ).in("character_id", actorIds), "character traits"),
    readRows(client.from("character_ambitions").select(
      "character_id, ambition, status, priority",
    ).in("character_id", actorIds), "character ambitions"),
    readRows(client.from("character_loyalties").select(
      "character_id, loyal_to_character_id, loyal_to_house_id, description, strength",
    ).in("character_id", actorIds), "character loyalties"),
    readRows(client.from("character_secrets").select(
      "id, canonical_summary",
    ), "character secrets"),
    readRows(client.from("character_secret_knowledge").select(
      "secret_id, character_id, knowledge_status, details",
    ).in("character_id", actorIds), "character secret knowledge"),
    readRows(client.from("playable_character_knowledge").select(
      "character_id, fact_key, knowledge_state, private_fact, basis",
    ).in("character_id", actorIds), "playable character knowledge"),
    readRows(client.from("political_claims").select(
      "claimant_character_id, target_title, claim_status, summary",
    ).in("claimant_character_id", actorIds), "character claims"),
    readRows(client.from("world_wars").select(
      "id, name, status, is_public, public_summary",
    ), "wars"),
    readRows(client.from("war_participants").select(
      "war_id, house_id, side",
    ), "war participants"),
    readRows(client.from("regional_military_estimates").select(
      "region_id, force_name, force_type, minimum_strength, maximum_strength, " +
      "confidence_level, readiness_status, summary",
    ), "regional military estimates"),
    readRows(client.from("military_muster_rules").select(
      "id, region_id, rule_name, force_type, minimum_days, maximum_days, summary",
    ), "military muster rules"),
    readRows(client.from("diplomacy_records").select(
      "id, relation_type, status, house_a_id, house_b_id, character_a_id, character_b_id, " +
      "terms, is_public, public_summary",
    ), "diplomacy records"),
    readRows(client.from("travel_journey_participants")
      .select("journey_id, character_id, participation_status")
      .in("character_id", actorIds)
      .in("participation_status", ["travelling", "joined"]),
    "active journey participants"),
  ]);
  if (eventResponse.error) {
    throw new Error(`Unable to load the game event log: ${eventResponse.error.message}`);
  }
  if (eventResponse.data === null || !eventResponse.data.every(isRecord)) {
    throw new Error("Supabase returned invalid event history.");
  }

  const worldRows = worldState;
  const regionRows = regions;
  const houseRows = houses;
  const locationRows = locations;
  const characterRows = characters;
  const assignmentRows = assignments;
  const traitRows = traits;
  const ambitionRows = ambitions;
  const loyaltyRows = loyalties;
  const secretRows = secrets;
  const secretKnowledgeRows = secretKnowledge;
  const characterKnowledgeRows = characterKnowledge;
  const claimRows = claims;
  const warRows = wars;
  const warParticipantRows = warParticipants;
  const estimateRows = estimates;
  const musterRuleRows = musterRules;
  const diplomacyRows = diplomacy;
  const journeyParticipantRows = journeyParticipants;
  const eventRows = eventResponse.data.map((event) => ({
    id: numberField(event, "id") ?? 0,
    occurredAt: stringField(event, "occurred_at") ?? "",
    worldDateLabel: stringField(event, "world_date_label"),
    eventType: stringField(event, "event_type") ?? "other",
    title: stringField(event, "title") ?? "",
    publicSummary: stringField(event, "public_summary"),
    characterKnowledge: isRecord(event.character_knowledge)
      ? Object.fromEntries(Object.entries(event.character_knowledge).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ))
      : {},
  }));
  const assignmentByCharacter = new Map(
    assignmentRows.flatMap((assignment) => {
      const id = numberField(assignment, "character_id");
      return id === null ? [] : [[id, assignment] as const];
    }),
  );
  const actorById = new Map(
    characterRows.flatMap((character) => {
      const id = numberField(character, "id");
      if (id === null) return [];
      const assignment = assignmentByCharacter.get(id);
      const locationId = numberField(character, "current_location_id")
        ?? numberField(assignment ?? {}, "current_location_id");
      return [[id, { character, assignment, locationId }] as const];
    }),
  );
  const originIds = [...new Set(
    [...actorById.values()]
      .map((actor) => actor.locationId)
      .filter((id): id is number => id !== null),
  )];
  const routeBatches = await Promise.all(originIds.map((locationId) =>
    readRows(client.from("travel_route_options").select(
      "id, origin_location_id, destination_location_id, catalog_status, playable_path, " +
      "leg_modes, mounted_party_days, foot_party_days, route_constraints",
    ).or(
      `origin_location_id.eq.${locationId},destination_location_id.eq.${locationId}`,
    ), "routes from the acting character's location"),
  ));
  const routeRows = [...new Map(routeBatches.flat().flatMap((route) => {
    const id = numberField(route, "id");
    return id === null ? [] : [[id, route] as const];
  })).values()];
  const routeIds = routeRows.flatMap((route) => {
    const id = numberField(route, "id");
    return id === null ? [] : [id];
  });
  const [routeLegRows, journeyRows] = await Promise.all([
    routeIds.length > 0
      ? readRows(client.from("travel_route_option_legs").select(
        "route_option_id, sequence_number, route_edge_id, from_location_id, to_location_id",
      ).in("route_option_id", routeIds), "route legs")
      : Promise.resolve([]),
    journeyParticipantRows.length > 0
      ? readRows(client.from("travel_journeys").select(
        "id, origin_location_id, destination_location_id, status, party_type, party_size, " +
        "elapsed_days, estimated_duration_days",
      ).in("id", [...new Set(journeyParticipantRows
        .map((row) => numberField(row, "journey_id"))
        .filter((id): id is number => id !== null))])
        .in("status", ["planned", "awaiting_permission", "ready", "in_progress", "delayed"]),
      "active journeys")
      : Promise.resolve([]),
  ]);
  const legRows = routeLegRows;
  const edgeIds = [...new Set(legRows
    .map((leg) => numberField(leg, "route_edge_id"))
    .filter((id): id is number => id !== null))];
  const routeEdgeRows = edgeIds.length > 0
    ? await readRows(client.from("travel_route_edges").select(
      "id, mode, availability_status, seasonal_status, is_blockaded, is_destroyed, requires_permission",
    ).in("id", edgeIds), "route conditions")
    : [];
  const houseNameById = new Map(houseRows.flatMap((house) => {
    const id = numberField(house, "id");
    const name = stringField(house, "name");
    return id !== null && name !== null ? [[id, name] as const] : [];
  }));
  const regionNameById = new Map(regionRows.flatMap((region) => {
    const id = numberField(region, "id");
    const name = stringField(region, "name");
    return id !== null && name !== null ? [[id, name] as const] : [];
  }));

  const publicWars = warRows.filter((war) =>
    war.is_public === true && stringField(war, "public_summary") !== null,
  ).map((war) => ({
    id: war.id,
    name: war.name,
    status: war.status,
    summary: war.public_summary,
    participants: warParticipantRows
      .filter((participant) => participant.war_id === war.id)
      .map((participant) => ({
        house: houseNameById.get(numberField(participant, "house_id") ?? -1) ?? null,
        side: participant.side,
      })),
  }));
  const publicDiplomacy = diplomacyRows.filter((record) =>
    record.is_public === true && stringField(record, "public_summary") !== null,
  ).map((record) => ({
    id: record.id,
    relationType: record.relation_type,
    status: record.status,
    houseA: houseNameById.get(numberField(record, "house_a_id") ?? -1) ?? null,
    houseB: houseNameById.get(numberField(record, "house_b_id") ?? -1) ?? null,
    summary: record.public_summary,
  }));
  const publicWorldContext = format({
    world: worldRows.map((row) => pick(row, [
      "turn_number", "elapsed_days", "date_description", "season",
      "current_situation", "opening_situation",
    ])),
    regions: regionRows.map((row) => pick(row, [
      "id", "name", "current_situation", "opening_situation",
    ])),
    houses: houseRows.map((row) => ({
      ...pick(row, [
        "id", "name", "seat_name", "house_words", "opening_head",
        "opening_summary", "current_summary",
      ]),
      region: regionNameById.get(numberField(row, "region_id") ?? -1) ?? null,
    })),
    publicCharacters: characterRows.map((row) => pick(row, [
      "id", "display_name", "aliases", "playable_group", "region",
      "starting_house", "opening_title", "opening_relationships",
    ])),
    locations: locationRows.map((row) => pick(row, [
      "id", "name", "region", "location_type",
    ])),
    publicWars,
    publicDiplomacy,
    militaryEstimates: estimateRows.map((row) => pick(row, [
      "region_id", "force_name", "force_type", "minimum_strength",
      "maximum_strength", "confidence_level", "readiness_status", "summary",
    ])),
    musterRules: musterRuleRows.map((row) => pick(row, [
      "id", "region_id", "rule_name", "force_type", "minimum_days",
      "maximum_days", "summary",
    ])),
  });

  const prompts = new Map<number, ReturnType<typeof buildGroqGamePrompt>>();
  for (const request of requests) {
    const actor = actorById.get(request.actorCharacterId);
    if (!actor) {
      throw new Error(`Character ${request.actorCharacterId} is missing from the campaign roster.`);
    }
    if (
      request.playerUserId &&
      numberField(actor.assignment ?? {}, "character_id") !== request.actorCharacterId
    ) {
      throw new Error("The requested player is not assigned to the designated character.");
    }
    const actorRow = actor.character;
    const houseId = numberField(actorRow, "current_house_id")
      ?? numberField(actorRow, "starting_house_id");
    const actorContext = {
      character: {
        ...pick(actorRow, [
          "id", "display_name", "aliases", "playable_group", "region",
          "opening_title", "opening_relationships", "gameplay_focus",
          "opening_status", "current_status", "opening_life_status",
          "current_life_status", "opening_presence",
        ]),
        currentHouse: houseNameById.get(houseId ?? -1) ?? null,
        currentRegion:
          regionNameById.get(numberField(actorRow, "world_region_id") ?? -1) ?? null,
        currentLocation:
          locationRows.find((location) =>
            numberField(location, "id") === actor.locationId,
          )?.name ?? null,
      },
      traits: rowsForCharacter(traitRows, request.actorCharacterId).map((row) =>
        pick(row, ["trait", "details"]),
      ),
      ambitions: rowsForCharacter(ambitionRows, request.actorCharacterId).map((row) =>
        pick(row, ["ambition", "status", "priority"]),
      ),
      loyalties: rowsForCharacter(loyaltyRows, request.actorCharacterId).map((row) => ({
        ...pick(row, ["description", "strength"]),
        loyalToCharacter: characterRows.find((candidate) =>
          numberField(candidate, "id") === numberField(row, "loyal_to_character_id"),
        )?.display_name ?? null,
        loyalToHouse:
          houseNameById.get(numberField(row, "loyal_to_house_id") ?? -1) ?? null,
      })),
      claims: claimRows.filter((claim) =>
        numberField(claim, "claimant_character_id") === request.actorCharacterId,
      ).map((row) => pick(row, ["target_title", "claim_status", "summary"])),
      privateDiplomacy: diplomacyRows.filter((record) =>
        numberField(record, "character_a_id") === request.actorCharacterId ||
        numberField(record, "character_b_id") === request.actorCharacterId,
      ).map((record) => ({
        ...pick(record, ["id", "relation_type", "status", "terms"]),
        houseA: houseNameById.get(numberField(record, "house_a_id") ?? -1) ?? null,
        houseB: houseNameById.get(numberField(record, "house_b_id") ?? -1) ?? null,
      })),
      playerState: actor.assignment
        ? pick(actor.assignment, ["resources", "personality"])
        : null,
    };
    const knowledge = projectCharacterKnowledge(
      request.actorCharacterId,
      characterKnowledgeRows,
      secretRows,
      secretKnowledgeRows,
    );
    const knownEvents = projectEventsForCharacter(request.actorCharacterId, eventRows);
    const travelContext = buildTravelContext({
      actorCharacterId: request.actorCharacterId,
      actorLocationId: actor.locationId,
      request: request.playerRequest,
      locations: locationRows,
      routes: routeRows,
      routeLegs: legRows,
      routeEdges: routeEdgeRows,
      journeys: journeyRows,
      journeyParticipants: journeyParticipantRows,
    });
    prompts.set(request.actorCharacterId, buildGroqGamePrompt({
      publicWorldContext,
      actorContext: format(actorContext),
      actorKnowledge: format(knowledge),
      eventHistory: format(knownEvents),
      travelContext: format(travelContext),
      playerRequest: request.playerRequest,
    }));
  }

  return prompts;
}

export async function loadGroqGamePrompt(
  playerUserId: string,
  playerRequest: string,
) {
  if (!playerUserId.trim()) {
    throw new Error("A player user ID is required to build the game prompt.");
  }
  if (!playerRequest.trim()) {
    throw new Error("A player request is required to build the game prompt.");
  }
  const assignments = await readRows(
    getAdminClient().from("user_character_assignments")
      .select("character_id")
      .eq("user_id", playerUserId),
    "the requested player's assignment",
  );
  if (assignments.length !== 1) {
    throw new Error("The authenticated player must have exactly one assigned character.");
  }
  const actorCharacterId = numberField(assignments[0], "character_id");
  if (actorCharacterId === null) {
    throw new Error("The player's assigned character ID is invalid.");
  }
  const prompts = await loadGroqCharacterPrompts([{
    actorCharacterId,
    playerRequest,
    playerUserId,
  }]);
  const prompt = prompts.get(actorCharacterId);
  if (!prompt) throw new Error("Unable to build the player's scoped game prompt.");
  return prompt;
}
