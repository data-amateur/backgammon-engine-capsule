import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { GNU_TAR } from "./gnu-tar.mjs";

export const SOURCE_ARCHIVE_NAME =
  "backgammon-engine-capsule-source.tar.gz";
export const SOURCE_INFO_NAME = "source-bundle-info.json";
export const SOURCE_MANIFEST_NAME = "SOURCE-MANIFEST.json";
export const SOURCE_ARCHIVE_ROOT = "backgammon-engine-capsule-source";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputRoot = path.join(repositoryRoot, "build/source");
const archiveFile = path.join(outputRoot, SOURCE_ARCHIVE_NAME);
const infoFile = path.join(outputRoot, SOURCE_INFO_NAME);
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_TREE_BYTES = 256 * 1024 * 1024;
const MAX_SOURCE_FILES = 20_000;
const SAFE_SOURCE_PATH = /^[A-Za-z0-9._/-]+$/u;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    encoding: options.binary ? null : "utf8",
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

function isSafeSourcePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    SAFE_SOURCE_PATH.test(value) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every(
      (part) => part.length > 0 && part !== "." && part !== "..",
    )
  );
}

function listSourcePaths() {
  const output = run(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { binary: true },
  );
  const decoded = output.toString("utf8");
  if (decoded.includes("\uFFFD")) {
    throw new Error("Source paths must be valid UTF-8");
  }
  const candidates = decoded
    .split("\0")
    .filter(Boolean)
    .sort(comparePaths);
  if (candidates.length > MAX_SOURCE_FILES) {
    throw new Error(
      `Source tree contains more than ${MAX_SOURCE_FILES} files`,
    );
  }
  if (new Set(candidates).size !== candidates.length) {
    throw new Error("Source tree contains duplicate paths");
  }
  return candidates;
}

export function collectSourceSnapshot() {
  const files = [];
  let totalBytes = 0;

  for (const relativePath of listSourcePaths()) {
    if (!isSafeSourcePath(relativePath)) {
      throw new Error(`Unsafe source path: ${JSON.stringify(relativePath)}`);
    }
    const absolutePath = path.join(repositoryRoot, ...relativePath.split("/"));
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        // A tracked deletion is part of a dirty working-tree snapshot.
        continue;
      }
      throw error;
    }
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.nlink !== 1
    ) {
      throw new Error(
        `Corresponding source must contain only regular files: ${relativePath}`,
      );
    }
    if (stats.size > MAX_SOURCE_FILE_BYTES) {
      throw new Error(
        `Source file exceeds ${MAX_SOURCE_FILE_BYTES} bytes: ${relativePath}`,
      );
    }
    const bytes = readFileSync(absolutePath);
    if (bytes.includes(Buffer.from(repositoryRoot))) {
      throw new Error(
        `Source file exposes the local repository path: ${relativePath}`,
      );
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_SOURCE_TREE_BYTES) {
      throw new Error(
        `Source tree exceeds ${MAX_SOURCE_TREE_BYTES} bytes`,
      );
    }
    files.push({
      path: relativePath,
      bytes,
      size: bytes.length,
      sha256: sha256(bytes),
    });
  }

  const treeDigest = createHash("sha256");
  treeDigest.update("backgammon-engine-capsule-source-v1\0", "utf8");
  for (const file of files) {
    treeDigest.update(file.path, "utf8");
    treeDigest.update("\0", "utf8");
    treeDigest.update(String(file.size), "utf8");
    treeDigest.update("\0", "utf8");
    treeDigest.update(file.bytes);
    treeDigest.update("\0", "utf8");
  }

  const repositoryCommit = String(
    run("git", ["rev-parse", "HEAD"]),
  ).trim();
  if (!/^[0-9a-f]{40}$/u.test(repositoryCommit)) {
    throw new Error("Could not resolve an exact repository commit");
  }
  const status = run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
    { binary: true },
  );

  return {
    files,
    repositoryCommit,
    workingTreeClean: status.length === 0,
    sourceTreeSha256: treeDigest.digest("hex"),
    totalBytes,
  };
}

