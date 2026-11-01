import assert from "node:assert/strict";
import test from "node:test";
import {
  projectCharacterKnowledge,
  projectEventsForCharacter,
} from "./knowledge.ts";

test("projects each generic knowledge state without canonicalizing suspicions", () => {
  const projection = projectCharacterKnowledge(
    7,
    [
      { character_id: 7, fact_key: "known", knowledge_state: "knows", private_fact: "Known fact." },
      { character_id: 7, fact_key: "learned", knowledge_state: "learned", private_fact: "Learned fact." },
      { character_id: 7, fact_key: "suspected", knowledge_state: "suspects", private_fact: "Canonical secret.", basis: "A witness contradicted the official account." },
      { character_id: 7, fact_key: "false", knowledge_state: "misbelieves", private_fact: "Incorrect belief." },
      { character_id: 7, fact_key: "forgotten", knowledge_state: "forgotten", private_fact: "Forgotten fact." },
      { character_id: 7, fact_key: "legacy", knowledge_state: "unclassified_legacy", private_fact: "Do not project this." },
    ],
    [{ id: 1, canonical_summary: "The complete secret." }],
    [
      { character_id: 7, secret_id: 1, knowledge_status: "suspects", details: "A sealed letter is suspicious." },
      { character_id: 7, secret_id: 1, knowledge_status: "misbelieves", details: "The character's incorrect version." },
      { character_id: 7, secret_id: 1, knowledge_status: "knows", details: "Learned from a reliable source." },
    ],
  );

  assert.deepEqual(projection.recordedFacts, [
    { factKey: "known", state: "knows", fact: "Known fact." },
    { factKey: "learned", state: "learned", fact: "Learned fact." },
    {
      factKey: "suspected",
      state: "suspects",
      evidence: "A witness contradicted the official account.",
    },
    { factKey: "false", state: "misbelieves", belief: "Incorrect belief." },
  ]);
  assert.deepEqual(projection.recordedSecrets, [
    { state: "suspects", evidence: "A sealed letter is suspicious." },
    { state: "misbelieves", belief: "The character's incorrect version." },
    {
      state: "knows",
      fact: "The complete secret.",
      evidence: "Learned from a reliable source.",
    },
  ]);
  assert.equal(
    JSON.stringify(projection).includes("Canonical secret."),
    false,
  );
  assert.equal(JSON.stringify(projection).includes("unclassified_legacy"), false);
  assert.equal(JSON.stringify(projection).includes("Do not project this."), false);
});

test("projects public events and character-only knowledge without canonical summaries", () => {
  const projected = projectEventsForCharacter(7, [
    {
      id: 1,
      occurredAt: "298 AC",
      worldDateLabel: null,
      eventType: "political",
      title: "Public event",
      publicSummary: "The court announced a new decree.",
      characterKnowledge: {},
    },
    {
      id: 2,
      occurredAt: "298 AC",
      worldDateLabel: null,
      eventType: "personal",
      title: "Canonical secret title",
      publicSummary: null,
      characterKnowledge: { "7": "The character heard an uncertain rumor." },
    },
    {
      id: 3,
      occurredAt: "298 AC",
      worldDateLabel: null,
      eventType: "personal",
      title: "Hidden event",
      publicSummary: null,
      characterKnowledge: {},
    },
  ]);

  assert.deepEqual(projected.map((event) => event.summary), [
    "The court announced a new decree.",
    "The character heard an uncertain rumor.",
  ]);
  assert.equal(JSON.stringify(projected).includes("Canonical secret title"), false);
});
