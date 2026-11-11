import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = path.join(root, "build/gnubg/wasm");
const reference = JSON.parse(readFileSync(path.join(root, "tests/fixtures/gnubg-analysis-reference-v1.json"), "utf8"));
const deeperReference = JSON.parse(readFileSync(path.join(root, "tests/fixtures/gnubg-deep-analysis-reference-v1.json"), "utf8"));
const corpus = JSON.parse(readFileSync(path.join(root, "tests/fixtures/bep-analysis-v1.json"), "utf8"));
const { default: createModule } = await import(pathToFileURL(path.join(buildRoot, "gnubg-wasm.mjs")).href);
const digest = createHash("sha256");
for (const file of ["gnubg-wasm.mjs", "gnubg-wasm.wasm", "gnubg-wasm.data",
  "build-info.json", "EMSCRIPTEN-LICENSE.txt", "MUSL-COPYRIGHT.txt"]) {
  digest.update(file).update("\0").update(readFileSync(path.join(buildRoot, file))).update("\0");
}
const assetsId = "sha256-" + digest.digest("hex");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/worker/gnubgEngine.ts"],
  bundle: true, write: false, format: "esm", platform: "node",
  define: { "import.meta.env": JSON.stringify({ VITE_BUILD_ID: assetsId }) },
});
const { GnubgEngine, GnubgEngineError } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"),
);
const base = "https://capsule.test/engines/" + assetsId + "/";
const engine = await GnubgEngine.create({
  moduleUrl: base + "gnubg-wasm.mjs",
  wasmUrl: base + "gnubg-wasm.wasm",
  dataUrl: base + "gnubg-wasm.data",
}, async () => async () => createModule({ locateFile: (file) => path.join(buildRoot, file) }));

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= reference.tolerance,
    "equity " + actual + " differs from independent reference " + expected);
}
function startingBoard() {
  const points = Array.from({ length: 24 }, () => ({ white: 0, black: 0 }));
  for (const [point, count] of [[23, 2], [12, 5], [7, 3], [5, 5]]) points[point].white = count;
  for (const [point, count] of [[0, 2], [11, 5], [16, 3], [18, 5]]) points[point].black = count;
  return { points, bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 } };
}
function requestFor(actor, fixtureIndex) {
  const terminal = corpus.validHostMessages[0].payload;
  const board = startingBoard();
  const source = fixtureIndex === 2 ? 7 : 23;
  const point = (relative) => actor === "white" ? relative : 23 - relative;
  const expectedResultingBoard = structuredClone(board);
  expectedResultingBoard.points[point(source)][actor]--;
  expectedResultingBoard.points[point(source - 3)][actor]++;
  const match = fixtureIndex === 1 ? {
    mode: "match", length: 5,
    score: actor === "white" ? { white: 1, black: 3 } : { white: 3, black: 1 }, crawford: "none",
  } : terminal.position.match;
  return {
    ...terminal, actor, expectedResultingBoard,
    position: {
      ...terminal.position, revision: "reference:" + actor + ":" + fixtureIndex,
      board, playerOnRoll: actor, match,
      cube: { value: fixtureIndex === 1 ? 2 : 1, owner: fixtureIndex === 1 ? actor : null,
        state: "available", offeredBy: null },
    },
    playedTurn: { steps: [
      { from: { kind: "point", point: point(source) }, to: { kind: "point", point: point(source - 1) }, die: 1, hit: false },
      { from: { kind: "point", point: point(source - 1) }, to: { kind: "point", point: point(source - 3) }, die: 2, hit: false },
    ] },
  };
}

