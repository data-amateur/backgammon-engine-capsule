import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

run(process.execPath, [
  path.join(repositoryRoot, "scripts/build-gnubg-native.mjs"),
  ...(sanitized ? ["--sanitized"] : []),
]);
const sourceRoot = path.join(
  repositoryRoot,
  "third_party/gnubg/work",
  `gnubg-${sourceLock.version}`,
);
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
for (const executable of [
  "gnubg-native-golden",
  "gnubg-wasm-public-smoke",
]) {
  run(
    path.join(repositoryRoot, "build/gnubg", buildDirectory, executable),
    [sourceRoot],
    { env: testEnvironment },
  );
}
