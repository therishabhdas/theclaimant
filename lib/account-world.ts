import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type CharacterCore = {
  id: number;
  birth_house: string | null;
  current_house_id: number | null;
  starting_house_id: number | null;
};

type CharacterTrait = {
  id: number;
  trait: string;
  details: string | null;
};

type CharacterAmbition = {
  id: number;
  ambition: string;
  status: string;
};

type CharacterLoyalty = {
  id: number;
  loyal_to_character_id: number | null;
  loyal_to_house_id: number | null;
  description: string;
  strength: number | null;
  loyalCharacter?: { display_name: string } | null;
  loyalHouse?: { name: string } | null;
};

type CharacterSecretKnowledge = {
  knowledge_status: "knows" | "suspects" | "misbelieves" | "learned" | "forgotten";
  details: string | null;
  secret: {
    canonical_summary: string;
    public_summary: string | null;
  };
};

type CharacterClaim = {
  id: number;
  target_title: string;
  claim_status: string;
  summary: string | null;
};

type CharacterHouse = {
  id: number;
  name: string;
  treasury_amount: number | null;
  army_size: number | null;
  liege_house_id: number | null;
};

export type CharacterAccountDetails = {
  birthHouse: string | null;
  currentHouse: CharacterHouse | null;
  liegeHouse: string | null;
  currentLocation: string | null;
  traits: CharacterTrait[];
  ambitions: CharacterAmbition[];
  loyalties: CharacterLoyalty[];
  knownSecrets: CharacterSecretKnowledge[];
  claims: CharacterClaim[];
  resources: Record<string, unknown>;
  personality: Record<string, unknown>;
};

export type RealmRegion = {
  id: number;
  name: string;
  houses: { id: number; name: string; treasuryAmount: number | null; armySize: number | null }[];
  locations: { id: number; name: string; locationType: string; house: string | null }[];
  recentEvents: { id: number; title: string; publicSummary: string | null }[];
};

export type RealmOverview = {
  dateDescription: string;
  season: string | null;
  currentSituation: string;
  regions: RealmRegion[];
  activeWars: { id: number; name: string; publicSummary: string | null }[];
  diplomacy: { type: string; status: string; parties: string; publicSummary: string | null }[];
  recentEvents: { id: number; occurredAt: string; title: string; publicSummary: string | null }[];
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
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function throwOnError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`Unable to load ${context}: ${error.message}`);
  }
}

