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
const buildRoot = path.join(repositoryRoot, "build/gnubg/native");
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

function shellWords(value) {
  // pkg-config emits plain compiler flags for the dependencies used here.
  // Reject quoting instead of pretending this tiny splitter is a shell.
  if (/["'`\\]/u.test(value)) {
    throw new Error(`Unsupported quoted pkg-config output: ${value}`);
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
});
run(make, [`-j${jobs}`, "--silent"], {
  cwd: path.join(buildRoot, "lib"),
});

const glibCflags = shellWords(
  run("pkg-config", ["--cflags", "glib-2.0"], { capture: true }),
);
const glibLibraries = shellWords(
  run("pkg-config", ["--libs", "glib-2.0"], { capture: true }),
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
  "-O2",
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

const adapterObject = path.join(buildRoot, "gnubg_adapter.o");
const testObject = path.join(buildRoot, "gnubg_golden_test.o");
run(compiler, [
  ...commonCompileFlags,
  "-c",
  path.join(adapterRoot, "gnubg_adapter.c"),
  "-o",
  adapterObject,
]);
run(compiler, [
  ...commonCompileFlags,
  "-c",
  path.join(adapterRoot, "gnubg_golden_test.c"),
  "-o",
  testObject,
]);

const executable = path.join(buildRoot, "gnubg-native-golden");
run(compiler, [
  "-o",
  executable,
  adapterObject,
  testObject,
  ...coreObjects.map((object) => path.join(buildRoot, object)),
  path.join(buildRoot, "lib/.libs/libevent.a"),
  ...glibLibraries,
  "-lm",
]);

writeFileSync(
  path.join(buildRoot, "build-info.json"),
  `${JSON.stringify(
    {
      gnubgVersion: sourceLock.version,
      archiveSha256: sourceLock.archive.sha256,
      sourcePatches: preparedSource.patches,
      buildKind: "clean authenticated-source native test build; not bit-for-bit reproducible",
      configureFlags,
      coreObjects,
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

console.log(`Built headless GNUbg native harness at ${executable}`);
