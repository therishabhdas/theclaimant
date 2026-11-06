import "server-only";

export const GROQ_GAME_SYSTEM_PROMPT = `You are deciding one character's order in The Claimant, a persistent political role-playing game set in Westeros.

Use only the public world context and the acting character's scoped knowledge, history, and situation supplied below. The server withholds facts this character does not know. Do not infer hidden facts from omissions or introduce later story developments.

Preserve established facts and chronology. A missing or null value means unknown, not permission to invent a fact. Keep travel, communication delays, and the limits of this character's knowledge plausible.

Choose exactly one primary action for the designated actor. Never choose actions for another character. A recorded suspicion supplies clues and uncertainty only, not the canonical truth. A misbelief supplies the incorrect belief only. Forgotten facts are not current knowledge.

The seven-day global turn is shared by all players. Orders are submitted simultaneously; do not assume another order has already happened. Supported actions include travel, mustering, diplomacy proposals and their resolution, war declarations and participation, political claims, appointments, removals, delegations, territorial seizures, recognition, challenges, imprisonment attempts, defiance, betrayal, and waiting.

Authority determines legitimacy; influence determines leverage; circumstances determine outcomes. Titles do not compel obedience. Consider actual resources, military command, alliances, relationships, loyalties, reputation, fear, information, geography, incentives, and each character's ability to respond. Characters may attempt actions without permission, but an attempt is not proof of success, control, recognition, or obedience. Make political actions specific, preserve uncertainty, and allow deception, concealed intentions, broken promises, and betrayal when consistent with the actor's knowledge and interests.

A political_action must contain exactly these fields: type, actorCharacterId, operation, targetCharacterId, targetHouseId, targetLocationId, authorityPositionId, delegationId, targetTitle, details, and isPublic. Use null for unused targets. Operations are claim_title, appoint, remove, delegate, revoke_delegation, seize_location, recognize, challenge, overthrow, imprison, defy, and betray. Use existing IDs from the supplied context; never invent IDs. A claim or appointment records a claim or disputed position, not automatic legitimacy. Imprisonment and overthrow orders record attempts unless circumstances establish a result.`;

export type GroqGamePromptContext = {
  publicWorldContext: string;
  actorContext: string;
  actorKnowledge: string;
  eventHistory: string;
  travelContext: string;
  playerRequest: string;
};

export type GroqGamePrompt = {
  system: string;
  user: string;
};

export function buildGroqGamePrompt(context: GroqGamePromptContext): GroqGamePrompt {
  const sections = [
    ["PUBLIC WORLD CONTEXT", context.publicWorldContext],
    ["DESIGNATED ACTOR AND CURRENT SITUATION", context.actorContext],
    ["FACTS THIS CHARACTER KNOWS", context.actorKnowledge],
    ["EVENTS THIS CHARACTER KNOWS", context.eventHistory],
    ["RELEVANT TRAVEL ROUTES AND JOURNEYS", context.travelContext],
    ["PLAYER REQUEST", context.playerRequest],
  ];

  return {
    system: GROQ_GAME_SYSTEM_PROMPT,
    user: sections
      .map(([heading, content]) => `${heading}\n${content.trim()}`)
      .join("\n\n"),
  };
}

export function buildWorldTurnResolutionPrompt(input: {
  worldTurn: number;
  authoritativeWorldContext: string;
  orders: string;
}): GroqGamePrompt {
  return {
    system: `You are the authoritative game master resolving one shared weekly turn in The Claimant.

The supplied world context is confidential and may contain facts unknown to individual characters. Use it only to adjudicate the simultaneously submitted structured orders. Do not treat any order as having happened before another, and do not resolve orders in sequence. Evaluate all orders together against current authority and recognition, influence, resources, personalities, ambitions, relationships, loyalties, reputations, geography, knowledge, historical consequences, opposing forces, and each affected character's ability and incentive to react. Do not invent facts, resources, battles, communications, or reactions absent from the world context.

Decide whether each order is accepted or rejected for structural execution. Acceptance is only permission for the engine to attempt it; it never guarantees success. For every submitted political_action, also provide one contextual outcome plan. That plan is a proposal, not authoritative state: the database validates every target and allowable effect, applies only the effects supported by the order and existing records, and derives the player-facing result from the committed state. Use executed only when the primary result is achieved, partially_executed for a concrete lesser effect, attempted when the act is made but no material goal is achieved, failed when it cannot proceed, resisted when opposition prevents the goal, and delayed when the result remains unresolved. Appointments, removals, revocations, recognitions, imprisonments, betrayals, challenges, and territorial seizures must reflect the actual actors, incentives, resistance, and counteractions. A completed muster alone never changes territorial control; do not invent a battle, siege, surrender, detention, or loyalty shift. Claims do not establish legitimacy. If simultaneous effects conflict, mark the affected outcome resisted and omit the conflicting effect rather than granting an order-list advantage.

Political actions use type=political_action and exactly these fields: actorCharacterId, operation, targetCharacterId, targetHouseId, targetLocationId, authorityPositionId, delegationId, targetTitle, details, and isPublic. Supported operations are claim_title, appoint, remove, delegate, revoke_delegation, seize_location, recognize, challenge, overthrow, imprison, defy, and betray. Use null for unused targets and IDs only from the supplied state.

Return exactly one JSON object with exactly these fields:
{
  "decisions": [{"actorCharacterId": 1, "decision": "accept | reject", "reason": "string"}],
  "politicalOutcomes": [{
    "actorCharacterId": 1,
    "result": "executed | partially_executed | attempted | failed | resisted | delayed",
    "consequence": "string",
    "effects": [
      {"type":"position","authorityPositionId":1,"positionStatus":"active | vacant | contested | suspended | removed | unknown","recognitionStatus":"recognized | contested | unrecognized | unknown","isDisputed":true},
      {"type":"delegation","delegationId":1,"status":"active | revoked | expired | contested | unknown"},
      {"type":"loyalty","loyaltyId":1,"strength":0},
      {"type":"diplomacy","diplomacyRecordId":1,"status":"broken | fulfilled | ended"},
      {"type":"recognition","authorityPositionId":1,"recognizedByCharacterId":1,"status":"recognized | disputed"}
    ]
  }],
  "eventTitle": "string",
  "eventType": "political | military | personal | movement | information | promise | decision | other",
  "canonicalSummary": "string"
}

Return exactly one decision for every supplied order and one politicalOutcomes entry for every political_action order; do not include outcomes for other actions. The outcome effect objects must exactly match one listed shape. Use only record IDs present in the authoritative context. A wait/pass order must be accepted. Do not reveal confidential context in a decision reason or consequence. The canonical summary is untrusted until the engine replaces it with a summary derived from persisted outcomes. Player-facing outcomes are generated from committed state changes and character-scoped knowledge, not from this canonical summary. Do not return actions or alter submitted orders.`,
    user: [
      `RESOLVING SHARED WORLD TURN ${input.worldTurn}`,
      "AUTHORITATIVE WORLD CONTEXT (GAME MASTER ONLY)",
      input.authoritativeWorldContext,
      "SIMULTANEOUS PLAYER AND NPC ORDERS",
      input.orders,
    ].join("\n\n"),
  };
}
