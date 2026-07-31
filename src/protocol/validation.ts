import {
  BEP_PROTOCOL,
  BEP_RUNTIME_LIMITS,
  BEP_VERSION,
  type BepBoard,
  type BepChannelConnectMessage,
  type BepCheckerCounts,
  type BepCheckerLocation,
  type BepChooseTurnRequest,
  type BepChooseTurnResult,
  type BepCubeDecision,
  type BepCubeDecisionRequest,
  type BepCubeDecisionResult,
  type BepEngineCapabilities,
  type BepEngineError,
  type BepEngineMetadata,
  type BepEngineSettings,
  type BepEngineToHostMessage,
  type BepHelloRequest,
  type BepHelloResult,
  type BepHostToEngineMessage,
  type BepLegalTurn,
  type BepMethod,
  type BepPoint,
  type BepPosition,
  type BepRankedTurn,
  type BepSearchLimits,
  type BepSearchStats,
  type BepStrengthPreset,
  type BepTurnStep,
  type Player,
} from "./types";

export interface BoundedJsonOptions {
  readonly maxMessageBytes?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxStringLength?: number;
  readonly maxArrayLength?: number;
  readonly maxObjectKeys?: number;
}

const MAX_CHECKERS_PER_PLAYER = 15;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_VARIATION_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const containsControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
};

const isBoundedString = (
  value: unknown,
  maxLength = BEP_RUNTIME_LIMITS.maxStringLength,
): value is string => typeof value === "string" && value.length <= maxLength;

export const isBepIdentifier = (value: unknown): value is string =>
  isBoundedString(value, BEP_RUNTIME_LIMITS.maxIdentifierLength) &&
  SAFE_IDENTIFIER_PATTERN.test(value);

const isNonEmptyText = (value: unknown, maxLength = 256): value is string =>
  isBoundedString(value, maxLength) &&
  value.trim().length > 0 &&
  !containsControlCharacter(value);

const isSafeWebUrl = (value: unknown): value is string => {
  if (!isBoundedString(value, BEP_RUNTIME_LIMITS.maxUrlLength)) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      return false;
    }
    if (url.protocol === "https:") {
      return true;
    }
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1")
    );
  } catch {
    return false;
  }
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

const isPlayer = (value: unknown): value is Player =>
  value === "white" || value === "black";

const isNullablePlayer = (value: unknown): value is Player | null =>
  value === null || isPlayer(value);

export function hasBoundedJsonShape(
  value: unknown,
  options: BoundedJsonOptions = {},
): boolean {
  const maxMessageBytes =
    options.maxMessageBytes ?? BEP_RUNTIME_LIMITS.maxMessageBytes;
  const maxDepth = options.maxDepth ?? BEP_RUNTIME_LIMITS.maxDepth;
  const maxNodes = options.maxNodes ?? BEP_RUNTIME_LIMITS.maxNodes;
  const maxStringLength =
    options.maxStringLength ?? BEP_RUNTIME_LIMITS.maxStringLength;
  const maxArrayLength =
    options.maxArrayLength ?? BEP_RUNTIME_LIMITS.maxArrayLength;
  const maxObjectKeys =
    options.maxObjectKeys ?? BEP_RUNTIME_LIMITS.maxObjectKeys;
  const seen = new WeakSet<object>();
  let nodeCount = 0;
  let estimatedBytes = 0;

  const visit = (candidate: unknown, depth: number): boolean => {
    nodeCount += 1;
    if (nodeCount > maxNodes || depth > maxDepth) {
      return false;
    }
    if (candidate === null) {
      estimatedBytes += 4;
      return estimatedBytes <= maxMessageBytes;
    }
    if (typeof candidate === "boolean") {
      estimatedBytes += 5;
      return estimatedBytes <= maxMessageBytes;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        return false;
      }
      estimatedBytes += 24;
      return estimatedBytes <= maxMessageBytes;
    }
    if (typeof candidate === "string") {
      if (candidate.length > maxStringLength) {
        return false;
      }
      estimatedBytes += candidate.length * 2 + 2;
      return estimatedBytes <= maxMessageBytes;
    }
    if (typeof candidate !== "object" || candidate === undefined) {
      return false;
    }
    if (seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      if (candidate.length > maxArrayLength) {
        return false;
      }
      estimatedBytes += candidate.length + 2;
      return (
        estimatedBytes <= maxMessageBytes &&
        candidate.every((item) => visit(item, depth + 1))
      );
    }

    const keys = Object.keys(candidate);
    if (keys.length > maxObjectKeys) {
      return false;
    }
    estimatedBytes += 2;
    for (const key of keys) {
      if (key.length > maxStringLength) {
        return false;
      }
      estimatedBytes += key.length * 2 + 3;
      if (
        estimatedBytes > maxMessageBytes ||
        !visit((candidate as Record<string, unknown>)[key], depth + 1)
      ) {
        return false;
      }
    }
    return true;
  };

  return visit(value, 0);
}

