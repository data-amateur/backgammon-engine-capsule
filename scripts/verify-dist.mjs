import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifySourceBundle } from "./verify-source-bundle.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distRoot = path.join(repositoryRoot, "dist");
const manifestPath = path.join(
  repositoryRoot,
  "build/browser-assets-manifest.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safePublicPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every(
      (part) => part && part !== "." && part !== "..",
    )
  );
}

async function collectFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = prefix
      ? `${prefix}/${entry.name}`
      : entry.name;
    const absolutePath = path.join(directory, entry.name);
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink()) {
      throw new Error(`dist must not contain symbolic links: ${relativePath}`);
    }
    if (stats.isDirectory()) {
      files.push(...await collectFiles(absolutePath, relativePath));
    } else if (stats.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`dist contains an unsupported entry: ${relativePath}`);
    }
  }

  return files;
}

if (
  manifest.schemaVersion !== 2 ||
  manifest.engine !== "gnubg" ||
  manifest.gnubgVersion !== "1.08.003" ||
  manifest.abiVersion !== "1.0" ||
  !/^sha256-[0-9a-f]{64}$/u.test(manifest.contentVersion) ||
  manifest.publicBase !== `/engines/${manifest.contentVersion}/` ||
  !/^\/sources\/sha256-[0-9a-f]{64}\/$/u.test(
    manifest.sourceBundle?.publicBase,
  ) ||
  manifest.sourceBundle?.url !== manifest.sourceUrl ||
  manifest.sourceBundle?.path !==
    `${manifest.sourceBundle.publicBase.slice(1)}backgammon-engine-capsule-source.tar.gz` ||
  manifest.sourceBundle?.sha256 !==
    manifest.sourceBundle.publicBase.slice(
      "/sources/sha256-".length,
      -1,
    ) ||
  !Number.isSafeInteger(manifest.sourceBundle?.size) ||
  manifest.sourceBundle.size <= 0 ||
  !/^[0-9a-f]{64}$/u.test(manifest.sourceBundle?.manifestSha256) ||
  !/^[0-9a-f]{40}$/u.test(manifest.sourceBundle?.repositoryCommit) ||
  typeof manifest.sourceBundle?.workingTreeClean !== "boolean" ||
  !/^[0-9a-f]{64}$/u.test(manifest.sourceBundle?.sourceTreeSha256) ||
  !Number.isSafeInteger(manifest.sourceBundle?.fileCount) ||
  manifest.sourceBundle.fileCount <= 0 ||
  !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(manifest.buildId) ||
  !Array.isArray(manifest.files)
) {
  throw new Error("Browser asset manifest has an unexpected identity or shape");
}
for (const variableName of ["sourceUrl", "licenseUrl"]) {
  const url = new URL(manifest[variableName]);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(manifest.mode !== "production" && url.protocol === "http:" && loopback))
  ) {
    throw new Error(`Manifest ${variableName} is not an approved public URL`);
  }
}
const sourceUrl = new URL(manifest.sourceUrl);
if (
  sourceUrl.origin !== manifest.capsuleOrigin ||
  sourceUrl.pathname !== `/${manifest.sourceBundle.path}` ||
  sourceUrl.search ||
  sourceUrl.hash
) {
  throw new Error(
    "Manifest source URL does not identify the exact same-origin archive",
  );
}

const manifestPaths = new Set();
for (const record of manifest.files) {
  if (
    !safePublicPath(record.path) ||
    typeof record.role !== "string" ||
    !Number.isSafeInteger(record.size) ||
    record.size <= 0 ||
    !/^[0-9a-f]{64}$/u.test(record.sha256) ||
    manifestPaths.has(record.path)
  ) {
    throw new Error("Browser asset manifest contains an invalid file record");
  }
  manifestPaths.add(record.path);
}

