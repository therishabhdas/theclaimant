type GameEventKnowledge = {
  id: number;
  occurredAt: string;
  worldDateLabel: string | null;
  eventType: string;
  title: string;
  publicSummary: string | null;
  characterKnowledge: Record<string, string>;
};

type ProjectedKnowledge = {
  factKey?: string;
  state: string;
  fact?: string;
  evidence?: string;
  belief?: string;
};

function numberField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function textField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export function projectCharacterKnowledge(
  characterId: number,
  facts: Record<string, unknown>[],
  secretRows: Record<string, unknown>[],
  secretKnowledge: Record<string, unknown>[],
) {
  const privateFacts = facts.flatMap<ProjectedKnowledge>((fact) => {
    if (numberField(fact, "character_id") !== characterId) return [];
    const state = textField(fact, "knowledge_state");
    const factKey = textField(fact, "fact_key");
    const privateFact = textField(fact, "private_fact");
    const basis = textField(fact, "basis");
    if (!factKey || state === "forgotten") return [];
    if (state === "suspects") {
      return basis
        ? [{ factKey, state, evidence: basis }]
        : [];
    }
    if (state === "knows" || state === "learned") {
      return privateFact
        ? [{ factKey, state, fact: privateFact }]
        : [];
    }
    if (state === "misbelieves") {
      return privateFact
        ? [{ factKey, state, belief: privateFact }]
        : [];
    }
    return [];
  });

  const secretsById = new Map(
    secretRows.flatMap((secret) => {
      const id = numberField(secret, "id");
      const canonicalSummary = textField(secret, "canonical_summary");
      return id !== null && canonicalSummary !== null ? [[id, canonicalSummary] as const] : [];
    }),
  );
  const secretFacts = secretKnowledge.flatMap<ProjectedKnowledge>((entry) => {
    if (numberField(entry, "character_id") !== characterId) {
      return [];
    }
    const state = textField(entry, "knowledge_status");
    if (state === "forgotten") return [];
    const secretId = numberField(entry, "secret_id");
    const canonicalSummary = secretId === null ? null : secretsById.get(secretId);
    if (!canonicalSummary) return [];
    const details = textField(entry, "details");

    if (state === "knows" || state === "learned") {
      return [{
        state,
        fact: canonicalSummary,
        ...(details ? { evidence: details } : {}),
      }];
    }
    if (state === "suspects") {
      return details
        ? [{ state, evidence: details }]
        : [];
    }
    if (state === "misbelieves") {
      return details
        ? [{ state, belief: details }]
        : [];
    }
    return [];
  });

  return { recordedFacts: privateFacts, recordedSecrets: secretFacts };
}

export function projectEventsForCharacter(
  characterId: number,
  events: GameEventKnowledge[],
) {
  const key = String(characterId);
  return events.flatMap((event) => {
    if (event.publicSummary?.trim()) {
      return [{
        id: event.id,
        occurredAt: event.occurredAt,
        worldDateLabel: event.worldDateLabel,
        eventType: event.eventType,
        title: event.title,
        summary: event.publicSummary,
        source: "public",
      }];
    }

    const knownSummary = event.characterKnowledge[key]?.trim();
    if (!knownSummary) return [];
    return [{
      id: event.id,
      occurredAt: event.occurredAt,
      worldDateLabel: event.worldDateLabel,
      eventType: event.eventType,
      title: "Known event",
      summary: knownSummary,
      source: "character_knowledge",
    }];
  });
}
