import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const lock = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "toolchains/emscripten-lock.json"),
    "utf8",
  ),
);
const sourceLock = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "third_party/gnubg/source-lock.json"),
    "utf8",
  ),
);
const sourceRoot = path.join(
  repositoryRoot,
  "third_party/gnubg/work",
  `gnubg-${sourceLock.version}`,
);
const nativeRoot = path.join(repositoryRoot, "native/gnubg");
const compatibilityRoot = path.join(nativeRoot, "wasm-compat");
const generatedRoot = path.join(repositoryRoot, "build/gnubg/generated");
const buildRoot = path.join(repositoryRoot, "build/gnubg/wasm");
const objectRoot = path.join(buildRoot, "objects");
const compiler = process.env.EMCC || "emcc";
const emsdkRoot = process.env.EMSDK
  ? path.resolve(process.env.EMSDK)
  : path.isAbsolute(compiler)
    ? path.resolve(path.dirname(compiler), "../..")
    : null;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
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
    throw new Error(
      `${command} exited with status ${result.status}${detail}`,
    );
  }
  return options.capture ? result.stdout.trim() : "";
}

function firstLine(value) {
  return value.split(/\r?\n/u)[0] ?? "";
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function artifact(file) {
  const bytes = readFileSync(file);
  return {
    file: path.relative(repositoryRoot, file),
    size: bytes.length,
    gzipSize: gzipSync(bytes, { level: 9 }).length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function normalizeBuildValue(value) {
  let normalized = String(value);
  const replacements = [
    [repositoryRoot, "<repository>"],
    ...(emsdkRoot ? [[emsdkRoot, "<emsdk>"]] : []),
  ].sort(([left], [right]) => right.length - left.length);
  for (const [absolutePath, replacement] of replacements) {
    normalized = normalized.replaceAll(absolutePath, replacement);
  }
  return normalized;
}

function assertNoPrivateBuildPaths(file) {
  const bytes = readFileSync(file);
  for (const absolutePath of [repositoryRoot, emsdkRoot].filter(Boolean)) {
    if (bytes.includes(Buffer.from(absolutePath))) {
      throw new Error(
        `Generated artifact exposes a local absolute path: ${path.relative(repositoryRoot, file)}`,
      );
    }
  }
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
  readFileSync(
    path.join(emsdkRoot, "emscripten-releases-tags.json"),
    "utf8",
  ),
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

const compilerVersionOutput = run(
  compiler,
  ["--version"],
  { capture: true },
);
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

const compilerTarget = run(
  compiler,
  ["-dumpmachine"],
  { capture: true },
);
if (!compilerTarget.startsWith("wasm32")) {
  throw new Error(
    `Expected a wasm32 compiler target, received: ${compilerTarget}`,
  );
}

const runtimeNoticeCopies = [
  {
    source: path.join(emsdkRoot, "upstream/emscripten/LICENSE"),
    output: path.join(buildRoot, "EMSCRIPTEN-LICENSE.txt"),
  },
  {
    source: path.join(
      emsdkRoot,
      "upstream/emscripten/system/lib/libc/musl/COPYRIGHT",
    ),
    output: path.join(buildRoot, "MUSL-COPYRIGHT.txt"),
  },
];
for (const notice of runtimeNoticeCopies) {
  if (!existsSync(notice.source) || statSync(notice.source).size === 0) {
    throw new Error(`Pinned runtime notice is missing: ${notice.source}`);
  }
}

run(
  process.execPath,
  [path.join(repositoryRoot, "scripts/prepare-gnubg-source.mjs")],
);
run(
  process.execPath,
  [path.join(repositoryRoot, "scripts/test-generate-gnubg-met.mjs")],
);
run(
  process.execPath,
  [path.join(repositoryRoot, "scripts/generate-gnubg-met.mjs")],
);

const preparedSource = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "third_party/gnubg/work/prepared-source.json"),
    "utf8",
  ),
);
const generatedMatchEquity = path.join(
  generatedRoot,
  "gnubg_kazaross_xg2_met_bits.inc",
);
if (!existsSync(generatedMatchEquity)) {
  throw new Error("The generated embedded match-equity include is missing");
}

rmSync(buildRoot, { recursive: true, force: true });
mkdirSync(objectRoot, { recursive: true });
for (const notice of runtimeNoticeCopies) {
  copyFileSync(notice.source, notice.output);
}

const evaluatorSources = [
  "eval.c",
  "positionid.c",
  "matchequity.c",
  "matchid.c",
  "mtsupport.c",
  "bearoffgammon.c",
  "bearoff.c",
  "lib/neuralnet.c",
  "lib/isaac.c",
  "lib/md5.c",
  "lib/cache.c",
  "lib/inputs.c",
].map((source) => path.join(sourceRoot, source));
const capsuleSources = [
  "gnubg_adapter.c",
  "gnubg_wasm_abi.c",
  "gnubg_wasm_marshal.c",
  "gnubg_wasm_bridge.c",
  "gnubg_wasm_runtime.c",
].map((source) => path.join(nativeRoot, source));
const sources = [...evaluatorSources, ...capsuleSources];

const compileFlags = [
  "-std=c11",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-DHAVE_CONFIG_H",
  "-DBGC_EMBEDDED_KAZAROSS_MET=1",
  "-DBGC_EVAL_CACHE_ENTRIES=65536",
  "-DBGC_PRUNE_CACHE_ENTRIES=8192",
  "-DBUILD_DATE=0",
  `-ffile-prefix-map=${repositoryRoot}=.`,
  `-fmacro-prefix-map=${repositoryRoot}=.`,
  `-I${path.relative(repositoryRoot, compatibilityRoot)}`,
  `-I${path.relative(repositoryRoot, generatedRoot)}`,
  `-I${path.relative(repositoryRoot, sourceRoot)}`,
  `-I${path.relative(repositoryRoot, path.join(sourceRoot, "lib"))}`,
  `-I${path.relative(repositoryRoot, nativeRoot)}`,
];

const objects = sources.map((source) => {
  const relativeSource = path.relative(repositoryRoot, source);
  const objectName = relativeSource
    .replaceAll("/", "__")
    .replace(/\.c$/u, ".o");
  return path.join(objectRoot, objectName);
});
for (let index = 0; index < sources.length; index++) {
  run(compiler, [
    ...compileFlags,
    "-c",
    path.relative(repositoryRoot, sources[index]),
    "-o",
    path.relative(repositoryRoot, objects[index]),
  ]);
}

const llvmNm = path.join(emsdkRoot, "upstream/bin/llvm-nm");
const undefinedSymbols = run(
  llvmNm,
  [
    "--undefined-only",
    ...objects.map((object) => path.relative(repositoryRoot, object)),
  ],
  { capture: true },
);
const forbiddenUndefined = [
  /\bU g_/u,
  /\bU g_markup_/u,
  /\bU g_file_get_contents\b/u,
  /\bU g_ascii_strtod\b/u,
  /\bU g_ascii_strtoull\b/u,
  /\bU List(?:Create|Insert|Delete)\b/u,
  /\bU mec(?:_pc)?\b/u,
];
for (const pattern of forbiddenUndefined) {
  if (pattern.test(undefinedSymbols)) {
    throw new Error(
      `Forbidden desktop/parser dependency remained in wasm objects: ${pattern}`,
    );
  }
}
writeFileSync(
  path.join(buildRoot, "undefined-symbols.txt"),
  `${undefinedSymbols}\n`,
);

const moduleFile = path.join(buildRoot, "gnubg-wasm.mjs");
const exportedFunctions = [
  "_malloc",
  "_free",
  "_bgc_wasm_abi_version",
  "_bgc_wasm_abi_descriptor_size",
  "_bgc_wasm_get_abi_descriptor",
  "_bgc_wasm_alloc",
  "_bgc_wasm_free",
  "_bgc_wasm_init",
  "_bgc_wasm_choose_turn",
  "_bgc_wasm_decide_cube",
  "_bgc_wasm_reset",
  "_bgc_wasm_dispose",
];
const weightsFile = path.join(sourceRoot, "gnubg.weights");
const matchEquityFile = path.join(sourceRoot, "met/Kazaross-XG2.xml");
const linkObjects = objects.map((object) => path.relative(buildRoot, object));
const linkFlags = [
  "-O2",
  "--no-entry",
  "-sSTRICT=1",
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sEXPORT_NAME=createGnubgEngineModule",
  "-sENVIRONMENT=worker,node",
  "-sFORCE_FILESYSTEM=1",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sINITIAL_MEMORY=33554432",
  "-sMAXIMUM_MEMORY=134217728",
  "-sSTACK_SIZE=1048576",
  "-sABORTING_MALLOC=0",
  "-sASSERTIONS=1",
  "-sEMIT_EMSCRIPTEN_LICENSE=1",
  "-sERROR_ON_UNDEFINED_SYMBOLS=1",
  "-sINCOMING_MODULE_JS_API=[\"locateFile\"]",
  "-sEXPORTED_RUNTIME_METHODS=[\"HEAPU8\"]",
  `-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
  "--preload-file",
  `${path.relative(buildRoot, weightsFile)}@/gnubg/gnubg.weights`,
  "--preload-file",
  `${path.relative(buildRoot, matchEquityFile)}@/gnubg/met/Kazaross-XG2.xml`,
  "-o",
  path.basename(moduleFile),
];
run(compiler, [...linkObjects, ...linkFlags], { cwd: buildRoot });

const outputFiles = [
  moduleFile,
  path.join(buildRoot, "gnubg-wasm.wasm"),
  path.join(buildRoot, "gnubg-wasm.data"),
];
for (const file of outputFiles) {
  if (!existsSync(file) || statSync(file).size === 0) {
    throw new Error(`Expected nonempty wasm artifact: ${file}`);
  }
  assertNoPrivateBuildPaths(file);
}
const moduleSource = readFileSync(moduleFile, "utf8");
if (!/Copyright [0-9]+ The Emscripten Authors/u.test(moduleSource)) {
  throw new Error("Generated JavaScript is missing the Emscripten license block");
}

const artifacts = outputFiles.map(artifact);
const runtimeNotices = runtimeNoticeCopies.map((notice) =>
  artifact(notice.output)
);
const payloadSize = artifacts.reduce(
  (total, current) => total + current.size,
  0,
);
const payloadGzipSize = artifacts.reduce(
  (total, current) => total + current.gzipSize,
  0,
);

const buildInfoFile = path.join(buildRoot, "build-info.json");
writeFileSync(
  buildInfoFile,
  `${JSON.stringify(
    {
      buildKind:
        "real GNUbg 1.08.003 wasm32 evaluator for the browser capsule Worker",
      abiVersion: "1.0",
      gnubgVersion: sourceLock.version,
      archiveSha256: sourceLock.archive.sha256,
      sourcePatches: preparedSource.patches,
      generatedMatchEquity: {
        file: path.relative(repositoryRoot, generatedMatchEquity),
        sha256: sha256(generatedMatchEquity),
        sourceXmlSha256:
          "7a232b171744b8db34306d11cff79a5974541328bb033b6bf16c012e8f7a3cc3",
      },
      compiler: {
        command: normalizeBuildValue(compiler),
        version: compilerVersion,
        target: compilerTarget,
        emsdkRoot: normalizeBuildValue(emsdkRoot),
        emsdkCommit,
        mappedRelease,
        installedRelease,
      },
      compileFlags: compileFlags.map(normalizeBuildValue),
      sources: sources.map((source) =>
        path.relative(repositoryRoot, source)
      ),
      objects: objects.map((object) =>
        path.relative(repositoryRoot, object)
      ),
      linkFlags: linkFlags.map(normalizeBuildValue),
      exportedFunctions,
      memory: {
        initialBytes: 33_554_432,
        maximumBytes: 134_217_728,
        stackBytes: 1_048_576,
        evaluatorCacheEntries: 65_536,
        pruningCacheEntries: 8_192,
        growthAllowed: true,
        abortingMalloc: false,
        pthreads: false,
      },
      assets: {
        weights: {
          virtualPath: "/gnubg/gnubg.weights",
          sha256: sha256(weightsFile),
          size: statSync(weightsFile).size,
        },
        matchEquityXml: {
          purpose:
            "temporary readable-path ABI input; evaluation uses the compiled authenticated table",
          virtualPath: "/gnubg/met/Kazaross-XG2.xml",
          sha256: sha256(matchEquityFile),
          size: statSync(matchEquityFile).size,
        },
      },
      artifacts,
      runtimeNotices,
      payload: {
        size: payloadSize,
        gzipSize: payloadGzipSize,
      },
    },
    null,
    2,
  )}\n`,
);
for (const file of [
  path.join(buildRoot, "undefined-symbols.txt"),
  ...outputFiles,
  ...runtimeNoticeCopies.map((notice) => notice.output),
  buildInfoFile,
]) {
  assertNoPrivateBuildPaths(file);
}

console.log(
  `Built real GNUbg WebAssembly evaluator at ${moduleFile} (${payloadSize} bytes across module, wasm, and data)`,
);