const enginePrefix = manifest.publicBase.slice(1);
const sourceArchivePath = manifest.sourceBundle.path;
const requiredEngineFiles = [
  "gnubg-wasm.mjs",
  "gnubg-wasm.wasm",
  "gnubg-wasm.data",
  "build-info.json",
  "EMSCRIPTEN-LICENSE.txt",
  "MUSL-COPYRIGHT.txt",
];
for (const fileName of requiredEngineFiles) {
  if (!manifestPaths.has(`${enginePrefix}${fileName}`)) {
    throw new Error(`Required engine artifact is missing from manifest: ${fileName}`);
  }
}
const sourceArchiveRecord = manifest.files.find(
  ({ role }) => role === "corresponding-source-archive",
);
if (
  !sourceArchiveRecord ||
  sourceArchiveRecord.path !== sourceArchivePath ||
  sourceArchiveRecord.size !== manifest.sourceBundle.size ||
  sourceArchiveRecord.sha256 !== manifest.sourceBundle.sha256
) {
  throw new Error(
    "Required corresponding-source archive is missing from manifest",
  );
}
for (const fileName of [
  "gnubg-engine.worker.js",
  "gnubg-engine.worker.js.map",
  "LICENSE.txt",
  "LICENSES/GPL-3.0-or-later.txt",
  "NOTICE.txt",
  "THIRD_PARTY_NOTICES.txt",
  "SOURCE.txt",
  "robots.txt",
]) {
  if (!manifestPaths.has(fileName)) {
    throw new Error(`Required distribution file is missing from manifest: ${fileName}`);
  }
}

const files = (await collectFiles(distRoot)).sort();
const assetPattern = /^assets\/index-[A-Za-z0-9_-]+\.(?:css|js|js\.map)$/u;
const generatedFiles = new Set(["_headers", "index.html"]);
for (const file of files) {
  if (
    !manifestPaths.has(file) &&
    !generatedFiles.has(file) &&
    !assetPattern.test(file)
  ) {
    throw new Error(`Unexpected browser artifact: ${file}`);
  }
}
for (const required of [...manifestPaths, ...generatedFiles]) {
  if (!files.includes(required)) {
    throw new Error(`Required browser artifact is missing: ${required}`);
  }
}
for (const extension of [".css", ".js", ".js.map"]) {
  if (
    !files.some(
      (file) => file.startsWith("assets/") && file.endsWith(extension),
    )
  ) {
    throw new Error(`Expected one or more hashed ${extension} assets in dist`);
  }
}

for (const record of manifest.files) {
  const bytes = await readFile(path.join(distRoot, record.path));
  if (bytes.length !== record.size || sha256(bytes) !== record.sha256) {
    throw new Error(
      `Distributed file differs from the staged manifest: ${record.path}`,
    );
  }
}

const payloadNames = [
  "gnubg-wasm.mjs",
  "gnubg-wasm.wasm",
  "gnubg-wasm.data",
];
const payloadBytes = new Map();
for (const fileName of payloadNames) {
  payloadBytes.set(
    fileName,
    await readFile(path.join(distRoot, enginePrefix, fileName)),
  );
}
const contentDigest = createHash("sha256");
for (const fileName of [
  ...payloadNames,
  "build-info.json",
  "EMSCRIPTEN-LICENSE.txt",
  "MUSL-COPYRIGHT.txt",
]) {
  contentDigest.update(fileName, "utf8");
  contentDigest.update("\0", "utf8");
  contentDigest.update(
    await readFile(path.join(distRoot, enginePrefix, fileName)),
  );
  contentDigest.update("\0", "utf8");
}
const calculatedVersion = `sha256-${contentDigest.digest("hex")}`;
if (calculatedVersion !== manifest.contentVersion) {
  throw new Error("Engine content version does not match its payload");
}

