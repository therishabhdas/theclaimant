export const GAME_TURN_DAYS = 7;
export const MAX_ACTIONS_PER_TURN = 1;

export const GAME_EVENT_TYPES = [
  "political",
  "military",
  "personal",
  "movement",
  "information",
  "assassination",
  "betrayal",
  "battle",
  "promise",
  "decision",
  "other",
] as const;

export const SUPPORTED_TURN_EVENT_TYPES = [
  "political",
  "military",
  "personal",
  "movement",
  "information",
  "promise",
  "decision",
  "other",
] as const;

export const DIPLOMACY_RELATION_TYPES = [
  "alliance",
  "rivalry",
  "marriage",
  "hostage",
  "treaty",
  "promise",
  "fealty",
  "neutrality",
  "other",
] as const;

export const POLITICAL_ACTION_OPERATIONS = [
  "claim_title",
  "appoint",
  "remove",
  "delegate",
  "revoke_delegation",
  "seize_location",
  "recognize",
  "challenge",
  "overthrow",
  "imprison",
  "defy",
  "betray",
] as const;

export type GameEventType = (typeof GAME_EVENT_TYPES)[number];
export type SupportedTurnEventType = (typeof SUPPORTED_TURN_EVENT_TYPES)[number];
export type DiplomacyRelationType = (typeof DIPLOMACY_RELATION_TYPES)[number];
export type TravelPartyType = "mounted_party" | "foot_party";
export type DiplomacyStatus = "proposed" | "active" | "broken" | "fulfilled" | "ended";
export type WarStatus = "active" | "ended" | "suspended" | "rumored";

export type GameAction =
  | {
      type: "move";
      actorCharacterId: number;
      routeOptionId: number;
      destinationLocationId: number;
      partyType: TravelPartyType;
      partySize: number;
    }
  | {
      type: "muster";
      actorCharacterId: number;
      regionId: number;
      forceSize: number;
      ruleId: number;
    }
  | {
      type: "diplomacy_propose";
      actorCharacterId: number;
      targetHouseId: number;
      relationType: DiplomacyRelationType;
      terms: string;
    }
  | {
      type: "diplomacy_resolve";
      actorCharacterId: number;
      diplomacyRecordId: number;
      status: "active" | "broken" | "fulfilled" | "ended";
    }
  | {
      type: "war_declare";
      actorCharacterId: number;
      targetHouseId: number;
      name: string;
      summary: string;
    }
  | {
      type: "war_join";
      actorCharacterId: number;
      warId: number;
      side: string;
    }
  | {
      type: "political_action";
      actorCharacterId: number;
      operation: (typeof POLITICAL_ACTION_OPERATIONS)[number];
      targetCharacterId: number | null;
      targetHouseId: number | null;
      targetLocationId: number | null;
      authorityPositionId: number | null;
      delegationId: number | null;
      targetTitle: string | null;
      details: string;
      isPublic: boolean;
    }
  | {
      type: "wait";
      actorCharacterId: number;
      reason: string;
    };

export type StructuredGameTurn = {
  narration: string;
  eventTitle: string;
  eventType: SupportedTurnEventType;
  eventSummary: string;
  actions: GameAction[];
};

export type WorldTurnOrderDecision = {
  actorCharacterId: number;
  decision: "accept" | "reject";
  reason: string;
};

export type StructuredWorldTurnResolution = {
  decisions: WorldTurnOrderDecision[];
  eventTitle: string;
  eventType: SupportedTurnEventType;
  canonicalSummary: string;
};

export type EngineCharacter = {
  id: number;
  currentLocationId: number | null;
  currentHouseId: number | null;
  controller: "player" | "ai" | "other";
};

export type EngineRoute = {
  id: number;
  originLocationId: number;
  destinationLocationId: number;
  catalogStatus: "available" | "unavailable";
  blocked: boolean;
  permissionRequired: boolean;
  partyDays: Partial<Record<TravelPartyType, number | null>>;
};

export type EngineJourney = {
  id: number;
  characterIds: number[];
  destinationLocationId: number;
  status:
    | "planned"
    | "awaiting_permission"
    | "ready"
    | "in_progress"
    | "delayed"
    | "arrived";
  elapsedDays: number;
  estimatedDays: number;
};

export type EngineMusterOrder = {
  id: number;
  houseId: number;
  regionId: number;
  forceSize: number;
  requiredDays: number;
  elapsedDays: number;
  status: "mustering" | "ready" | "cancelled";
};

