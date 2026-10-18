import type { createClient } from "./supabase/server";

type ServerSupabaseClient = ReturnType<typeof createClient>;

export type AssignedCharacter = {
  id: number;
  displayName: string;
  aliases: string[];
  group: string;
  region: string | null;
  house: string | null;
  title: string | null;
  openingStatus: string;
  currentStatus: string;
  openingLifeStatus: string;
  lifeStatus: string;
  openingClaimStatus: string;
  openingClaimTarget: string | null;
  openingClaimSummary: string | null;
  openingClaimBasis: string | null;
  currentClaimBasis: string | null;
  openingRelationships: string;
  gameplayFocus: string[];
  claimStatus: string;
  claimTarget: string | null;
  claimSummary: string | null;
  location: string | null;
  powerRatings: {
    political: number | null;
    military: number | null;
    economic: number | null;
    naval: number | null;
    intelligence: number | null;
    diplomatic: number | null;
    legitimacy: number | null;
    popularSupport: number | null;
  };
};

export async function getAssignedCharacter(
  supabase: ServerSupabaseClient,
  characterId: number,
): Promise<{ character: AssignedCharacter | null; error: string | null }> {
  const { data, error } = await supabase
    .from("playable_characters")
    .select(
      "id, display_name, aliases, playable_group, region, starting_house, opening_title, opening_status, current_status, opening_life_status, current_life_status, opening_relationships, gameplay_focus, opening_claim_status, opening_claim_target, opening_claim_summary, opening_claim_basis, current_claim_status, current_claim_target, current_claim_basis, current_claim_summary, current_location_id, political_power, military_power, economic_power, naval_power, intelligence_power, diplomatic_power, legitimacy_power, popular_support",
    )
    .eq("id", characterId)
    .maybeSingle();

  if (error) {
    console.error("Unable to load the assigned character:", error.message);
    return { character: null, error: "The character could not be loaded. Please try again." };
  }

  if (!data) {
    console.error(`The assignment references missing character ${characterId}.`);
    return {
      character: null,
      error: "The assigned character is no longer in the roster. Please contact the game administrator.",
    };
  }

  let location: string | null = null;
  if (data.current_location_id !== null) {
    const { data: locationData, error: locationError } = await supabase
      .from("playable_locations")
      .select("name")
      .eq("id", data.current_location_id)
      .maybeSingle();

    if (locationError) {
      console.error("Unable to load the assigned character's location:", locationError.message);
      return {
        character: null,
        error: "The character was found, but their current location could not be loaded.",
      };
    }

    location = locationData?.name ?? null;
  }

  return {
    character: {
      id: data.id,
      displayName: data.display_name,
      aliases: data.aliases ?? [],
      group: data.playable_group,
      region: data.region,
      house: data.starting_house,
      title: data.opening_title,
      openingStatus: data.opening_status,
      currentStatus: data.current_status,
      openingLifeStatus: data.opening_life_status,
      lifeStatus: data.current_life_status,
      openingClaimStatus: data.opening_claim_status,
      openingClaimTarget: data.opening_claim_target,
      openingClaimSummary: data.opening_claim_summary,
      openingClaimBasis: data.opening_claim_basis,
      currentClaimBasis: data.current_claim_basis,
      openingRelationships: data.opening_relationships,
      gameplayFocus: data.gameplay_focus ?? [],
      claimStatus: data.current_claim_status,
      claimTarget: data.current_claim_target,
      claimSummary: data.current_claim_summary,
      location,
      powerRatings: {
        political: data.political_power,
        military: data.military_power,
        economic: data.economic_power,
        naval: data.naval_power,
        intelligence: data.intelligence_power,
        diplomatic: data.diplomatic_power,
        legitimacy: data.legitimacy_power,
        popularSupport: data.popular_support,
      },
    },
    error: null,
  };
}