const buildInfo = JSON.parse(
  await readFile(path.join(distRoot, enginePrefix, "build-info.json"), "utf8"),
);
if (
  buildInfo.abiVersion !== manifest.abiVersion ||
  buildInfo.gnubgVersion !== manifest.gnubgVersion ||
  !Array.isArray(buildInfo.artifacts) ||
  !Array.isArray(buildInfo.runtimeNotices)
) {
  throw new Error("Distributed GNUbg build information is invalid");
}
if (
  buildInfo.correspondingSource?.archiveSize !==
    manifest.sourceBundle.size ||
  buildInfo.correspondingSource?.archiveSha256 !==
    manifest.sourceBundle.sha256 ||
  buildInfo.correspondingSource?.manifestSha256 !==
    manifest.sourceBundle.manifestSha256 ||
  buildInfo.correspondingSource?.repositoryCommit !==
    manifest.sourceBundle.repositoryCommit ||
  buildInfo.correspondingSource?.workingTreeClean !==
    manifest.sourceBundle.workingTreeClean ||
  buildInfo.correspondingSource?.sourceTreeSha256 !==
    manifest.sourceBundle.sourceTreeSha256 ||
  buildInfo.correspondingSource?.fileCount !==
    manifest.sourceBundle.fileCount
) {
  throw new Error(
    "Distributed GNUbg build is not bound to its corresponding source",
  );
}
for (const fileName of payloadNames) {
  const bytes = payloadBytes.get(fileName);
  const record = buildInfo.artifacts.find(
    ({ file }) => path.basename(file) === fileName,
  );
  if (
    !record ||
    record.size !== bytes.length ||
    record.sha256 !== sha256(bytes)
  ) {
    throw new Error(`${fileName} does not match distributed build-info.json`);
  }
}
for (const fileName of [
  "EMSCRIPTEN-LICENSE.txt",
  "MUSL-COPYRIGHT.txt",
]) {
  const bytes = await readFile(path.join(distRoot, enginePrefix, fileName));
  const record = buildInfo.runtimeNotices.find(
    ({ file }) => path.basename(file) === fileName,
  );
  if (
    !record ||
    record.size !== bytes.length ||
    record.sha256 !== sha256(bytes)
  ) {
    throw new Error(`${fileName} does not match distributed build-info.json`);
  }
}

const exactLicenseCopies = [
  ["LICENSE", "LICENSE.txt"],
  ["LICENSES/GPL-3.0-or-later.txt", "LICENSES/GPL-3.0-or-later.txt"],
];
for (const [sourcePath, publicPath] of exactLicenseCopies) {
  const source = await readFile(path.join(repositoryRoot, sourcePath));
  const distributed = await readFile(path.join(distRoot, publicPath));
  if (!source.equals(distributed)) {
    throw new Error(`${publicPath} is not an exact license copy`);
  }
}

