import {
  BEP_ANALYSIS_SCHEMA_VERSION,
  BEP_ANALYSIS_LIMITS,
  type BepAnalysisMethod,
  type BepAnalysisProfile,
  type BepAnalysisCapabilities,
  type BepAnalysisRequest,
  type BepAnalysisCandidate,
  type BepAnalysisProvenance,
  type BepAnalyzeCheckerRequest,
  type BepAnalyzeCheckerResult,
  type BepAnalyzeCubeRequest,
  type BepAnalyzeCubeResult,
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
import { isLoopbackHostname } from "../shared/webUrl";

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
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
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

const isBepSessionNonce = (value: unknown): value is string =>
  isBepIdentifier(value) &&
  value.length >= BEP_RUNTIME_LIMITS.minSessionNonceLength;

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
    return url.protocol === "http:" && isLoopbackHostname(url.hostname);
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
  if (
    !isPositiveInteger(value.length) ||
    value.length > BEP_RUNTIME_LIMITS.maxMatchLength
  ) {
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

const isMatchCubeWithinRange = (match: unknown, cube: unknown): boolean =>
  isRecord(match) &&
  isRecord(cube) &&
  (match.mode !== "match" ||
    (typeof cube.value === "number" &&
      cube.value <= BEP_RUNTIME_LIMITS.maxMatchCubeValue));

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
    isMatchCubeWithinRange(value.match, value.cube) &&
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

export function isBepAnalysisProfile(value: unknown): value is BepAnalysisProfile {
  return value === "quick-0ply-v1" || value === "deep-2ply-v1";
}

function isAnalysisCapabilities(value: unknown): value is BepAnalysisCapabilities {
  return isRecord(value) &&
    Array.isArray(value.schemaVersions) && value.schemaVersions.length === 1 &&
    value.schemaVersions[0] === BEP_ANALYSIS_SCHEMA_VERSION &&
    Array.isArray(value.methods) && value.methods.length > 0 && value.methods.length <= 2 &&
    value.methods.every((method) => method === "analyze-checker" || method === "analyze-cube") &&
    new Set(value.methods).size === value.methods.length &&
    Array.isArray(value.profiles) && value.profiles.length > 0 && value.profiles.length <= 2 &&
    value.profiles.every(isBepAnalysisProfile) &&
    new Set(value.profiles).size === value.profiles.length &&
    (value.quickProvenance === undefined ||
      (isBepAnalysisProvenance(value.quickProvenance) &&
        value.quickProvenance.effectiveProfile === "quick-0ply-v1" &&
        value.profiles.includes("quick-0ply-v1"))) &&
    (value.deepProvenance === undefined ||
      (isBepAnalysisProvenance(value.deepProvenance) &&
        value.deepProvenance.effectiveProfile === "deep-2ply-v1" &&
        value.profiles.includes("deep-2ply-v1")));
}

export function hasBepAnalysisCapability(
  metadata: BepEngineMetadata,
  method: BepAnalysisMethod,
  profile: BepAnalysisProfile,
): boolean {
  const capability = metadata.capabilities.analysis;
  return capability !== undefined &&
    capability.schemaVersions.includes(BEP_ANALYSIS_SCHEMA_VERSION) &&
    capability.methods.includes(method) && capability.profiles.includes(profile);
}

function isAnalysisRequest(value: unknown): value is BepAnalysisRequest {
  return isRecord(value) && value.schemaVersion === BEP_ANALYSIS_SCHEMA_VERSION &&
    isBepPosition(value.position) && isPlayer(value.actor) &&
    isBepAnalysisProfile(value.profile) && isPositiveInteger(value.timeMs) &&
    value.timeMs <= BEP_RUNTIME_LIMITS.maxTimeMs;
}

export function isBepAnalyzeCheckerRequest(value: unknown): value is BepAnalyzeCheckerRequest {
  if (!isRecord(value) || !isAnalysisRequest(value) ||
    value.position.phase !== "checker-play" || value.position.dice.length !== 2 ||
    value.actor !== value.position.playerOnRoll || !isRecord(value.playedTurn) ||
    !Array.isArray(value.playedTurn.steps) ||
    value.playedTurn.steps.length > BEP_RUNTIME_LIMITS.maxTurnSteps ||
    !value.playedTurn.steps.every(isTurnStep) || !isBoard(value.expectedResultingBoard) ||
    !isPositiveInteger(value.maxAlternatives) ||
    value.maxAlternatives > BEP_ANALYSIS_LIMITS.maxAlternatives) return false;
  const remaining: number[] = value.position.dice[0] === value.position.dice[1]
    ? Array(4).fill(value.position.dice[0]) : [...value.position.dice];
  for (const step of value.playedTurn.steps) {
    const index = remaining.indexOf(step.die);
    if (index < 0 || !isStepDirectionValid(step, value.actor)) return false;
    remaining.splice(index, 1);
  }
  return true;
}

export function isBepAnalyzeCubeRequest(value: unknown): value is BepAnalyzeCubeRequest {
  if (!isRecord(value) || !isAnalysisRequest(value) ||
    value.position.phase !== "before-roll" || value.position.dice.length !== 0 ||
    value.position.board.borneOff.white === 15 || value.position.board.borneOff.black === 15 ||
    value.position.cube.owner !== null && value.position.cube.owner !== value.position.playerOnRoll ||
    value.position.match.crawford === "crawford" ||
    value.position.match.mode === "match" && value.position.match.length === 1) return false;
  return (value.role === "offer" && value.actor === value.position.playerOnRoll &&
    (value.recordedAction === "double" || value.recordedAction === "no-double")) ||
    (value.role === "response" && value.actor !== value.position.playerOnRoll &&
    (value.recordedAction === "take" || value.recordedAction === "pass"));
}

/** Stable identity with absolute points, bar and off; independent of display orientation. */
export function bepAnalysisCandidateId(board: BepBoard): string {
  const counts = [...board.points, board.bar, board.borneOff];
  return "position:" + counts.map(({ white, black }) =>
    white.toString(16).padStart(2, "0") + black.toString(16).padStart(2, "0")).join("");
}

export function isBepAnalysisProvenance(value: unknown): value is BepAnalysisProvenance {
  if (!isRecord(value) || !isBepIdentifier(value.engineId) ||
    !isBepIdentifier(value.engineVersion) || !isBepIdentifier(value.buildId) ||
    typeof value.assetsId !== "string" || !/^sha256-[0-9a-f]{64}$/.test(value.assetsId) ||
    typeof value.weightsSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.weightsSha256) ||
    !isBepIdentifier(value.matchEquityTableId) ||
    typeof value.matchEquitySha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.matchEquitySha256) ||
    value.bearoff !== "gnubg-heuristic-1.08.003-no-database" ||
    !isBepAnalysisProfile(value.requestedProfile) ||
    value.effectiveProfile !== value.requestedProfile ||
    value.cubeful !== true || value.deterministic !== true || value.noise !== 0 ||
    value.completion !== "complete") return false;
  return value.effectiveProfile === "quick-0ply-v1"
    ? value.depth === 0 && value.pruning === false && value.filterPolicy === "all-unique-root-positions-v1"
    : value.depth === 2 && value.pruning === true &&
      value.filterPolicy === "quick-top2-window160-max8-plus-played-v1";
}

