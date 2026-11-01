import "server-only";

import Groq from "groq-sdk";
import {
  parseStructuredGameTurn,
  parseStructuredWorldTurnResolution,
  type StructuredGameTurn,
  type StructuredWorldTurnResolution,
} from "../game/engine";
import type { GroqGamePrompt } from "./prompt-template";

export const GROQ_MODEL = "openai/gpt-oss-120b";

export function createGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY. Add it to your .env.local file.");
  }

  return new Groq({ apiKey });
}

const GAME_ACTION_CONTRACT = `Return one JSON object with exactly these fields:
{
  "narration": "string",
  "eventTitle": "string",
  "eventType": "political | military | personal | movement | information | promise | decision | other",
  "eventSummary": "string",
  "actions": []
}

Each action must use exactly one of these shapes:
- {"type":"move","actorCharacterId":1,"routeOptionId":1,"destinationLocationId":1,"partyType":"mounted_party | foot_party","partySize":1}
- {"type":"muster","actorCharacterId":1,"regionId":1,"forceSize":1,"ruleId":1}
- {"type":"diplomacy_propose","actorCharacterId":1,"targetHouseId":1,"relationType":"alliance | rivalry | marriage | hostage | treaty | promise | fealty | neutrality | other","terms":"string"}
- {"type":"diplomacy_resolve","actorCharacterId":1,"diplomacyRecordId":1,"status":"active | broken | fulfilled | ended"}
- {"type":"war_declare","actorCharacterId":1,"targetHouseId":1,"name":"string","summary":"string"}
- {"type":"war_join","actorCharacterId":1,"warId":1,"side":"string"}
- {"type":"wait","actorCharacterId":1,"reason":"string"}

Use only numeric IDs present in the supplied campaign state. Treat actions as proposals for deterministic validation, not facts already completed. Include at least one action; use "wait" if no state-changing action is justified. Do not output markdown or additional properties.`;

export async function inferStructuredGameTurn(
  prompt: GroqGamePrompt,
): Promise<StructuredGameTurn> {
  const completion = await createGroqClient().chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${prompt.system}\n\n${GAME_ACTION_CONTRACT}`,
      },
      { role: "user", content: prompt.user },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("Groq returned an empty structured game turn.");
  }

  let generated: unknown;
  try {
    generated = JSON.parse(content);
  } catch (error) {
    throw new Error("Groq returned invalid JSON for the structured game turn.", {
      cause: error,
    });
  }

  return parseStructuredGameTurn(generated);
}

export async function inferStructuredWorldTurnResolution(
  prompt: GroqGamePrompt,
  expectedActorIds: number[],
): Promise<StructuredWorldTurnResolution> {
  const completion = await createGroqClient().chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("Groq returned an empty world-turn resolution.");
  }

  let generated: unknown;
  try {
    generated = JSON.parse(content);
  } catch (error) {
    throw new Error("Groq returned invalid JSON for the world-turn resolution.", {
      cause: error,
    });
  }

  return parseStructuredWorldTurnResolution(generated, expectedActorIds);
}