const wasmPath = `${enginePrefix}gnubg-wasm.wasm`;
const archiveSignatures = [
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from([0x1f, 0x8b]),
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]),
  Buffer.from("!<arch>\n", "ascii"),
];
for (const file of files) {
  const bytes = await readFile(path.join(distRoot, file));
  const isWasm =
    bytes.length >= 4 &&
    bytes.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d]));
  if (isWasm !== (file === wasmPath)) {
    throw new Error(`Unexpected or invalid WebAssembly file: ${file}`);
  }
  if (
    file !== sourceArchivePath &&
    archiveSignatures.some((signature) =>
      bytes.subarray(0, signature.length).equals(signature))
  ) {
    throw new Error(`Archive or native binary is forbidden in browser dist: ${file}`);
  }
  for (const privatePath of [
    repositoryRoot,
    process.env.EMSDK,
    process.env.EMCC &&
      path.isAbsolute(process.env.EMCC)
      ? path.dirname(process.env.EMCC)
      : undefined,
  ].filter(Boolean)) {
    if (bytes.includes(Buffer.from(privatePath))) {
      throw new Error(`Browser artifact exposes a private build path: ${file}`);
    }
  }

  if (/\.(?:css|html|js|json|map|mjs|txt)$/u.test(file) || file === "_headers") {
    const source = bytes.toString("utf8");
    if (
      /(?:^|[^:])\/home\/(?!web_user(?:\/|["'\s]|$))[^\s"']+/mu.test(source) ||
      /(?:^|[^:])\/Users\/[^\s"']+/mu.test(source) ||
      /[A-Za-z]:\\Users\\[^\s"']+/u.test(source)
    ) {
      throw new Error(`Browser artifact contains an absolute user path: ${file}`);
    }
    if (/mock-engine\.worker|0\.1\.0-mock|GPL-free deterministic mock/iu.test(source)) {
      throw new Error(`Browser artifact contains stale mock runtime text: ${file}`);
    }
  }
}

verifySourceBundle({
  archiveFile: path.join(distRoot, sourceArchivePath),
  infoFile: path.join(
    repositoryRoot,
    "build/source/source-bundle-info.json",
  ),
  requireClean: manifest.mode === "production",
});

const moduleSource = payloadBytes.get("gnubg-wasm.mjs").toString("utf8");
if (!/Copyright [0-9]+ The Emscripten Authors/u.test(moduleSource)) {
  throw new Error("GNUbg module is missing the Emscripten license banner");
}
const workerSource = (
  await readFile(path.join(distRoot, "gnubg-engine.worker.js"))
).toString("utf8");
if (
  !workerSource.startsWith(
    "/* SPDX-License-Identifier: GPL-3.0-or-later */",
  ) ||
  /SPDX-License-Identifier:\s*Apache-2\.0/u.test(workerSource)
) {
  throw new Error("Distributed GNUbg Worker has an invalid license banner");
}
for (const metadata of [
  manifest.buildId,
  manifest.sourceUrl,
  manifest.licenseUrl,
]) {
  if (!workerSource.includes(metadata)) {
    throw new Error("Distributed GNUbg Worker is missing release metadata");
  }
}

const notice = await readFile(path.join(distRoot, "NOTICE.txt"), "utf8");
const thirdParty = await readFile(
  path.join(distRoot, "THIRD_PARTY_NOTICES.txt"),
  "utf8",
);
const sourceNotice = await readFile(path.join(distRoot, "SOURCE.txt"), "utf8");
if (
  !/GNU Backgammon/u.test(notice) ||
  !/GPL-3\.0-or-later/u.test(notice) ||
  !/GNU Backgammon 1\.08\.003/u.test(thirdParty) ||
  !/Emscripten 6\.0\.5/u.test(thirdParty) ||
  !/musl/u.test(thirdParty) ||
  !sourceNotice.includes(manifest.sourceUrl) ||
  !sourceNotice.includes(manifest.sourceBundle.sha256) ||
  !sourceNotice.includes(manifest.sourceBundle.repositoryCommit) ||
  !sourceNotice.includes(manifest.sourceBundle.sourceTreeSha256) ||
  !sourceNotice.includes(manifest.sourceBundle.manifestSha256) ||
  !sourceNotice.includes(String(manifest.sourceBundle.fileCount)) ||
  !sourceNotice.includes(manifest.buildId) ||
  !sourceNotice.includes(manifest.contentVersion)
) {
  throw new Error("Distribution notices do not describe the real GNUbg build");
}

const headers = await readFile(path.join(distRoot, "_headers"), "utf8");
if (
  !headers.includes(manifest.publicBase + "*") ||
  !headers.includes(manifest.sourceBundle.publicBase + "*") ||
  !headers.includes(`/${manifest.sourceBundle.path}`) ||
  !headers.includes("Cache-Control: public, max-age=31536000, immutable") ||
  !headers.includes("Content-Type: application/gzip") ||
  !headers.includes("Content-Encoding: identity") ||
  !headers.includes(
    "Content-Disposition: attachment; filename=backgammon-engine-capsule-source.tar.gz",
  ) ||
  !headers.includes("Access-Control-Allow-Origin: *") ||
  !headers.includes("Cross-Origin-Resource-Policy: cross-origin") ||
  !headers.includes("'wasm-unsafe-eval'") ||
  headers.includes(" 'unsafe-eval'")
) {
  throw new Error(
    "Static-host headers do not cover immutable GNUbg assets with the narrow WASM CSP",
  );
}

console.log(
  `Verified real GNUbg browser artifact: ${files.length} files, ${manifest.contentVersion}`,
);