const isCounts = (value: unknown): value is BepCheckerCounts =>
  isRecord(value) &&
  isNonNegativeInteger(value.white) &&
  isNonNegativeInteger(value.black);

const isCheckerCounts = (value: unknown): value is BepCheckerCounts =>
  isCounts(value) &&
  value.white <= MAX_CHECKERS_PER_PLAYER &&
  value.black <= MAX_CHECKERS_PER_PLAYER;

const isPoint = (value: unknown): value is BepPoint =>
  isRecord(value) &&
  isNonNegativeInteger(value.white) &&
  value.white <= MAX_CHECKERS_PER_PLAYER &&
  isNonNegativeInteger(value.black) &&
  value.black <= MAX_CHECKERS_PER_PLAYER &&
  !(value.white > 0 && value.black > 0);

const isBoard = (value: unknown): value is BepBoard => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.points) ||
    value.points.length !== 24 ||
    !value.points.every(isPoint) ||
    !isCheckerCounts(value.bar) ||
    !isCheckerCounts(value.borneOff)
  ) {
    return false;
  }
  const totals = value.points.reduce(
    (sum, point) => ({
      white: sum.white + point.white,
      black: sum.black + point.black,
    }),
    { white: 0, black: 0 },
  );
  return (
    totals.white + value.bar.white + value.borneOff.white === 15 &&
    totals.black + value.bar.black + value.borneOff.black === 15
  );
};

const isCube = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !isPositiveInteger(value.value) ||
    value.value > BEP_RUNTIME_LIMITS.maxCubeValue ||
    (value.value & (value.value - 1)) !== 0 ||
    !isNullablePlayer(value.owner) ||
    !["available", "offered", "accepted", "declined"].includes(
      value.state as string,
    ) ||
    !isNullablePlayer(value.offeredBy)
  ) {
    return false;
  }
  if (value.state === "offered") {
    return (
      value.offeredBy !== null &&
      (value.owner === null || value.owner === value.offeredBy)
    );
  }
  if (value.state === "available" || value.state === "accepted") {
    return value.offeredBy === null;
  }
  return value.offeredBy !== null;
};

const isMatch = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    (value.mode !== "match" && value.mode !== "money") ||
    !isCounts(value.score) ||
    !["none", "crawford", "post-crawford"].includes(value.crawford as string)
  ) {
    return false;
  }
  if (value.mode === "money") {
    return value.length === null && value.crawford === "none";
  }
  if (!isPositiveInteger(value.length)) {
    return false;
  }
  if (value.crawford === "none") {
    return true;
  }
  return (
    value.length > 1 &&
    (value.score.white === value.length - 1 ||
      value.score.black === value.length - 1)
  );
};

const isRules = (value: unknown): boolean =>
  isRecord(value) &&
  isBoundedString(value.variation, 64) &&
  SAFE_VARIATION_PATTERN.test(value.variation) &&
  typeof value.jacoby === "boolean" &&
  typeof value.beavers === "boolean" &&
  typeof value.raccoons === "boolean" &&
  isNonNegativeInteger(value.automaticDoubles) &&
  value.automaticDoubles <= 16;

const isDice = (value: unknown): boolean =>
  Array.isArray(value) &&
  (value.length === 0 ||
    (value.length === 2 &&
      value.every((die) => Number.isInteger(die) && die >= 1 && die <= 6)));