export type EngineDiplomacyRecord = {
  id: number;
  relationType: DiplomacyRelationType;
  status: DiplomacyStatus;
  houseAId: number | null;
  houseBId: number | null;
  characterAId: number | null;
  characterBId: number | null;
};

export type EngineWarParticipant = {
  houseId: number;
  side: string | null;
};

export type EngineWar = {
  id: number;
  name: string;
  status: WarStatus;
  participants: EngineWarParticipant[];
};

export type EnginePoliticalPosition = {
  id: number;
  status: "active" | "vacant" | "contested" | "suspended" | "removed" | "unknown";
};

export type EnginePoliticalDelegation = {
  id: number;
  status: "active" | "revoked" | "expired" | "contested" | "unknown";
};

export type EngineLocation = {
  id: number;
  regionId: number | null;
};

export type EngineSnapshot = {
  revision: number;
  turnNumber: number;
  elapsedDays: number;
  characters: EngineCharacter[];
  houses: { id: number; regionId: number | null }[];
  routes: EngineRoute[];
  journeys: EngineJourney[];
  regionalEstimates: {
    regionId: number;
    forceType: string;
    maximumStrength: number | null;
  }[];
  musterRules: {
    id: number;
    regionId: number | null;
    forceType: string;
    minimumDays: number;
    maximumDays: number;
  }[];
  musterOrders: EngineMusterOrder[];
  diplomacy: EngineDiplomacyRecord[];
  wars: EngineWar[];
  locations?: EngineLocation[];
  politicalPositions?: EnginePoliticalPosition[];
  politicalDelegations?: EnginePoliticalDelegation[];
};

export type GameTurnResult = {
  snapshot: EngineSnapshot;
  resolvedEvents: {
    type: "journey_arrived" | "muster_completed";
    targetId: number;
  }[];
};

export class GameActionValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "GameActionValidationError";
    this.errors = errors;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPositivePgInteger(value: unknown): value is number {
  return isPositiveInteger(value) && value <= 2_147_483_647;
}

function isNullablePositivePgInteger(value: unknown): value is number | null {
  return value === null || isPositivePgInteger(value);
}

function isPositiveSmallint(value: unknown): value is number {
  return isPositiveInteger(value) && value <= 32_767;
}

