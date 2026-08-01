import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(repositoryRoot, "native/gnubg");
const buildRoot = path.join(repositoryRoot, "build/gnubg/wasm-abi-native");
const compiler = process.env.CC || "cc";
const executable = path.join(buildRoot, "gnubg-wasm-abi-layout-test");

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
  "-std=c11",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-pedantic",
  `-I${sourceRoot}`,
  path.join(sourceRoot, "gnubg_wasm_abi.c"),
  path.join(sourceRoot, "gnubg_wasm_abi_layout_test.c"),
  "-o",
  executable,
]);
run(executable, []);