const hasConsistentPositionPhase = (position: BepPosition): boolean => {
  switch (position.phase) {
    case "before-roll":
      return (
        position.dice.length === 0 &&
        position.cube.state !== "offered" &&
        position.cube.state !== "declined"
      );
    case "checker-play":
      return (
        position.dice.length === 2 &&
        position.cube.state !== "offered" &&
        position.cube.state !== "declined"
      );
    case "cube-response":
      return position.dice.length === 0 && position.cube.state === "offered";
    case "game-over":
      return position.dice.length === 0;
  }
};

export const isBepPosition = (value: unknown): value is BepPosition => {
  if (
    isRecord(value) &&
    isBepIdentifier(value.revision) &&
    ["before-roll", "checker-play", "cube-response", "game-over"].includes(
      value.phase as string,
    ) &&
    isBoard(value.board) &&
    isPlayer(value.playerOnRoll) &&
    isDice(value.dice) &&
    isCube(value.cube) &&
    isMatch(value.match) &&
    isRules(value.rules)
  ) {
    return hasConsistentPositionPhase(value as unknown as BepPosition);
  }
  return false;
};

const isLocation = (value: unknown): value is BepCheckerLocation => {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "point") {
    return (
      Number.isInteger(value.point) &&
      (value.point as number) >= 0 &&
      (value.point as number) < 24
    );
  }
  return value.kind === "bar" || value.kind === "borne-off";
};

const isTurnStep = (value: unknown): value is BepTurnStep =>
  isRecord(value) &&
  isLocation(value.from) &&
  isLocation(value.to) &&
  Number.isInteger(value.die) &&
  (value.die as number) >= 1 &&
  (value.die as number) <= 6 &&
  typeof value.hit === "boolean";

const isLegalTurnShape = (value: unknown): value is BepLegalTurn =>
  isRecord(value) &&
  isBepIdentifier(value.id) &&
  Array.isArray(value.steps) &&
  value.steps.length > 0 &&
  value.steps.length <= BEP_RUNTIME_LIMITS.maxTurnSteps &&
  value.steps.every(isTurnStep) &&
  (value.resultingBoard === undefined || isBoard(value.resultingBoard));

const sameLocation = (
  left: BepCheckerLocation,
  right: BepCheckerLocation,
): boolean =>
  left.kind === right.kind &&
  (left.kind !== "point" ||
    (right.kind === "point" && left.point === right.point));

const isStepDirectionValid = (step: BepTurnStep, player: Player): boolean => {
  if (
    step.from.kind === "borne-off" ||
    step.to.kind === "bar" ||
    sameLocation(step.from, step.to) ||
    (step.hit && step.to.kind !== "point")
  ) {
    return false;
  }
  if (step.from.kind === "bar") {
    return (
      step.to.kind === "point" &&
      step.to.point === (player === "white" ? 24 - step.die : step.die - 1)
    );
  }
  if (step.to.kind === "borne-off") {
    return player === "white"
      ? step.die >= step.from.point + 1
      : step.die >= 24 - step.from.point;
  }
  return player === "white"
    ? step.to.point === step.from.point - step.die
    : step.to.point === step.from.point + step.die;
};

const isLegalTurnForRequest = (
  value: unknown,
  player: Player,
  dice: readonly [number, number],
): value is BepLegalTurn => {
  if (!isLegalTurnShape(value)) {
    return false;
  }
  const remainingDice =
    dice[0] === dice[1] ? Array(4).fill(dice[0]) : [...dice];
  for (const step of value.steps) {
    const dieIndex = remainingDice.indexOf(step.die);
    if (dieIndex < 0 || !isStepDirectionValid(step, player)) {
      return false;
    }
    remainingDice.splice(dieIndex, 1);
  }
  return true;
};

const STRENGTH_PRESETS: readonly BepStrengthPreset[] = [
  "beginner",
  "casual",
  "intermediate",
  "expert",
  "maximum",
];

export const isBepStrengthPreset = (
  value: unknown,
): value is BepStrengthPreset =>
  STRENGTH_PRESETS.some((preset) => preset === value);