function isAnalysisCandidate(value: unknown): value is BepAnalysisCandidate {
  return isRecord(value) && isBepIdentifier(value.id) && isBoard(value.resultingBoard) &&
    value.id === bepAnalysisCandidateId(value.resultingBoard) &&
    isFiniteNumber(value.equity) && isPositiveInteger(value.rank) &&
    typeof value.tiedWithBest === "boolean" &&
    Array.isArray(value.segments) && value.segments.length <= BEP_RUNTIME_LIMITS.maxTurnSteps &&
    value.segments.every((segment) => isRecord(segment) &&
      isTurnStep({ ...segment, die: 1 }) &&
      (segment.from as BepCheckerLocation).kind !== "borne-off" &&
      (segment.to as BepCheckerLocation).kind !== "bar" &&
      (!segment.hit || (segment.to as BepCheckerLocation).kind === "point") &&
      segment.die === undefined);
}

export function isBepAnalyzeCheckerResult(value: unknown): value is BepAnalyzeCheckerResult {
  if (!isRecord(value) || value.schemaVersion !== BEP_ANALYSIS_SCHEMA_VERSION ||
    !isBepIdentifier(value.positionRevision) || !isPlayer(value.actor) || value.playedLegal !== true ||
    !isBepIdentifier(value.playedCandidateId) || !isBepIdentifier(value.bestCandidateId) ||
    !Array.isArray(value.candidates) || value.candidates.length < 1 ||
    value.candidates.length > BEP_ANALYSIS_LIMITS.maxReturnedCandidates ||
    !value.candidates.every(isAnalysisCandidate) ||
    !isPositiveInteger(value.legalPositionCount) ||
    value.legalPositionCount > BEP_ANALYSIS_LIMITS.maxLegalPositions ||
    !isPositiveInteger(value.evaluatedPositionCount) ||
    value.evaluatedPositionCount > value.legalPositionCount ||
    typeof value.forced !== "boolean" || typeof value.noPlay !== "boolean" ||
    !isFiniteNumber(value.equityLoss) || value.equityLoss < 0 ||
    !isFiniteNumber(value.elapsedMs) || value.elapsedMs < 0 ||
    !isBepAnalysisProvenance(value.provenance)) return false;
  const result = value as unknown as BepAnalyzeCheckerResult;
  const best = result.candidates[0];
  const played = result.candidates.find(({ id }) => id === result.playedCandidateId);
  const tolerance = BEP_ANALYSIS_LIMITS.equityTolerance;
  return best?.id === result.bestCandidateId && best.rank === 1 && best.tiedWithBest &&
    played !== undefined && result.candidates.length <= result.evaluatedPositionCount &&
    new Set(result.candidates.map(({ id }) => id)).size === result.candidates.length &&
    new Set(result.candidates.map(({ rank }) => rank)).size === result.candidates.length &&
    result.candidates.every((candidate, index) => candidate.rank <= result.evaluatedPositionCount &&
      (index === 0 || (candidate.rank > result.candidates[index - 1]!.rank &&
        candidate.equity <= result.candidates[index - 1]!.equity + tolerance)) &&
      candidate.tiedWithBest === (Math.abs(best.equity - candidate.equity) <= tolerance)) &&
    Math.abs(result.equityLoss - (best.equity - played.equity)) <= tolerance &&
    result.forced === (result.legalPositionCount === 1) &&
    (!result.noPlay || (result.forced && result.candidates[0]!.segments.length === 0)) &&
    (result.noPlay || result.candidates.every(({ segments }) => segments.length > 0)) &&
    (result.provenance.effectiveProfile !== "quick-0ply-v1" ||
      result.evaluatedPositionCount === result.legalPositionCount) &&
    (result.provenance.effectiveProfile !== "deep-2ply-v1" ||
      (result.evaluatedPositionCount >= Math.min(2, result.legalPositionCount) &&
       result.evaluatedPositionCount <= BEP_ANALYSIS_LIMITS.maxDeepRootPositions));
}