function isText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function parseAction(value: unknown, index: number): GameAction {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error(`Action ${index + 1} has an invalid shape.`);
  }

  switch (value.type) {
    case "move":
      if (
        !hasExactKeys(value, [
          "type",
          "actorCharacterId",
          "routeOptionId",
          "destinationLocationId",
          "partyType",
          "partySize",
        ]) ||
        !isPositivePgInteger(value.actorCharacterId) ||
        !isPositiveInteger(value.routeOptionId) ||
        !isPositiveInteger(value.destinationLocationId) ||
        !isOneOf(value.partyType, ["mounted_party", "foot_party"]) ||
        !isPositivePgInteger(value.partySize)
      ) {
        throw new Error(`Action ${index + 1} has an invalid shape.`);
      }
      return {
        type: "move",
        actorCharacterId: value.actorCharacterId,
        routeOptionId: value.routeOptionId,
        destinationLocationId: value.destinationLocationId,
        partyType: value.partyType,
        partySize: value.partySize,
      };
    case "muster":
      if (
        !hasExactKeys(value, ["type", "actorCharacterId", "regionId", "forceSize", "ruleId"]) ||
        !isPositivePgInteger(value.actorCharacterId) ||
        !isPositiveSmallint(value.regionId) ||
        !isPositivePgInteger(value.forceSize) ||
        !isPositiveInteger(value.ruleId)
      ) {
        throw new Error(`Action ${index + 1} has an invalid shape.`);
      }
      return {
        type: "muster",
        actorCharacterId: value.actorCharacterId,
        regionId: value.regionId,
        forceSize: value.forceSize,
        ruleId: value.ruleId,
      };
    case "diplomacy_propose":
      if (
        !hasExactKeys(value, [
          "type",
          "actorCharacterId",
          "targetHouseId",
          "relationType",
          "terms",
        ]) ||
        !isPositivePgInteger(value.actorCharacterId) ||
        !isPositiveInteger(value.targetHouseId) ||
        !isOneOf(value.relationType, DIPLOMACY_RELATION_TYPES) ||
        !isText(value.terms, 2000)
      ) {
        throw new Error(`Action ${index + 1} has an invalid shape.`);
      }
      return {
        type: "diplomacy_propose",
        actorCharacterId: value.actorCharacterId,
        targetHouseId: value.targetHouseId,
        relationType: value.relationType,
        terms: value.terms,
      };
    case "diplomacy_resolve":
      if (
        !hasExactKeys(value, ["type", "actorCharacterId", "diplomacyRecordId", "status"]) ||
        !isPositivePgInteger(value.actorCharacterId) ||
        !isPositiveInteger(value.diplomacyRecordId) ||
        !isOneOf(value.status, ["active", "broken", "fulfilled", "ended"])
      ) {
        throw new Error(`Action ${index + 1} has an invalid shape.`);
      }
      return {
        type: "diplomacy_resolve",
        actorCharacterId: value.actorCharacterId,
        diplomacyRecordId: value.diplomacyRecordId,
        status: value.status,
      };
    case "war_declare":
      if (
        !hasExactKeys(value, [
          "type",
          "actorCharacterId",
          "targetHouseId",
          "name",
          "summary",
        ]) ||
        !isPositivePgInteger(value.actorCharacterId) ||
        !isPositiveInteger(value.targetHouseId) ||
        !isText(value.name, 160) ||
        !isText(value.summary, 4000)
      ) {
        throw new Error(`Action ${index + 1} has an invalid shape.`);
      }
      return {
        type: "war_declare",
        actorCharacterId: value.actorCharacterId,
        targetHouseId: value.targetHouseId,
        name: value.name,
        summary: value.summary,
      };
    case "war_join":
      if (
        !hasExactKeys(value, ["type", "actorCharacterId", "warId", "side"]) ||
        !isPositivePgInteger(value.actorCharacterId) ||
        !isPositiveInteger(value.warId) ||
        !isText(value.side, 80)
      ) {
        throw new Error(`Action ${index + 1} has an invalid shape.`);
      }
      return {
        type: "war_join",
        actorCharacterId: value.actorCharacterId,
        warId: value.warId,
        side: value.side,
      };
    case "political_action":
      if (
        !hasExactKeys(value, [
          "type",
          "actorCharacterId",
          "operation",
          "targetCharacterId",
          "targetHouseId",
          "targetLocationId",
          "authorityPositionId",
          "delegationId",
          "targetTitle",
          "details",
          "isPublic",
        ]) ||
        !isPositivePgInteger(value.actorCharacterId) ||
        !isOneOf(value.operation, POLITICAL_ACTION_OPERATIONS) ||
        !isNullablePositivePgInteger(value.targetCharacterId) ||
        !isNullablePositivePgInteger(value.targetHouseId) ||
        !isNullablePositivePgInteger(value.targetLocationId) ||
        !isNullablePositivePgInteger(value.authorityPositionId) ||
        !isNullablePositivePgInteger(value.delegationId) ||
        !(value.targetTitle === null || isText(value.targetTitle, 160)) ||
        !isText(value.details, 2000) ||
        typeof value.isPublic !== "boolean"
      ) {
        throw new Error(`Action ${index + 1} has an invalid shape.`);
      }
      return {
        type: "political_action",
        actorCharacterId: value.actorCharacterId,
        operation: value.operation,
        targetCharacterId: value.targetCharacterId,
        targetHouseId: value.targetHouseId,
        targetLocationId: value.targetLocationId,
        authorityPositionId: value.authorityPositionId,
        delegationId: value.delegationId,
        targetTitle: value.targetTitle,
        details: value.details.trim(),
        isPublic: value.isPublic,
      };
    case "wait":
      if (
        !hasExactKeys(value, ["type", "actorCharacterId", "reason"]) ||
        !isPositivePgInteger(value.actorCharacterId) ||
        !isText(value.reason, 1000)
      ) {
        throw new Error(`Action ${index + 1} has an invalid shape.`);
      }
      return {
        type: "wait",
        actorCharacterId: value.actorCharacterId,
        reason: value.reason,
      };
    default:
      throw new Error(`Action ${index + 1} has an invalid shape.`);
  }
}

