import { build } from "esbuild";
import { loadEnv } from "vite";

const mode = process.argv[2] ?? "development";
const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };

await build({
  entryPoints: ["src/worker/mock.worker.ts"],
  outfile: "public/mock-engine.worker.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  legalComments: "inline",
  define: {
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(
      env.VITE_BUILD_ID ?? "mock-dev",
    ),
    "import.meta.env.VITE_SOURCE_URL": JSON.stringify(
      env.VITE_SOURCE_URL ?? "",
    ),
    "import.meta.env.VITE_LICENSE_URL": JSON.stringify(
      env.VITE_LICENSE_URL ?? "",
    ),
  },
  banner: {
    js: "/* SPDX-License-Identifier: Apache-2.0 */",
  },
});
