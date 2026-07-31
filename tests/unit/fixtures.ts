import type {
  BepBoard,
  BepChooseTurnRequest,
  BepCubeDecisionRequest,
  BepEngineSettings,
  BepPosition,
} from "../../src/protocol/types";

export const settings: BepEngineSettings = {
  strength: "intermediate",
  limits: { timeMs: 500, candidateLimit: 16 },
  randomization: {
    mode: "deterministic",
    seed: "unit-test",
    variability: 0,
  },
};

export function createBoard(): BepBoard {
  const points = Array.from({ length: 24 }, () => ({ white: 0, black: 0 }));
  points[23] = { white: 2, black: 0 };
  points[12] = { white: 5, black: 0 };
  points[7] = { white: 3, black: 0 };
  points[5] = { white: 5, black: 0 };
  points[0] = { white: 0, black: 2 };
  points[11] = { white: 0, black: 5 };
  points[16] = { white: 0, black: 3 };
  points[18] = { white: 0, black: 5 };
  return {
    points,
    bar: { white: 0, black: 0 },
    borneOff: { white: 0, black: 0 },
  };
}

export function createPosition(
  overrides: Partial<BepPosition> = {},
): BepPosition {
  return {
    revision: "position:1",
    phase: "checker-play",
    board: createBoard(),
    playerOnRoll: "white",
    dice: [1, 2],
    cube: {
      value: 1,
      owner: null,
      state: "available",
      offeredBy: null,
    },
    match: {
      mode: "match",
      length: 5,
      score: { white: 0, black: 0 },
      crawford: "none",
    },
    rules: {
      variation: "standard",
      jacoby: false,
      beavers: false,
      raccoons: false,
      automaticDoubles: 0,
    },
    ...overrides,
  };
}

export function createChooseRequest(): BepChooseTurnRequest {
  return {
    enginePlayer: "white",
    position: createPosition(),
    legalTurns: [
      {
        id: "turn:first",
        steps: [
          {
            from: { kind: "point", point: 23 },
            to: { kind: "point", point: 22 },
            die: 1,
            hit: false,
          },
          {
            from: { kind: "point", point: 22 },
            to: { kind: "point", point: 20 },
            die: 2,
            hit: false,
          },
        ],
      },
      {
        id: "turn:second",
        // Partial candidate: the authoritative host says only die 2 is playable.
        steps: [
          {
            from: { kind: "point", point: 12 },
            to: { kind: "point", point: 10 },
            die: 2,
            hit: false,
          },
        ],
      },
    ],
    settings,
  };
}

export function createCubeRequest(): BepCubeDecisionRequest {
  return {
    enginePlayer: "white",
    position: createPosition({
      revision: "position:cube",
      phase: "before-roll",
      dice: [],
    }),
    phase: "consider-offer",
    legalDecisions: ["double", "no-double"],
    settings,
  };
}