function createManifest(snapshot) {
  const sourceLockFile = path.join(
    repositoryRoot,
    "third_party/gnubg/source-lock.json",
  );
  const toolchainLockFile = path.join(
    repositoryRoot,
    "toolchains/emscripten-lock.json",
  );
  const sourceLock = JSON.parse(readFileSync(sourceLockFile, "utf8"));
  const toolchainLock = JSON.parse(readFileSync(toolchainLockFile, "utf8"));

  return {
    schemaVersion: 1,
    package: "backgammon-engine-capsule-corresponding-source",
    archiveRoot: SOURCE_ARCHIVE_ROOT,
    repositoryCommit: snapshot.repositoryCommit,
    workingTreeClean: snapshot.workingTreeClean,
    sourceTreeSha256: snapshot.sourceTreeSha256,
    fileCount: snapshot.files.length,
    totalBytes: snapshot.totalBytes,
    gnubg: {
      version: sourceLock.version,
      archivePath: sourceLock.archive.path,
      archiveSize: sourceLock.archive.bytes,
      archiveSha256: sourceLock.archive.sha256,
      signaturePath: sourceLock.signature.path,
      signatureSha256: sourceLock.signature.sha256,
      signingKeyPath: sourceLock.signingKey.path,
      signingKeySha256: sourceLock.signingKey.sha256,
      signerFingerprint: sourceLock.signingKey.fingerprint,
    },
    emscripten: {
      version: toolchainLock.emscriptenVersion,
      lockPath: "toolchains/emscripten-lock.json",
      lockSha256: sha256(readFileSync(toolchainLockFile)),
    },
    generatedFiles: {
      [SOURCE_MANIFEST_NAME]:
        "This manifest is generated from the listed source snapshot and is not included in files.",
    },
    files: snapshot.files.map(({ path: filePath, size, sha256: digest }) => ({
      path: filePath,
      size,
      sha256: digest,
    })),
  };
}

function writeSnapshot(root, snapshot, manifestBytes) {
  for (const file of snapshot.files) {
    const output = path.join(root, ...file.path.split("/"));
    mkdirSync(path.dirname(output), { recursive: true, mode: 0o755 });
    writeFileSync(output, file.bytes, { mode: 0o644 });
    chmodSync(output, 0o644);
  }
  const manifestPath = path.join(root, SOURCE_MANIFEST_NAME);
  writeFileSync(manifestPath, manifestBytes, { mode: 0o644 });
  chmodSync(manifestPath, 0o644);
}

export function buildSourceBundle(mode = "development") {
  const production = mode === "production";
  const snapshot = collectSourceSnapshot();
  if (production && !snapshot.workingTreeClean) {
    throw new Error(
      "Production corresponding-source bundles require a clean Git working tree",
    );
  }

  const manifest = createManifest(snapshot);
  const manifestBytes = Buffer.from(
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "backgammon-capsule-source-"),
  );

  try {
    const stagedRoot = path.join(temporaryRoot, SOURCE_ARCHIVE_ROOT);
    mkdirSync(stagedRoot, { recursive: true, mode: 0o755 });
    chmodSync(stagedRoot, 0o755);
    writeSnapshot(stagedRoot, snapshot, manifestBytes);

    const tarFile = path.join(temporaryRoot, "source.tar");
    run(GNU_TAR.executable, [
      "--create",
      "--format=posix",
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--mode=a-x,u=rwX,go=rX",
      "--pax-option=delete=atime,delete=ctime",
      "--file",
      tarFile,
      "--directory",
      temporaryRoot,
      SOURCE_ARCHIVE_ROOT,
    ]);
    const archiveBytes = gzipSync(readFileSync(tarFile), {
      level: 9,
      mtime: 0,
    });

    rmSync(outputRoot, { recursive: true, force: true });
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(archiveFile, archiveBytes);
    const info = {
      schemaVersion: 1,
      archive: SOURCE_ARCHIVE_NAME,
      archiveRoot: SOURCE_ARCHIVE_ROOT,
      archiveSize: archiveBytes.length,
      archiveSha256: sha256(archiveBytes),
      manifest: SOURCE_MANIFEST_NAME,
      manifestSha256: sha256(manifestBytes),
      repositoryCommit: snapshot.repositoryCommit,
      workingTreeClean: snapshot.workingTreeClean,
      sourceTreeSha256: snapshot.sourceTreeSha256,
      fileCount: snapshot.files.length,
      sourceBytes: snapshot.totalBytes,
      gnubgVersion: manifest.gnubg.version,
      gnubgArchiveSha256: manifest.gnubg.archiveSha256,
      emscriptenVersion: manifest.emscripten.version,
    };
    writeFileSync(infoFile, `${JSON.stringify(info, null, 2)}\n`);

    console.log(
      `Built corresponding source bundle at ${path.relative(
        repositoryRoot,
        archiveFile,
      )} (${archiveBytes.length} bytes, ${info.archiveSha256})`,
    );
    return { archiveFile, infoFile, info };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  buildSourceBundle(process.argv[2] ?? "development");
}