export function parseStructuredGameTurn(value: unknown): StructuredGameTurn {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["narration", "eventTitle", "eventType", "eventSummary", "actions"]) ||
    !isText(value.narration, 12000) ||
    !isText(value.eventTitle, 160) ||
    !isOneOf(value.eventType, SUPPORTED_TURN_EVENT_TYPES) ||
    !isText(value.eventSummary, 4000) ||
    !Array.isArray(value.actions) ||
    value.actions.length === 0 ||
    value.actions.length > MAX_ACTIONS_PER_TURN
  ) {
    throw new Error("The generated turn has an invalid response shape.");
  }

  return {
    narration: value.narration.trim(),
    eventTitle: value.eventTitle.trim(),
    eventType: value.eventType,
    eventSummary: value.eventSummary.trim(),
    actions: value.actions.map(parseAction),
  };
}

export function parseStructuredWorldTurnResolution(
  value: unknown,
  expectedActorIds: number[],
): StructuredWorldTurnResolution {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["decisions", "eventTitle", "eventType", "canonicalSummary"]) ||
    !isText(value.eventTitle, 160) ||
    !isOneOf(value.eventType, SUPPORTED_TURN_EVENT_TYPES) ||
    !isText(value.canonicalSummary, 4000) ||
    !Array.isArray(value.decisions) ||
    value.decisions.length !== expectedActorIds.length
  ) {
    throw new Error("The generated world-turn resolution has an invalid response shape.");
  }

  const expected = new Set(expectedActorIds);
  const seen = new Set<number>();
  const decisions = value.decisions.map((entry) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["actorCharacterId", "decision", "reason"]) ||
      !isPositivePgInteger(entry.actorCharacterId) ||
      !isOneOf(entry.decision, ["accept", "reject"]) ||
      !isText(entry.reason, 1000) ||
      !expected.has(entry.actorCharacterId) ||
      seen.has(entry.actorCharacterId)
    ) {
      throw new Error("The generated world-turn resolution contains an invalid order decision.");
    }
    seen.add(entry.actorCharacterId);
    return {
      actorCharacterId: entry.actorCharacterId,
      decision: entry.decision,
      reason: entry.reason.trim(),
    };
  });
  if (seen.size !== expected.size) {
    throw new Error("The generated world-turn resolution omitted an order.");
  }

  return {
    decisions,
    eventTitle: value.eventTitle.trim(),
    eventType: value.eventType,
    canonicalSummary: value.canonicalSummary.trim(),
  };
}

function characterHouse(snapshot: EngineSnapshot, characterId: number) {
  return snapshot.characters.find((character) => character.id === characterId)?.currentHouseId ?? null;
}

function activeJourney(snapshot: EngineSnapshot, characterId: number) {
  return snapshot.journeys.some(
    (journey) =>
      journey.characterIds.includes(characterId) &&
      ["planned", "awaiting_permission", "ready", "in_progress", "delayed"].includes(
        journey.status,
      ),
  );
}

