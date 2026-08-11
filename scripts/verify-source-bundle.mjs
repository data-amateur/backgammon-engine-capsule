import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  collectSourceSnapshot,
  SOURCE_ARCHIVE_NAME,
  SOURCE_ARCHIVE_ROOT,
  SOURCE_INFO_NAME,
  SOURCE_MANIFEST_NAME,
} from "./build-source-bundle.mjs";
import { GNU_TAR } from "./gnu-tar.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultArchiveFile = path.join(
  repositoryRoot,
  "build/source",
  SOURCE_ARCHIVE_NAME,
);
const defaultInfoFile = path.join(
  repositoryRoot,
  "build/source",
  SOURCE_INFO_NAME,
);
const SAFE_ARCHIVE_ENTRY = /^[A-Za-z0-9._/-]+\/?$/u;
const MAX_SOURCE_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_TREE_BYTES = 256 * 1024 * 1024;
const MAX_SOURCE_FILES = 20_000;
const MAX_SOURCE_ENTRIES = MAX_SOURCE_FILES * 4 + 2;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status}: ${String(
        result.stderr || result.stdout,
      ).trim()}`,
    );
  }
  return result.stdout;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectExtractedFiles(root, relative = "") {
  const directory = path.join(root, ...relative.split("/").filter(Boolean));
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => comparePaths(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const relativePath = relative
      ? `${relative}/${entry.name}`
      : entry.name;
    const absolutePath = path.join(directory, entry.name);
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Corresponding-source archive contains a symbolic link: ${relativePath}`,
      );
    }
    if (stats.isDirectory()) {
      files.push(...collectExtractedFiles(root, relativePath));
    } else if (stats.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(
        `Corresponding-source archive contains an unsupported entry: ${relativePath}`,
      );
    }
  }
  return files;
}

function validateInfo(info, archiveBytes) {
  if (
    !isRecord(info) ||
    info.schemaVersion !== 1 ||
    info.archive !== SOURCE_ARCHIVE_NAME ||
    info.archiveRoot !== SOURCE_ARCHIVE_ROOT ||
    info.archiveSize !== archiveBytes.length ||
    info.archiveSize > MAX_SOURCE_ARCHIVE_BYTES ||
    info.archiveSha256 !== sha256(archiveBytes) ||
    info.manifest !== SOURCE_MANIFEST_NAME ||
    !/^[0-9a-f]{64}$/u.test(info.manifestSha256) ||
    !/^[0-9a-f]{40}$/u.test(info.repositoryCommit) ||
    typeof info.workingTreeClean !== "boolean" ||
    !/^[0-9a-f]{64}$/u.test(info.sourceTreeSha256) ||
    !Number.isSafeInteger(info.fileCount) ||
    info.fileCount <= 0 ||
    info.fileCount > MAX_SOURCE_FILES ||
    !Number.isSafeInteger(info.sourceBytes) ||
    info.sourceBytes <= 0 ||
    info.sourceBytes > MAX_SOURCE_TREE_BYTES ||
    info.gnubgVersion !== "1.08.003" ||
    !/^[0-9a-f]{64}$/u.test(info.gnubgArchiveSha256) ||
    typeof info.emscriptenVersion !== "string"
  ) {
    throw new Error("Source bundle information has an invalid shape");
  }
}