export async function getCharacterAccountDetails(
  userId: string,
  characterId: number,
): Promise<CharacterAccountDetails> {
  const supabase = getAdminClient();
  const { data: assignment, error: assignmentError } = await supabase
    .from("user_character_assignments")
    .select("character_id, current_location_id, resources, personality")
    .eq("user_id", userId)
    .eq("character_id", characterId)
    .maybeSingle();
  throwOnError(assignmentError, "the character assignment");

  if (!assignment) {
    throw new Error("The requested character is not assigned to this account.");
  }

  const [
    characterResult,
    traitsResult,
    ambitionsResult,
    loyaltiesResult,
    knowledgeResult,
    claimsResult,
  ] = await Promise.all([
    supabase
      .from("playable_characters")
      .select("id, birth_house, current_house_id, starting_house_id")
      .eq("id", characterId)
      .single(),
    supabase
      .from("character_traits")
      .select("id, trait, details")
      .eq("character_id", characterId)
      .order("trait"),
    supabase
      .from("character_ambitions")
      .select("id, ambition, status")
      .eq("character_id", characterId)
      .order("created_at"),
    supabase
      .from("character_loyalties")
      .select("id, loyal_to_character_id, loyal_to_house_id, description, strength")
      .eq("character_id", characterId),
    supabase
      .from("character_secret_knowledge")
      .select("knowledge_status, details, secret:character_secrets(canonical_summary, public_summary)")
      .eq("character_id", characterId)
      .in("knowledge_status", ["knows", "suspects", "learned"]),
    supabase
      .from("political_claims")
      .select("id, target_title, claim_status, summary")
      .eq("claimant_character_id", characterId),
  ]);

  throwOnError(characterResult.error, "character details");
  throwOnError(traitsResult.error, "character traits");
  throwOnError(ambitionsResult.error, "character ambitions");
  throwOnError(loyaltiesResult.error, "character loyalties");
  throwOnError(knowledgeResult.error, "character knowledge");
  throwOnError(claimsResult.error, "character claims");

  const character = characterResult.data as CharacterCore;
  const houseIds = [
    character.current_house_id,
    character.starting_house_id,
  ].filter((id): id is number => id !== null);
  const loyaltyCharacterIds = (loyaltiesResult.data ?? [])
    .map((loyalty) => loyalty.loyal_to_character_id)
    .filter((id): id is number => id !== null);
  const [housesResult, loyalCharactersResult] = await Promise.all([
    houseIds.length > 0
      ? supabase
          .from("houses")
          .select("id, name, treasury_amount, army_size, liege_house_id")
          .in("id", houseIds)
      : Promise.resolve({ data: [], error: null }),
    loyaltyCharacterIds.length > 0
      ? supabase.from("playable_characters").select("id, display_name").in("id", loyaltyCharacterIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  throwOnError(housesResult.error, "character houses");
  throwOnError(loyalCharactersResult.error, "character relationships");
  const relatedHouseIds = [
    ...new Set([
      ...(loyaltiesResult.data ?? [])
        .map((loyalty) => loyalty.loyal_to_house_id)
        .filter((id): id is number => id !== null),
      ...(housesResult.data ?? [])
        .map((house) => house.liege_house_id)
        .filter((id): id is number => id !== null),
    ]),
  ];
  const loyalHousesResult = relatedHouseIds.length > 0
    ? await supabase
        .from("houses")
        .select("id, name")
        .in("id", relatedHouseIds)
    : { data: [], error: null };
  throwOnError(loyalHousesResult.error, "character allegiance");

  const houses = new Map(
    (housesResult.data ?? []).map((house) => [house.id, house as CharacterHouse]),
  );
  const loyalCharacters = new Map(
    (loyalCharactersResult.data ?? []).map((loyalCharacter) => [
      loyalCharacter.id,
      loyalCharacter.display_name,
    ]),
  );
  const loyalHouses = new Map(
    (loyalHousesResult.data ?? []).map((house) => [house.id, house.name]),
  );

  const loyalties = ((loyaltiesResult.data ?? []) as Omit<
    CharacterLoyalty,
    "loyalCharacter" | "loyalHouse"
  >[]).map((loyalty) => ({
    ...loyalty,
    loyalCharacter: loyalty.loyal_to_character_id
      ? { display_name: loyalCharacters.get(loyalty.loyal_to_character_id) ?? "Unknown character" }
      : null,
    loyalHouse: loyalty.loyal_to_house_id
      ? { name: loyalHouses.get(loyalty.loyal_to_house_id) ?? "Unknown house" }
      : null,
  }));

  const knownSecrets = (knowledgeResult.data ?? []).flatMap((entry) => {
    const rawSecret = Array.isArray(entry.secret) ? entry.secret[0] : entry.secret;
    if (!rawSecret) return [];

    const secretKnowledge = entry as Omit<CharacterSecretKnowledge, "secret">;
    return [{
      ...secretKnowledge,
      secret: rawSecret as CharacterSecretKnowledge["secret"],
    }];
  });

  let currentLocation: string | null = null;
  if (assignment.current_location_id !== null) {
    const { data: location, error } = await supabase
      .from("playable_locations")
      .select("name")
      .eq("id", assignment.current_location_id)
      .maybeSingle();
    throwOnError(error, "the player's current location");
    currentLocation = location?.name ?? null;
  }

  const currentHouseId = character.current_house_id ?? character.starting_house_id;
  return {
    birthHouse: character.birth_house,
    currentHouse: currentHouseId
      ? houses.get(currentHouseId) ?? null
      : null,
    liegeHouse: currentHouseId
      ? (() => {
          const liegeHouseId = houses.get(currentHouseId)?.liege_house_id;
          return liegeHouseId ? loyalHouses.get(liegeHouseId) ?? null : null;
        })()
      : null,
    currentLocation,
    traits: (traitsResult.data ?? []) as CharacterTrait[],
    ambitions: (ambitionsResult.data ?? []) as CharacterAmbition[],
    loyalties,
    knownSecrets,
    claims: (claimsResult.data ?? []) as CharacterClaim[],
    resources: assignment.resources ?? {},
    personality: assignment.personality ?? {},
  };
}

export async function getRealmOverview(): Promise<RealmOverview> {
  const supabase = getAdminClient();
  const [
    stateResult,
    regionsResult,
    housesResult,
    locationsResult,
    warsResult,
    diplomacyResult,
    eventsResult,
  ] = await Promise.all([
    supabase
      .from("world_state")
      .select("date_description, season, current_situation")
      .eq("id", 1)
      .single(),
    supabase.from("world_regions").select("id, name").order("id"),
    supabase
      .from("houses")
      .select("id, name, region_id, treasury_amount, army_size")
      .order("name"),
    supabase
      .from("playable_locations")
      .select("id, name, location_type, region, world_region_id, house")
      .order("name"),
    supabase
      .from("world_wars")
      .select("id, name, public_summary")
      .eq("status", "active")
      .eq("is_public", true)
      .order("name"),
    supabase
      .from("diplomacy_records")
      .select("relation_type, status, house_a_id, house_b_id, character_a_id, character_b_id, public_summary")
      .in("status", ["active", "proposed"])
      .eq("is_public", true)
      .order("relation_type"),
    supabase
      .from("game_events")
      .select("id, occurred_at, title, public_summary, location_id")
      .not("public_summary", "is", null)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(12),
  ]);

  throwOnError(stateResult.error, "the current world state");
  throwOnError(regionsResult.error, "the regions");
  throwOnError(housesResult.error, "regional houses");
  throwOnError(locationsResult.error, "regional locations");
  throwOnError(warsResult.error, "current wars");
  throwOnError(diplomacyResult.error, "current diplomacy");
  throwOnError(eventsResult.error, "public event history");

  if (!stateResult.data) {
    throw new Error("The current world state record has not been initialized.");
  }

  const houses = housesResult.data ?? [];
  const locations = locationsResult.data ?? [];
  const regionIdByLocationId = new Map(
    locations.map((location) => [location.id, location.world_region_id]),
  );
  const houseNames = new Map(houses.map((house) => [house.id, house.name]));
  const charactersForDiplomacy = new Set(
    (diplomacyResult.data ?? [])
      .flatMap((record) => [record.character_a_id, record.character_b_id])
      .filter((id): id is number => id !== null),
  );
  let characterNames = new Map<number, string>();
  if (charactersForDiplomacy.size > 0) {
    const { data, error } = await supabase
      .from("playable_characters")
      .select("id, display_name")
      .in("id", [...charactersForDiplomacy]);
    throwOnError(error, "diplomacy participants");
    characterNames = new Map((data ?? []).map((character) => [
      character.id,
      character.display_name,
    ]));
  }

  return {
    dateDescription: stateResult.data.date_description,
    season: stateResult.data.season,
    currentSituation: stateResult.data.current_situation,
    regions: (regionsResult.data ?? []).map((region) => ({
      id: region.id,
      name: region.name,
      houses: houses
        .filter((house) => house.region_id === region.id)
        .map((house) => ({
          id: house.id,
          name: house.name,
          treasuryAmount: house.treasury_amount,
          armySize: house.army_size,
        })),
      locations: locations
        .filter((location) => location.world_region_id === region.id)
        .map((location) => ({
          id: location.id,
          name: location.name,
          locationType: location.location_type,
          house: location.house,
        })),
      recentEvents: (eventsResult.data ?? [])
        .filter(
          (event) =>
            event.location_id !== null &&
            regionIdByLocationId.get(event.location_id) === region.id,
        )
        .slice(0, 3)
        .map((event) => ({
          id: event.id,
          title: event.title,
          publicSummary: event.public_summary,
        })),
    })),
    activeWars: (warsResult.data ?? []).map((war) => ({
      id: war.id,
      name: war.name,
      publicSummary: war.public_summary,
    })),
    diplomacy: (diplomacyResult.data ?? []).map((record) => {
      const parties = [
        record.house_a_id ? houseNames.get(record.house_a_id) : null,
        record.house_b_id ? houseNames.get(record.house_b_id) : null,
        record.character_a_id ? characterNames.get(record.character_a_id) : null,
        record.character_b_id ? characterNames.get(record.character_b_id) : null,
      ].filter((name): name is string => Boolean(name));

      return {
        type: record.relation_type,
        status: record.status,
        parties: parties.join(" · "),
        publicSummary: record.public_summary,
      };
    }),
    recentEvents: (eventsResult.data ?? []).map((event) => ({
      id: event.id,
      occurredAt: event.occurred_at,
      title: event.title,
      publicSummary: event.public_summary,
    })),
  };
}