function validateAction(
  snapshot: EngineSnapshot,
  action: GameAction,
  errors: string[],
  simulated: EngineSnapshot,
) {
  const actor = simulated.characters.find(
    (character) => character.id === action.actorCharacterId,
  );
  if (!actor) {
    errors.push(`Character ${action.actorCharacterId} does not exist.`);
    return;
  }
  const originalActor = snapshot.characters.find(
    (character) => character.id === action.actorCharacterId,
  );
  if (originalActor?.controller === "other") {
    errors.push(`Character ${action.actorCharacterId} is controlled by another player.`);
    return;
  }

  switch (action.type) {
    case "move": {
      if (!actor || actor.currentLocationId === null) {
        errors.push(`Character ${action.actorCharacterId} has no known current location.`);
        return;
      }
      if (activeJourney(simulated, actor.id)) {
        errors.push(`Character ${actor.id} is already travelling.`);
        return;
      }
      const route = simulated.routes.find((candidate) => candidate.id === action.routeOptionId);
      if (!route || route.catalogStatus !== "available") {
        errors.push(`Route ${action.routeOptionId} is not available.`);
        return;
      }
      if (route.blocked) {
        errors.push(`Route ${route.id} is currently closed, blockaded, or destroyed.`);
        return;
      }
      if (route.permissionRequired) {
        errors.push(`Route ${route.id} requires permission, which is not yet resolved.`);
        return;
      }
      if (action.destinationLocationId === actor.currentLocationId) {
        errors.push("A character cannot travel to their current location.");
        return;
      }
      const routeMatches =
        (route.originLocationId === actor.currentLocationId &&
          route.destinationLocationId === action.destinationLocationId) ||
        (route.destinationLocationId === actor.currentLocationId &&
          route.originLocationId === action.destinationLocationId);
      if (!routeMatches) {
        errors.push(`Route ${route.id} does not connect the character's current and destination locations.`);
        return;
      }
      const days = route.partyDays[action.partyType];
      if (typeof days !== "number" || !Number.isSafeInteger(days) || days < 1) {
        errors.push(`Route ${route.id} has no usable travel estimate for ${action.partyType}.`);
        return;
      }
      simulated.journeys.push({
        id: -(simulated.journeys.length + 1),
        characterIds: [actor.id],
        destinationLocationId: action.destinationLocationId,
        status: "in_progress",
        elapsedDays: 0,
        estimatedDays: days,
      });
      return;
    }
    case "muster": {
      const houseId = actor ? characterHouse(simulated, actor.id) : null;
      const house = simulated.houses.find((candidate) => candidate.id === houseId);
      const actorRegionId = actor?.currentLocationId === null || actor?.currentLocationId === undefined
        ? null
        : simulated.locations?.find((location) =>
          location.id === actor.currentLocationId,
        )?.regionId ?? null;
      if (
        !houseId ||
        !house ||
        (house.regionId !== action.regionId && actorRegionId !== action.regionId)
      ) {
        errors.push(`Character ${action.actorCharacterId} cannot muster forces in region ${action.regionId}.`);
        return;
      }
      const capacities = simulated.regionalEstimates
        .filter(
          (candidate) =>
            candidate.regionId === action.regionId && candidate.forceType === "regional_levy",
        )
        .map((estimate) => estimate.maximumStrength)
        .filter((strength): strength is number => strength !== null);
      const availableStrength = capacities.length > 0 ? Math.max(...capacities) : null;
      if (availableStrength === null) {
        errors.push(`The military capacity for region ${action.regionId} is unknown.`);
        return;
      }
      const rule = simulated.musterRules.find((candidate) => candidate.id === action.ruleId);
      if (
        !rule ||
        rule.forceType !== "regional_levy" ||
        (rule.regionId !== null && rule.regionId !== action.regionId)
      ) {
        errors.push(`Muster rule ${action.ruleId} does not apply to region ${action.regionId}.`);
        return;
      }
      const committed = simulated.musterOrders
        .filter(
          (order) =>
            order.regionId === action.regionId &&
            order.status !== "cancelled",
        )
        .reduce((total, order) => total + order.forceSize, 0);
      if (committed + action.forceSize > availableStrength) {
        errors.push(
          `The requested muster exceeds the remaining regional estimate of ${availableStrength - committed}.`,
        );
        return;
      }
      const requiredDays = Math.max(1, Math.ceil((rule.minimumDays + rule.maximumDays) / 2));
      simulated.musterOrders.push({
        id: -(simulated.musterOrders.length + 1),
        houseId,
        regionId: action.regionId,
        forceSize: action.forceSize,
        requiredDays,
        elapsedDays: 0,
        status: "mustering",
      });
      return;
    }
    case "diplomacy_propose": {
      const actorHouseId = actor ? characterHouse(simulated, actor.id) : null;
      if (!actorHouseId || actorHouseId === action.targetHouseId) {
        errors.push("Diplomacy proposals require two different houses and an actor with a current house.");
        return;
      }
      if (!simulated.houses.some((house) => house.id === action.targetHouseId)) {
        errors.push(`House ${action.targetHouseId} does not exist.`);
        return;
      }
      const duplicate = simulated.diplomacy.some(
        (record) =>
          record.relationType === action.relationType &&
          record.status === "proposed" &&
          ((record.houseAId === actorHouseId && record.houseBId === action.targetHouseId) ||
            (record.houseBId === actorHouseId && record.houseAId === action.targetHouseId)),
      );
      if (duplicate) {
        errors.push("An unresolved proposal of this type already exists between these houses.");
        return;
      }
      simulated.diplomacy.push({
        id: -(simulated.diplomacy.length + 1),
        relationType: action.relationType,
        status: "proposed",
        houseAId: actorHouseId,
        houseBId: action.targetHouseId,
        characterAId: actor.id,
        characterBId: null,
      });
      return;
    }
    case "diplomacy_resolve": {
      const record = simulated.diplomacy.find(
        (candidate) => candidate.id === action.diplomacyRecordId,
      );
      if (!record || !["proposed", "active"].includes(record.status)) {
        errors.push(`Diplomacy record ${action.diplomacyRecordId} cannot be resolved.`);
        return;
      }
      const actorHouseId = actor ? characterHouse(simulated, actor.id) : null;
      const isParty =
        record.characterAId === actor?.id ||
        record.characterBId === actor?.id ||
        (actorHouseId !== null &&
          (record.houseAId === actorHouseId || record.houseBId === actorHouseId));
      const isResponder =
        record.characterBId === actor?.id ||
        (actorHouseId !== null && record.houseBId === actorHouseId);
      if (!isParty || (record.status === "proposed" && !isResponder)) {
        errors.push(`Character ${action.actorCharacterId} cannot resolve diplomacy record ${record.id}.`);
        return;
      }
      if (record.status === "proposed" && !["active", "ended"].includes(action.status)) {
        errors.push("A proposed diplomatic relation must be accepted or declined.");
        return;
      }
      if (record.status === "active" && action.status === "active") {
        errors.push("An active diplomatic relation cannot be accepted again.");
        return;
      }
      record.status = action.status;
      return;
    }
    case "war_declare": {
      const actorHouseId = actor ? characterHouse(simulated, actor.id) : null;
      if (!actorHouseId || actorHouseId === action.targetHouseId) {
        errors.push("A war requires two different houses and an actor with a current house.");
        return;
      }
      if (!simulated.houses.some((house) => house.id === action.targetHouseId)) {
        errors.push(`House ${action.targetHouseId} does not exist.`);
        return;
      }
      const alreadyAtWar = simulated.wars.some(
        (war) =>
          war.status === "active" &&
          war.participants.some((participant) => participant.houseId === actorHouseId) &&
          war.participants.some((participant) => participant.houseId === action.targetHouseId),
      );
      if (alreadyAtWar) {
        errors.push("These houses are already recorded as opposing participants in an active war.");
        return;
      }
      simulated.wars.push({
        id: -(simulated.wars.length + 1),
        name: action.name,
        status: "active",
        participants: [
          { houseId: actorHouseId, side: "declaring" },
          { houseId: action.targetHouseId, side: "target" },
        ],
      });
      return;
    }
    case "war_join": {
      const actorHouseId = actor ? characterHouse(simulated, actor.id) : null;
      const war = simulated.wars.find((candidate) => candidate.id === action.warId);
      if (!actorHouseId || !war || war.status !== "active") {
        errors.push("Joining a war requires an actor with a house and an active war.");
        return;
      }
      if (war.participants.some((participant) => participant.houseId === actorHouseId)) {
        errors.push(`House ${actorHouseId} already participates in war ${war.id}.`);
        return;
      }
      if (!war.participants.some((participant) => participant.side === action.side)) {
        errors.push(`Side ${action.side} is not part of war ${war.id}.`);
        return;
      }
      war.participants.push({ houseId: actorHouseId, side: action.side });
      return;
    }
    case "political_action": {
      const targetCharacterExists = action.targetCharacterId === null ||
        simulated.characters.some((candidate) => candidate.id === action.targetCharacterId);
      const targetHouseExists = action.targetHouseId === null ||
        simulated.houses.some((candidate) => candidate.id === action.targetHouseId);
      const targetLocationExists = action.targetLocationId === null ||
        simulated.locations?.some((candidate) => candidate.id === action.targetLocationId) === true;
      const position = action.authorityPositionId === null
        ? null
        : simulated.politicalPositions?.find((candidate) =>
          candidate.id === action.authorityPositionId,
        );
      const delegation = action.delegationId === null
        ? null
        : simulated.politicalDelegations?.find((candidate) =>
          candidate.id === action.delegationId,
        );
      const activePosition = position !== null && position !== undefined &&
        !["vacant", "removed"].includes(position.status);

      if (!targetCharacterExists || !targetHouseExists || !targetLocationExists) {
        errors.push("The political action names a character, house, or location that does not exist.");
        return;
      }

      switch (action.operation) {
        case "claim_title":
          if (!action.targetTitle) errors.push("A title claim requires a title.");
          return;
        case "appoint":
          if (action.targetCharacterId === null || !action.targetTitle) {
            errors.push("An appointment requires a character and a position title.");
          }
          return;
        case "remove":
        case "recognize":
        case "challenge":
        case "overthrow":
        case "defy":
          if (!activePosition) {
            errors.push("The political action requires an existing, non-vacant authority position.");
          }
          return;
        case "delegate":
          if (!activePosition || action.targetCharacterId === null ||
              action.targetCharacterId === actor.id) {
            errors.push("Delegation requires an existing position and a different delegate.");
          }
          return;
        case "revoke_delegation":
          if (!delegation || delegation.status !== "active") {
            errors.push("The delegation is not active.");
          }
          return;
        case "seize_location":
          if (action.targetLocationId === null || actor.currentHouseId === null) {
            errors.push("Seizing a location requires an existing location and an associated house.");
          }
          return;
        case "imprison":
          if (action.targetCharacterId === null || action.targetCharacterId === actor.id) {
            errors.push("An imprisonment attempt requires a different target character.");
          }
          return;
        case "betray":
          if (action.targetCharacterId === null && action.targetHouseId === null) {
            errors.push("A betrayal must identify a character or house.");
          }
          return;
      }
    }
    case "wait":
      return;
  }
}

