import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  BepRequestMessage,
  BepResultMessage,
} from "../../src/protocol/types";
import {
  bepCheckerAnalysisMatchesRequest,
  bepCubeAnalysisMatchesRequest,
  hasBepAnalysisCapability,
  isBepEngineToHostMessage,
  isBepHostToEngineMessage,
  isBepAnalyzeCheckerResult,
  isBepAnalyzeCubeResult,
} from "../../src/protocol/validation";

const serialized = readFileSync(
  new URL("../fixtures/bep-analysis-v1.json", import.meta.url),
);
const corpus = JSON.parse(serialized.toString("utf8")) as {
  validHostMessages: unknown[];
  validEngineMessages: unknown[];
  invalidHostMessages: unknown[];
  invalidEngineMessages: unknown[];
};
const request = corpus
  .validHostMessages[0] as BepRequestMessage<"analyze-checker">;
const response = corpus
  .validEngineMessages[0] as BepResultMessage<"analyze-checker">;

describe("shared serialized analysis contract v1", () => {
  it("pins the same corpus used by the application protocol tests", () => {
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "165ea3631b106102b8f8ce778b847ea69cd6d76b378fd1bca88e9a820727dccf",
    );
  });
  it("accepts compatible requests/results and rejects malformed serialized messages", () => {
    for (const message of corpus.validHostMessages)
      expect(isBepHostToEngineMessage(message)).toBe(true);
    for (const message of corpus.validEngineMessages)
      expect(isBepEngineToHostMessage(message)).toBe(true);
    for (const message of corpus.invalidHostMessages)
      expect(isBepHostToEngineMessage(message)).toBe(false);
    for (const message of corpus.invalidEngineMessages)
      expect(isBepEngineToHostMessage(message)).toBe(false);
  });
  it("keeps old capsule handshakes valid and gates unadvertised methods/profiles", () => {
    const oldHello = corpus.validEngineMessages[1] as BepResultMessage<"hello">;
    const newHello = corpus.validEngineMessages[2] as BepResultMessage<"hello">;
    expect(
      hasBepAnalysisCapability(
        oldHello.payload.metadata,
        "analyze-checker",
        "quick-0ply-v1",
      ),
    ).toBe(false);
    expect(
      hasBepAnalysisCapability(
        newHello.payload.metadata,
        "analyze-checker",
        "quick-0ply-v1",
      ),
    ).toBe(true);
    expect(
      hasBepAnalysisCapability(
        newHello.payload.metadata,
        "analyze-cube",
        "quick-0ply-v1",
      ),
    ).toBe(false);
    expect(
      hasBepAnalysisCapability(
        newHello.payload.metadata,
        "analyze-checker",
        "deep-2ply-v1",
      ),
    ).toBe(false);
  });
  it("requires revision, actor, profile, played-board and canonical segment correlation", () => {
    expect(
      bepCheckerAnalysisMatchesRequest(request.payload, response.payload),
    ).toBe(true);
    expect(
      bepCheckerAnalysisMatchesRequest(request.payload, {
        ...response.payload,
        positionRevision: "position:stale",
      }),
    ).toBe(false);
    expect(
      bepCheckerAnalysisMatchesRequest(request.payload, {
        ...response.payload,
        actor: "black",
      }),
    ).toBe(false);
    expect(
      bepCheckerAnalysisMatchesRequest(
        {
          ...request.payload,
          expectedResultingBoard: request.payload.position.board,
        },
        response.payload,
      ),
    ).toBe(false);
    const candidates = response.payload.candidates.map((candidate) => ({
      ...candidate,
      segments: [],
    }));
    expect(
      bepCheckerAnalysisMatchesRequest(request.payload, {
        ...response.payload,
        candidates,
      }),
    ).toBe(false);
  });
  it("rejects nonfinite numbers without arbitrarily bounding normalized equity", () => {
    for (const equity of [NaN, Infinity, -Infinity]) {
      const candidates = response.payload.candidates.map((candidate) => ({
        ...candidate,
        equity,
      }));
      expect(
        isBepAnalyzeCheckerResult({ ...response.payload, candidates }),
      ).toBe(false);
    }
    const candidates = response.payload.candidates.map((candidate) => ({
      ...candidate,
      equity: 7.125,
    }));
    expect(isBepAnalyzeCheckerResult({ ...response.payload, candidates })).toBe(
      true,
    );
  });
  it("correlates both cube roles and all recorded actions to the pre-offer reference", () => {
    const requests = corpus.validHostMessages.filter((message) => (message as BepRequestMessage).method === "analyze-cube") as BepRequestMessage<"analyze-cube">[];
    const results = corpus.validEngineMessages.filter((message) => (message as BepResultMessage).method === "analyze-cube") as BepResultMessage<"analyze-cube">[];
    requests.forEach(({ payload: cube }, index) => {
      const result = results[index]!.payload;
      expect(bepCubeAnalysisMatchesRequest(cube, result)).toBe(true);
      for (const changed of [
        { positionRevision: "cube:stale" },
        { referenceCube: 2 },
        {
          actor:
            result.actor === "white" ? ("black" as const) : ("white" as const),
        },
        {
          equityPerspective:
            result.equityPerspective === "white"
              ? ("black" as const)
              : ("white" as const),
        },
        { recordedActionEquity: result.recordedActionEquity + 0.1 },
        { equityLoss: result.equityLoss + 0.1 },
      ])
        expect(
          bepCubeAnalysisMatchesRequest(cube, { ...result, ...changed }),
        ).toBe(false);
    });
  });
  it("checks cube recommendations and too-good semantics without bounding equities", () => {
    const result = (
      corpus.validEngineMessages[4] as BepResultMessage<"analyze-cube">
    ).payload;
    expect(
      isBepAnalyzeCubeResult({ ...result, recommendedAction: "no-double" }),
    ).toBe(false);
    expect(isBepAnalyzeCubeResult({ ...result, tooGood: true })).toBe(false);
    for (const equity of [NaN, Infinity, -Infinity])
      for (const field of [
        "noDoubleEquity",
        "doubleTakeEquity",
        "doublePassEquity",
        "recordedActionEquity",
        "equityLoss",
      ])
        expect(isBepAnalyzeCubeResult({ ...result, [field]: equity })).toBe(
          false,
        );
    expect(
      isBepAnalyzeCubeResult({
        ...result,
        noDoubleEquity: 7.125,
        doubleTakeEquity: 8,
        doublePassEquity: 9,
        recordedActionEquity: 7.125,
        equityLoss: 0.875,
      }),
    ).toBe(true);
  });
});
