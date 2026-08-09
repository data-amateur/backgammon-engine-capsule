/* SPDX-License-Identifier: GPL-3.0-or-later */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KAZAROSS_XG2_XML_SHA256 =
  "7a232b171744b8db34306d11cff79a5974541328bb033b6bf16c012e8f7a3cc3";
export const KAZAROSS_XG2_LENGTH = 25;

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultInputPath = path.join(
  repositoryRoot,
  "third_party/gnubg/work/gnubg-1.08.003/met/Kazaross-XG2.xml",
);
const defaultOutputPath = path.join(
  repositoryRoot,
  "build/gnubg/generated/gnubg_kazaross_xg2_met_bits.inc",
);

const requiredNoticeFragments = [
  "Copyright (C) 2011 Neil Kazaross",
  "Transcribed for use by GNUbg by Michael Petch  <mpetch@capp-sysware.com>",
  "Copying and distribution of this file, with or without modification,",
  "are permitted in any medium without royalty provided the copyright",
  "notice and this notice are preserved.",
  "This file is offered as-is,",
  "without any warranty.",
];

const emittedNoticeLines = [
  "Upstream data notice preserved from Kazaross-XG2.xml:",
  "",
  "Copyright (C) 2011 Neil Kazaross",
  "",
  "Table rolled up to 9 point match by eXtreme Gammon. Then uses",
  "R/K MET which was rolled up to 15 and extrapolated to 25 points.",
  "",
  "Transcribed for use by GNUbg by Michael Petch  <mpetch@capp-sysware.com>",
  "",
  "This file is distributed as a part of the GNU Backgammon program.",
  "",
  "Copying and distribution of this file, with or without modification,",
  "are permitted in any medium without royalty provided the copyright",
  "notice and this notice are preserved.  This file is offered as-is,",
  "without any warranty.",
  "",
  "$Id: Kazaross-XG2.xml,v 1.3 2011/08/25 05:50:53 mdpetch Exp $",
];

function parserError(message, offset) {
  throw new Error(`Invalid Kazaross-XG2 XML at offset ${offset}: ${message}`);
}

function isNameStart(character) {
  return /[A-Za-z_:]/u.test(character);
}

function isNameCharacter(character) {
  return /[A-Za-z0-9_.:-]/u.test(character);
}

