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
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const mode = process.argv[2] ?? "development";
const production = mode === "production";
const env = { ...loadEnv(mode, repositoryRoot, "VITE_"), ...process.env };
const wasmBuildRoot = path.join(repositoryRoot, "build/gnubg/wasm");
const publicRoot = path.join(repositoryRoot, "build/browser-public");
const manifestFile = path.join(
  repositoryRoot,
  "build/browser-assets-manifest.json",
);

const staticPublicFiles = [
  "LICENSE.txt",
  "NOTICE.txt",
  "THIRD_PARTY_NOTICES.txt",
  "robots.txt",
];
const engineFiles = [
  "gnubg-wasm.mjs",
  "gnubg-wasm.wasm",
  "gnubg-wasm.data",
  "build-info.json",
  "EMSCRIPTEN-LICENSE.txt",
  "MUSL-COPYRIGHT.txt",
];
const payloadFiles = [
  "gnubg-wasm.mjs",
  "gnubg-wasm.wasm",
  "gnubg-wasm.data",
];

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file));
}

function requireRegularFile(file, description) {
  if (!existsSync(file)) {
    throw new Error(
      `${description} is missing: ${path.relative(repositoryRoot, file)}`,
    );
  }
  const stats = statSync(file);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error(
      `${description} must be a nonempty regular file: ${path.relative(repositoryRoot, file)}`,
    );
  }
}

function safeBuildId(value) {
  const trimmed = value?.trim();
  if (!trimmed || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(trimmed)) {
    throw new Error(
      "VITE_BUILD_ID must be a 1-128 character safe release identifier",
    );
  }
  return trimmed;
}

function publicUrl(value, variableName, fallback) {
  const source = value?.trim() || fallback;
  if (!source) {
    throw new Error(`${variableName} is required`);
  }
  const url = new URL(source);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && loopback)) ||
    (production && url.protocol !== "https:")
  ) {
    throw new Error(
      `${variableName} must be HTTPS (HTTP is allowed only for loopback non-production builds)`,
    );
  }
  return url.href;
}

for (const fileName of engineFiles) {
  requireRegularFile(
    path.join(wasmBuildRoot, fileName),
    "Real GNUbg WebAssembly build artifact",
  );
}

const buildInfo = JSON.parse(
  readFileSync(path.join(wasmBuildRoot, "build-info.json"), "utf8"),
);
if (
  buildInfo.abiVersion !== "1.0" ||
  buildInfo.gnubgVersion !== "1.08.003" ||
  !Array.isArray(buildInfo.artifacts)
) {
  throw new Error("GNUbg build-info.json has an unexpected identity or shape");
}

for (const payloadName of payloadFiles) {
  const artifact = buildInfo.artifacts.find(
    ({ file }) => path.basename(file) === payloadName,
  );
  const sourceFile = path.join(wasmBuildRoot, payloadName);
  if (
    !artifact ||
    artifact.size !== statSync(sourceFile).size ||
    artifact.sha256 !== sha256File(sourceFile)
  ) {
    throw new Error(`${payloadName} does not match build-info.json`);
  }
}

const contentDigest = createHash("sha256");
for (const fileName of engineFiles) {
  contentDigest.update(fileName, "utf8");
  contentDigest.update("\0", "utf8");
  contentDigest.update(readFileSync(path.join(wasmBuildRoot, fileName)));
  contentDigest.update("\0", "utf8");
}
const contentVersion = `sha256-${contentDigest.digest("hex")}`;
const publicBase = `/engines/${contentVersion}/`;
const enginePublicRoot = path.join(
  publicRoot,
  "engines",
  contentVersion,
);

const capsuleOrigin = publicUrl(
  env.VITE_CAPSULE_PUBLIC_ORIGIN,
  "VITE_CAPSULE_PUBLIC_ORIGIN",
  production ? undefined : "http://localhost:4174/",
);
const buildId = safeBuildId(
  env.VITE_BUILD_ID || (production ? undefined : `gnubg-${mode}`),
);
const sourceUrl = publicUrl(
  env.VITE_SOURCE_URL,
  "VITE_SOURCE_URL",
  production ? undefined : new URL("SOURCE.txt", capsuleOrigin).href,
);
const licenseUrl = publicUrl(
  env.VITE_LICENSE_URL,
  "VITE_LICENSE_URL",
  production
    ? undefined
    : new URL("LICENSES/GPL-3.0-or-later.txt", capsuleOrigin).href,
);

rmSync(publicRoot, { recursive: true, force: true });
rmSync(manifestFile, { force: true });
mkdirSync(enginePublicRoot, { recursive: true });

const stagedFiles = [];

function stageFile(sourceFile, publicPath, role) {
  requireRegularFile(sourceFile, `Staged ${role}`);
  const outputFile = path.join(publicRoot, ...publicPath.split("/"));
  mkdirSync(path.dirname(outputFile), { recursive: true });
  copyFileSync(sourceFile, outputFile);
  const stats = statSync(outputFile);
  stagedFiles.push({
    path: publicPath,
    role,
    size: stats.size,
    sha256: sha256File(outputFile),
  });
}

for (const fileName of staticPublicFiles) {
  stageFile(
    path.join(repositoryRoot, "public", fileName),
    fileName,
    "capsule-static",
  );
}
stageFile(
  path.join(repositoryRoot, "LICENSES/GPL-3.0-or-later.txt"),
  "LICENSES/GPL-3.0-or-later.txt",
  "gpl-license",
);
for (const fileName of engineFiles) {
  stageFile(
    path.join(wasmBuildRoot, fileName),
    `engines/${contentVersion}/${fileName}`,
    fileName.startsWith("gnubg-wasm.")
      ? "engine-payload"
      : "engine-notice",
  );
}

const sourceNotice = [
  "BACKGAMMON ENGINE CAPSULE CORRESPONDING SOURCE",
  "",
  `Build ID: ${buildId}`,
  `Engine content version: ${contentVersion}`,
  `Source: ${sourceUrl}`,
  `GNUbg version: ${buildInfo.gnubgVersion}`,
  `GNUbg source archive SHA-256: ${buildInfo.archiveSha256}`,
  "",
  "The source location must provide the complete source for this exact build,",
  "including the authenticated GNUbg archive, patches, capsule adapter and",
  "Worker sources, build scripts, package lock, and toolchain lock.",
  "",
].join("\n");
const sourceNoticePath = path.join(publicRoot, "SOURCE.txt");
writeFileSync(sourceNoticePath, sourceNotice);
stagedFiles.push({
  path: "SOURCE.txt",
  role: "corresponding-source",
  size: statSync(sourceNoticePath).size,
  sha256: sha256File(sourceNoticePath),
});

stagedFiles.sort((left, right) => left.path.localeCompare(right.path));
mkdirSync(path.dirname(manifestFile), { recursive: true });
writeFileSync(
  manifestFile,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      mode,
      engine: "gnubg",
      gnubgVersion: buildInfo.gnubgVersion,
      abiVersion: buildInfo.abiVersion,
      contentVersion,
      publicBase,
      buildId,
      sourceUrl,
      licenseUrl,
      capsuleOrigin: new URL(capsuleOrigin).origin,
      files: stagedFiles,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Staged GNUbg browser assets at ${path.relative(repositoryRoot, enginePublicRoot)} (${contentVersion})`,
);
