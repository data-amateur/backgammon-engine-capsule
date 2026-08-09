import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const arguments_ = process.argv.slice(2);
const sanitized = arguments_.includes("--sanitized");
const unknownArguments = arguments_.filter(
  (argument) => argument !== "--sanitized",
);
if (unknownArguments.length > 0) {
  throw new Error(`Unknown test argument: ${unknownArguments[0]}`);
}
const buildDirectory = sanitized ? "native-sanitized" : "native";
const sourceLock = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "third_party/gnubg/source-lock.json"),
    "utf8",
  ),
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function networkHeader(inputCount, hiddenCount, outputCount) {
  return (
    `${inputCount} ${hiddenCount} ${outputCount} ` +
    "0 0.1000000 1.0000000\n"
  );
}

function zeroNetwork(inputCount, hiddenCount, outputCount) {
  const floatCount =
    inputCount * hiddenCount +
    hiddenCount * outputCount +
    hiddenCount +
    outputCount;
  return (
    networkHeader(inputCount, hiddenCount, outputCount) +
    "0\n".repeat(floatCount)
  );
}

run(process.execPath, [
  path.join(repositoryRoot, "scripts/build-gnubg-native.mjs"),
  ...(sanitized ? ["--sanitized"] : []),
]);
const sourceRoot = path.join(
  repositoryRoot,
  "third_party/gnubg/work",
  `gnubg-${sourceLock.version}`,
);
const nativeBuildRoot = path.join(
  repositoryRoot,
  "build/gnubg",
  buildDirectory,
);
const fixtureRoot = path.join(nativeBuildRoot, "init-fixtures");
const validWeightsPath = path.join(sourceRoot, "gnubg.weights");
const matchEquityPath = path.join(sourceRoot, "met/Kazaross-XG2.xml");
const validShapes = [
  [250, 128, 5],
  [214, 128, 5],
  [250, 128, 5],
  [200, 16, 5],
  [200, 16, 5],
  [200, 8, 5],
];
const wrongHiddenShapes = [
  [250, 127, 5],
  [214, 128, 5],
  [250, 128, 5],
  [200, 16, 5],
  [200, 16, 5],
  [200, 8, 5],
];
const malformedWeightFixtures = [
  {
    scenario: "wrong-version",
    file: "wrong-version.weights",
    contents: "GNU Backgammon 0.00\n",
  },
  {
    scenario: "truncated-first-network",
    file: "truncated-first-network.weights",
    contents:
      "GNU Backgammon 1.01\n" +
      networkHeader(...validShapes[0]) +
      "0\n".repeat(17),
  },
  {
    scenario: "truncated-second-network",
    file: "truncated-second-network.weights",
    contents:
      "GNU Backgammon 1.01\n" +
      zeroNetwork(...validShapes[0]) +
      networkHeader(...validShapes[1]) +
      "0\n".repeat(17),
  },
  {
    scenario: "nonfinite-second-network",
    file: "nonfinite-second-network.weights",
    contents:
      "GNU Backgammon 1.01\n" +
      zeroNetwork(...validShapes[0]) +
      networkHeader(...validShapes[1]) +
      "nan\n",
  },
  {
    scenario: "wrong-hidden-shape",
    file: "wrong-hidden-shape.weights",
    contents:
      "GNU Backgammon 1.01\n" +
      wrongHiddenShapes
        .map(([input, hidden, output]) =>
          zeroNetwork(input, hidden, output),
        )
        .join(""),
  },
];
const testEnvironment = {
  ...process.env,
  G_DEBUG: "fatal-criticals",
  ...(sanitized
    ? {
        ASAN_OPTIONS:
          "detect_leaks=1:halt_on_error=1:strict_string_checks=1",
        UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=1",
      }
    : {}),
};

const metParityRoot = path.join(nativeBuildRoot, "met-parity");
const xmlMetDump = path.join(metParityRoot, "xml-parser.bin");
const embeddedMetDump = path.join(metParityRoot, "embedded.bin");
rmSync(metParityRoot, { recursive: true, force: true });
mkdirSync(metParityRoot, { recursive: true });
run(
  path.join(nativeBuildRoot, "gnubg-met-xml-dump"),
  [matchEquityPath, xmlMetDump],
  { env: testEnvironment },
);
run(
  path.join(nativeBuildRoot, "gnubg-met-embedded-dump"),
  [matchEquityPath, embeddedMetDump],
  { env: testEnvironment },
);
const xmlMetBytes = readFileSync(xmlMetDump);
const embeddedMetBytes = readFileSync(embeddedMetDump);
const expectedMetBytes =
  64 * 64 * 4 +
  2 * 64 * 4 +
  7 * 64 * 64 * 4 * 4 +
  7 * 64 * 2 * 4 * 4;
if (
  xmlMetBytes.length !== expectedMetBytes ||
  embeddedMetBytes.length !== expectedMetBytes
) {
  throw new Error(
    `MET parity dumps must each contain ${expectedMetBytes} bytes; ` +
      `received XML=${xmlMetBytes.length}, embedded=${embeddedMetBytes.length}`,
  );
}
if (!xmlMetBytes.equals(embeddedMetBytes)) {
  let difference = 0;
  while (
    difference < xmlMetBytes.length &&
    xmlMetBytes[difference] === embeddedMetBytes[difference]
  ) {
    difference += 1;
  }
  throw new Error(
    `embedded MET differs from GNUbg XML parsing at byte ${difference}`,
  );
}
console.log(
  `Embedded MET parity passed for all ${expectedMetBytes} table and gammon-price bytes`,
);

rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(fixtureRoot, { recursive: true });
for (const fixture of malformedWeightFixtures) {
  const fixturePath = path.join(fixtureRoot, fixture.file);
  writeFileSync(fixturePath, fixture.contents, {
    encoding: "utf8",
    flag: "wx",
  });
  run(
    path.join(nativeBuildRoot, "gnubg-native-init-failure"),
    [
      fixture.scenario,
      fixturePath,
      validWeightsPath,
      matchEquityPath,
    ],
    { env: testEnvironment },
  );
}

// Every malformed run consumes an independent process. A subsequent
// authenticated initialization demonstrates the required fresh-process retry.
for (const executable of [
  "gnubg-native-golden",
  "gnubg-wasm-public-smoke",
]) {
  run(path.join(nativeBuildRoot, executable), [sourceRoot], {
    env: testEnvironment,
  });
}
