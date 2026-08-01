import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distRoot = path.join(repositoryRoot, "dist");

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

const exactFiles = new Set([
  "LICENSE.txt",
  "NOTICE.txt",
  "THIRD_PARTY_NOTICES.txt",
  "_headers",
  "index.html",
  "mock-engine.worker.js",
  "mock-engine.worker.js.map",
  "robots.txt",
]);
const assetPattern = /^assets\/index-[A-Za-z0-9_-]+\.(?:css|js|js\.map)$/u;
const files = (await collectFiles(distRoot)).sort();

for (const file of files) {
  if (!exactFiles.has(file) && !assetPattern.test(file)) {
    throw new Error(
      `Unexpected browser artifact ${file}; update the audited mock allowlist intentionally`,
    );
  }
}

for (const required of exactFiles) {
  if (!files.includes(required)) {
    throw new Error(`Required browser artifact is missing: ${required}`);
  }
}

for (const extension of [".css", ".js", ".js.map"]) {
  if (!files.some((file) => file.startsWith("assets/") && file.endsWith(extension))) {
    throw new Error(`Expected one or more hashed ${extension} assets in dist`);
  }
}

const forbiddenText = [
  /third_party\/gnubg/iu,
  /native\/gnubg/iu,
  /gnubg\.weights/iu,
  /gnubg-native/iu,
  /(?:^|[^\w])[^\s"']+\.wasm(?:[^\w]|$)/iu,
  /\bEvalInitialise\b/u,
  /\bScoreMove\b/u,
];

for (const file of files) {
  const bytes = await readFile(path.join(distRoot, file));
  const forbiddenBinary =
    (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d]))) ||
    (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) ||
    (bytes.length >= 2 && bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) ||
    (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) ||
    (bytes.length >= 6 && bytes.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]))) ||
    bytes.subarray(0, 8).toString("ascii") === "!<arch>\n";
  if (forbiddenBinary) {
    throw new Error(`Binary, archive, or WASM content is forbidden in mock dist: ${file}`);
  }

  if (file === "NOTICE.txt" || file === "THIRD_PARTY_NOTICES.txt") {
    continue;
  }
  const source = bytes.toString("utf8");
  for (const pattern of forbiddenText) {
    if (pattern.test(source)) {
      throw new Error(`GNUbg/native marker ${pattern} found in mock dist file ${file}`);
    }
  }
}

process.stdout.write(`Verified mock-only browser artifact: ${files.length} files\n`);
