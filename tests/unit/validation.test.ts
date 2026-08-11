import { describe, expect, it } from "vitest";
import {
  hasBoundedJsonShape,
  isBepChooseTurnRequest,
  isBepEngineError,
  isBepEngineToHostMessage,
  isBepHostToEngineMessage,
  isBepPosition,
} from "../../src/protocol/validation";
import { BEP_PROTOCOL, BEP_VERSION } from "../../src/protocol/types";
import { createBoard, createChooseRequest, createPosition } from "./fixtures";

const NONCE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("BEP request validation", () => {
  it("accepts a complete checker-play request", () => {
    expect(isBepChooseTurnRequest(createChooseRequest())).toBe(true);
  });

  it("rejects duplicate opaque turn IDs", () => {
    const request = createChooseRequest();
    const duplicate = {
      ...request,
      legalTurns: request.legalTurns.map((turn) => ({
        ...turn,
        id: "turn:duplicate",
      })),
    };
    expect(isBepChooseTurnRequest(duplicate)).toBe(false);
  });

  it("rejects an invalid checker direction", () => {
    const request = createChooseRequest();
    const invalid = {
      ...request,
      legalTurns: [
        {
          id: "turn:backwards",
          steps: [
            {
              from: { kind: "point", point: 5 },
              to: { kind: "point", point: 6 },
              die: 1,
              hit: false,
            },
          ],
        },
      ],
    };
    expect(isBepChooseTurnRequest(invalid)).toBe(false);
  });

  it("accepts a valid host envelope and rejects the wrong nonce shape", () => {
    const valid = {
      protocol: BEP_PROTOCOL,
      version: BEP_VERSION,
      sessionNonce: NONCE,
      kind: "bep.request",
      requestId: "request:1",
      method: "choose-turn",
      payload: createChooseRequest(),
    };
    expect(isBepHostToEngineMessage(valid)).toBe(true);
    expect(
      isBepHostToEngineMessage({ ...valid, sessionNonce: "contains spaces" }),
    ).toBe(false);
    expect(
      isBepHostToEngineMessage({ ...valid, sessionNonce: "short" }),
    ).toBe(false);
  });

  it("accepts a partial legal turn but rejects unavailable die reuse", () => {
    const request = createChooseRequest();
    expect(
      isBepChooseTurnRequest({
        ...request,
        legalTurns: [request.legalTurns[1]],
      }),
    ).toBe(true);
    expect(
      isBepChooseTurnRequest({
        ...request,
        legalTurns: [
          {
            id: "turn:reused-die",
            steps: [
              {
                from: { kind: "point", point: 23 },
                to: { kind: "point", point: 22 },
                die: 1,
                hit: false,
              },
              {
                from: { kind: "point", point: 22 },
                to: { kind: "point", point: 21 },
                die: 1,
                hit: false,
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("position invariant validation", () => {
  it("rejects simultaneous point occupation while preserving checker totals", () => {
    const board = createBoard();
    const points = board.points.map((point) => ({ ...point }));
    points[0] = { white: 0, black: 1 };
    points[23] = { white: 2, black: 1 };

    expect(
      isBepPosition(createPosition({ board: { ...board, points } })),
    ).toBe(false);
  });

  it("enforces cube ownership and offered-phase consistency", () => {
    const validOffer = createPosition({
      phase: "cube-response",
      dice: [],
      cube: {
        value: 2,
        owner: null,
        state: "offered",
        offeredBy: "white",
      },
    });
    expect(isBepPosition(validOffer)).toBe(true);
    expect(
      isBepPosition({
        ...validOffer,
        cube: { ...validOffer.cube, owner: "black" },
      }),
    ).toBe(false);
  });

  it("requires a match-point score for Crawford states", () => {
    const beforeRoll = createPosition({ phase: "before-roll", dice: [] });
    expect(
      isBepPosition({
        ...beforeRoll,
        match: { ...beforeRoll.match, crawford: "crawford" },
      }),
    ).toBe(false);
    expect(
      isBepPosition({
        ...beforeRoll,
        match: {
          ...beforeRoll.match,
          score: { white: 4, black: 2 },
          crawford: "crawford",
        },
      }),
    ).toBe(true);
  });

  it("bounds match length and match cube values to GNUbg's BEP v1 range", () => {
    const match = createPosition({ phase: "before-roll", dice: [] });
    expect(
      isBepPosition({
        ...match,
        match: { ...match.match, length: 64 },
        cube: { ...match.cube, value: 64 },
      }),
    ).toBe(true);
    expect(
      isBepPosition({
        ...match,
        match: { ...match.match, length: 65 },
      }),
    ).toBe(false);
    expect(
      isBepPosition({
        ...match,
        cube: { ...match.cube, value: 128 },
      }),
    ).toBe(false);

    expect(
      isBepPosition({
        ...match,
        cube: { ...match.cube, value: 4_096 },
        match: {
          mode: "money",
          length: null,
          score: { white: 0, black: 0 },
          crawford: "none",
        },
      }),
    ).toBe(true);
  });
});

describe("bounded structured-clone validation", () => {
  it("rejects cycles", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(hasBoundedJsonShape(cyclic)).toBe(false);
  });

  it("rejects excessive depth and message size", () => {
    expect(hasBoundedJsonShape({ a: { b: { c: 1 } } }, { maxDepth: 1 })).toBe(
      false,
    );
    expect(hasBoundedJsonShape("x".repeat(1_000), { maxMessageBytes: 10 })).toBe(
      false,
    );
  });
});

describe("BEP result validation", () => {
  it("accepts completed and partial searches but requires completion state", () => {
    const valid = {
      protocol: BEP_PROTOCOL,
      version: BEP_VERSION,
      sessionNonce: NONCE,
      kind: "bep.result",
      requestId: "request:1",
      method: "choose-turn",
      payload: {
        positionRevision: "position:1",
        chosenTurnId: "turn:first",
        stats: { elapsedMs: 0, completed: true },
      },
    };
    expect(isBepEngineToHostMessage(valid)).toBe(true);
    expect(
      isBepEngineToHostMessage({
        ...valid,
        payload: {
          ...valid.payload,
          stats: { elapsedMs: 0.125, completed: false },
        },
      }),
    ).toBe(true);
    expect(
      isBepEngineToHostMessage({
        ...valid,
        payload: { ...valid.payload, stats: { elapsedMs: 0 } },
      }),
    ).toBe(false);
  });
});

describe("engine error validation", () => {
  it("rejects C0, DEL, and C1 control characters in messages", () => {
    const base = {
      code: "internal-error",
      retryable: false,
    };
    expect(isBepEngineError({ ...base, message: "safe message" })).toBe(true);
    for (const control of ["\u0000", "\u007f", "\u0085"]) {
      expect(
        isBepEngineError({ ...base, message: `bad${control}message` }),
      ).toBe(false);
    }
  });
});
