import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadEnv } from "vite";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const mode = process.argv[2] ?? "development";
const env = { ...loadEnv(mode, repositoryRoot, "VITE_"), ...process.env };
const manifestPath = path.join(
  repositoryRoot,
  "build/browser-assets-manifest.json",
);

if (!existsSync(manifestPath)) {
  throw new Error(
    "Browser asset manifest is missing; build GNUbg and stage its browser assets first",
  );
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (
  manifest.schemaVersion !== 1 ||
  manifest.mode !== mode ||
  manifest.engine !== "gnubg" ||
  !/^\/engines\/sha256-[0-9a-f]{64}\/$/u.test(manifest.publicBase) ||
  !Array.isArray(manifest.files)
) {
  throw new Error("Browser asset manifest has an unexpected shape or mode");
}

const capsuleOrigin =
  env.VITE_CAPSULE_PUBLIC_ORIGIN?.trim() || manifest.capsuleOrigin;
if (new URL(capsuleOrigin).origin !== manifest.capsuleOrigin) {
  throw new Error(
    "VITE_CAPSULE_PUBLIC_ORIGIN does not match the staged browser manifest",
  );
}

const outputDirectory = path.join(
  repositoryRoot,
  "build/browser-public",
);
const workerPath = path.join(outputDirectory, "gnubg-engine.worker.js");
const sourceMapPath = `${workerPath}.map`;

await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["src/worker/gnubg.worker.ts"],
  outfile: workerPath,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  legalComments: "inline",
  define: {
    "import.meta.env.VITE_GNUBG_ASSET_BASE": JSON.stringify(
      manifest.publicBase,
    ),
    "import.meta.env.VITE_CAPSULE_PUBLIC_ORIGIN": JSON.stringify(
      manifest.capsuleOrigin,
    ),
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(manifest.buildId),
    "import.meta.env.VITE_SOURCE_URL": JSON.stringify(manifest.sourceUrl),
    "import.meta.env.VITE_LICENSE_URL": JSON.stringify(manifest.licenseUrl),
  },
  banner: {
    js: "/* SPDX-License-Identifier: GPL-3.0-or-later */",
  },
});

function fileRecord(file, publicPath, role) {
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
    throw new Error(`Expected nonempty Worker artifact: ${file}`);
  }
  const bytes = readFileSync(file);
  return {
    path: publicPath,
    role,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const workerPublicPath = "gnubg-engine.worker.js";
const sourceMapPublicPath = "gnubg-engine.worker.js.map";
manifest.files = manifest.files.filter(
  ({ role }) => role !== "engine-worker" && role !== "engine-worker-map",
);
manifest.files.push(
  fileRecord(workerPath, workerPublicPath, "engine-worker"),
  fileRecord(sourceMapPath, sourceMapPublicPath, "engine-worker-map"),
);
manifest.files.sort((left, right) => left.path.localeCompare(right.path));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Built GPL GNUbg Worker at ${path.relative(repositoryRoot, workerPath)}`,
);