function validateManifest(
  manifest,
  manifestBytes,
  info,
  extractedRoot,
  archiveEntries,
) {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.package !==
      "backgammon-engine-capsule-corresponding-source" ||
    manifest.archiveRoot !== SOURCE_ARCHIVE_ROOT ||
    manifest.repositoryCommit !== info.repositoryCommit ||
    manifest.workingTreeClean !== info.workingTreeClean ||
    manifest.sourceTreeSha256 !== info.sourceTreeSha256 ||
    manifest.fileCount !== info.fileCount ||
    manifest.totalBytes !== info.sourceBytes ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== info.fileCount ||
    manifest.gnubg?.version !== info.gnubgVersion ||
    manifest.gnubg?.archiveSha256 !== info.gnubgArchiveSha256 ||
    manifest.emscripten?.version !== info.emscriptenVersion ||
    info.manifestSha256 !== sha256(manifestBytes)
  ) {
    throw new Error("Embedded source manifest does not match bundle information");
  }

  const manifestPaths = new Set();
  const sourceTreeDigest = createHash("sha256");
  sourceTreeDigest.update(
    "backgammon-engine-capsule-source-v1\0",
    "utf8",
  );
  let actualSourceBytes = 0;
  let previousPath = null;
  for (const record of manifest.files) {
    if (
      !isRecord(record) ||
      typeof record.path !== "string" ||
      !SAFE_ARCHIVE_ENTRY.test(record.path) ||
      record.path.startsWith("/") ||
      record.path.includes("\\") ||
      record.path.split("/").some(
        (part) => !part || part === "." || part === "..",
      ) ||
      !Number.isSafeInteger(record.size) ||
      record.size < 0 ||
      record.size > MAX_SOURCE_FILE_BYTES ||
      !/^[0-9a-f]{64}$/u.test(record.sha256) ||
      manifestPaths.has(record.path) ||
      (previousPath !== null && comparePaths(previousPath, record.path) >= 0)
    ) {
      throw new Error("Embedded source manifest contains an invalid file record");
    }
    previousPath = record.path;
    manifestPaths.add(record.path);
    const file = path.join(extractedRoot, ...record.path.split("/"));
    const bytes = readFileSync(file);
    if (bytes.length !== record.size || sha256(bytes) !== record.sha256) {
      throw new Error(
        `Extracted source differs from its manifest: ${record.path}`,
      );
    }
    actualSourceBytes += bytes.length;
    if (actualSourceBytes > MAX_SOURCE_TREE_BYTES) {
      throw new Error("Extracted source exceeds the source-tree byte limit");
    }
    sourceTreeDigest.update(record.path, "utf8");
    sourceTreeDigest.update("\0", "utf8");
    sourceTreeDigest.update(String(bytes.length), "utf8");
    sourceTreeDigest.update("\0", "utf8");
    sourceTreeDigest.update(bytes);
    sourceTreeDigest.update("\0", "utf8");
  }
  if (
    actualSourceBytes !== manifest.totalBytes ||
    actualSourceBytes !== info.sourceBytes ||
    sourceTreeDigest.digest("hex") !== manifest.sourceTreeSha256 ||
    manifest.sourceTreeSha256 !== info.sourceTreeSha256
  ) {
    throw new Error(
      "Embedded source manifest has invalid source-tree accounting",
    );
  }

  const actualFiles = collectExtractedFiles(extractedRoot).sort(comparePaths);
  const expectedFiles = [
    ...manifestPaths,
    SOURCE_MANIFEST_NAME,
  ].sort(comparePaths);
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    throw new Error("Corresponding-source archive has missing or extra files");
  }

  const expectedArchiveEntries = new Map([
    [SOURCE_ARCHIVE_ROOT, "directory"],
  ]);
  for (const filePath of [...manifestPaths, SOURCE_MANIFEST_NAME]) {
    const components = filePath.split("/");
    for (let index = 1; index < components.length; index += 1) {
      expectedArchiveEntries.set(
        `${SOURCE_ARCHIVE_ROOT}/${components.slice(0, index).join("/")}`,
        "directory",
      );
    }
    expectedArchiveEntries.set(
      `${SOURCE_ARCHIVE_ROOT}/${filePath}`,
      "file",
    );
  }
  if (
    archiveEntries.size !== expectedArchiveEntries.size ||
    [...expectedArchiveEntries].some(
      ([entry, type]) => archiveEntries.get(entry) !== type,
    )
  ) {
    throw new Error(
      "Corresponding-source archive has extra or missing directory entries",
    );
  }

  const upstreamRecord = manifest.files.find(
    ({ path: filePath }) => filePath === manifest.gnubg.archivePath,
  );
  if (
    !upstreamRecord ||
    upstreamRecord.size !== manifest.gnubg.archiveSize ||
    upstreamRecord.sha256 !== manifest.gnubg.archiveSha256
  ) {
    throw new Error("Authenticated GNUbg archive is missing from source bundle");
  }
  const signatureRecord = manifest.files.find(
    ({ path: filePath }) => filePath === manifest.gnubg.signaturePath,
  );
  const signingKeyRecord = manifest.files.find(
    ({ path: filePath }) => filePath === manifest.gnubg.signingKeyPath,
  );
  const toolchainLockRecord = manifest.files.find(
    ({ path: filePath }) => filePath === manifest.emscripten.lockPath,
  );
  if (
    !signatureRecord ||
    signatureRecord.sha256 !== manifest.gnubg.signatureSha256 ||
    !signingKeyRecord ||
    signingKeyRecord.sha256 !== manifest.gnubg.signingKeySha256 ||
    !toolchainLockRecord ||
    toolchainLockRecord.sha256 !== manifest.emscripten.lockSha256
  ) {
    throw new Error(
      "Source authentication or toolchain lock is missing from the bundle",
    );
  }
}

function assertMatchesWorkingTree(manifest, info) {
  const snapshot = collectSourceSnapshot();
  if (
    snapshot.repositoryCommit !== info.repositoryCommit ||
    snapshot.workingTreeClean !== info.workingTreeClean ||
    snapshot.sourceTreeSha256 !== info.sourceTreeSha256 ||
    snapshot.files.length !== info.fileCount ||
    snapshot.totalBytes !== info.sourceBytes
  ) {
    throw new Error(
      "Corresponding-source bundle does not match the current source tree",
    );
  }
  for (let index = 0; index < snapshot.files.length; index += 1) {
    const current = snapshot.files[index];
    const archived = manifest.files[index];
    if (
      current.path !== archived.path ||
      current.size !== archived.size ||
      current.sha256 !== archived.sha256
    ) {
      throw new Error(
        `Corresponding-source snapshot mismatch: ${current.path}`,
      );
    }
  }
}

