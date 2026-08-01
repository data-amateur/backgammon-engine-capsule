import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
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
  throw new Error(`Unknown build argument: ${unknownArguments[0]}`);
}
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
const buildRoot = path.join(
  repositoryRoot,
  sanitized ? "build/gnubg/native-sanitized" : "build/gnubg/native",
);
const adapterRoot = path.join(repositoryRoot, "native/gnubg");
const compiler = process.env.CC || "cc";
const make = process.env.MAKE || "make";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} is required for the GNUbg native build`);
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

function simpleWords(value, source) {
  // This intentionally supports argv-like tokens, not shell evaluation.
  if (/["'`\\]/u.test(value)) {
    throw new Error(
      `${source} must use simple whitespace-separated tokens; ` +
        "quotes and backslashes are not supported",
    );
  }
  return value ? value.split(/\s+/u) : [];
}

function firstLine(value) {
  return value.split(/\r?\n/u)[0] ?? "";
}

function makefileVariable(file, name) {
  const prefix = `${name} = `;
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length) : null;
}

const inheritedEnvironment = Object.fromEntries(
  [
    "CC",
    "CFLAGS",
    "CPPFLAGS",
    "CXXFLAGS",
    "LDFLAGS",
    "MAKE",
    "CONFIG_SITE",
    "PKG_CONFIG_PATH",
    "PKG_CONFIG_LIBDIR",
  ]
    .filter((name) => Object.hasOwn(process.env, name))
    .map((name) => [name, process.env[name]]),
);
const inheritedCppFlags = simpleWords(
  process.env.CPPFLAGS ?? "",
  "CPPFLAGS",
);
const inheritedCFlags = simpleWords(process.env.CFLAGS ?? "", "CFLAGS");
const inheritedLdFlags = simpleWords(
  process.env.LDFLAGS ?? "",
  "LDFLAGS",
);
const sanitizerCompileFlags = [
  "-O1",
  "-g",
  "-fno-omit-frame-pointer",
  "-fno-sanitize-recover=all",
  "-fsanitize=address,undefined",
];
const sanitizerLinkFlags = ["-fsanitize=address,undefined"];
const modeCompileFlags = sanitized
  ? sanitizerCompileFlags
  : inheritedCFlags.length > 0
    ? []
    : ["-O2"];
const modeLinkFlags = sanitized ? sanitizerLinkFlags : [];
const effectiveCompileFlags = [
  ...inheritedCppFlags,
  ...inheritedCFlags,
  ...modeCompileFlags,
];
/* Automake includes CFLAGS in compiler-driver link commands; mirror it. */
const effectiveLinkFlags = [
  ...inheritedCFlags,
  ...inheritedLdFlags,
  ...modeLinkFlags,
];
const buildEnvironment = {
  ...process.env,
  CFLAGS: [process.env.CFLAGS, ...modeCompileFlags]
    .filter(Boolean)
    .join(" "),
  ...(sanitized
    ? {
        LDFLAGS: [process.env.LDFLAGS, ...sanitizerLinkFlags]
          .filter(Boolean)
          .join(" "),
      }
    : {}),
};

run(process.execPath, [path.join(repositoryRoot, "scripts/prepare-gnubg-source.mjs")]);
const preparedSource = JSON.parse(
  readFileSync(path.join(repositoryRoot, "third_party/gnubg/work/prepared-source.json"), "utf8"),
);

rmSync(buildRoot, { recursive: true, force: true });
mkdirSync(buildRoot, { recursive: true });

const configureFlags = [
  "--quiet",
  "--with-gtk=no",
  "--with-gtk3=no",
  "--with-board3d=no",
  "--with-python=no",
  "--with-sqlite=no",
  "--without-libcurl",
  "--disable-threads",
  "--disable-cputest",
  "--enable-simd=no",
];
run(path.join(sourceRoot, "configure"), configureFlags, {
  cwd: buildRoot,
  env: buildEnvironment,
});

const coreObjects = [
  "eval.o",
  "positionid.o",
  "matchequity.o",
  "matchid.o",
  "mtsupport.o",
  "bearoffgammon.o",
  "bearoff.o",
  "mec.o",
  "util.o",
];
const jobs = Math.max(1, Math.min(os.availableParallelism?.() ?? 2, 8));
run(make, [`-j${jobs}`, "--silent", ...coreObjects], {
  cwd: buildRoot,
  env: buildEnvironment,
});
run(make, [`-j${jobs}`, "--silent"], {
  cwd: path.join(buildRoot, "lib"),
  env: buildEnvironment,
});

