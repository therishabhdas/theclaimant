import assert from "node:assert/strict";
import test from "node:test";
import {
  GameActionValidationError,
  parseStructuredGameTurn,
  parseStructuredWorldTurnResolution,
  reconcilePoliticalOutcomeConflicts,
  simulateGameTurn,
  simulateSimultaneousWorldTurn,
  validateGameTurn,
} from "./engine.ts";

function createSnapshot() {
  return {
    revision: 3,
    turnNumber: 0,
    elapsedDays: 0,
    characters: [
      { id: 1, currentLocationId: 1, currentHouseId: 10, controller: "player" },
      { id: 2, currentLocationId: 3, currentHouseId: 20, controller: "ai" },
      { id: 3, currentLocationId: 1, currentHouseId: 10, controller: "other" },
      { id: 4, currentLocationId: 4, currentHouseId: 30, controller: "ai" },
    ],
    houses: [
      { id: 10, regionId: 100 },
      { id: 20, regionId: 200 },
      { id: 30, regionId: 100 },
    ],
    routes: [
      {
        id: 50,
        originLocationId: 1,
        destinationLocationId: 2,
        catalogStatus: "available",
        blocked: false,
        permissionRequired: false,
        partyDays: { mounted_party: 14, foot_party: 21 },
      },
    ],
    journeys: [],
    regionalEstimates: [{ regionId: 100, forceType: "regional_levy", maximumStrength: 10000 }],
    musterRules: [
      { id: 60, regionId: 100, forceType: "regional_levy", minimumDays: 7, maximumDays: 21 },
    ],
    musterOrders: [],
    diplomacy: [],
    wars: [],
    locations: [
      { id: 1, regionId: 100 },
      { id: 2, regionId: 100 },
      { id: 3, regionId: 200 },
    ],
    politicalPositions: [{ id: 70, status: "active" }],
    politicalDelegations: [{ id: 80, status: "active" }],
  };
}

function politicalAction(operation, overrides = {}) {
  return {
    type: "political_action",
    actorCharacterId: 1,
    operation,
    targetCharacterId: null,
    targetHouseId: null,
    targetLocationId: null,
    authorityPositionId: null,
    delegationId: null,
    targetTitle: null,
    details: "Pursue this action according to the circumstances.",
    isPublic: false,
    ...overrides,
  };
}

function createTurn(actions) {
  return {
    narration: "The realm waits.",
    eventTitle: "The council convenes",
    eventType: "political",
    eventSummary: "A private council convened.",
    actions,
  };
}

test("parses a structured turn and rejects undeclared fields", () => {
  const parsed = parseStructuredGameTurn(createTurn([
    { type: "wait", actorCharacterId: 1, reason: "Observe the court." },
  ]));
  assert.equal(parsed.actions.length, 1);
  assert.throws(
    () => parseStructuredGameTurn({ ...createTurn([]), surprise: true }),
    /invalid response shape/i,
  );
});

test("rejects malformed or unsupported model actions", () => {
  assert.throws(
    () => parseStructuredGameTurn(createTurn([
      { type: "teleport", actorCharacterId: 1 },
    ])),
    /invalid shape/i,
  );
  assert.throws(
    () => parseStructuredGameTurn(createTurn([
      { type: "wait", actorCharacterId: 1, reason: "Wait." },
      { type: "wait", actorCharacterId: 1, reason: "Wait again." },
    ])),
    /invalid response shape/i,
  );
  assert.throws(
    () => parseStructuredGameTurn(createTurn([{
      type: "move",
      actorCharacterId: 1,
      routeOptionId: 50,
      destinationLocationId: 2,
      partyType: "mounted_party",
      partySize: 2_147_483_648,
    }])),
    /invalid shape/i,
  );
});