export function verifySourceBundle({
  archiveFile = defaultArchiveFile,
  infoFile = defaultInfoFile,
  compareWorkingTree = true,
  requireClean = false,
} = {}) {
  const archiveBytes = readFileSync(archiveFile);
  if (
    archiveBytes.length < 2 ||
    archiveBytes.length > MAX_SOURCE_ARCHIVE_BYTES ||
    archiveBytes[0] !== 0x1f ||
    archiveBytes[1] !== 0x8b
  ) {
    throw new Error("Corresponding-source archive is not gzip data");
  }
  const info = JSON.parse(readFileSync(infoFile, "utf8"));
  validateInfo(info, archiveBytes);
  if (requireClean && !info.workingTreeClean) {
    throw new Error("Production source bundle must describe a clean tree");
  }

  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "backgammon-capsule-source-verify-"),
  );
  try {
    // All structural checks and extraction use the exact bytes whose digest
    // was validated above, even if the caller replaces archiveFile meanwhile.
    const stableArchiveFile = path.join(temporaryRoot, SOURCE_ARCHIVE_NAME);
    writeFileSync(stableArchiveFile, archiveBytes, { mode: 0o600 });
    const listedEntries = run(GNU_TAR.executable, [
      "--list",
      "--gzip",
      "--file",
      stableArchiveFile,
    ])
      .split("\n")
      .filter(Boolean);
    if (listedEntries.length === 0) {
      throw new Error("Corresponding-source archive is empty");
    }
    if (listedEntries.length > MAX_SOURCE_ENTRIES) {
      throw new Error("Corresponding-source archive has too many entries");
    }
    const logicalEntries = new Set();
    for (const entry of listedEntries) {
      const canonicalEntry = entry.endsWith("/")
        ? entry.slice(0, -1)
        : entry;
      const components = canonicalEntry.split("/");
      if (
        !SAFE_ARCHIVE_ENTRY.test(entry) ||
        canonicalEntry.length === 0 ||
        (canonicalEntry !== SOURCE_ARCHIVE_ROOT &&
          !canonicalEntry.startsWith(`${SOURCE_ARCHIVE_ROOT}/`)) ||
        components.some(
          (part) => part.length === 0 || part === "." || part === "..",
        ) ||
        logicalEntries.has(canonicalEntry)
      ) {
        throw new Error(
          `Unsafe or duplicate corresponding-source archive entry: ${entry}`,
        );
      }
      logicalEntries.add(canonicalEntry);
    }
    const verboseEntries = run(GNU_TAR.executable, [
      "--list",
      "--verbose",
      "--gzip",
      "--file",
      stableArchiveFile,
    ])
      .split("\n")
      .filter(Boolean);
    let listedSourceBytes = 0;
    const archiveEntries = new Map();
    const verboseInvalid =
      verboseEntries.length !== listedEntries.length ||
      verboseEntries.some((entry, index) => {
        const match = entry.match(
          /^([d-][rwx-]{9})\s+\d+\/\d+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/u,
        );
        if (!match || match[3] !== listedEntries[index]) {
          return true;
        }
        const size = Number(match[2]);
        if (
          !Number.isSafeInteger(size) ||
          size < 0 ||
          size > MAX_SOURCE_FILE_BYTES
        ) {
          return true;
        }
        if (match[1][0] === "-") {
          listedSourceBytes += size;
          archiveEntries.set(
            listedEntries[index].replace(/\/$/u, ""),
            "file",
          );
          return (
            match[1] !== "-rw-r--r--" ||
            listedEntries[index].endsWith("/")
          );
        }
        archiveEntries.set(
          listedEntries[index].replace(/\/$/u, ""),
          "directory",
        );
        return (
          match[1] !== "drwxr-xr-x" ||
          size !== 0 ||
          !listedEntries[index].endsWith("/")
        );
      });
    if (
      verboseInvalid ||
      listedSourceBytes > MAX_SOURCE_TREE_BYTES + 4 * 1024 * 1024
    ) {
      throw new Error(
        "Corresponding-source archive contains invalid entries or modes",
      );
    }

    run(GNU_TAR.executable, [
      "--extract",
      "--gzip",
      "--file",
      stableArchiveFile,
      "--directory",
      temporaryRoot,
      "--no-same-owner",
      "--no-same-permissions",
    ]);
    const extractedRoot = path.join(temporaryRoot, SOURCE_ARCHIVE_ROOT);
    if (!statSync(extractedRoot).isDirectory()) {
      throw new Error("Corresponding-source archive root is missing");
    }
    const manifestFile = path.join(extractedRoot, SOURCE_MANIFEST_NAME);
    const manifestBytes = readFileSync(manifestFile);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    validateManifest(
      manifest,
      manifestBytes,
      info,
      extractedRoot,
      archiveEntries,
    );
    if (compareWorkingTree) {
      assertMatchesWorkingTree(manifest, info);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log(
    `Verified corresponding source bundle: ${info.fileCount} files, ${info.archiveSha256}`,
  );
  return info;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  verifySourceBundle({
    requireClean: process.argv.includes("--require-clean"),
  });
}
