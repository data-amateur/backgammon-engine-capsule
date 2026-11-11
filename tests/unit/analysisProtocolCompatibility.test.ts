import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  BepAnalysisSegment,
  BepAnalyzeCheckerRequest,
  BepAnalyzeCheckerResult,
  BepBoard,
  BepRequestMessage,
  BepResultMessage,
} from "../../src/protocol/types";
import {
  bepAnalysisCandidateId,
  bepCheckerAnalysisMatchesRequest,
  hasBepAnalysisCapability,
  isBepAnalyzeCheckerRequest,
  isBepAnalyzeCheckerResult,
  isBepEngineToHostMessage,
} from "../../src/protocol/validation";

// Mirrors the application's client/src/engine/analysisProtocol.test.ts.
const corpus = JSON.parse(
  readFileSync(
    new URL("../fixtures/bep-analysis-v1.json", import.meta.url),
    "utf8",
  ),
) as { validHostMessages: unknown[]; validEngineMessages: unknown[] };
const checkerRequest = (
  corpus.validHostMessages[0] as BepRequestMessage<"analyze-checker">
).payload;
const checkerResult = (
  corpus.validEngineMessages[0] as BepResultMessage<"analyze-checker">
).payload;
const helloMessage = corpus.validEngineMessages[2] as BepResultMessage<"hello">;

const hello = (change: (analysis: Record<string, unknown>) => void) => {
  const message = structuredClone(helloMessage);
  change(
    message.payload.metadata.capabilities.analysis as unknown as Record<
      string,
      unknown
    >,
  );
  return message;
};

describe("optional analysis capability", () => {
  it("ignores entries a newer capsule may add without invalidating the handshake", () => {
    const newer = hello((analysis) => {
      analysis.schemaVersions = [1, 2];
      analysis.methods = ["analyze-checker", "analyze-future"];
      analysis.profiles = ["quick-0ply-v1", "deep-3ply-v9"];
    });
    expect(isBepEngineToHostMessage(newer)).toBe(true);
    const metadata = newer.payload.metadata;
    expect(
      hasBepAnalysisCapability(metadata, "analyze-checker", "quick-0ply-v1"),
    ).toBe(true);
    expect(
      hasBepAnalysisCapability(metadata, "analyze-cube", "quick-0ply-v1"),
    ).toBe(false);
  });
  it("keeps gameplay but reports analysis unavailable when v1 is no longer offered", () => {
    const v2 = hello((analysis) => {
      analysis.schemaVersions = [2];
    });
    expect(isBepEngineToHostMessage(v2)).toBe(true);
    expect(
      hasBepAnalysisCapability(
        v2.payload.metadata,
        "analyze-checker",
        "quick-0ply-v1",
      ),
    ).toBe(false);
  });
  it("still rejects malformed lists and inexact provenance for known profiles", () => {
    for (const change of [
      (analysis: Record<string, unknown>) => (analysis.profiles = []),
      (analysis: Record<string, unknown>) =>
        (analysis.methods = ["analyze-checker", "analyze-checker"]),
      (analysis: Record<string, unknown>) => (analysis.schemaVersions = [0]),
      (analysis: Record<string, unknown>) =>
        (analysis.quickProvenance = {
          ...checkerResult.provenance,
          depth: 2,
        }),
    ])
      expect(isBepEngineToHostMessage(hello(change))).toBe(false);
  });
});

