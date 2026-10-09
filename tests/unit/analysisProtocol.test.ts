import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BepRequestMessage, BepResultMessage } from "../../src/protocol/types";
import {
  bepCheckerAnalysisMatchesRequest,
  hasBepAnalysisCapability,
  isBepEngineToHostMessage,
  isBepHostToEngineMessage,
  isBepAnalyzeCheckerResult,
} from "../../src/protocol/validation";

const serialized = readFileSync(new URL("../fixtures/bep-analysis-v1.json", import.meta.url));
const corpus = JSON.parse(serialized.toString("utf8")) as {
  validHostMessages: unknown[];
  validEngineMessages: unknown[];
  invalidHostMessages: unknown[];
  invalidEngineMessages: unknown[];
};
const request = corpus.validHostMessages[0] as BepRequestMessage<"analyze-checker">;
const response = corpus.validEngineMessages[0] as BepResultMessage<"analyze-checker">;

describe("shared serialized analysis contract v1", () => {
  it("pins the same corpus used by the application protocol tests", () => {
    expect(createHash("sha256").update(serialized).digest("hex"))
      .toBe("571e7fecda4656e9b62437fe7fc0b42a05b15da2761fc8d76861f8010ce9939b");
  });
  it("accepts compatible requests/results and rejects malformed serialized messages", () => {
    for (const message of corpus.validHostMessages) expect(isBepHostToEngineMessage(message)).toBe(true);
    for (const message of corpus.validEngineMessages) expect(isBepEngineToHostMessage(message)).toBe(true);
    for (const message of corpus.invalidHostMessages) expect(isBepHostToEngineMessage(message)).toBe(false);
    for (const message of corpus.invalidEngineMessages) expect(isBepEngineToHostMessage(message)).toBe(false);
  });
  it("keeps old capsule handshakes valid and gates unadvertised methods/profiles", () => {
    const oldHello = corpus.validEngineMessages[1] as BepResultMessage<"hello">;
    const newHello = corpus.validEngineMessages[2] as BepResultMessage<"hello">;
    expect(hasBepAnalysisCapability(oldHello.payload.metadata, "analyze-checker", "quick-0ply-v1")).toBe(false);
    expect(hasBepAnalysisCapability(newHello.payload.metadata, "analyze-checker", "quick-0ply-v1")).toBe(true);
    expect(hasBepAnalysisCapability(newHello.payload.metadata, "analyze-cube", "quick-0ply-v1")).toBe(false);
    expect(hasBepAnalysisCapability(newHello.payload.metadata, "analyze-checker", "deep-2ply-v1")).toBe(false);
  });
  it("requires revision, actor, profile, played-board and canonical segment correlation", () => {
    expect(bepCheckerAnalysisMatchesRequest(request.payload, response.payload)).toBe(true);
    expect(bepCheckerAnalysisMatchesRequest(request.payload, { ...response.payload, positionRevision: "position:stale" })).toBe(false);
    expect(bepCheckerAnalysisMatchesRequest(request.payload, { ...response.payload, actor: "black" })).toBe(false);
    expect(bepCheckerAnalysisMatchesRequest({ ...request.payload, expectedResultingBoard: request.payload.position.board }, response.payload)).toBe(false);
    const candidates = response.payload.candidates.map((candidate) => ({ ...candidate, segments: [] }));
    expect(bepCheckerAnalysisMatchesRequest(request.payload, { ...response.payload, candidates })).toBe(false);
  });
  it("rejects nonfinite numbers without arbitrarily bounding normalized equity", () => {
    for (const equity of [NaN, Infinity, -Infinity]) {
      const candidates = response.payload.candidates.map((candidate) => ({ ...candidate, equity }));
      expect(isBepAnalyzeCheckerResult({ ...response.payload, candidates })).toBe(false);
    }
    const candidates = response.payload.candidates.map((candidate) => ({ ...candidate, equity: 7.125 }));
    expect(isBepAnalyzeCheckerResult({ ...response.payload, candidates })).toBe(true);
  });
});