function decodeXmlEntities(value, offset) {
  let output = "";
  let cursor = 0;

  while (cursor < value.length) {
    const ampersand = value.indexOf("&", cursor);
    if (ampersand === -1) {
      output += value.slice(cursor);
      break;
    }
    output += value.slice(cursor, ampersand);
    const semicolon = value.indexOf(";", ampersand + 1);
    if (semicolon === -1) {
      parserError("unterminated entity", offset + ampersand);
    }
    const entity = value.slice(ampersand + 1, semicolon);
    const namedEntities = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      quot: '"',
    };

    if (Object.hasOwn(namedEntities, entity)) {
      output += namedEntities[entity];
    } else {
      const hexadecimal = entity.match(/^#x([0-9A-Fa-f]+)$/u);
      const decimal = entity.match(/^#([0-9]+)$/u);
      const codePoint = hexadecimal
        ? Number.parseInt(hexadecimal[1], 16)
        : decimal
          ? Number.parseInt(decimal[1], 10)
          : Number.NaN;
      if (
        !Number.isInteger(codePoint) ||
        codePoint < 1 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        parserError(`unsupported entity &${entity};`, offset + ampersand);
      }
      output += String.fromCodePoint(codePoint);
    }
    cursor = semicolon + 1;
  }

  return output;
}

function parseXmlDocument(xml) {
  let offset = 0;
  let root = null;
  let declarationSeen = false;
  let doctypeSeen = false;
  const stack = [];

  function skipWhitespace() {
    while (/\s/u.test(xml[offset] ?? "")) {
      offset += 1;
    }
  }

  function parseName() {
    const start = offset;
    if (!isNameStart(xml[offset] ?? "")) {
      parserError("expected an XML name", offset);
    }
    offset += 1;
    while (isNameCharacter(xml[offset] ?? "")) {
      offset += 1;
    }
    return xml.slice(start, offset);
  }

  function appendNode(node) {
    if (stack.length > 0) {
      stack.at(-1).children.push(node);
      return;
    }
    if (node.type === "text" && node.value.trim() === "") {
      return;
    }
    if (node.type !== "element" || root !== null) {
      parserError("document must contain exactly one root element", offset);
    }
    root = node;
  }

  function skipComment() {
    const end = xml.indexOf("-->", offset + 4);
    if (end === -1) {
      parserError("unterminated comment", offset);
    }
    const contents = xml.slice(offset + 4, end);
    if (contents.includes("--")) {
      parserError("comment contains a forbidden -- sequence", offset);
    }
    offset = end + 3;
  }

  function skipDoctype() {
    if (doctypeSeen || root !== null || stack.length > 0) {
      parserError("DOCTYPE is duplicated or misplaced", offset);
    }
    doctypeSeen = true;
    let cursor = offset + "<!DOCTYPE".length;
    let quote = null;
    let subsetDepth = 0;

    for (; cursor < xml.length; cursor += 1) {
      const character = xml[cursor];
      if (quote !== null) {
        if (character === quote) {
          quote = null;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "[") {
        subsetDepth += 1;
      } else if (character === "]") {
        subsetDepth -= 1;
        if (subsetDepth < 0) {
          parserError("malformed DOCTYPE subset", cursor);
        }
      } else if (character === ">" && subsetDepth === 0) {
        offset = cursor + 1;
        return;
      }
    }
    parserError("unterminated DOCTYPE", offset);
  }

  while (offset < xml.length) {
    if (xml.startsWith("<!--", offset)) {
      skipComment();
      continue;
    }

    if (xml.startsWith("<?", offset)) {
      const end = xml.indexOf("?>", offset + 2);
      if (end === -1) {
        parserError("unterminated processing instruction", offset);
      }
      const instruction = xml.slice(offset + 2, end).trim();
      if (
        declarationSeen ||
        root !== null ||
        stack.length > 0 ||
        !/^xml\s+version\s*=\s*(["'])1\.0\1$/u.test(instruction)
      ) {
        parserError("only one leading XML 1.0 declaration is allowed", offset);
      }
      declarationSeen = true;
      offset = end + 2;
      continue;
    }

    if (xml.startsWith("<!DOCTYPE", offset)) {
      skipDoctype();
      continue;
    }

    if (xml.startsWith("<!", offset)) {
      parserError("unsupported XML declaration", offset);
    }

    if (xml.startsWith("</", offset)) {
      const tagOffset = offset;
      offset += 2;
      const name = parseName();
      skipWhitespace();
      if (xml[offset] !== ">") {
        parserError("malformed closing tag", offset);
      }
      offset += 1;
      const openElement = stack.pop();
      if (!openElement || openElement.name !== name) {
        parserError(`closing tag </${name}> does not match`, tagOffset);
      }
      continue;
    }

    if (xml[offset] === "<") {
      offset += 1;
      const name = parseName();
      const attributes = Object.create(null);
      let selfClosing = false;

      while (offset < xml.length) {
        skipWhitespace();
        if (xml.startsWith("/>", offset)) {
          selfClosing = true;
          offset += 2;
          break;
        }
        if (xml[offset] === ">") {
          offset += 1;
          break;
        }

        const attributeOffset = offset;
        const attributeName = parseName();
        if (Object.hasOwn(attributes, attributeName)) {
          parserError(`duplicate attribute ${attributeName}`, attributeOffset);
        }
        skipWhitespace();
        if (xml[offset] !== "=") {
          parserError(`attribute ${attributeName} is missing =`, offset);
        }
        offset += 1;
        skipWhitespace();
        const quote = xml[offset];
        if (quote !== '"' && quote !== "'") {
          parserError(`attribute ${attributeName} must be quoted`, offset);
        }
        offset += 1;
        const valueStart = offset;
        const valueEnd = xml.indexOf(quote, offset);
        if (valueEnd === -1) {
          parserError(`attribute ${attributeName} is unterminated`, offset);
        }
        attributes[attributeName] = decodeXmlEntities(
          xml.slice(valueStart, valueEnd),
          valueStart,
        );
        offset = valueEnd + 1;
      }

      const element = { attributes, children: [], name, type: "element" };
      appendNode(element);
      if (!selfClosing) {
        stack.push(element);
      }
      continue;
    }

    const textStart = offset;
    const nextTag = xml.indexOf("<", offset);
    offset = nextTag === -1 ? xml.length : nextTag;
    const value = decodeXmlEntities(xml.slice(textStart, offset), textStart);
    appendNode({ type: "text", value });
  }

  if (stack.length > 0) {
    parserError(`unclosed <${stack.at(-1).name}> element`, offset);
  }
  if (root === null) {
    parserError("document has no root element", offset);
  }
  return root;
}

function elementChildren(node, context) {
  const elements = [];
  for (const child of node.children) {
    if (child.type === "text") {
      if (child.value.trim() !== "") {
        throw new Error(`${context} contains unexpected text`);
      }
    } else {
      elements.push(child);
    }
  }
  return elements;
}

function assertAttributes(node, expected, context) {
  const actualKeys = Object.keys(node.attributes).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`${context} has unexpected attributes`);
  }
  for (const key of expectedKeys) {
    if (node.attributes[key] !== expected[key]) {
      throw new Error(`${context} attribute ${key} must be ${expected[key]}`);
    }
  }
}

function leafText(node, context) {
  assertAttributes(node, {}, context);
  let value = "";
  for (const child of node.children) {
    if (child.type !== "text") {
      throw new Error(`${context} cannot contain child elements`);
    }
    value += child.value;
  }
  return value.trim();
}

function float32Bits(value) {
  const storage = new ArrayBuffer(4);
  const view = new DataView(storage);
  view.setFloat32(0, value, false);
  return view.getUint32(0, false);
}

function parseEquityValue(node, context) {
  if (node.name !== "me") {
    throw new Error(`${context} must contain only <me> values`);
  }
  const source = leafText(node, context);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(source)) {
    throw new Error(`${context} is not a finite decimal number`);
  }
  const number = Number(source);
  if (!Number.isFinite(number)) {
    throw new Error(`${context} is not finite`);
  }
  if (number < 0 || number > 1) {
    throw new Error(`${context} must be between 0 and 1`);
  }
  const rounded = Math.fround(number);
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > 1) {
    throw new Error(`${context} is not a representable equity`);
  }
  return float32Bits(rounded);
}