/** White checkers only move toward point 0; black stays in its home board. */
function board(white: Record<number, number>): BepBoard {
  const points = Array.from({ length: 24 }, (_, point) => ({
    white: white[point] ?? 0,
    black: point === 18 ? 15 : 0,
  }));
  const onBoard = Object.values(white).reduce((sum, count) => sum + count, 0);
  return {
    points,
    bar: { white: 0, black: 0 },
    borneOff: { white: 15 - onBoard, black: 0 },
  };
}
const point = (value: number) => ({ kind: "point" as const, point: value });
const off = { kind: "borne-off" as const };
function play(start: BepBoard, segments: readonly BepAnalysisSegment[]) {
  const next = structuredClone(start) as {
    points: { white: number; black: number }[];
    bar: { white: number; black: number };
    borneOff: { white: number; black: number };
  };
  for (const { from, to } of segments) {
    if (from.kind === "point") next.points[from.point]!.white -= 1;
    if (to.kind === "point") next.points[to.point]!.white += 1;
    else next.borneOff.white += 1;
  }
  return next;
}
/** Builds a self-consistent Quick result whose best move is `best`. */
function analyze(
  start: BepBoard,
  dice: [number, number],
  played: readonly BepAnalysisSegment[],
  best: readonly BepAnalysisSegment[],
) {
  const request: BepAnalyzeCheckerRequest = {
    ...structuredClone(checkerRequest),
    position: {
      ...structuredClone(checkerRequest.position),
      board: start,
      dice,
      playerOnRoll: "white",
    },
    actor: "white",
    playedTurn: {
      steps: played.map((segment, index) => ({
        ...segment,
        die: dice[index]!,
      })),
    },
    expectedResultingBoard: play(start, played),
  };
  const candidate = (
    segments: readonly BepAnalysisSegment[],
    rank: number,
    equity: number,
  ) => {
    const resultingBoard = play(start, segments);
    return {
      id: bepAnalysisCandidateId(resultingBoard),
      resultingBoard,
      segments,
      equity,
      rank,
      tiedWithBest: rank === 1,
    };
  };
  const candidates = [candidate(best, 1, 0.5), candidate(played, 2, 0.4)];
  const result: BepAnalyzeCheckerResult = {
    ...structuredClone(checkerResult),
    positionRevision: request.position.revision,
    actor: "white",
    playedCandidateId: candidates[1]!.id,
    bestCandidateId: candidates[0]!.id,
    candidates,
    legalPositionCount: 2,
    evaluatedPositionCount: 2,
    forced: false,
    noPlay: false,
    equityLoss: 0.1,
  };
  return { request, result };
}
const move = (from: number, to: number): BepAnalysisSegment => ({
  from: point(from),
  to: point(to),
  hit: false,
});

describe("engine candidate legality", () => {
  const off1 = (from: number): BepAnalysisSegment => ({
    from: point(from),
    to: off,
    hit: false,
  });
  it("accepts legal bear-offs in either segment order", () => {
    // 6-1: bring the last checker home, then bear off with the 1.
    const start = board({ 0: 13, 4: 1, 10: 1 });
    const played = [move(10, 4), move(4, 3)];
    for (const best of [
      [move(10, 4), off1(0)],
      [off1(0), move(10, 4)],
    ]) {
      const { request, result } = analyze(start, [6, 1], played, best);
      expect(isBepAnalyzeCheckerRequest(request)).toBe(true);
      expect(bepCheckerAnalysisMatchesRequest(request, result)).toBe(true);
    }
  });
  it("rejects a bear-off that leaves a checker outside the home board", () => {
    const start = board({ 0: 14, 10: 1 });
    const played = [move(10, 4), off1(4)];
    const { request, result } = analyze(start, [6, 5], played, [
      off1(0),
      off1(0),
    ]);
    expect(isBepAnalyzeCheckerRequest(request)).toBe(true);
    expect(isBepAnalyzeCheckerResult(result)).toBe(true);
    expect(bepCheckerAnalysisMatchesRequest(request, result)).toBe(false);
  });
  it("rejects a candidate that moves further than the dice allow", () => {
    const start = board({ 20: 1, 5: 14 });
    const played = [move(20, 14), move(14, 9)];
    const legal = analyze(start, [6, 5], played, [move(20, 14), move(5, 0)]);
    expect(isBepAnalyzeCheckerRequest(legal.request)).toBe(true);
    expect(bepCheckerAnalysisMatchesRequest(legal.request, legal.result)).toBe(
      true,
    );
    // One merged segment of 20 pips with a 6-5.
    const overlong = analyze(start, [6, 5], played, [move(20, 0)]);
    expect(isBepAnalyzeCheckerResult(overlong.result)).toBe(true);
    expect(
      bepCheckerAnalysisMatchesRequest(overlong.request, overlong.result),
    ).toBe(false);
  });
});
