/* SPDX-License-Identifier: GPL-3.0-or-later */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateKazarossMetInclude,
  KAZAROSS_XG2_LENGTH,
  KAZAROSS_XG2_XML_SHA256,
  parseKazarossMetXml,
  renderKazarossMetInclude,
} from "./generate-gnubg-met.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const archivePath = path.join(
  repositoryRoot,
  "third_party/gnubg/upstream/gnubg-release-1.08.003-sources.tar.gz",
);
const archiveMember = "gnubg-1.08.003/met/Kazaross-XG2.xml";
const generatorPath = path.join(
  repositoryRoot,
  "scripts/generate-gnubg-met.mjs",
);
const temporaryRoot = mkdtempSync(
  path.join(os.tmpdir(), "gnubg-met-generator-test-"),
);

const notice = `<!--
Copyright (C) 2011 Neil Kazaross
Transcribed for use by GNUbg by Michael Petch  <mpetch@capp-sysware.com>
Copying and distribution of this file, with or without modification,
are permitted in any medium without royalty provided the copyright
notice and this notice are preserved.  This file is offered as-is,
without any warranty.
-->`;

function row(values) {
  return `<row>${values.map((value) => `<me>${value}</me>`).join("")}</row>`;
}

function defaultRows() {
  return Array.from({ length: KAZAROSS_XG2_LENGTH }, () =>
    Array.from({ length: KAZAROSS_XG2_LENGTH }, () => "0.5"),
  );
}

function validXml(options = {}) {
  const preRows = options.preRows ?? defaultRows();
  const postRows = options.postRows ?? [
    Array.from({ length: KAZAROSS_XG2_LENGTH }, () => "0.5"),
  ];
  const preTable = `<pre-crawford-table type="explicit">${preRows
    .map(row)
    .join("")}</pre-crawford-table>`;
  const postTable = `<post-crawford-table type="explicit" player="${
    options.postPlayer ?? "both"
  }">${postRows.map(row).join("")}</post-crawford-table>`;
  return `${options.notice ?? notice}
<met>
  <info>
    <name>Kazaross test table</name>
    <description>Strict generator fixture</description>
    <length>${options.length ?? KAZAROSS_XG2_LENGTH}</length>
  </info>
  ${preTable}
  ${postTable}
  ${options.extraSection ?? ""}
</met>`;
}

function expectParseFailure(label, xml, expected) {
  const file = path.join(temporaryRoot, `${label}.xml`);
  writeFileSync(file, xml, "utf8");
  assert.throws(
    () => parseKazarossMetXml(readFileSync(file, "utf8")),
    expected,
    label,
  );
}

function extractAuthenticatedXml() {
  const result = spawnSync(
    "tar",
    ["-xOzf", archivePath, archiveMember],
    { encoding: null, maxBuffer: 1024 * 1024 },
  );
  if (result.error?.code === "ENOENT") {
    throw new Error("tar is required for the GNUbg MET generator test");
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `tar could not extract ${archiveMember}: ${result.stderr.toString("utf8")}`,
    );
  }
  return result.stdout;
}