export function isBepAnalyzeCubeResult(value: unknown): value is BepAnalyzeCubeResult {
  if (!isRecord(value) || value.schemaVersion !== BEP_ANALYSIS_SCHEMA_VERSION ||
    !isBepIdentifier(value.positionRevision) || !isPlayer(value.actor) ||
    !isPlayer(value.equityPerspective) || (value.role !== "offer" && value.role !== "response") ||
    !Array.isArray(value.availableActions) || value.availableActions.length !== 2 ||
    new Set(value.availableActions).size !== 2 || !value.availableActions.includes(value.recommendedAction) ||
    !isPositiveInteger(value.referenceCube) || value.referenceCube > BEP_RUNTIME_LIMITS.maxCubeValue ||
    (value.referenceCube & (value.referenceCube - 1)) !== 0 ||
    !isFiniteNumber(value.noDoubleEquity) || !isFiniteNumber(value.doubleTakeEquity) ||
    !isFiniteNumber(value.doublePassEquity) || !isFiniteNumber(value.recordedActionEquity) ||
    !isFiniteNumber(value.equityLoss) || value.equityLoss < 0 ||
    !isFiniteNumber(value.elapsedMs) || value.elapsedMs < 0 ||
    (value.tooGood !== undefined && typeof value.tooGood !== "boolean") ||
    !isBepAnalysisProvenance(value.provenance)) return false;
  const offered = Math.min(value.doubleTakeEquity, value.doublePassEquity);
  const tolerance = BEP_ANALYSIS_LIMITS.equityTolerance;
  if (value.role === "offer") {
    const recommended = value.recommendedAction === "double" ? offered : value.noDoubleEquity;
    if (Math.max(value.noDoubleEquity, offered) - recommended > tolerance ||
      value.tooGood === true && (value.recommendedAction !== "no-double" ||
        value.noDoubleEquity <= value.doublePassEquity)) return false;
  } else {
    const recommended = value.recommendedAction === "take" ? value.doubleTakeEquity : value.doublePassEquity;
    if (recommended - offered > tolerance || value.tooGood === true) return false;
  }
  return value.role === "offer"
    ? value.equityPerspective === value.actor &&
      value.availableActions.includes("double") && value.availableActions.includes("no-double")
    : value.equityPerspective !== value.actor &&
      value.availableActions.includes("take") && value.availableActions.includes("pass");
}

/** Validate branch values, loss and actor against the common pre-offer context. */
export function bepCubeAnalysisMatchesRequest(
  request: BepAnalyzeCubeRequest,
  result: BepAnalyzeCubeResult,
): boolean {
  if (!isBepAnalyzeCubeResult(result) ||
    result.positionRevision !== request.position.revision || result.actor !== request.actor ||
    result.role !== request.role || result.equityPerspective !== request.position.playerOnRoll ||
    result.referenceCube !== request.position.cube.value ||
    result.provenance.requestedProfile !== request.profile) return false;
  const offered = Math.min(result.doubleTakeEquity, result.doublePassEquity);
  const recorded = request.recordedAction === "no-double" ? result.noDoubleEquity :
    request.recordedAction === "double" ? offered : request.recordedAction === "take" ?
      result.doubleTakeEquity : result.doublePassEquity;
  const loss = request.role === "offer" ? Math.max(result.noDoubleEquity, offered) - recorded : recorded - offered;
  const tolerance = BEP_ANALYSIS_LIMITS.equityTolerance;
  return Math.abs(recorded - result.recordedActionEquity) <= tolerance &&
    Math.abs(loss - result.equityLoss) <= tolerance;
}