export function validateGameTurn(
  snapshot: EngineSnapshot,
  turn: StructuredGameTurn,
): string[] {
  if (turn.actions.length > MAX_ACTIONS_PER_TURN) {
    return [`A turn may contain no more than ${MAX_ACTIONS_PER_TURN} actions.`];
  }

  const simulated = structuredClone(snapshot);
  const errors: string[] = [];
  for (const action of turn.actions) {
    validateAction(snapshot, action, errors, simulated);
  }
  return errors;
}

export function simulateGameTurn(
  snapshot: EngineSnapshot,
  turn: StructuredGameTurn,
): GameTurnResult {
  const result = simulateSimultaneousWorldTurn(
    snapshot,
    turn.actions.map((action) => ({
      action,
      decision: "accept" as const,
      reason: "Accepted.",
    })),
  );
  const rejected = result.orderResults.filter((order) => order.status === "rejected");
  if (rejected.length > 0) {
    throw new GameActionValidationError(rejected.map((order) => order.reason));
  }
  return {
    snapshot: result.snapshot,
    resolvedEvents: result.resolvedEvents,
  };
}

export type SimultaneousOrder = {
  action: GameAction;
  decision: "accept" | "reject";
  reason: string;
};

export type SimultaneousOrderResult = {
  actorCharacterId: number;
  status: "accepted" | "rejected" | "pass";
  reason: string;
};