function parseRows(table, rowCount, valuesPerRow, context) {
  const rows = elementChildren(table, context);
  if (rows.length !== rowCount || rows.some((row) => row.name !== "row")) {
    throw new Error(`${context} must contain exactly ${rowCount} <row> elements`);
  }

  return rows.map((row, rowIndex) => {
    const rowContext = `${context} row ${rowIndex}`;
    assertAttributes(row, {}, rowContext);
    const values = elementChildren(row, rowContext);
    if (values.length !== valuesPerRow) {
      throw new Error(
        `${rowContext} must contain exactly ${valuesPerRow} <me> values`,
      );
    }
    return values.map((value, valueIndex) =>
      parseEquityValue(value, `${rowContext} value ${valueIndex}`),
    );
  });
}

export function parseKazarossMetXml(xml) {
  if (typeof xml !== "string" || xml.length === 0 || xml.includes("\0")) {
    throw new Error("Kazaross-XG2 XML must be nonempty text without NUL bytes");
  }
  for (const fragment of requiredNoticeFragments) {
    if (!xml.includes(fragment)) {
      throw new Error(`Kazaross-XG2 XML is missing notice text: ${fragment}`);
    }
  }

  const root = parseXmlDocument(xml);
  if (root.name !== "met") {
    throw new Error("Kazaross-XG2 XML root must be <met>");
  }
  assertAttributes(root, {}, "<met>");
  const sections = elementChildren(root, "<met>");
  const expectedSections = [
    "info",
    "pre-crawford-table",
    "post-crawford-table",
  ];
  if (
    sections.length !== expectedSections.length ||
    sections.some((section, index) => section.name !== expectedSections[index])
  ) {
    throw new Error(
      "<met> must contain one <info>, one <pre-crawford-table>, and one <post-crawford-table> in order",
    );
  }

  const [info, preTable, postTable] = sections;
  assertAttributes(info, {}, "<info>");
  const infoFields = elementChildren(info, "<info>");
  const expectedInfoFields = ["name", "description", "length"];
  if (
    infoFields.length !== expectedInfoFields.length ||
    infoFields.some((field, index) => field.name !== expectedInfoFields[index])
  ) {
    throw new Error("<info> must contain name, description, and length exactly once");
  }
  const name = leafText(infoFields[0], "<name>");
  const description = leafText(infoFields[1], "<description>");
  const lengthText = leafText(infoFields[2], "<length>");
  if (name.length === 0 || description.length === 0) {
    throw new Error("Kazaross-XG2 name and description must be nonempty");
  }
  if (lengthText !== String(KAZAROSS_XG2_LENGTH)) {
    throw new Error(`<length> must be exactly ${KAZAROSS_XG2_LENGTH}`);
  }

  assertAttributes(
    preTable,
    { type: "explicit" },
    "<pre-crawford-table>",
  );
  assertAttributes(
    postTable,
    { player: "both", type: "explicit" },
    "<post-crawford-table>",
  );
  const preBits = parseRows(
    preTable,
    KAZAROSS_XG2_LENGTH,
    KAZAROSS_XG2_LENGTH,
    "pre-Crawford table",
  );
  const [postBits] = parseRows(
    postTable,
    1,
    KAZAROSS_XG2_LENGTH,
    "post-Crawford table",
  );

  return {
    description,
    length: KAZAROSS_XG2_LENGTH,
    name,
    postBits,
    preBits,
  };
}