/** Correlation and candidate replay checks before a result crosses the capsule boundary. */
export function bepCheckerAnalysisMatchesRequest(
  request: BepAnalyzeCheckerRequest,
  result: BepAnalyzeCheckerResult,
): boolean {
  if (!isBepAnalyzeCheckerResult(result) ||
    result.positionRevision !== request.position.revision || result.actor !== request.actor ||
    result.provenance.requestedProfile !== request.profile ||
    result.playedCandidateId !== bepAnalysisCandidateId(request.expectedResultingBoard) ||
    result.noPlay !== (request.playedTurn.steps.length === 0)) return false;
  const topCount = Math.min(request.maxAlternatives, result.evaluatedPositionCount);
  const top = result.candidates.slice(0, topCount);
  if (top.length !== topCount || top.some(({ rank }, index) => rank !== index + 1) ||
    result.candidates.length !== topCount +
      (top.some(({ id }) => id === result.playedCandidateId) ? 0 : 1)) return false;
  return result.candidates.every((candidate) => {
    const board = {
      points: request.position.board.points.map((point) => ({ ...point })),
      bar: { ...request.position.board.bar },
      borneOff: { ...request.position.board.borneOff },
    };
    const actor = request.actor;
    const opponent = actor === "white" ? "black" : "white";
    for (const segment of candidate.segments) {
      const from = segment.from.kind === "bar" ? board.bar :
        segment.from.kind === "point" ? board.points[segment.from.point] : undefined;
      if (!from || from[actor] < 1 || (segment.from.kind !== "bar" && board.bar[actor] > 0)) return false;
      if (segment.from.kind === "point" && segment.to.kind === "point" &&
        (actor === "white" ? segment.to.point >= segment.from.point : segment.to.point <= segment.from.point))
        return false;
      from[actor] -= 1;
      if (segment.to.kind === "borne-off") {
        if (segment.from.kind !== "point" || segment.hit) return false;
        board.borneOff[actor] += 1;
      } else if (segment.to.kind === "point") {
        const to = board.points[segment.to.point]!;
        if (to[opponent] > 1 || segment.hit !== (to[opponent] === 1)) return false;
        if (segment.hit) { to[opponent] = 0; board.bar[opponent] += 1; }
        to[actor] += 1;
      } else return false;
    }
    return bepAnalysisCandidateId(board) === candidate.id;
  });
}


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
  (value.analysis === undefined || isAnalysisCapabilities(value.analysis)) &&
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
  (value.runtime.wasmMemoryBytes === undefined ||
    isPositiveInteger(value.runtime.wasmMemoryBytes)) &&
  (value.runtime.wasmMemoryLimitBytes === undefined ||
    isPositiveInteger(value.runtime.wasmMemoryLimitBytes)) &&
  (value.runtime.wasmMemoryBytes === undefined ||
    value.runtime.wasmMemoryLimitBytes === undefined ||
    value.runtime.wasmMemoryBytes <= value.runtime.wasmMemoryLimitBytes) &&
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
  typeof value.completed === "boolean";

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
  isBepSessionNonce(value.sessionNonce);

export const isBepChannelConnectMessage = (
  value: unknown,
): value is BepChannelConnectMessage =>
  hasBoundedJsonShape(value) &&
  isRecord(value) &&
  hasValidEnvelopeBase(value) &&
  value.kind === "bep.channel-connect";

export const isBepMethod = (value: unknown): value is BepMethod =>
  value === "hello" || value === "choose-turn" || value === "decide-cube" ||
  value === "analyze-checker" || value === "analyze-cube";

const isRequestPayload = (method: BepMethod, payload: unknown): boolean => {
  switch (method) {
    case "hello":
      return isHelloRequest(payload);
    case "choose-turn":
      return isBepChooseTurnRequest(payload);
    case "decide-cube":
      return isBepCubeDecisionRequest(payload);
    case "analyze-checker":
      return isBepAnalyzeCheckerRequest(payload);
    case "analyze-cube":
      return isBepAnalyzeCubeRequest(payload);
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
    case "analyze-checker":
      return isBepAnalyzeCheckerResult(payload);
    case "analyze-cube":
      return isBepAnalyzeCubeResult(payload);
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
