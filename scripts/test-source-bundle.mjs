import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSourceBundle } from "./build-source-bundle.mjs";
import {
  GNU_TAR,
  GNU_TAR_OVERRIDE,
  parseSupportedGnuTarVersion,
} from "./gnu-tar.mjs";
import { verifySourceBundle } from "./verify-source-bundle.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function testGnuTarResolution() {
  if (
    parseSupportedGnuTarVersion("tar (GNU tar) 1.27.1") !== null ||
    parseSupportedGnuTarVersion("tar (GNU tar) 1.28") === null ||
    parseSupportedGnuTarVersion("tar (GNU tar) 2.0.3") === null ||
    parseSupportedGnuTarVersion("bsdtar 3.7.4") !== null
  ) {
    throw new Error("GNU tar minimum-version validation is incorrect");
  }
  const importCommand = "await import('./scripts/gnu-tar.mjs')";
  const validOverride = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", importCommand],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: "",
        [GNU_TAR_OVERRIDE]: GNU_TAR.executable,
      },
      encoding: "utf8",
    },
  );
  if (validOverride.status !== 0) {
    throw new Error(
      `The explicit GNU tar override was rejected: ${validOverride.stderr}`,
    );
  }

  const invalidOverride = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", importCommand],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        [GNU_TAR_OVERRIDE]: process.execPath,
      },
      encoding: "utf8",
    },
  );
  const invalidOutput = `${invalidOverride.stdout || ""}\n${invalidOverride.stderr || ""}`;
  if (
    invalidOverride.status === 0 ||
    !invalidOutput.includes("is not GNU tar 1.28 or newer")
  ) {
    throw new Error("A non-GNU BGC_GNU_TAR override was not rejected");
  }
}

testGnuTarResolution();

const first = buildSourceBundle("verification");
const firstArchive = readFileSync(first.archiveFile);
const firstInfo = readFileSync(first.infoFile);
verifySourceBundle();

const second = buildSourceBundle("verification");
const secondArchive = readFileSync(second.archiveFile);
const secondInfo = readFileSync(second.infoFile);
if (!firstArchive.equals(secondArchive) || !firstInfo.equals(secondInfo)) {
  throw new Error(
    "Corresponding-source bundle is not byte-for-byte deterministic",
  );
}
verifySourceBundle();

if (second.info.workingTreeClean) {
  const production = buildSourceBundle("production");
  if (!readFileSync(production.archiveFile).equals(secondArchive)) {
    throw new Error(
      "Clean production and verification source archives must be identical",
    );
  }
  verifySourceBundle({ requireClean: true });
} else {
  let rejectedDirtyProduction = false;
  try {
    buildSourceBundle("production");
  } catch (error) {
    rejectedDirtyProduction = /clean Git working tree/u.test(
      String(error.message),
    );
  }
  if (!rejectedDirtyProduction) {
    throw new Error("Production source bundle accepted a dirty source tree");
  }
}

const temporaryRoot = mkdtempSync(
  path.join(tmpdir(), "backgammon-capsule-source-tamper-"),
);
try {
  const tamperedArchive = Buffer.from(secondArchive);
  tamperedArchive[tamperedArchive.length - 1] ^= 0xff;
  const archiveFile = path.join(temporaryRoot, "tampered.tar.gz");
  const infoFile = path.join(temporaryRoot, "source-bundle-info.json");
  writeFileSync(archiveFile, tamperedArchive);
  writeFileSync(infoFile, secondInfo);

  let rejected = false;
  try {
    verifySourceBundle({
      archiveFile,
      infoFile,
      compareWorkingTree: false,
    });
  } catch (error) {
    rejected = /invalid shape/u.test(String(error.message));
  }
  if (!rejected) {
    throw new Error("Tampered corresponding-source archive was not rejected");
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(
  `Corresponding source repeatability, tamper, and GNU tar resolution tests passed (${second.info.archiveSha256}; ${GNU_TAR.version})`,
);
