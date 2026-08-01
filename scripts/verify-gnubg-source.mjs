import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const lockPath = path.join(
  repositoryRoot,
  "third_party/gnubg/source-lock.json",
);
const sourceLock = JSON.parse(readFileSync(lockPath, "utf8"));

function resolveRepositoryPath(relativePath) {
  const resolvedPath = path.resolve(repositoryRoot, relativePath);
  const repositoryPrefix = `${repositoryRoot}${path.sep}`;
  if (!resolvedPath.startsWith(repositoryPrefix)) {
    throw new Error(`Path escapes the repository: ${relativePath}`);
  }
  return resolvedPath;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function verifyPinnedFile(label, metadata) {
  const filePath = resolveRepositoryPath(metadata.path);
  const actualBytes = statSync(filePath).size;
  if (actualBytes !== metadata.bytes) {
    throw new Error(
      `${label} size mismatch: expected ${metadata.bytes}, received ${actualBytes}`,
    );
  }

  const actualHash = await sha256(filePath);
  if (actualHash !== metadata.sha256) {
    throw new Error(
      `${label} SHA-256 mismatch: expected ${metadata.sha256}, received ${actualHash}`,
    );
  }
  return filePath;
}

const archivePath = await verifyPinnedFile("GNUbg archive", sourceLock.archive);
const signaturePath = await verifyPinnedFile(
  "GNUbg detached signature",
  sourceLock.signature,
);
const signingKeyPath = await verifyPinnedFile(
  "GNUbg signing key",
  sourceLock.signingKey,
);
await verifyPinnedFile("GNUbg GPL text", sourceLock.license);

const verification = spawnSync(
  "gpgv",
  [
    "--keyring",
    signingKeyPath,
    "--status-fd",
    "1",
    signaturePath,
    archivePath,
  ],
  { encoding: "utf8" },
);

if (verification.error?.code === "ENOENT") {
  throw new Error(
    "gpgv is required to verify the pinned GNUbg release signature",
  );
}
if (verification.error) {
  throw verification.error;
}
if (verification.status !== 0) {
  throw new Error(
    `GNUbg signature verification failed:\n${verification.stderr.trim()}`,
  );
}

const validSignature = verification.stdout
  .split(/\r?\n/u)
  .find((line) => line.startsWith("[GNUPG:] VALIDSIG "));
const verifiedFingerprint = validSignature?.split(/\s+/u)[2];
if (verifiedFingerprint !== sourceLock.signingKey.fingerprint) {
  throw new Error(
    `GNUbg signature used unexpected key ${verifiedFingerprint ?? "unknown"}`,
  );
}

console.log(
  `Verified GNUbg ${sourceLock.version}: ${sourceLock.archive.sha256}, signed by ${verifiedFingerprint}`,
);
