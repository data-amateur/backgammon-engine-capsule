import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestPath = path.join(
  repositoryRoot,
  "build/browser-assets-manifest.json",
);
if (!existsSync(manifestPath)) {
  throw new Error("Browser asset manifest is missing");
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (
  manifest.schemaVersion !== 1 ||
  manifest.engine !== "gnubg" ||
  !Array.isArray(manifest.files)
) {
  throw new Error("Browser asset manifest has an unexpected shape");
}

const workerRecord = manifest.files.find(
  ({ role }) => role === "engine-worker",
);
const sourceMapRecord = manifest.files.find(
  ({ role }) => role === "engine-worker-map",
);
if (
  !workerRecord ||
  workerRecord.path !== "gnubg-engine.worker.js" ||
  !sourceMapRecord ||
  sourceMapRecord.path !== "gnubg-engine.worker.js.map"
) {
  throw new Error("Browser asset manifest does not contain the root GNUbg Worker");
}

function verifyRecord(record) {
  const file = path.join(repositoryRoot, "build/browser-public", record.path);
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
    throw new Error(`Worker artifact is missing: ${record.path}`);
  }
  const bytes = readFileSync(file);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== record.size || hash !== record.sha256) {
    throw new Error(`Worker artifact does not match its manifest: ${record.path}`);
  }
  return bytes;
}

const source = verifyRecord(workerRecord).toString("utf8");
verifyRecord(sourceMapRecord);

if (!source.startsWith("/* SPDX-License-Identifier: GPL-3.0-or-later */")) {
  throw new Error("GNUbg Worker is missing its GPL SPDX banner");
}
if (/SPDX-License-Identifier:\s*Apache-2\.0/u.test(source)) {
  throw new Error("GNUbg Worker must not carry the mock Apache-only banner");
}
if (/^\s*(?:import|export)\s/mu.test(source)) {
  throw new Error("GNUbg Worker must remain a self-contained classic bundle");
}
if (/\bimport\.meta\b/u.test(source)) {
  throw new Error("GNUbg Worker contains an unresolved import.meta reference");
}
const dynamicImports = source.match(/\bimport\s*\(/gu) ?? [];
if (dynamicImports.length !== 1) {
  throw new Error(
    `GNUbg Worker must contain exactly one external module import; found ${dynamicImports.length}`,
  );
}
if (/mock-engine|mock Worker|0\.1\.0-mock/iu.test(source)) {
  throw new Error("GNUbg Worker contains stale mock-engine code");
}
if (/\beval\s*\(|\bnew\s+Function\s*\(/u.test(source)) {
  throw new Error("GNUbg Worker contains string-evaluation code");
}

console.log(
  `Verified GPL GNUbg Worker: ${workerRecord.path} (${workerRecord.size} bytes)`,
);
