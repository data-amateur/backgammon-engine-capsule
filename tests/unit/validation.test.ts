import { describe, expect, it } from "vitest";
import {
  hasBoundedJsonShape,
  isBepChooseTurnRequest,
  isBepEngineToHostMessage,
  isBepHostToEngineMessage,
} from "../../src/protocol/validation";
import { BEP_PROTOCOL, BEP_VERSION } from "../../src/protocol/types";
import { createChooseRequest } from "./fixtures";

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
  it("accepts a correlated-looking legal shape and rejects incomplete stats", () => {
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
        payload: { ...valid.payload, stats: { elapsedMs: 0 } },
      }),
    ).toBe(false);
  });
});
