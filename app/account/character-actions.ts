"use server";

import { cookies } from "next/headers";
import { createClient } from "../../lib/supabase/server";
import {
  getAssignedCharacter,
  type AssignedCharacter,
} from "../../lib/game/character-assignment";

type DrawResult =
  | { success: true; character: AssignedCharacter }
  | { success: false; error: string };

export async function drawPlayableCharacter(): Promise<DrawResult> {
  const supabase = createClient(await cookies());
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError && userError.name !== "AuthSessionMissingError") {
    console.error("Unable to verify the character draw request:", userError.message);
    return { success: false, error: "Your sign-in could not be verified. Please sign in again." };
  }

  if (!user) {
    return { success: false, error: "Please sign in before drawing a character." };
  }

  const { data: characterId, error: drawError } = await supabase.rpc(
    "draw_playable_character",
  );

  if (drawError) {
    console.error("Unable to draw a playable character:", drawError.message);
    return {
      success: false,
      error: "The character draw is not available yet. Check that the Supabase assignment SQL has been run.",
    };
  }

  if (typeof characterId !== "number") {
    console.error("The character draw returned an invalid character ID.");
    return { success: false, error: "The character draw returned an invalid result. Please try again." };
  }

  const { character, error } = await getAssignedCharacter(supabase, characterId);
  if (error || !character) {
    return {
      success: false,
      error: error ?? "The assigned character could not be loaded.",
    };
  }

  return { success: true, character };
}