test("political claims and appointments are attempts, not rank-gated actions", () => {
  const claim = politicalAction("claim_title", {
    targetTitle: "Lord Paramount",
  });
  const appointment = politicalAction("appoint", {
    targetCharacterId: 2,
    targetHouseId: 20,
    targetTitle: "Castellan",
  });
  const parsed = parseStructuredGameTurn(createTurn([claim]));
  assert.equal(parsed.actions[0].type, "political_action");
  assert.deepEqual(validateGameTurn(createSnapshot(), createTurn([claim])), []);
  assert.deepEqual(validateGameTurn(createSnapshot(), createTurn([appointment])), []);

  const result = simulateSimultaneousWorldTurn(createSnapshot(), [
    { action: claim, decision: "accept", reason: "The claim is attempted." },
  ]);
  assert.equal(result.orderResults[0].status, "accepted");
});

test("political actions require real targets and preserve ownership checks", () => {
  const invalidLocation = politicalAction("seize_location", {
    targetLocationId: 999,
  });
  assert.match(
    validateGameTurn(createSnapshot(), createTurn([invalidLocation])).join(" "),
    /does not exist/i,
  );

  const anotherPlayerAction = politicalAction("claim_title", {
    actorCharacterId: 3,
    targetTitle: "Lord Paramount",
  });
  assert.match(
    validateGameTurn(createSnapshot(), createTurn([anotherPlayerAction])).join(" "),
    /controlled by another player/i,
  );
});

test("conflicting political challenges remain attempts for contextual resolution", () => {
  const snapshot = createSnapshot();
  snapshot.politicalPositions = [{ id: 70, status: "active" }];
  const result = simulateSimultaneousWorldTurn(snapshot, [
    {
      action: politicalAction("challenge", { authorityPositionId: 70 }),
      decision: "accept",
      reason: "Challenge the office.",
    },
    {
      action: politicalAction("overthrow", {
        actorCharacterId: 2,
        authorityPositionId: 70,
      }),
      decision: "accept",
      reason: "Challenge the office.",
    },
  ]);
  assert.deepEqual(
    result.orderResults.map((order) => order.status),
    ["accepted", "accepted"],
  );
});

test("blocks actions from another player's assigned character", () => {
  const errors = validateGameTurn(
    createSnapshot(),
    createTurn([{ type: "wait", actorCharacterId: 3, reason: "Wait." }]),
  );
  assert.match(errors.join(" "), /controlled by another player/i);
});

test("validates routes and simulates movement arrival over multiple turns", () => {
  const snapshot = createSnapshot();
  const moveTurn = createTurn([{
    type: "move",
    actorCharacterId: 1,
    routeOptionId: 50,
    destinationLocationId: 2,
    partyType: "mounted_party",
    partySize: 1,
  }]);

  const started = simulateGameTurn(snapshot, moveTurn).snapshot;
  assert.equal(started.journeys[0].status, "in_progress");
  assert.equal(started.characters[0].currentLocationId, 1);
  assert.equal(started.elapsedDays, 7);

  const underway = simulateGameTurn(started, createTurn([
    { type: "wait", actorCharacterId: 2, reason: "Wait for news." },
  ])).snapshot;
  assert.equal(underway.journeys[0].status, "in_progress");

  const advanced = simulateGameTurn(underway, createTurn([
    { type: "wait", actorCharacterId: 2, reason: "Wait for news." },
  ]));
  assert.equal(advanced.snapshot.journeys[0].status, "arrived");
  assert.equal(advanced.snapshot.characters[0].currentLocationId, 2);
  assert.deepEqual(advanced.resolvedEvents, [{ type: "journey_arrived", targetId: -1 }]);
});

test("allows a new move after the prior journey arrives in the same turn", () => {
  const snapshot = createSnapshot();
  snapshot.routes.push({
    id: 51,
    originLocationId: 2,
    destinationLocationId: 3,
    catalogStatus: "available",
    blocked: false,
    permissionRequired: false,
    partyDays: { mounted_party: 7, foot_party: 14 },
  });
  snapshot.journeys.push({
    id: 90,
    characterIds: [1],
    destinationLocationId: 2,
    status: "in_progress",
    elapsedDays: 7,
    estimatedDays: 14,
  });

  const result = simulateGameTurn(snapshot, createTurn([{
    type: "move",
    actorCharacterId: 1,
    routeOptionId: 51,
    destinationLocationId: 3,
    partyType: "mounted_party",
    partySize: 1,
  }]));

  assert.equal(result.snapshot.characters[0].currentLocationId, 2);
  assert.equal(result.snapshot.journeys[0].status, "arrived");
  assert.equal(result.snapshot.journeys[1].status, "in_progress");
  assert.deepEqual(result.resolvedEvents, [{ type: "journey_arrived", targetId: 90 }]);
});