const glibCflags = simpleWords(
  run("pkg-config", ["--cflags", "glib-2.0"], { capture: true }),
  "pkg-config --cflags glib-2.0 output",
);
const glibLibraries = simpleWords(
  run("pkg-config", ["--libs", "glib-2.0"], { capture: true }),
  "pkg-config --libs glib-2.0 output",
);
const toolchain = {
  compilerVersion: firstLine(run(compiler, ["--version"], { capture: true })),
  compilerTarget: run(compiler, ["-dumpmachine"], { capture: true }),
  makeVersion: firstLine(run(make, ["--version"], { capture: true })),
  pkgConfigVersion: run("pkg-config", ["--version"], { capture: true }),
  glibVersion: run("pkg-config", ["--modversion", "glib-2.0"], { capture: true }),
};
const commonCompileFlags = [
  "-std=c11",
  ...effectiveCompileFlags,
  "-Wall",
  "-Wextra",
  "-Werror",
  "-DHAVE_CONFIG_H",
  `-I${buildRoot}`,
  `-I${sourceRoot}`,
  `-I${path.join(sourceRoot, "lib")}`,
  `-I${adapterRoot}`,
  ...glibCflags,
];

const harnessSources = [
  "gnubg_adapter.c",
  "gnubg_wasm_abi.c",
  "gnubg_wasm_marshal.c",
  "gnubg_wasm_bridge.c",
  "gnubg_wasm_test_support.c",
  "gnubg_golden_test.c",
  "gnubg_wasm_public_smoke_test.c",
];
const harnessObjects = harnessSources.map((source) =>
  path.join(buildRoot, source.replace(/\.c$/u, ".o")),
);
for (let index = 0; index < harnessSources.length; index++) {
  run(compiler, [
    ...commonCompileFlags,
    "-c",
    path.join(adapterRoot, harnessSources[index]),
    "-o",
    harnessObjects[index],
  ]);
}

const objectBySource = new Map(
  harnessSources.map((source, index) => [source, harnessObjects[index]]),
);
const runtimeSources = [
  "gnubg_adapter.c",
  "gnubg_wasm_abi.c",
  "gnubg_wasm_marshal.c",
  "gnubg_wasm_bridge.c",
];
const executableSpecifications = [
  {
    file: path.join(buildRoot, "gnubg-native-golden"),
    sources: [
      ...runtimeSources,
      "gnubg_wasm_test_support.c",
      "gnubg_golden_test.c",
    ],
  },
  {
    file: path.join(buildRoot, "gnubg-wasm-public-smoke"),
    sources: [...runtimeSources, "gnubg_wasm_public_smoke_test.c"],
  },
];
for (const specification of executableSpecifications) {
  run(compiler, [
    ...effectiveLinkFlags,
    "-o",
    specification.file,
    ...specification.sources.map((source) => objectBySource.get(source)),
    ...coreObjects.map((object) => path.join(buildRoot, object)),
    path.join(buildRoot, "lib/.libs/libevent.a"),
    ...glibLibraries,
    "-lm",
  ]);
}

writeFileSync(
  path.join(buildRoot, "build-info.json"),
  `${JSON.stringify(
    {
      gnubgVersion: sourceLock.version,
      archiveSha256: sourceLock.archive.sha256,
      sourcePatches: preparedSource.patches,
      buildKind: "clean authenticated-source native test build; not bit-for-bit reproducible",
      buildMode: sanitized ? "asan-ubsan" : "release-test",
      configureFlags,
      coreObjects,
      harnessSources,
      harnessObjects: harnessObjects.map((object) => path.basename(object)),
      executables: executableSpecifications.map((specification) => ({
        file: path.basename(specification.file),
        sources: specification.sources,
      })),
      host: {
        platform: process.platform,
        architecture: process.arch,
        release: os.release(),
      },
      toolchain: {
        compiler,
        make,
        ...toolchain,
      },
      inheritedEnvironment,
      upstreamMakefile: {
        cc: makefileVariable(path.join(buildRoot, "Makefile"), "CC"),
        amCflags: makefileVariable(path.join(buildRoot, "Makefile"), "AM_CFLAGS"),
        cflags: makefileVariable(path.join(buildRoot, "Makefile"), "CFLAGS"),
        cppflags: makefileVariable(path.join(buildRoot, "Makefile"), "CPPFLAGS"),
        ldflags: makefileVariable(path.join(buildRoot, "Makefile"), "LDFLAGS"),
        supportLibraryAmCflags: makefileVariable(
          path.join(buildRoot, "lib/Makefile"),
          "AM_CFLAGS",
        ),
      },
      adapterCompileFlags: commonCompileFlags,
      linkFlags: effectiveLinkFlags,
      glib: {
        cflags: glibCflags,
        libraries: glibLibraries,
        version: toolchain.glibVersion,
      },
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Built headless GNUbg native harnesses (${
    sanitized ? "ASan/UBSan" : "release-test"
  }): ${executableSpecifications
    .map((specification) => specification.file)
    .join(", ")}`,
);
