import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = path.join(root, "build/gnubg/wasm");
const reference = JSON.parse(
  readFileSync(
    path.join(root, "tests/fixtures/gnubg-cube-analysis-reference-v1.json"),
    "utf8",
  ),
);
const corpus = JSON.parse(
  readFileSync(path.join(root, "tests/fixtures/bep-analysis-v1.json"), "utf8"),
);
const { default: createModule } = await import(
  pathToFileURL(path.join(buildRoot, "gnubg-wasm.mjs")).href
);
const digest = createHash("sha256");
for (const file of [
  "gnubg-wasm.mjs",
  "gnubg-wasm.wasm",
  "gnubg-wasm.data",
  "build-info.json",
  "EMSCRIPTEN-LICENSE.txt",
  "MUSL-COPYRIGHT.txt",
]) {
  digest
    .update(file)
    .update("\0")
    .update(readFileSync(path.join(buildRoot, file)))
    .update("\0");
}
const assetsId = "sha256-" + digest.digest("hex");
const bundled = await build({
  absWorkingDir: root,
  entryPoints: ["src/worker/gnubgEngine.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  define: { "import.meta.env": JSON.stringify({ VITE_BUILD_ID: assetsId }) },
});
const { GnubgEngine, GnubgEngineError } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].contents).toString("base64")
);
const base = "https://capsule.test/engines/" + assetsId + "/";
const engine = await GnubgEngine.create(
  {
    moduleUrl: base + "gnubg-wasm.mjs",
    wasmUrl: base + "gnubg-wasm.wasm",
    dataUrl: base + "gnubg-wasm.data",
  },
  async () => async () =>
    createModule({ locateFile: (file) => path.join(buildRoot, file) }),
);

function close(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) <= reference.tolerance,
    "equity " + actual + " differs from independent reference " + expected,
  );
}
function requestFor(fixture, actor, role, recordedAction) {
  const opponent = actor === "white" ? "black" : "white";
  const board = {
    points: Array.from({ length: 24 }, () => ({ white: 0, black: 0 })),
    bar: { white: 0, black: 0 },
    borneOff: { white: 0, black: 0 },
  };
  for (let point = 0; point < 24; point++) {
    board.points[actor === "white" ? point : 23 - point][actor] =
      fixture.actor[point];
    board.points[actor === "white" ? 23 - point : point][opponent] =
      fixture.opponent[point];
  }
  board.bar[actor] = fixture.actor[24];
  board.bar[opponent] = fixture.opponent[24];
  board.borneOff[actor] = 15 - fixture.actor.reduce((a, b) => a + b, 0);
  board.borneOff[opponent] = 15 - fixture.opponent.reduce((a, b) => a + b, 0);
  const base = corpus.validHostMessages.find(
    (item) => item.method === "analyze-cube",
  ).payload;
  return {
    ...base,
    role,
    recordedAction,
    actor: role === "offer" ? actor : opponent,
    position: {
      ...base.position,
      revision: `cube:${fixture.name}:${actor}:${role}:${recordedAction}`,
      board,
      playerOnRoll: actor,
      cube: {
        value: fixture.cube,
        owner: fixture.owner === -1 ? null : actor,
        state: fixture.owner === -1 ? "available" : "accepted",
        offeredBy: null,
      },
      match: {
        mode: fixture.length ? "match" : "money",
        length: fixture.length || null,
        score: { [actor]: fixture.score[0], [opponent]: fixture.score[1] },
        crawford: fixture.crawford
          ? "crawford"
          : fixture.score.some((score) => score === fixture.length - 1)
            ? "post-crawford"
            : "none",
      },
    },
  };
}
try {
  assert.deepEqual(
    engine.hello({
      supportedProtocolVersions: [1],
      host: { name: "cube-test", version: "1" },
    }).metadata.capabilities.analysis.methods,
    ["analyze-checker", "analyze-cube"],
  );
  for (const fixture of reference.cases)
    for (const actor of ["white", "black"]) {
      if (!fixture.evaluated) {
        assert.throws(
          () =>
            engine.analyzeCube(
              requestFor(fixture, actor, "offer", "no-double"),
            ),
          (error) =>
            error instanceof GnubgEngineError &&
            ["unsupported", "invalid-request"].includes(error.bepError.code),
        );
        continue;
      }
      for (const role of ["offer", "response"])
        for (const action of role === "offer"
          ? ["no-double", "double"]
          : ["take", "pass"]) {
          const request = requestFor(fixture, actor, role, action);
          const result = engine.analyzeCube(request);
          close(result.noDoubleEquity, fixture.noDouble);
          close(result.doubleTakeEquity, fixture.take);
          close(result.doublePassEquity, fixture.pass);
          assert.equal(result.equityPerspective, actor);
          assert.equal(result.referenceCube, fixture.cube);
          assert.equal(result.actor, request.actor);
          assert.equal(result.provenance.assetsId, assetsId);
          const offered = Math.min(fixture.take, fixture.pass);
          const recorded =
            action === "no-double"
              ? fixture.noDouble
              : action === "double"
                ? offered
                : action === "take"
                  ? fixture.take
                  : fixture.pass;
          close(result.recordedActionEquity, recorded);
          close(
            result.equityLoss,
            role === "offer"
              ? Math.max(fixture.noDouble, offered) - recorded
              : recorded - offered,
          );
          assert.equal(
            result.recommendedAction,
            role === "offer"
              ? fixture.noDouble >= offered
                ? "no-double"
                : "double"
              : fixture.take <= fixture.pass
                ? "take"
                : "pass",
          );
          assert.equal(
            result.tooGood,
            role === "offer" &&
              [
                "too-good",
                "match-5-score-1-3",
                "post-crawford-trailing",
                "match-7-too-good",
              ].includes(fixture.name),
          );
        }
    }
  // Rejection leaves the initialized runtime usable.
  const good = requestFor(reference.cases[0], "white", "offer", "no-double");
  assert.throws(
    () => engine.analyzeCube({ ...good, profile: "deep-2ply-v1" }),
    (error) => error.bepError.code === "unsupported",
  );
  close(engine.analyzeCube(good).equityLoss, 0.088883877);
  console.log(
    "Real WASM cube analysis: independent equities, mirrored roles, losses, too-good, unavailable cubes and recovery passed",
  );
} finally {
  engine.dispose();
}
