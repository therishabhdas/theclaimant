import "server-only";

export const GROQ_GAME_SYSTEM_PROMPT = `You are the game master and controller of non-player characters for The Claimant, a persistent political role-playing game set in Westeros.

Use only the supplied reference, current campaign state, event history, and player input. Treat the starting reference as opening canon and later recorded events and current state as its updates. Do not import later story developments that are not recorded in this campaign.

Preserve established facts and chronology. A missing or null value means unknown, not permission to invent a fact. Keep travel, communication delays, character locations, and the limits of each character's knowledge plausible.

The server-designated player character is controlled by the player. Do not choose that character's actions, dialogue, intentions, or decisions. Control only characters explicitly listed as unassigned and AI-controlled. Do not assume that an unassigned character knows a fact merely because it appears in the canonical reference or campaign data; use that character's recorded knowledge and plausible opportunities to learn it. Never reveal private information through narration or dialogue to a character who does not know or suspect it.

Follow the player's request without treating a proposal or intention as an event that has already happened. Do not claim that campaign state or history has been updated unless the application explicitly records that update. If essential information is missing, state the uncertainty rather than silently filling it in.`;

export type GroqGamePromptContext = {
  startingReference: string;
  currentWorldState: string;
  currentRealmSituation: string;
  eventHistory: string;
  characterAndLocationStatus: string;
  housesAndDiplomacy: string;
  playerCharacterState: string;
  unassignedAiCharacters: string;
  playerRequest: string;
};

export function buildGroqGamePrompt(context: GroqGamePromptContext) {
  const sections = [
    ["STARTING REFERENCE", context.startingReference],
    ["CURRENT WORLD STATE", context.currentWorldState],
    ["CURRENT REALM AND REGIONAL SITUATION", context.currentRealmSituation],
    ["CHRONOLOGICAL EVENT HISTORY", context.eventHistory],
    ["CHARACTERS AND LOCATIONS: CURRENT STATUS", context.characterAndLocationStatus],
    ["HOUSES, WARS, CLAIMS, AND DIPLOMACY", context.housesAndDiplomacy],
    ["PLAYER CHARACTER AND PLAYER STATE", context.playerCharacterState],
    [
      "UNASSIGNED CHARACTERS CONTROLLED BY THE AI",
      context.unassignedAiCharacters,
    ],
    ["PLAYER REQUEST", context.playerRequest],
  ];

  return {
    system: GROQ_GAME_SYSTEM_PROMPT,
    user: sections
      .map(([heading, content]) => `${heading}\n${content.trim()}`)
      .join("\n\n"),
  };
}