test("rejects unavailable, disconnected, and unestimated routes", () => {
  const snapshot = createSnapshot();
  snapshot.routes[0].catalogStatus = "unavailable";
  const errors = validateGameTurn(snapshot, createTurn([{
    type: "move",
    actorCharacterId: 1,
    routeOptionId: 50,
    destinationLocationId: 2,
    partyType: "mounted_party",
    partySize: 1,
  }]));
  assert.match(errors.join(" "), /not available/i);

  snapshot.routes[0].catalogStatus = "available";
  snapshot.routes[0].blocked = true;
  assert.match(
    validateGameTurn(snapshot, createTurn([{
      type: "move",
      actorCharacterId: 1,
      routeOptionId: 50,
      destinationLocationId: 2,
      partyType: "mounted_party",
      partySize: 1,
    }])).join(" "),
    /closed, blockaded, or destroyed/i,
  );
  snapshot.routes[0].blocked = false;
  snapshot.routes[0].permissionRequired = true;
  assert.match(
    validateGameTurn(snapshot, createTurn([{
      type: "move",
      actorCharacterId: 1,
      routeOptionId: 50,
      destinationLocationId: 2,
      partyType: "mounted_party",
      partySize: 1,
    }])).join(" "),
    /requires permission/i,
  );
  snapshot.routes[0].permissionRequired = false;
  snapshot.routes[0].partyDays = {};
  assert.match(
    validateGameTurn(snapshot, createTurn([{
      type: "move",
      actorCharacterId: 1,
      routeOptionId: 50,
      destinationLocationId: 2,
      partyType: "mounted_party",
      partySize: 1,
    }])).join(" "),
    /no usable travel estimate/i,
  );
});

test("checks muster geography and regional capacity, then completes the order", () => {
  const turn = createTurn([{
    type: "muster",
    actorCharacterId: 1,
    regionId: 100,
    forceSize: 1000,
    ruleId: 60,
  }]);
  const started = simulateGameTurn(createSnapshot(), turn).snapshot;
  assert.equal(started.musterOrders[0].status, "mustering");
  assert.equal(started.musterOrders[0].requiredDays, 14);

  const inProgress = simulateGameTurn(started, createTurn([
    { type: "wait", actorCharacterId: 2, reason: "Wait." },
  ])).snapshot;
  const completed = simulateGameTurn(inProgress, createTurn([
    { type: "wait", actorCharacterId: 2, reason: "Wait." },
  ]));
  assert.equal(completed.snapshot.musterOrders[0].status, "ready");
  assert.deepEqual(completed.resolvedEvents, [{ type: "muster_completed", targetId: -1 }]);

  const invalid = createTurn([{
    type: "muster",
    actorCharacterId: 1,
    regionId: 100,
    forceSize: 10001,
    ruleId: 60,
  }]);
  assert.throws(
    () => simulateGameTurn(createSnapshot(), invalid),
    GameActionValidationError,
  );

  const overcommitted = createSnapshot();
  overcommitted.musterOrders.push({
    id: 70,
    houseId: 10,
    regionId: 100,
    forceSize: 6000,
    requiredDays: 14,
    elapsedDays: 0,
    status: "mustering",
  });
  assert.match(
    validateGameTurn(overcommitted, createTurn([{
      type: "muster",
      actorCharacterId: 1,
      regionId: 100,
      forceSize: 5000,
      ruleId: 60,
    }])).join(" "),
    /remaining regional estimate/i,
  );
});