export type SimultaneousGameTurnResult = GameTurnResult & {
  orderResults: SimultaneousOrderResult[];
};

function advanceWorldTurn(snapshot: EngineSnapshot) {
  const next = structuredClone(snapshot);
  const resolvedEvents: GameTurnResult["resolvedEvents"] = [];
  next.turnNumber += 1;
  next.elapsedDays += GAME_TURN_DAYS;
  next.revision += 1;

  for (const journey of next.journeys) {
    if (journey.status !== "in_progress" && journey.status !== "delayed") continue;
    journey.elapsedDays += GAME_TURN_DAYS;
    if (journey.elapsedDays >= journey.estimatedDays) {
      journey.status = "arrived";
      for (const characterId of journey.characterIds) {
        const character = next.characters.find((candidate) => candidate.id === characterId);
        if (character) character.currentLocationId = journey.destinationLocationId;
      }
      resolvedEvents.push({ type: "journey_arrived", targetId: journey.id });
    }
  }

  for (const order of next.musterOrders) {
    if (order.status === "cancelled" || order.status === "ready") continue;
    order.elapsedDays += GAME_TURN_DAYS;
    if (order.elapsedDays >= order.requiredDays) {
      order.status = "ready";
      resolvedEvents.push({ type: "muster_completed", targetId: order.id });
    }
  }

  return { next, resolvedEvents };
}

function markGroupedConflicts(
  actions: GameAction[],
  orderResults: SimultaneousOrderResult[],
  groups: Map<string, number[]>,
  message: (action: GameAction) => string,
) {
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      orderResults[index].status = "rejected";
      orderResults[index].reason = message(actions[index]);
    }
  }
}

