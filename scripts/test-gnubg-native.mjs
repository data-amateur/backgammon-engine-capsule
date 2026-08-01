import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

run(process.execPath, [path.join(repositoryRoot, "scripts/build-gnubg-native.mjs")]);
run(
  path.join(repositoryRoot, "build/gnubg/native/gnubg-native-golden"),
  [
    path.join(
      repositoryRoot,
      "third_party/gnubg/work",
      `gnubg-${sourceLock.version}`,
    ),
  ],
  {
    env: { ...process.env, G_DEBUG: "fatal-criticals" },
  },
);
