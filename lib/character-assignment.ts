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
  lifeStatus: string;
  openingRelationships: string;
  gameplayFocus: string[];
  claimStatus: string;
  claimTarget: string | null;
  claimSummary: string | null;
  location: string | null;
};

export async function getAssignedCharacter(
  supabase: ServerSupabaseClient,
  characterId: number,
): Promise<{ character: AssignedCharacter | null; error: string | null }> {
  const { data, error } = await supabase
    .from("playable_characters")
    .select(
      "id, display_name, aliases, playable_group, region, starting_house, opening_title, opening_status, current_status, current_life_status, opening_relationships, gameplay_focus, current_claim_status, current_claim_target, current_claim_summary, current_location_id",
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
      lifeStatus: data.current_life_status,
      openingRelationships: data.opening_relationships,
      gameplayFocus: data.gameplay_focus ?? [],
      claimStatus: data.current_claim_status,
      claimTarget: data.current_claim_target,
      claimSummary: data.current_claim_summary,
      location,
    },
    error: null,
  };
}