try {
  const authenticatedBytes = extractAuthenticatedXml();
  const authenticatedHash = createHash("sha256")
    .update(authenticatedBytes)
    .digest("hex");
  assert.equal(authenticatedHash, KAZAROSS_XG2_XML_SHA256);

  const inputPath = path.join(temporaryRoot, "Kazaross-XG2.xml");
  const firstOutputPath = path.join(temporaryRoot, "first", "met.inc");
  const secondOutputPath = path.join(temporaryRoot, "second", "met.inc");
  const cliOutputPath = path.join(temporaryRoot, "cli", "met.inc");
  writeFileSync(inputPath, authenticatedBytes);

  const firstResult = generateKazarossMetInclude({
    inputPath,
    outputPath: firstOutputPath,
  });
  const secondResult = generateKazarossMetInclude({
    inputPath,
    outputPath: secondOutputPath,
  });
  assert.equal(firstResult.sourceHash, KAZAROSS_XG2_XML_SHA256);
  assert.equal(firstResult.output, secondResult.output);
  assert.deepEqual(
    readFileSync(firstOutputPath),
    readFileSync(secondOutputPath),
    "authenticated generation must be byte-for-byte deterministic",
  );

  const parsedAuthenticated = parseKazarossMetXml(
    authenticatedBytes.toString("utf8"),
  );
  assert.equal(parsedAuthenticated.length, 25);
  assert.equal(parsedAuthenticated.preBits.length, 25);
  assert.ok(parsedAuthenticated.preBits.every((values) => values.length === 25));
  assert.equal(parsedAuthenticated.postBits.length, 25);
  assert.equal(parsedAuthenticated.preBits[0][0], 0x3f000000);
  assert.equal(parsedAuthenticated.postBits[0], 0x3f000000);
  assert.equal(
    renderKazarossMetInclude(parsedAuthenticated),
    firstResult.output,
  );

  const output = readFileSync(firstOutputPath, "utf8");
  assert.ok(output.endsWith("\n"));
  assert.match(output, new RegExp(KAZAROSS_XG2_XML_SHA256, "u"));
  assert.match(output, /Copyright \(C\) 2011 Neil Kazaross/u);
  assert.match(output, /Transcribed for use by GNUbg by Michael Petch/u);
  assert.equal(
    [...output.matchAll(/UINT32_C\(0x[0-9a-f]{8}\)/gu)].length,
    650,
  );

  const cli = spawnSync(
    process.execPath,
    [
      generatorPath,
      "--input",
      inputPath,
      "--output",
      cliOutputPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Generated .* from authenticated /u);
  assert.deepEqual(readFileSync(cliOutputPath), readFileSync(firstOutputPath));

  const badArgument = spawnSync(
    process.execPath,
    [generatorPath, "--expected-sha256", KAZAROSS_XG2_XML_SHA256],
    { encoding: "utf8" },
  );
  assert.notEqual(badArgument.status, 0);
  assert.match(badArgument.stderr, /Unknown generator argument/u);

  const modifiedInputPath = path.join(temporaryRoot, "modified.xml");
  const rejectedOutputPath = path.join(temporaryRoot, "rejected.inc");
  const modifiedBytes = Buffer.from(authenticatedBytes);
  modifiedBytes[modifiedBytes.length - 2] ^= 1;
  writeFileSync(modifiedInputPath, modifiedBytes);
  assert.throws(
    () =>
      generateKazarossMetInclude({
        inputPath: modifiedInputPath,
        outputPath: rejectedOutputPath,
      }),
    /SHA-256 mismatch/u,
  );
  assert.equal(existsSync(rejectedOutputPath), false);

  assert.throws(
    () =>
      generateKazarossMetInclude({
        inputPath,
        outputPath: inputPath,
      }),
    /input and output paths must differ/u,
  );

  const fixture = validXml();
  const parsedFixture = parseKazarossMetXml(fixture);
  assert.equal(parsedFixture.preBits.length, 25);
  assert.equal(parsedFixture.postBits.length, 25);

  expectParseFailure(
    "malformed-closing-tag",
    fixture.replace("</met>", "</wrong>"),
    /closing tag|unclosed/u,
  );
  expectParseFailure(
    "missing-notice",
    fixture.replace(notice, ""),
    /missing notice text/u,
  );
  expectParseFailure(
    "wrong-length",
    validXml({ length: 24 }),
    /<length> must be exactly 25/u,
  );

  const tooFewRows = defaultRows().slice(0, 24);
  expectParseFailure(
    "too-few-pre-rows",
    validXml({ preRows: tooFewRows }),
    /exactly 25 <row>/u,
  );

  const tooFewValues = defaultRows();
  tooFewValues[0] = tooFewValues[0].slice(0, 24);
  expectParseFailure(
    "too-few-values",
    validXml({ preRows: tooFewValues }),
    /exactly 25 <me>/u,
  );

  const extraValues = defaultRows();
  extraValues[0] = [...extraValues[0], "0.5"];
  expectParseFailure(
    "extra-values",
    validXml({ preRows: extraValues }),
    /exactly 25 <me>/u,
  );

  const nonfiniteValues = defaultRows();
  nonfiniteValues[0][0] = "1e999";
  expectParseFailure(
    "nonfinite-value",
    validXml({ preRows: nonfiniteValues }),
    /not finite/u,
  );

  const notNumericValues = defaultRows();
  notNumericValues[0][0] = "NaN";
  expectParseFailure(
    "not-numeric-value",
    validXml({ preRows: notNumericValues }),
    /not a finite decimal number/u,
  );

  for (const [label, invalidValue] of [
    ["negative-value", "-0.01"],
    ["value-above-one", "1.01"],
  ]) {
    const outOfRangeValues = defaultRows();
    outOfRangeValues[0][0] = invalidValue;
    expectParseFailure(
      label,
      validXml({ preRows: outOfRangeValues }),
      /between 0 and 1/u,
    );
  }

  expectParseFailure(
    "post-player-not-both",
    validXml({ postPlayer: "0" }),
    /attribute player must be both/u,
  );
  expectParseFailure(
    "extra-post-row",
    validXml({
      postRows: [
        Array.from({ length: 25 }, () => "0.5"),
        Array.from({ length: 25 }, () => "0.5"),
      ],
    }),
    /exactly 1 <row>/u,
  );
  expectParseFailure(
    "extra-table",
    validXml({
      extraSection:
        '<post-crawford-table type="explicit" player="both"></post-crawford-table>',
    }),
    /must contain one <info>/u,
  );
  expectParseFailure(
    "extra-value-element",
    fixture.replace("</pre-crawford-table>", "<me>0.5</me></pre-crawford-table>"),
    /exactly 25 <row>/u,
  );

  console.log("Authenticated GNUbg MET generator tests passed");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