test("allows a character to muster in a region where they are physically present", () => {
  const snapshot = createSnapshot();
  snapshot.characters[0].currentLocationId = 3;
  snapshot.regionalEstimates.push({
    regionId: 200,
    forceType: "regional_levy",
    maximumStrength: 500,
  });
  snapshot.musterRules.push({
    id: 61,
    regionId: 200,
    forceType: "regional_levy",
    minimumDays: 7,
    maximumDays: 14,
  });
  assert.deepEqual(validateGameTurn(snapshot, createTurn([{
    type: "muster",
    actorCharacterId: 1,
    regionId: 200,
    forceSize: 100,
    ruleId: 61,
  }])), []);
});

test("validates diplomacy proposals and war participation", () => {
  const proposal = createTurn([{
    type: "diplomacy_propose",
    actorCharacterId: 1,
    targetHouseId: 20,
    relationType: "alliance",
    terms: "Mutual defense.",
  }]);
  const proposed = simulateGameTurn(createSnapshot(), proposal).snapshot;
  assert.equal(proposed.diplomacy[0].status, "proposed");

  assert.match(
    validateGameTurn(proposed, createTurn([{
      type: "diplomacy_resolve",
      actorCharacterId: 1,
      diplomacyRecordId: -1,
      status: "active",
    }])).join(" "),
    /cannot resolve/i,
  );

  const resolved = simulateGameTurn(proposed, createTurn([{
    type: "diplomacy_resolve",
    actorCharacterId: 2,
    diplomacyRecordId: -1,
    status: "active",
  }])).snapshot;
  assert.equal(resolved.diplomacy[0].status, "active");

  const war = simulateGameTurn(createSnapshot(), createTurn([{
    type: "war_declare",
    actorCharacterId: 1,
    targetHouseId: 20,
    name: "The Northern Conflict",
    summary: "A declared conflict.",
  }])).snapshot;
  assert.equal(war.wars[0].participants.length, 2);

  const joined = simulateGameTurn(war, createTurn([{
    type: "war_join",
    actorCharacterId: 4,
    warId: -1,
    side: "target",
  }])).snapshot;
  assert.equal(joined.wars[0].participants.length, 3);

  assert.match(
    validateGameTurn(war, createTurn([{
      type: "war_join",
      actorCharacterId: 4,
      warId: -1,
      side: "unaffiliated",
    }])).join(" "),
    /not part of war/i,
  );
});

test("resolves all orders against one snapshot and advances the clock once", () => {
  const snapshot = createSnapshot();
  const result = simulateSimultaneousWorldTurn(snapshot, [
    {
      action: { type: "wait", actorCharacterId: 1, reason: "Wait." },
      decision: "accept",
      reason: "Pass.",
    },
    {
      action: { type: "wait", actorCharacterId: 2, reason: "Wait." },
      decision: "accept",
      reason: "Pass.",
    },
  ]);
  assert.equal(result.snapshot.turnNumber, snapshot.turnNumber + 1);
  assert.equal(result.snapshot.elapsedDays, snapshot.elapsedDays + 7);
  assert.deepEqual(result.orderResults.map((order) => order.status), ["pass", "pass"]);
});

test("resolves three player journeys in one shared world turn", () => {
  const snapshot = createSnapshot();
  snapshot.characters.forEach((character) => {
    character.controller = "player";
  });
  snapshot.routes.push(
    {
      id: 51,
      originLocationId: 3,
      destinationLocationId: 5,
      catalogStatus: "available",
      blocked: false,
      permissionRequired: false,
      partyDays: { mounted_party: 14, foot_party: 21 },
    },
    {
      id: 52,
      originLocationId: 4,
      destinationLocationId: 6,
      catalogStatus: "available",
      blocked: false,
      permissionRequired: false,
      partyDays: { mounted_party: 14, foot_party: 21 },
    },
  );
  const result = simulateSimultaneousWorldTurn(snapshot, [
    { action: { type: "move", actorCharacterId: 1, routeOptionId: 50, destinationLocationId: 2, partyType: "mounted_party", partySize: 1 }, decision: "accept", reason: "Accepted." },
    { action: { type: "move", actorCharacterId: 2, routeOptionId: 51, destinationLocationId: 5, partyType: "mounted_party", partySize: 1 }, decision: "accept", reason: "Accepted." },
    { action: { type: "move", actorCharacterId: 4, routeOptionId: 52, destinationLocationId: 6, partyType: "mounted_party", partySize: 1 }, decision: "accept", reason: "Accepted." },
  ]);

  assert.deepEqual(result.orderResults.map((order) => order.status), [
    "accepted", "accepted", "accepted",
  ]);
  assert.deepEqual(
    result.snapshot.journeys.map((journey) => journey.characterIds),
    [[1], [2], [4]],
  );
  assert.equal(result.snapshot.elapsedDays, snapshot.elapsedDays + 7);
});