try {
  const hello = engine.hello({ supportedProtocolVersions: [1], host: { name: "Real WASM analysis test", version: "1" } });
  const { quickProvenance, deepProvenance, ...capabilities } = hello.metadata.capabilities.analysis;
  assert.equal(quickProvenance.assetsId, assetsId);
  assert.equal(quickProvenance.weightsSha256, reference.weightsSha256);
  assert.equal(quickProvenance.matchEquitySha256, reference.matchEquitySha256);
  assert.deepEqual(capabilities,
    { schemaVersions: [1], methods: ["analyze-checker", "analyze-cube"], profiles: ["quick-0ply-v1", "deep-2ply-v1"] });
  assert.equal(deepProvenance.depth, 2);
  assert.equal(deepProvenance.pruning, true);
  for (const profile of ["quick-0ply-v1", "deep-2ply-v1"]) for (const actor of ["white", "black"]) {
    for (let index = 0; index < reference.cases.length; index++) {
      const request = { ...requestFor(actor, index), profile };
      const expected = (profile === "deep-2ply-v1" ? deeperReference : reference).cases[index];
      const result = engine.analyzeChecker(request);
      const played = result.candidates.find(({ id }) => id === result.playedCandidateId);
      const best = result.candidates[0];
      assert.equal(result.legalPositionCount, expected.legalPositionCount);
      assert.equal(result.evaluatedPositionCount, expected.evaluatedPositionCount ?? expected.legalPositionCount);
      assert.equal(result.candidates.length, index === 2 ? 6 : 5);
      assert.equal(played.rank, expected.playedRank);
      assert.deepEqual(played.resultingBoard, request.expectedResultingBoard);
      close(best.equity, expected.bestEquity);
      close(played.equity, expected.playedEquity);
      close(result.equityLoss, expected.equityLoss);
      const opponent = actor === "white" ? "black" : "white";
      for (let point = 0; point < 24; point++) {
        const relativeActor = actor === "white" ? point : 23 - point;
        const relativeOpponent = actor === "white" ? 23 - point : point;
        assert.equal(best.resultingBoard.points[point][actor], expected.bestActor[relativeActor]);
        assert.equal(best.resultingBoard.points[point][opponent], expected.bestOpponent[relativeOpponent]);
      }
      assert.equal(result.provenance.assetsId, assetsId);
      assert.equal(result.provenance.weightsSha256, reference.weightsSha256);
      assert.equal(result.provenance.matchEquitySha256, reference.matchEquitySha256);
      assert.equal(result.provenance.depth, profile === "deep-2ply-v1" ? 2 : 0);
      assert.equal(result.provenance.noise, 0);
      assert.equal(result.provenance.filterPolicy, profile === "deep-2ply-v1" ? "quick-top2-window160-max8-plus-played-v1" : "all-unique-root-positions-v1");
      if (index === 2) {
        const limited = engine.analyzeChecker({ ...request, maxAlternatives: 1 });
        assert.equal(limited.candidates.length, 2);
        assert.equal(limited.candidates[1].rank, expected.playedRank);
        assert.equal(limited.evaluatedPositionCount, result.evaluatedPositionCount);
        close(limited.equityLoss, result.equityLoss);
      }
      const reverse = structuredClone(request);
      const source = reverse.playedTurn.steps[0].from.point;
      const mid = actor === "white" ? source - 2 : source + 2;
      reverse.playedTurn.steps = [
        { from: { kind: "point", point: source }, to: { kind: "point", point: mid }, die: 2, hit: false },
        { from: { kind: "point", point: mid }, to: request.playedTurn.steps[1].to, die: 1, hit: false },
      ];
      const equivalent = engine.analyzeChecker(reverse);
      assert.equal(equivalent.playedCandidateId, result.playedCandidateId);
      assert.equal(equivalent.legalPositionCount, result.legalPositionCount);
      close(equivalent.equityLoss, result.equityLoss);
    }
  }
  const terminal = corpus.validHostMessages[0].payload;
  const won = engine.analyzeChecker(terminal);
  close(won.candidates[0].equity, 1);
  assert.equal(won.forced, true);
  assert.equal(won.noPlay, false);
  assert.equal(won.equityLoss, 0);
  const lowerDie = structuredClone(terminal);
  lowerDie.playedTurn.steps[0].die = 1;
  assert.throws(() => engine.analyzeChecker(lowerDie),
    (error) => error instanceof GnubgEngineError && error.bepError.code === "illegal-turn");
  const deeperWin = engine.analyzeChecker({ ...terminal, profile: "deep-2ply-v1" });
  close(deeperWin.candidates[0].equity, 1);
  assert.equal(deeperWin.provenance.depth, 2);
  assert.equal(deeperWin.evaluatedPositionCount, 1);
  assert.throws(() => engine.analyzeChecker({ ...terminal, expectedResultingBoard: terminal.position.board }),
    (error) => error instanceof GnubgEngineError && error.bepError.code === "illegal-turn");

  for (const actor of ["white", "black"]) {
    for (const fixture of [
      { name: "oversized-before-higher-checker", near: 1, far: 2, dice: [3, 1] },
      { name: "bearoff-before-all-home", near: 4, far: 6, dice: [5, 2] },
    ]) {
      const opponent = actor === "white" ? "black" : "white";
      const point = (relative) => actor === "white" ? relative : 23 - relative;
      const board = {
        points: Array.from({ length: 24 }, () => ({ white: 0, black: 0 })),
        bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 },
      };
      board.borneOff[actor] = 13;
      board.borneOff[opponent] = 14;
      board.points[point(fixture.near)][actor] = 1;
      board.points[point(fixture.far)][actor] = 1;
      board.points[point(23)][opponent] = 1;
      const expectedResultingBoard = structuredClone(board);
      expectedResultingBoard.borneOff[actor] = 14;
      expectedResultingBoard.points[point(fixture.far)][actor] = 0;
      const steps = [
        { from: { kind: "point", point: point(fixture.near) }, to: { kind: "borne-off" }, die: fixture.dice[0], hit: false },
        { from: { kind: "point", point: point(fixture.far) }, to: { kind: "point", point: point(fixture.near) }, die: fixture.dice[1], hit: false },
      ];
      const invalid = {
        ...terminal, actor, expectedResultingBoard,
        position: { ...terminal.position, revision: "bearoff:" + actor + ":" + fixture.name,
          board, playerOnRoll: actor, dice: fixture.dice },
        playedTurn: { steps },
      };
      assert.throws(() => engine.analyzeChecker(invalid),
        (error) => error instanceof GnubgEngineError && error.bepError.code === "illegal-turn" && !error.fatal,
        actor + " " + fixture.name + " must reject the recorded order");
      const reversed = { ...invalid, playedTurn: { steps: [...steps].reverse() } };
      const legal = engine.analyzeChecker(reversed);
      assert.equal(legal.playedLegal, true);
      assert.deepEqual(legal.candidates.find(({ id }) => id === legal.playedCandidateId).resultingBoard,
        expectedResultingBoard, actor + " " + fixture.name + " legal reversal");
      assert.equal(legal.evaluatedPositionCount, legal.legalPositionCount);
      if (fixture.near === 1) {
        const exact = structuredClone(invalid);
        exact.position.dice[0] = 2;
        exact.playedTurn.steps[0].die = 2;
        const accepted = engine.analyzeChecker(exact);
        assert.deepEqual(accepted.candidates.find(({ id }) => id === accepted.playedCandidateId).resultingBoard,
          expectedResultingBoard, "an exact bearoff die may be used while a higher home checker remains");
      }
      assert.equal(engine.analyzeChecker(terminal).equityLoss, 0,
        "bearoff rejection must preserve the same engine for subsequent valid analysis");
    }
  }

  for (const actor of ["white", "black"]) {
    const opponent = actor === "white" ? "black" : "white";
    const point = (relative) => actor === "white" ? relative : 23 - relative;
    const board = {
      points: Array.from({ length: 24 }, () => ({ white: 0, black: 0 })),
      bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 },
    };
    board.bar[actor] = 1;
    board.borneOff[actor] = 14;
    board.borneOff[opponent] = 10;
    board.points[point(21)][opponent] = 1;
    board.points[point(18)][opponent] = board.points[point(15)][opponent] = 2;
    const expectedResultingBoard = structuredClone(board);
    expectedResultingBoard.bar[actor] = 0;
    expectedResultingBoard.bar[opponent] = 1;
    expectedResultingBoard.points[point(21)][opponent] = 0;
    expectedResultingBoard.points[point(21)][actor] = 1;
    const hit = {
      ...terminal, actor, expectedResultingBoard,
      position: { ...terminal.position, board, playerOnRoll: actor, dice: [3, 6] },
      playedTurn: { steps: [{ from: { kind: "bar" }, to: { kind: "point", point: point(21) }, die: 3, hit: true }] },
    };
    const result = engine.analyzeChecker(hit);
    assert.equal(result.forced, true);
    assert.equal(result.noPlay, false);
    assert.deepEqual(result.candidates[0].resultingBoard, expectedResultingBoard);
    assert.deepEqual(result.candidates[0].segments, [
      { from: { kind: "bar" }, to: { kind: "point", point: point(21) }, hit: true },
    ]);
    assert.throws(() => engine.analyzeChecker({ ...hit,
      playedTurn: { steps: [{ ...hit.playedTurn.steps[0], hit: false }] },
    }), (error) => error instanceof GnubgEngineError && error.bepError.code === "illegal-turn");
  }

  const noPlay = structuredClone(terminal);
  noPlay.position.board = {
    points: Array.from({ length: 24 }, () => ({ white: 0, black: 0 })),
    bar: { white: 1, black: 0 }, borneOff: { white: 0, black: 0 },
  };
  noPlay.position.board.points[5].white = 14;
  noPlay.position.board.points[23].black = noPlay.position.board.points[22].black = 2;
  noPlay.position.board.points[18].black = 11;
  noPlay.expectedResultingBoard = structuredClone(noPlay.position.board);
  noPlay.playedTurn.steps = [];
  const pass = engine.analyzeChecker(noPlay);
  assert.equal(pass.noPlay, true);
  assert.equal(pass.forced, true);
  assert.equal(pass.candidates.length, 1);
  assert.deepEqual(pass.candidates[0].resultingBoard, noPlay.position.board);
  assert.deepEqual(pass.candidates[0].segments, []);

  const doubles = requestFor("white", 0);
  doubles.position.dice = [6, 6];
  doubles.playedTurn.steps = [12, 12, 7, 7].map((point) => ({
    from: { kind: "point", point }, to: { kind: "point", point: point - 6 }, die: 6, hit: false,
  }));
  doubles.expectedResultingBoard = structuredClone(doubles.position.board);
  for (const { from, to } of doubles.playedTurn.steps) {
    doubles.expectedResultingBoard.points[from.point].white--;
    doubles.expectedResultingBoard.points[to.point].white++;
  }
  const many = engine.analyzeChecker(doubles);
  assert.ok(many.legalPositionCount > 8);
  assert.equal(many.evaluatedPositionCount, many.legalPositionCount);
  assert.throws(() => engine.analyzeChecker({
    ...doubles, playedTurn: { steps: doubles.playedTurn.steps.slice(0, 3) },
  }), (error) => error instanceof GnubgEngineError && error.bepError.code === "illegal-turn");
  assert.equal(engine.analyzeChecker(terminal).equityLoss, 0, "recoverable failures preserve the engine");
  console.log("Real GNUbg WASM checker analysis passed: independent equities, both colors, full roots, played outside top five, doubles, forced pass, per-step bearoff legality, terminal higher die and exact profiles");
} finally {
  engine.dispose();
}
