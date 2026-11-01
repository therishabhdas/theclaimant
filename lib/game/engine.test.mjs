import assert from "node:assert/strict";
import test from "node:test";
import {
  GameActionValidationError,
  parseStructuredGameTurn,
  parseStructuredWorldTurnResolution,
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

test("checks muster authority and regional capacity, then completes the order", () => {
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
