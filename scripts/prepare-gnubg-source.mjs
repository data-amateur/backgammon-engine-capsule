import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const archivePath = path.join(repositoryRoot, sourceLock.archive.path);
const workRoot = path.join(repositoryRoot, "third_party/gnubg/work");
const sourceRoot = path.join(workRoot, `gnubg-${sourceLock.version}`);
const sourcePatches = [
  path.join(
    repositoryRoot,
    "third_party/gnubg/patches/0001-race-bearoff-without-two-sided-db.patch",
  ),
];

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

run(process.execPath, [path.join(repositoryRoot, "scripts/verify-gnubg-source.mjs")]);

// This is a generated, ignored directory with one exact and verified target.
// Removing it prevents an old hand-edited extraction from entering a build.
rmSync(workRoot, { recursive: true, force: true });
mkdirSync(workRoot, { recursive: true });
run("tar", ["-xzf", archivePath, "-C", workRoot]);

for (const requiredPath of [
  path.join(sourceRoot, "configure"),
  path.join(sourceRoot, "eval.c"),
  path.join(sourceRoot, "gnubg.weights"),
  path.join(sourceRoot, "met/Kazaross-XG2.xml"),
  ...sourcePatches,
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`GNUbg source input is missing ${requiredPath}`);
  }
}

const appliedPatches = sourcePatches.map((patchPath) => {
  run("patch", ["--batch", "--forward", "-p1", "--input", patchPath], sourceRoot);
  return {
    path: path.relative(repositoryRoot, patchPath),
    sha256: createHash("sha256").update(readFileSync(patchPath)).digest("hex"),
  };
});

writeFileSync(
  path.join(workRoot, "prepared-source.json"),
  `${JSON.stringify(
    {
      version: sourceLock.version,
      archiveSha256: sourceLock.archive.sha256,
      sourceDirectory: path.relative(repositoryRoot, sourceRoot),
      patches: appliedPatches,
    },
    null,
    2,
  )}\n`,
);

console.log(`Prepared authenticated GNUbg source at ${sourceRoot}`);
