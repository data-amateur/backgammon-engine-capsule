import {
  BEP_VERSION,
  type BepChooseTurnRequest,
  type BepChooseTurnResult,
  type BepCubeDecisionRequest,
  type BepCubeDecisionResult,
  type BepEngineMetadata,
  type BepHelloRequest,
  type BepHelloResult,
} from "../protocol/types";

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function safeBuildId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && SAFE_IDENTIFIER_PATTERN.test(trimmed)
    ? trimmed
    : "mock-dev";
}

export const MOCK_ENGINE_METADATA: BepEngineMetadata = {
  engineId: "gnubg-capsule",
  name: "BEP Mock Capsule",
  version: "0.1.0-mock",
  buildId: safeBuildId(import.meta.env.VITE_BUILD_ID),
  protocolVersions: [BEP_VERSION],
  license: {
    spdxId: "Apache-2.0",
    name: "Apache License 2.0",
    ...(import.meta.env.VITE_SOURCE_URL
      ? { sourceUrl: import.meta.env.VITE_SOURCE_URL }
      : {}),
    ...(import.meta.env.VITE_LICENSE_URL
      ? { licenseUrl: import.meta.env.VITE_LICENSE_URL }
      : {}),
  },
  runtime: {
    transport: "iframe",
  },
  capabilities: {
    chooseTurn: true,
    cubeOffer: true,
    cubeResponse: true,
    positionEvaluation: false,
    moveRanking: false,
    rollout: false,
    matchPlay: true,
    moneyPlay: true,
    cancellation: true,
    deterministic: true,
    variations: ["standard"],
    strengthPresets: [
      "beginner",
      "casual",
      "intermediate",
      "expert",
      "maximum",
    ],
  },
};

export function hello(request: BepHelloRequest): BepHelloResult {
  if (!request.supportedProtocolVersions.includes(BEP_VERSION)) {
    throw new Error("BEP v1 is not supported by the host");
  }
  return {
    selectedProtocolVersion: BEP_VERSION,
    metadata: MOCK_ENGINE_METADATA,
  };
}

export function chooseTurn(
  request: BepChooseTurnRequest,
  startedAt = performance.now(),
): BepChooseTurnResult {
  const selected = request.legalTurns[0];
  if (!selected) {
    throw new Error("No legal turns were supplied");
  }
  return {
    positionRevision: request.position.revision,
    chosenTurnId: selected.id,
    stats: {
      elapsedMs: Math.max(0, performance.now() - startedAt),
      completed: true,
    },
  };
}

export function decideCube(
  request: BepCubeDecisionRequest,
  startedAt = performance.now(),
): BepCubeDecisionResult {
  const preferred =
    request.phase === "consider-offer" ? "no-double" : "take";
  const decision = request.legalDecisions.includes(preferred)
    ? preferred
    : request.legalDecisions[0];
  if (!decision) {
    throw new Error("No legal cube decisions were supplied");
  }
  return {
    positionRevision: request.position.revision,
    decision,
    stats: {
      elapsedMs: Math.max(0, performance.now() - startedAt),
      completed: true,
    },
  };
}