function formatWords(words, indentation) {
  const lines = [];
  for (let index = 0; index < words.length; index += 5) {
    const chunk = words
      .slice(index, index + 5)
      .map((word) => `UINT32_C(0x${word.toString(16).padStart(8, "0")})`);
    lines.push(`${indentation}${chunk.join(", ")},`);
  }
  return lines;
}

export function renderKazarossMetInclude(table) {
  if (
    table?.length !== KAZAROSS_XG2_LENGTH ||
    table.preBits?.length !== KAZAROSS_XG2_LENGTH ||
    table.preBits.some((row) => row.length !== KAZAROSS_XG2_LENGTH) ||
    table.postBits?.length !== KAZAROSS_XG2_LENGTH
  ) {
    throw new Error("Cannot render a malformed Kazaross-XG2 table");
  }

  const lines = [
    "/*",
    " * Generated from authenticated GNU Backgammon 1.08.003 data.",
    ` * Source SHA-256: ${KAZAROSS_XG2_XML_SHA256}`,
    " * Do not edit this file by hand.",
    " *",
    ...emittedNoticeLines.map((line) => ` *${line ? ` ${line}` : ""}`),
    " */",
    "",
    "#ifndef BGC_KAZAROSS_XG2_MET_BITS_INC",
    "#define BGC_KAZAROSS_XG2_MET_BITS_INC",
    "",
    "#include <stdint.h>",
    "",
    `#define BGC_KAZAROSS_XG2_MET_LENGTH UINT32_C(${KAZAROSS_XG2_LENGTH})`,
    `#define BGC_KAZAROSS_XG2_PRE_VALUE_COUNT UINT32_C(${KAZAROSS_XG2_LENGTH ** 2})`,
    `#define BGC_KAZAROSS_XG2_POST_VALUE_COUNT UINT32_C(${KAZAROSS_XG2_LENGTH})`,
    "",
    `static const uint32_t bgc_kazaross_xg2_pre_bits[${KAZAROSS_XG2_LENGTH}][${KAZAROSS_XG2_LENGTH}] = {`,
  ];

  for (const row of table.preBits) {
    lines.push("    {");
    lines.push(...formatWords(row, "        "));
    lines.push("    },");
  }
  lines.push("};", "");
  lines.push(
    `static const uint32_t bgc_kazaross_xg2_post_bits[${KAZAROSS_XG2_LENGTH}] = {`,
  );
  lines.push(...formatWords(table.postBits, "    "));
  lines.push("};", "", "#endif", "");
  return lines.join("\n");
}

export function generateKazarossMetInclude({ inputPath, outputPath }) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  if (resolvedInput === resolvedOutput) {
    throw new Error("MET input and output paths must differ");
  }

  const sourceBytes = readFileSync(resolvedInput);
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceHash !== KAZAROSS_XG2_XML_SHA256) {
    throw new Error(
      `Kazaross-XG2.xml SHA-256 mismatch: expected ${KAZAROSS_XG2_XML_SHA256}, received ${sourceHash}`,
    );
  }

  let xml;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  } catch (error) {
    throw new Error("Kazaross-XG2.xml is not valid UTF-8", { cause: error });
  }
  const output = renderKazarossMetInclude(parseKazarossMetXml(xml));
  mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, output, "utf8");
  return {
    inputPath: resolvedInput,
    output,
    outputPath: resolvedOutput,
    sourceHash,
  };
}

function parseCliArguments(arguments_) {
  const options = {
    inputPath: defaultInputPath,
    outputPath: defaultOutputPath,
  };
  const seen = new Set();

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--input" && argument !== "--output") {
      throw new Error(`Unknown generator argument: ${argument}`);
    }
    if (seen.has(argument)) {
      throw new Error(`Duplicate generator argument: ${argument}`);
    }
    seen.add(argument);
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a path`);
    }
    index += 1;
    if (argument === "--input") {
      options.inputPath = path.resolve(value);
    } else {
      options.outputPath = path.resolve(value);
    }
  }
  return options;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const result = generateKazarossMetInclude(
    parseCliArguments(process.argv.slice(2)),
  );
  console.log(
    `Generated ${result.outputPath} from authenticated ${result.inputPath}`,
  );
}
