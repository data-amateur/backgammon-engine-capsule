import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
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
const sourceRoot = path.join(repositoryRoot, "native/gnubg");
const buildRoot = path.join(
  repositoryRoot,
  sanitized
    ? "build/gnubg/wasm-abi-native-sanitized"
    : "build/gnubg/wasm-abi-native",
);
const compiler = process.env.CC || "cc";
const layoutExecutable = path.join(
  buildRoot,
  "gnubg-wasm-abi-layout-test",
);
const marshalExecutable = path.join(
  buildRoot,
  "gnubg-wasm-marshal-test",
);
const bridgeExecutable = path.join(
  buildRoot,
  "gnubg-wasm-bridge-fake-test",
);
const sanitizerFlags = [
  "-O1",
  "-g",
  "-fno-omit-frame-pointer",
  "-fno-sanitize-recover=all",
  "-fsanitize=address,undefined",
];
const strictFlags = [
  "-std=c11",
  ...(sanitized ? sanitizerFlags : ["-O2"]),
  "-Wall",
  "-Wextra",
  "-Werror",
  "-pedantic",
  `-I${sourceRoot}`,
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} is required for the wasm32 ABI layout test`);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

rmSync(buildRoot, { recursive: true, force: true });
mkdirSync(buildRoot, { recursive: true });

run(compiler, [
  ...strictFlags,
  path.join(sourceRoot, "gnubg_wasm_abi.c"),
  path.join(sourceRoot, "gnubg_wasm_abi_layout_test.c"),
  "-o",
  layoutExecutable,
]);
run(layoutExecutable, []);

run(compiler, [
  ...strictFlags,
  path.join(sourceRoot, "gnubg_wasm_marshal.c"),
  path.join(sourceRoot, "gnubg_wasm_marshal_test.c"),
  ...(sanitized ? ["-fsanitize=address,undefined"] : []),
  "-o",
  marshalExecutable,
]);
run(marshalExecutable, []);

run(compiler, [
  ...strictFlags,
  path.join(sourceRoot, "gnubg_wasm_abi.c"),
  path.join(sourceRoot, "gnubg_wasm_marshal.c"),
  path.join(sourceRoot, "gnubg_wasm_bridge.c"),
  path.join(sourceRoot, "gnubg_wasm_bridge_fake_test.c"),
  "-lm",
  ...(sanitized ? ["-fsanitize=address,undefined"] : []),
  "-o",
  bridgeExecutable,
]);
for (const scenario of [
  "lifecycle-success",
  "init-failure",
  "decision-failures",
  "malformed-init-output",
  "malformed-choose-output",
  "malformed-cube-output",
  "strength-conversion",
  "wire-validation",
  "dispose-before-init",
]) {
  run(bridgeExecutable, [scenario]);
}