const isSearchLimits = (value: unknown): value is BepSearchLimits =>
  isRecord(value) &&
  (value.timeMs === undefined ||
    (isPositiveInteger(value.timeMs) &&
      value.timeMs <= BEP_RUNTIME_LIMITS.maxTimeMs)) &&
  (value.maxDepth === undefined ||
    (isPositiveInteger(value.maxDepth) &&
      value.maxDepth <= BEP_RUNTIME_LIMITS.maxDepth)) &&
  (value.maxNodes === undefined ||
    (isPositiveInteger(value.maxNodes) &&
      value.maxNodes <= BEP_RUNTIME_LIMITS.maxNodes)) &&
  (value.memoryMb === undefined ||
    (isPositiveInteger(value.memoryMb) &&
      value.memoryMb <= BEP_RUNTIME_LIMITS.maxMemoryMb)) &&
  (value.candidateLimit === undefined ||
    (isPositiveInteger(value.candidateLimit) &&
      value.candidateLimit <= BEP_RUNTIME_LIMITS.maxLegalTurns));

const isEngineSettings = (value: unknown): value is BepEngineSettings =>
  isRecord(value) &&
  isBepStrengthPreset(value.strength) &&
  isSearchLimits(value.limits) &&
  isRecord(value.randomization) &&
  (value.randomization.mode === "deterministic" ||
    value.randomization.mode === "varied") &&
  isBoundedString(value.randomization.seed, 256) &&
  isFiniteNumber(value.randomization.variability) &&
  value.randomization.variability >= 0 &&
  value.randomization.variability <= 1;

const isHelloRequest = (value: unknown): value is BepHelloRequest =>
  isRecord(value) &&
  Array.isArray(value.supportedProtocolVersions) &&
  value.supportedProtocolVersions.length > 0 &&
  value.supportedProtocolVersions.every((version) => version === BEP_VERSION) &&
  isRecord(value.host) &&
  isNonEmptyText(value.host.name) &&
  isBepIdentifier(value.host.version);

export const isBepChooseTurnRequest = (
  value: unknown,
): value is BepChooseTurnRequest =>
  isRecord(value) &&
  isPlayer(value.enginePlayer) &&
  isBepPosition(value.position) &&
  value.position.phase === "checker-play" &&
  value.position.dice.length === 2 &&
  value.enginePlayer === value.position.playerOnRoll &&
  Array.isArray(value.legalTurns) &&
  value.legalTurns.length > 0 &&
  value.legalTurns.length <= BEP_RUNTIME_LIMITS.maxLegalTurns &&
  value.legalTurns.every((turn) =>
    isLegalTurnForRequest(
      turn,
      value.enginePlayer as Player,
      (value.position as BepPosition).dice as readonly [number, number],
    ),
  ) &&
  new Set(value.legalTurns.map((turn) => (turn as BepLegalTurn).id)).size ===
    value.legalTurns.length &&
  isEngineSettings(value.settings);

const CUBE_DECISIONS: readonly BepCubeDecision[] = [
  "double",
  "no-double",
  "too-good",
  "take",
  "pass",
  "beaver",
];

export const isBepCubeDecision = (
  value: unknown,
): value is BepCubeDecision =>
  CUBE_DECISIONS.some((decision) => decision === value);

export const isBepCubeDecisionRequest = (
  value: unknown,
): value is BepCubeDecisionRequest => {
  if (
    !isRecord(value) ||
    !isPlayer(value.enginePlayer) ||
    !isBepPosition(value.position) ||
    (value.phase !== "consider-offer" &&
      value.phase !== "respond-to-offer") ||
    !Array.isArray(value.legalDecisions) ||
    value.legalDecisions.length === 0 ||
    value.legalDecisions.length > CUBE_DECISIONS.length ||
    !value.legalDecisions.every(isBepCubeDecision) ||
    new Set(value.legalDecisions).size !== value.legalDecisions.length ||
    !isEngineSettings(value.settings)
  ) {
    return false;
  }
  if (value.phase === "consider-offer") {
    return (
      value.position.phase === "before-roll" &&
      value.enginePlayer === value.position.playerOnRoll &&
      value.legalDecisions.every(
        (decision) =>
          decision === "double" ||
          decision === "no-double" ||
          decision === "too-good",
      )
    );
  }
  return (
    value.position.phase === "cube-response" &&
    value.position.cube.state === "offered" &&
    value.position.cube.offeredBy !== null &&
    value.enginePlayer !== value.position.cube.offeredBy &&
    value.legalDecisions.every(
      (decision) =>
        decision === "take" ||
        decision === "pass" ||
        (decision === "beaver" &&
          (value.position as BepPosition).match.mode === "money" &&
          (value.position as BepPosition).rules.beavers),
    )
  );
};