function applySimultaneousConflicts(
  snapshot: EngineSnapshot,
  orders: SimultaneousOrder[],
  results: SimultaneousOrderResult[],
) {
  const groups = new Map<string, number[]>();
  const add = (key: string, index: number) => {
    const indexes = groups.get(key) ?? [];
    indexes.push(index);
    groups.set(key, indexes);
  };
  const accepted = orders.flatMap((order, index) =>
    order.decision === "accept" && results[index].status !== "rejected"
      ? [{ action: order.action, index }]
      : [],
  );

  for (const { action, index } of accepted) {
    add(`actor:${action.actorCharacterId}`, index);
    if (action.type === "diplomacy_resolve") {
      add(`diplomacy:${action.diplomacyRecordId}`, index);
    } else if (action.type === "diplomacy_propose") {
      const actorHouseId = characterHouse(snapshot, action.actorCharacterId);
      const houses = [actorHouseId, action.targetHouseId].sort((a, b) => (a ?? 0) - (b ?? 0));
      add(`diplomacy:${action.relationType}:${houses.join(":")}`, index);
    } else if (action.type === "war_declare") {
      const actorHouseId = characterHouse(snapshot, action.actorCharacterId);
      const houses = [actorHouseId, action.targetHouseId].sort((a, b) => (a ?? 0) - (b ?? 0));
      add(`war:${houses.join(":")}`, index);
    } else if (action.type === "war_join") {
      const actorHouseId = characterHouse(snapshot, action.actorCharacterId);
      add(`war_join:${action.warId}:${actorHouseId}`, index);
    } else if (action.type === "move") {
      add(`move:${action.actorCharacterId}`, index);
    } else if (action.type === "political_action") {
      if (action.authorityPositionId !== null) {
        add(`authority:${action.authorityPositionId}`, index);
      }
      if (action.targetLocationId !== null) {
        add(`territory:${action.targetLocationId}`, index);
      }
      if (action.delegationId !== null) {
        add(`delegation:${action.delegationId}`, index);
      }
      if (action.targetTitle !== null) {
        const entityId = action.targetHouseId ?? action.targetLocationId ?? "realm";
        add(`office:${entityId}:${action.targetTitle.toLocaleLowerCase()}`, index);
      }
    }
  }

  markGroupedConflicts(orders.map((order) => order.action), results, groups, () =>
    "This order conflicts with another simultaneous order; all orders in the conflict were rejected.",
  );

  const regionalMusterIndexes = new Map<number, number[]>();
  for (const { action, index } of accepted) {
    if (action.type !== "muster" || results[index].status === "rejected") continue;
    const indexes = regionalMusterIndexes.get(action.regionId) ?? [];
    indexes.push(index);
    regionalMusterIndexes.set(action.regionId, indexes);
  }
  for (const [regionId, indexes] of regionalMusterIndexes) {
    const capacity = snapshot.regionalEstimates
      .filter((estimate) =>
        estimate.regionId === regionId &&
        estimate.forceType === "regional_levy" &&
        estimate.maximumStrength !== null,
      )
      .reduce((maximum, estimate) => Math.max(maximum, estimate.maximumStrength ?? 0), 0);
    const existing = snapshot.musterOrders
      .filter((order) => order.regionId === regionId && order.status !== "cancelled")
      .reduce((total, order) => total + order.forceSize, 0);
    const proposed = indexes.reduce((total, index) => {
      const action = orders[index].action;
      return total + (action.type === "muster" ? action.forceSize : 0);
    }, 0);
    if (capacity > 0 && existing + proposed > capacity) {
      for (const index of indexes) {
        results[index].status = "rejected";
        results[index].reason =
          "The simultaneous muster orders exceed regional capacity; all orders in the conflict were rejected.";
      }
    }
  }
}

export function simulateSimultaneousWorldTurn(
  snapshot: EngineSnapshot,
  orders: SimultaneousOrder[],
): SimultaneousGameTurnResult {
  const { next, resolvedEvents } = advanceWorldTurn(snapshot);
  const orderResults = orders.map(({ action, decision, reason }) => ({
    actorCharacterId: action.actorCharacterId,
    status: action.type === "wait"
      ? "pass" as const
      : decision === "reject"
        ? "rejected" as const
        : "accepted" as const,
    reason: action.type === "wait" ? reason : reason,
  }));
  orders.forEach(({ action, decision }, index) => {
    if (decision !== "accept") return;
    const isolated = structuredClone(next);
    const errors: string[] = [];
    validateAction(next, action, errors, isolated);
    if (errors.length > 0) {
      orderResults[index].status = "rejected";
      orderResults[index].reason = errors.join(" ");
    }
  });

  applySimultaneousConflicts(snapshot, orders, orderResults);

  for (const [index, order] of orders.entries()) {
    if (orderResults[index].status !== "accepted") continue;
    const errors: string[] = [];
    validateAction(next, order.action, errors, next);
    if (errors.length > 0) {
      throw new Error(`Simultaneous conflict validation was incomplete: ${errors.join(" ")}`);
    }
  }

  return { snapshot: next, resolvedEvents, orderResults };
}
