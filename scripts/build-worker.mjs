import { build } from "esbuild";
import { loadEnv } from "vite";

const mode = process.argv[2] ?? "development";
const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
const mockResponseDelayMs = Number(env.VITE_MOCK_RESPONSE_DELAY_MS ?? "0");

if (
  !Number.isInteger(mockResponseDelayMs) ||
  mockResponseDelayMs < 0 ||
  mockResponseDelayMs > 1_000
) {
  throw new Error(
    "VITE_MOCK_RESPONSE_DELAY_MS must be an integer from 0 through 1000",
  );
}

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
    "import.meta.env.VITE_MOCK_RESPONSE_DELAY_MS": JSON.stringify(
      String(mockResponseDelayMs),
    ),
  },
  banner: {
    js: "/* SPDX-License-Identifier: Apache-2.0 */",
  },
});