const isEngineCapabilities = (
  value: unknown,
): value is BepEngineCapabilities =>
  isRecord(value) &&
  typeof value.chooseTurn === "boolean" &&
  typeof value.cubeOffer === "boolean" &&
  typeof value.cubeResponse === "boolean" &&
  typeof value.positionEvaluation === "boolean" &&
  typeof value.moveRanking === "boolean" &&
  typeof value.rollout === "boolean" &&
  typeof value.matchPlay === "boolean" &&
  typeof value.moneyPlay === "boolean" &&
  typeof value.cancellation === "boolean" &&
  typeof value.deterministic === "boolean" &&
  Array.isArray(value.variations) &&
  value.variations.length <= 64 &&
  value.variations.every(
    (variation) =>
      isBoundedString(variation, 64) &&
      SAFE_VARIATION_PATTERN.test(variation),
  ) &&
  new Set(value.variations).size === value.variations.length &&
  Array.isArray(value.strengthPresets) &&
  value.strengthPresets.every(isBepStrengthPreset) &&
  new Set(value.strengthPresets).size === value.strengthPresets.length;

const isEngineMetadata = (value: unknown): value is BepEngineMetadata =>
  isRecord(value) &&
  isBepIdentifier(value.engineId) &&
  isNonEmptyText(value.name) &&
  isBepIdentifier(value.version) &&
  isBepIdentifier(value.buildId) &&
  Array.isArray(value.protocolVersions) &&
  value.protocolVersions.length > 0 &&
  value.protocolVersions.every((version) => version === BEP_VERSION) &&
  isRecord(value.license) &&
  isBepIdentifier(value.license.spdxId) &&
  (value.license.name === undefined || isNonEmptyText(value.license.name)) &&
  (value.license.sourceUrl === undefined ||
    isSafeWebUrl(value.license.sourceUrl)) &&
  (value.license.licenseUrl === undefined ||
    isSafeWebUrl(value.license.licenseUrl)) &&
  isRecord(value.runtime) &&
  ["worker", "iframe", "http"].includes(value.runtime.transport as string) &&
  (value.runtime.approximateDownloadBytes === undefined ||
    isNonNegativeInteger(value.runtime.approximateDownloadBytes)) &&
  (value.runtime.approximateMemoryBytes === undefined ||
    isNonNegativeInteger(value.runtime.approximateMemoryBytes)) &&
  isEngineCapabilities(value.capabilities);

const isHelloResult = (value: unknown): value is BepHelloResult =>
  isRecord(value) &&
  value.selectedProtocolVersion === BEP_VERSION &&
  isEngineMetadata(value.metadata);

const isSearchStats = (value: unknown): value is BepSearchStats =>
  isRecord(value) &&
  isFiniteNumber(value.elapsedMs) &&
  value.elapsedMs >= 0 &&
  (value.nodes === undefined || isNonNegativeInteger(value.nodes)) &&
  (value.depth === undefined || isNonNegativeInteger(value.depth)) &&
  value.completed === true;

const isRankedTurn = (value: unknown): value is BepRankedTurn =>
  isRecord(value) &&
  isBepIdentifier(value.turnId) &&
  isPositiveInteger(value.rank) &&
  (value.score === undefined || isFiniteNumber(value.score));

