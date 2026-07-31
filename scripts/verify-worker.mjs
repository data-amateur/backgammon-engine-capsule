import { readFile } from "node:fs/promises";

const workerPath = "public/mock-engine.worker.js";
const source = await readFile(workerPath, "utf8");
const forbiddenPatterns = [
  [/^\s*import\s/m, "static import"],
  [/^\s*export\s/m, "export"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\bimport\.meta\b/, "import.meta"],
];

if (source.trim().length === 0) {
  throw new Error(workerPath + " is empty");
}

for (const [pattern, description] of forbiddenPatterns) {
  if (pattern.test(source)) {
    throw new Error(
      workerPath +
        " is not a self-contained classic Worker: found " +
        description,
    );
  }
}

process.stdout.write("Verified self-contained Worker: " + workerPath + "\n");