test("rejects every order in a simultaneous regional muster overcommit", () => {
  const result = simulateSimultaneousWorldTurn(createSnapshot(), [
    {
      action: {
        type: "muster",
        actorCharacterId: 1,
        regionId: 100,
        forceSize: 6000,
        ruleId: 60,
      },
      decision: "accept",
      reason: "Accepted.",
    },
    {
      action: {
        type: "muster",
        actorCharacterId: 4,
        regionId: 100,
        forceSize: 6000,
        ruleId: 60,
      },
      decision: "accept",
      reason: "Accepted.",
    },
  ]);
  assert.deepEqual(result.orderResults.map((order) => order.status), ["rejected", "rejected"]);
});

test("requires exactly one valid master decision for every actor", () => {
  const response = {
    decisions: [
      { actorCharacterId: 1, decision: "accept", reason: "Within authority." },
      { actorCharacterId: 2, decision: "reject", reason: "The order conflicts." },
    ],
    politicalOutcomes: [],
    eventTitle: "The week concludes",
    eventType: "political",
    canonicalSummary: "The orders were adjudicated.",
  };
  assert.equal(
    parseStructuredWorldTurnResolution(response, [1, 2]).decisions.length,
    2,
  );
  assert.throws(
    () => parseStructuredWorldTurnResolution({
      ...response,
      decisions: response.decisions.slice(0, 1),
    }, [1, 2]),
    /invalid response shape/i,
  );
  assert.throws(
    () => parseStructuredWorldTurnResolution({
      ...response,
      decisions: [
        response.decisions[0],
        { actorCharacterId: 3, decision: "accept", reason: "Unexpected actor." },
      ],
    }, [1, 2]),
    /invalid order decision/i,
  );
});

test("requires one contextual plan per political order and reconciles conflicting effects", () => {
  const decisions = [
    { actorCharacterId: 1, decision: "accept", reason: "The attempt is evaluated." },
    { actorCharacterId: 2, decision: "accept", reason: "The attempt is evaluated." },
  ];
  const outcome = (actorCharacterId) => ({
    actorCharacterId,
    result: "executed",
    consequence: "The office is contested.",
    effects: [{
      type: "position",
      authorityPositionId: 70,
      positionStatus: "contested",
      recognitionStatus: "contested",
      isDisputed: true,
    }],
  });
  const response = {
    decisions,
    politicalOutcomes: [outcome(1), outcome(2)],
    eventTitle: "Claims collide",
    eventType: "political",
    canonicalSummary: "Two claims conflict.",
  };
  assert.equal(
    parseStructuredWorldTurnResolution(response, [1, 2], [1, 2])
      .politicalOutcomes.length,
    2,
  );
  assert.throws(
    () => parseStructuredWorldTurnResolution(
      { ...response, politicalOutcomes: [outcome(1)] },
      [1, 2],
      [1, 2],
    ),
    /invalid response shape/i,
  );
  assert.throws(
    () => parseStructuredWorldTurnResolution({
      ...response,
      politicalOutcomes: [{
        ...outcome(1),
        effects: [...outcome(1).effects, ...outcome(1).effects],
      }, outcome(2)],
    }, [1, 2], [1, 2]),
    /conflicting effects for one record/i,
  );
  const reconciled = reconcilePoliticalOutcomeConflicts(response.politicalOutcomes);
  assert.deepEqual(reconciled.map((plan) => plan.result), ["resisted", "resisted"]);
  assert.deepEqual(reconciled.map((plan) => plan.effects), [[], []]);
});
