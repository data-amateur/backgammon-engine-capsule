import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(repositoryRoot, "native/gnubg");
const buildRoot = path.join(repositoryRoot, "build/gnubg/wasm-abi");
const lock = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "toolchains/emscripten-lock.json"),
    "utf8",
  ),
);
const compiler = process.env.EMCC || "emcc";
const emsdkRoot = process.env.EMSDK
  ? path.resolve(process.env.EMSDK)
  : path.isAbsolute(compiler)
    ? path.resolve(path.dirname(compiler), "../..")
    : null;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(
      `${command} was not found. Activate the pinned Emscripten ${lock.emscriptenVersion} SDK first; see docs/GNUBG-WASM.md`,
    );
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = options.capture
      ? `\n${result.stderr || result.stdout}`
      : "";
    throw new Error(`${command} exited with status ${result.status}${detail}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function firstLine(value) {
  return value.split(/\r?\n/u)[0] ?? "";
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

if (!emsdkRoot) {
  throw new Error(
    "Cannot verify the emsdk checkout. Source emsdk_env.sh or set EMCC to the absolute compiler path.",
  );
}

const emsdkCommit = run(
  "git",
  ["-C", emsdkRoot, "rev-parse", "HEAD"],
  { capture: true },
);
if (emsdkCommit !== lock.emsdkCommit) {
  throw new Error(
    `Expected emsdk commit ${lock.emsdkCommit}, received: ${emsdkCommit}`,
  );
}

const releaseMapping = JSON.parse(
  readFileSync(path.join(emsdkRoot, "emscripten-releases-tags.json"), "utf8"),
);
const mappedRelease = releaseMapping.releases?.[lock.emscriptenVersion];
if (mappedRelease !== lock.emscriptenReleasesBuild) {
  throw new Error(
    `Expected Emscripten build mapping ${lock.emscriptenReleasesBuild}, received: ${mappedRelease}`,
  );
}

const installedRelease = readFileSync(
  path.join(emsdkRoot, "upstream/.emsdk_version"),
  "utf8",
).trim();
const expectedInstalledPrefix =
  `releases-${lock.emscriptenReleasesBuild}-`;
if (!installedRelease.startsWith(expectedInstalledPrefix)) {
  throw new Error(
    `Expected installed SDK ${expectedInstalledPrefix}*, received: ${installedRelease}`,
  );
}

const compilerVersionOutput = run(compiler, ["--version"], { capture: true });
const compilerVersion = firstLine(compilerVersionOutput);
const versionMatch = compilerVersion.match(/\b(\d+\.\d+\.\d+)\b/u);
if (versionMatch?.[1] !== lock.emscriptenVersion) {
  throw new Error(
    `Expected Emscripten ${lock.emscriptenVersion}, received: ${compilerVersion}`,
  );
}
const releaseCommitMatch = compilerVersion.match(/\(([0-9a-f]{40})\)$/u);
if (releaseCommitMatch?.[1] !== lock.emscriptenReleaseCommit) {
  throw new Error(
    `Expected Emscripten release commit ${lock.emscriptenReleaseCommit}, received: ${compilerVersion}`,
  );
}

const compilerTarget = run(compiler, ["-dumpmachine"], { capture: true });
if (!compilerTarget.startsWith("wasm32")) {
  throw new Error(`Expected a wasm32 compiler target, received: ${compilerTarget}`);
}

rmSync(buildRoot, { recursive: true, force: true });
mkdirSync(buildRoot, { recursive: true });

const moduleFile = path.join(buildRoot, "gnubg-wasm-abi.mjs");
const compileFlags = [
  "-std=c11",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-pedantic",
  "--no-entry",
  "-sSTRICT=1",
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sEXPORT_NAME=createGnubgWasmAbiModule",
  "-sENVIRONMENT=worker,node",
  "-sFILESYSTEM=0",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sASSERTIONS=1",
  "-sERROR_ON_UNDEFINED_SYMBOLS=1",
  "-sEXPORTED_RUNTIME_METHODS=[\"HEAPU8\"]",
  "-sEXPORTED_FUNCTIONS=[\"_malloc\",\"_free\",\"_bgc_wasm_abi_version\",\"_bgc_wasm_abi_descriptor_size\",\"_bgc_wasm_get_abi_descriptor\"]",
  `-I${sourceRoot}`,
  path.join(sourceRoot, "gnubg_wasm_abi.c"),
  "-o",
  moduleFile,
];
run(compiler, compileFlags);

const artifacts = [
  moduleFile,
  path.join(buildRoot, "gnubg-wasm-abi.wasm"),
].map((file) => ({
  file: path.relative(repositoryRoot, file),
  size: statSync(file).size,
  sha256: sha256(file),
}));

writeFileSync(
  path.join(buildRoot, "build-info.json"),
  `${JSON.stringify(
    {
      buildKind: "ABI-only wasm32 smoke module; no GNUbg evaluator linked",
      abiVersion: "1.0",
      lock,
      compiler: {
        command: compiler,
        version: compilerVersion,
        target: compilerTarget,
        emsdkRoot,
        emsdkCommit,
        mappedRelease,
        installedRelease,
      },
      compileFlags,
      artifacts,
    },
    null,
    2,
  )}\n`,
);

console.log(`Built ABI-only WebAssembly module at ${moduleFile}`);