const isChooseTurnResult = (value: unknown): value is BepChooseTurnResult => {
  if (
    !isRecord(value) ||
    !isBepIdentifier(value.positionRevision) ||
    !isBepIdentifier(value.chosenTurnId) ||
    (value.rankedTurns !== undefined &&
      (!Array.isArray(value.rankedTurns) ||
        value.rankedTurns.length > BEP_RUNTIME_LIMITS.maxLegalTurns ||
        !value.rankedTurns.every(isRankedTurn))) ||
    !isSearchStats(value.stats)
  ) {
    return false;
  }
  if (value.rankedTurns === undefined) {
    return true;
  }
  const rankedTurns = value.rankedTurns as BepRankedTurn[];
  const turnIds = rankedTurns.map(({ turnId }) => turnId);
  const ranks = rankedTurns.map(({ rank }) => rank);
  return (
    new Set(turnIds).size === turnIds.length &&
    new Set(ranks).size === ranks.length &&
    [...ranks]
      .sort((left, right) => left - right)
      .every((rank, index) => rank === index + 1)
  );
};

const isCubeResult = (value: unknown): value is BepCubeDecisionResult =>
  isRecord(value) &&
  isBepIdentifier(value.positionRevision) &&
  isBepCubeDecision(value.decision) &&
  isSearchStats(value.stats);

const ENGINE_ERROR_CODES = new Set([
  "unsupported",
  "invalid-request",
  "invalid-position",
  "illegal-turn",
  "not-ready",
  "busy",
  "timeout",
  "cancelled",
  "engine-crash",
  "asset-load-failed",
  "version-mismatch",
  "transport-error",
  "stale-position",
  "disposed",
  "internal-error",
]);

export const isBepEngineError = (value: unknown): value is BepEngineError =>
  isRecord(value) &&
  ENGINE_ERROR_CODES.has(value.code as string) &&
  isNonEmptyText(value.message, 2_048) &&
  typeof value.retryable === "boolean" &&
  (value.details === undefined ||
    (isRecord(value.details) && hasBoundedJsonShape(value.details)));

const hasValidEnvelopeBase = (value: Record<string, unknown>): boolean =>
  value.protocol === BEP_PROTOCOL &&
  value.version === BEP_VERSION &&
  isBepIdentifier(value.sessionNonce);

export const isBepChannelConnectMessage = (
  value: unknown,
): value is BepChannelConnectMessage =>
  hasBoundedJsonShape(value) &&
  isRecord(value) &&
  hasValidEnvelopeBase(value) &&
  value.kind === "bep.channel-connect";

export const isBepMethod = (value: unknown): value is BepMethod =>
  value === "hello" || value === "choose-turn" || value === "decide-cube";

const isRequestPayload = (method: BepMethod, payload: unknown): boolean => {
  switch (method) {
    case "hello":
      return isHelloRequest(payload);
    case "choose-turn":
      return isBepChooseTurnRequest(payload);
    case "decide-cube":
      return isBepCubeDecisionRequest(payload);
  }
};

const isResultPayload = (method: BepMethod, payload: unknown): boolean => {
  switch (method) {
    case "hello":
      return isHelloResult(payload);
    case "choose-turn":
      return isChooseTurnResult(payload);
    case "decide-cube":
      return isCubeResult(payload);
  }
};

export const isBepHostToEngineMessage = (
  value: unknown,
  options: BoundedJsonOptions = {},
): value is BepHostToEngineMessage => {
  if (!hasBoundedJsonShape(value, options) || !isRecord(value)) {
    return false;
  }
  if (!hasValidEnvelopeBase(value)) {
    return false;
  }
  if (value.kind === "bep.dispose") {
    return true;
  }
  if (value.kind === "bep.cancel") {
    return (
      isBepIdentifier(value.requestId) &&
      ["caller", "timeout", "stale", "dispose"].includes(
        value.reason as string,
      )
    );
  }
  return (
    value.kind === "bep.request" &&
    isBepIdentifier(value.requestId) &&
    isBepMethod(value.method) &&
    isRequestPayload(value.method, value.payload)
  );
};

export const isBepEngineToHostMessage = (
  value: unknown,
  options: BoundedJsonOptions = {},
): value is BepEngineToHostMessage => {
  if (!hasBoundedJsonShape(value, options) || !isRecord(value)) {
    return false;
  }
  if (
    !hasValidEnvelopeBase(value) ||
    !isBepIdentifier(value.requestId) ||
    !isBepMethod(value.method)
  ) {
    return false;
  }
  if (value.kind === "bep.error") {
    return isBepEngineError(value.error);
  }
  return (
    value.kind === "bep.result" &&
    isResultPayload(value.method, value.payload)
  );
};
