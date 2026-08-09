import assert from "node:assert/strict";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { TextDecoder, TextEncoder } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const buildRoot = path.join(repositoryRoot, "build/gnubg/wasm");
const moduleUrl = pathToFileURL(
  path.join(buildRoot, "gnubg-wasm.mjs"),
);
const { default: createModule } = await import(moduleUrl.href);

const ABI_VERSION = 0x0001_0000;
const STATUS_OK = 0;
const STATUS_NOT_READY = 4;
const STATUS_INITIALIZATION_FAILED = 5;
const ARENA_SIZE = 4096;

const INIT_REQUEST_OFFSET = 0;
const INIT_ERROR_OFFSET = 64;
const INIT_WEIGHTS_OFFSET = 512;
const INIT_MATCH_EQUITY_OFFSET = 1536;

const CHOOSE_REQUEST_OFFSET = 0;
const CHOOSE_CANDIDATE_OFFSET = 256;
const CHOOSE_SCORES_OFFSET = 512;
const CHOOSE_RESULT_OFFSET = 768;
const CHOOSE_ERROR_OFFSET = 1024;

const CUBE_REQUEST_OFFSET = 0;
const CUBE_RESULT_OFFSET = 256;
const CUBE_ERROR_OFFSET = 512;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function locateFile(file) {
  return path.join(buildRoot, file);
}

async function instantiate() {
  const started = performance.now();
  const module = await createModule({ locateFile });
  return {
    module,
    milliseconds: performance.now() - started,
  };
}

function currentBytes(module, pointer, size = ARENA_SIZE) {
  return module.HEAPU8.subarray(pointer, pointer + size);
}

function currentView(module, pointer, size = ARENA_SIZE) {
  return new DataView(module.HEAPU8.buffer, pointer, size);
}

function assertZero(bytes, description) {
  assert.ok(
    bytes.every((value) => value === 0),
    description,
  );
}

function readError(module, arena, offset) {
  const bytes = currentBytes(module, arena).slice(offset, offset + 256);
  const terminator = bytes.indexOf(0);
  assert.notEqual(terminator, -1, "error record is NUL terminated");
  assertZero(
    bytes.subarray(terminator + 1),
    "error record is zero-tailed",
  );
  return decoder.decode(bytes.subarray(0, terminator));
}

function verifyDescriptor(module) {
  assert.equal(module._bgc_wasm_abi_version(), ABI_VERSION);
  assert.equal(module._bgc_wasm_abi_descriptor_size(), 128);
  assert.equal(module._bgc_wasm_get_abi_descriptor(0, 128), 1);

  const pointer = module._malloc(128);
  assert.notEqual(pointer, 0);
  try {
    currentBytes(module, pointer, 128).fill(0xa5);
    const unchanged = currentBytes(module, pointer, 128).slice();
    assert.equal(module._bgc_wasm_get_abi_descriptor(pointer, 127), 1);
    assert.deepEqual(currentBytes(module, pointer, 128), unchanged);
    assert.equal(module._bgc_wasm_get_abi_descriptor(pointer, 128), 0);

    const view = currentView(module, pointer, 128);
    const expectedFields = [
      [0, ABI_VERSION],
      [4, 128],
      [8, 0x0102_0304],
      [12, 4],
      [16, 8],
      [20, 2],
      [24, 52],
      [28, 16],
      [32, 20],
      [36, 20],
      [40, 120],
      [44, 8],
      [48, 24],
      [52, 104],
      [56, 16],
      [60, 8],
      [64, 256],
      [68, 32],
      [72, 176],
      [76, 32],
      [80, 192],
      [84, 64],
    ];
    for (const [offset, value] of expectedFields) {
      assert.equal(
        view.getUint32(offset, true),
        value,
        `ABI descriptor +${offset}`,
      );
    }
    for (let offset = 88; offset < 128; offset += 4) {
      assert.equal(
        view.getUint32(offset, true),
        0,
        `ABI reserved +${offset}`,
      );
    }
  } finally {
    module._free(pointer);
  }
}

function prepareInit(module, arena, weightsPath, equityPath) {
  const weights = encoder.encode(weightsPath);
  const equity = encoder.encode(equityPath);
  assert.ok(weights.length > 0 && weights.length <= 1024);
  assert.ok(equity.length > 0 && equity.length <= 1024);

  const bytes = currentBytes(module, arena);
  bytes.fill(0xa5);
  bytes.fill(0, INIT_REQUEST_OFFSET, INIT_REQUEST_OFFSET + 32);
  const view = currentView(module, arena);
  view.setUint32(0, ABI_VERSION, true);
  view.setUint32(4, 32, true);
  view.setUint32(8, INIT_WEIGHTS_OFFSET, true);
  view.setUint32(12, weights.length, true);
  view.setUint32(16, INIT_MATCH_EQUITY_OFFSET, true);
  view.setUint32(20, equity.length, true);
  bytes.set(weights, INIT_WEIGHTS_OFFSET);
  bytes.set(equity, INIT_MATCH_EQUITY_OFFSET);
}

function callInit(module, arena, weightsPath, equityPath) {
  prepareInit(module, arena, weightsPath, equityPath);
  return module._bgc_wasm_init(
    arena,
    ARENA_SIZE,
    INIT_REQUEST_OFFSET,
    INIT_ERROR_OFFSET,
  );
}

function writePosition(view, offset, position) {
  for (const [point, white, black] of position.points) {
    view.setUint8(offset + point * 2, white);
    view.setUint8(offset + point * 2 + 1, black);
  }
  view.setUint8(offset + 48, position.barWhite ?? 0);
  view.setUint8(offset + 49, position.barBlack ?? 0);
  view.setUint8(offset + 50, position.offWhite ?? 0);
  view.setUint8(offset + 51, position.offBlack ?? 0);
  view.setUint32(offset + 52, position.player ?? 0, true);
  view.setUint32(offset + 56, position.die0 ?? 0, true);
  view.setUint32(offset + 60, position.die1 ?? 0, true);
  view.setInt32(offset + 64, position.cubeValue ?? 1, true);
  view.setInt32(offset + 68, position.cubeOwner ?? -1, true);
  view.setUint32(offset + 72, position.cubeState ?? 0, true);
  view.setInt32(offset + 76, position.cubeOfferedBy ?? -1, true);
  view.setUint32(offset + 80, position.matchMode ?? 0, true);
  view.setInt32(offset + 84, position.matchLength ?? 0, true);
  view.setUint32(offset + 88, position.scoreWhite ?? 0, true);
  view.setUint32(offset + 92, position.scoreBlack ?? 0, true);
  view.setUint32(offset + 96, position.crawford ?? 0, true);
  view.setUint32(offset + 100, 0, true);
  view.setUint32(offset + 104, position.jacoby ?? 0, true);
  view.setUint32(offset + 108, position.beavers ?? 0, true);
  view.setUint32(offset + 112, position.raccoons ?? 0, true);
  view.setUint32(offset + 116, position.automaticDoubles ?? 0, true);
}

const startingPosition = {
  die0: 1,
  die1: 2,
  points: [
    [23, 2, 0],
    [12, 5, 0],
    [7, 3, 0],
    [5, 5, 0],
    [0, 0, 2],
    [11, 0, 5],
    [16, 0, 3],
    [18, 0, 5],
  ],
};

const checkerCandidates = [
  [
    [0, 23, 0, 22, 1, 0],
    [0, 22, 0, 20, 2, 0],
  ],
  [
    [0, 7, 0, 6, 1, 0],
    [0, 6, 0, 4, 2, 0],
  ],
];

function writeCandidate(view, offset, steps) {
  view.setUint32(offset, steps.length, true);
  view.setUint32(offset + 4, 0, true);
  for (let index = 0; index < steps.length; index++) {
    const stepOffset = offset + 8 + index * 24;
    const [
      fromKind,
      fromPoint,
      toKind,
      toPoint,
      die,
      hit,
    ] = steps[index];
    view.setUint32(stepOffset, fromKind, true);
    view.setInt32(stepOffset + 4, fromPoint, true);
    view.setUint32(stepOffset + 8, toKind, true);
    view.setInt32(stepOffset + 12, toPoint, true);
    view.setUint32(stepOffset + 16, die, true);
    view.setUint32(stepOffset + 20, hit, true);
  }
}

function prepareChoose(module, arena, strength = 3) {
  const bytes = currentBytes(module, arena);
  bytes.fill(0xa5);
  bytes.fill(
    0,
    CHOOSE_REQUEST_OFFSET,
    CHOOSE_REQUEST_OFFSET + 176,
  );
  bytes.fill(
    0,
    CHOOSE_CANDIDATE_OFFSET,
    CHOOSE_CANDIDATE_OFFSET + checkerCandidates.length * 104,
  );
  const view = currentView(module, arena);
  view.setUint32(0, ABI_VERSION, true);
  view.setUint32(4, 176, true);
  writePosition(view, 8, startingPosition);
  view.setUint32(128, CHOOSE_CANDIDATE_OFFSET, true);
  view.setUint32(132, checkerCandidates.length, true);
  view.setUint32(136, CHOOSE_SCORES_OFFSET, true);
  view.setUint32(140, checkerCandidates.length, true);
  view.setUint32(144, strength, true);
  checkerCandidates.forEach((candidate, index) => {
    writeCandidate(
      view,
      CHOOSE_CANDIDATE_OFFSET + index * 104,
      candidate,
    );
  });
}

function callChoose(module, arena, strength = 3) {
  prepareChoose(module, arena, strength);
  return module._bgc_wasm_choose_turn(
    arena,
    ARENA_SIZE,
    CHOOSE_REQUEST_OFFSET,
    CHOOSE_RESULT_OFFSET,
    CHOOSE_ERROR_OFFSET,
  );
}

function assertSuccessfulChoose(module, arena) {
  const bytes = currentBytes(module, arena);
  const view = currentView(module, arena);
  assert.equal(view.getUint32(CHOOSE_RESULT_OFFSET, true), ABI_VERSION);
  assert.equal(view.getUint32(CHOOSE_RESULT_OFFSET + 4, true), 32);
  assert.equal(view.getUint32(CHOOSE_RESULT_OFFSET + 8, true), 0);
  assert.equal(view.getUint32(CHOOSE_RESULT_OFFSET + 12, true), 2);
  assertZero(
    bytes.subarray(
      CHOOSE_RESULT_OFFSET + 16,
      CHOOSE_RESULT_OFFSET + 32,
    ),
    "checker result reserved fields are zero",
  );

  const score0 = view.getFloat32(CHOOSE_SCORES_OFFSET, true);
  const cubeless0 = view.getFloat32(CHOOSE_SCORES_OFFSET + 4, true);
  const score1 = view.getFloat32(CHOOSE_SCORES_OFFSET + 8, true);
  const cubeless1 = view.getFloat32(CHOOSE_SCORES_OFFSET + 12, true);
  assert.ok(Number.isFinite(cubeless0));
  assert.ok(Number.isFinite(cubeless1));
  assert.ok(Math.abs(score0 - (-0.022146732)) <= 1e-5);
  assert.ok(Math.abs(score1 - (-0.127965674)) <= 1e-5);
  assert.equal(readError(module, arena, CHOOSE_ERROR_OFFSET), "");
}

const cubePosition = {
  points: [
    [16, 2, 0],
    [19, 2, 0],
    [21, 2, 0],
    [22, 9, 0],
    [4, 0, 1],
    [7, 0, 11],
    [17, 0, 1],
    [18, 0, 2],
  ],
};

function prepareCube(module, arena) {
  const bytes = currentBytes(module, arena);
  bytes.fill(0xa5);
  bytes.fill(0, CUBE_REQUEST_OFFSET, CUBE_REQUEST_OFFSET + 192);
  const view = currentView(module, arena);
  view.setUint32(0, ABI_VERSION, true);
  view.setUint32(4, 192, true);
  writePosition(view, 8, cubePosition);
  view.setUint32(128, 0, true);
  view.setUint32(132, 0, true);
  view.setUint32(136, 3, true);
  view.setUint32(140, 2, true);
  view.setUint32(144, 1, true);
  view.setUint32(148, 0, true);
  view.setUint32(164, 3, true);
}

function assertNear(actual, expected, description) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-5,
    `${description}: expected ${expected}, received ${actual}`,
  );
}

function callAndAssertCube(module, arena) {
  prepareCube(module, arena);
  const status = module._bgc_wasm_decide_cube(
    arena,
    ARENA_SIZE,
    CUBE_REQUEST_OFFSET,
    CUBE_RESULT_OFFSET,
    CUBE_ERROR_OFFSET,
  );
  assert.equal(status, STATUS_OK);

  const bytes = currentBytes(module, arena);
  const view = currentView(module, arena);
  assert.equal(view.getUint32(CUBE_RESULT_OFFSET, true), ABI_VERSION);
  assert.equal(view.getUint32(CUBE_RESULT_OFFSET + 4, true), 64);
  assert.equal(view.getUint32(CUBE_RESULT_OFFSET + 8, true), 0);
  assert.equal(view.getUint32(CUBE_RESULT_OFFSET + 12, true), 2);
  assert.equal(view.getUint32(CUBE_RESULT_OFFSET + 16, true), 1);
  assert.equal(view.getUint32(CUBE_RESULT_OFFSET + 20, true), 0);
  assertNear(
    view.getFloat32(CUBE_RESULT_OFFSET + 24, true),
    0.885209322,
    "selected cube equity",
  );
  assertNear(
    view.getFloat32(CUBE_RESULT_OFFSET + 28, true),
    0.885209322,
    "optimal cube equity",
  );
  assertNear(
    view.getFloat32(CUBE_RESULT_OFFSET + 32, true),
    0.796325445,
    "no-double equity",
  );
  assertNear(
    view.getFloat32(CUBE_RESULT_OFFSET + 36, true),
    0.885209322,
    "double/take equity",
  );
  assertNear(
    view.getFloat32(CUBE_RESULT_OFFSET + 40, true),
    1,
    "double/pass equity",
  );
  assertZero(
    bytes.subarray(
      CUBE_RESULT_OFFSET + 44,
      CUBE_RESULT_OFFSET + 64,
    ),
    "cube result reserved fields are zero",
  );
  assert.equal(readError(module, arena, CUBE_ERROR_OFFSET), "");
}

const invalidModuleStart = performance.now();
const invalidInstantiation = await instantiate();
verifyDescriptor(invalidInstantiation.module);
const invalidArena =
  invalidInstantiation.module._bgc_wasm_alloc(ARENA_SIZE);
assert.notEqual(invalidArena, 0);
try {
  let status = callInit(
    invalidInstantiation.module,
    invalidArena,
    "/gnubg/met/Kazaross-XG2.xml",
    "/gnubg/met/Kazaross-XG2.xml",
  );
  assert.equal(status, STATUS_INITIALIZATION_FAILED);
  assert.equal(
    readError(
      invalidInstantiation.module,
      invalidArena,
      INIT_ERROR_OFFSET,
    ),
    "GNUbg evaluator initialization failed: weights data is invalid or incomplete",
  );

  status = callInit(
    invalidInstantiation.module,
    invalidArena,
    "/gnubg/gnubg.weights",
    "/gnubg/met/Kazaross-XG2.xml",
  );
  assert.equal(status, STATUS_INITIALIZATION_FAILED);
  assert.equal(
    readError(
      invalidInstantiation.module,
      invalidArena,
      INIT_ERROR_OFFSET,
    ),
    "engine initialization is already consumed",
  );
} finally {
  invalidInstantiation.module._bgc_wasm_dispose();
  invalidInstantiation.module._bgc_wasm_free(invalidArena);
}

const pressureInstantiation = await instantiate();
verifyDescriptor(pressureInstantiation.module);
const pressureModule = pressureInstantiation.module;
const pressureArena = pressureModule._bgc_wasm_alloc(ARENA_SIZE);
const pressureAllocations = [];
assert.notEqual(pressureArena, 0);
try {
  for (;;) {
    const allocation = pressureModule._malloc(1024 * 1024);
    if (allocation === 0) {
      break;
    }
    pressureAllocations.push(allocation);
  }
  assert.ok(
    pressureAllocations.length > 64,
    "memory pressure reaches the configured wasm maximum",
  );

  // Leave enough heap for fopen and error handling, but less than GNUbg's
  // first 3.5-MiB evaluator-cache allocation.
  pressureModule._free(pressureAllocations.pop());
  let status = callInit(
    pressureModule,
    pressureArena,
    "/gnubg/gnubg.weights",
    "/gnubg/met/Kazaross-XG2.xml",
  );
  assert.equal(status, STATUS_INITIALIZATION_FAILED);
  assert.equal(
    readError(pressureModule, pressureArena, INIT_ERROR_OFFSET),
    "GNUbg evaluator initialization failed: evaluation cache allocation failed",
  );

  status = callInit(
    pressureModule,
    pressureArena,
    "/gnubg/gnubg.weights",
    "/gnubg/met/Kazaross-XG2.xml",
  );
  assert.equal(status, STATUS_INITIALIZATION_FAILED);
  assert.equal(
    readError(pressureModule, pressureArena, INIT_ERROR_OFFSET),
    "engine initialization is already consumed",
  );
} finally {
  pressureModule._bgc_wasm_dispose();
  for (const allocation of pressureAllocations) {
    pressureModule._free(allocation);
  }
  pressureModule._bgc_wasm_free(pressureArena);
}

const validInstantiation = await instantiate();
verifyDescriptor(validInstantiation.module);
const module = validInstantiation.module;
const arena = module._bgc_wasm_alloc(ARENA_SIZE);
assert.notEqual(arena, 0);
let engineInitializationMilliseconds;
try {
  const engineStart = performance.now();
  const status = callInit(
    module,
    arena,
    "/gnubg/gnubg.weights",
    "/gnubg/met/Kazaross-XG2.xml",
  );
  engineInitializationMilliseconds = performance.now() - engineStart;
  assert.equal(status, STATUS_OK);
  assert.equal(readError(module, arena, INIT_ERROR_OFFSET), "");

  assert.equal(callChoose(module, arena), STATUS_OK);
  assertSuccessfulChoose(module, arena);

  assert.equal(callChoose(module, arena, 4), STATUS_OK);
  const maximumView = currentView(module, arena);
  assert.equal(maximumView.getUint32(CHOOSE_RESULT_OFFSET, true), ABI_VERSION);
  assert.equal(maximumView.getUint32(CHOOSE_RESULT_OFFSET + 4, true), 32);
  assert.ok(maximumView.getUint32(CHOOSE_RESULT_OFFSET + 8, true) <= 1);
  assert.equal(maximumView.getUint32(CHOOSE_RESULT_OFFSET + 12, true), 2);
  for (let offset = 0; offset < 16; offset += 4) {
    assert.ok(
      Number.isFinite(
        maximumView.getFloat32(CHOOSE_SCORES_OFFSET + offset, true),
      ),
      "maximum-strength checker scores are finite",
    );
  }
  assert.equal(readError(module, arena, CHOOSE_ERROR_OFFSET), "");

  callAndAssertCube(module, arena);

  currentBytes(module, arena).fill(
    0xa5,
    CHOOSE_ERROR_OFFSET,
    CHOOSE_ERROR_OFFSET + 256,
  );
  assert.equal(
    module._bgc_wasm_reset(
      arena,
      ARENA_SIZE,
      CHOOSE_ERROR_OFFSET,
    ),
    STATUS_OK,
  );
  assert.equal(readError(module, arena, CHOOSE_ERROR_OFFSET), "");

  module._bgc_wasm_dispose();
  module._bgc_wasm_dispose();

  assert.equal(callChoose(module, arena), STATUS_NOT_READY);
  const bytes = currentBytes(module, arena);
  const view = currentView(module, arena);
  assert.equal(view.getUint32(CHOOSE_RESULT_OFFSET, true), ABI_VERSION);
  assert.equal(view.getUint32(CHOOSE_RESULT_OFFSET + 4, true), 32);
  assert.equal(view.getUint32(CHOOSE_RESULT_OFFSET + 8, true), 0);
  assert.equal(view.getUint32(CHOOSE_RESULT_OFFSET + 12, true), 0);
  assertZero(
    bytes.subarray(
      CHOOSE_SCORES_OFFSET,
      CHOOSE_SCORES_OFFSET + 16,
    ),
    "not-ready checker scores are zero",
  );
  assert.equal(
    readError(module, arena, CHOOSE_ERROR_OFFSET),
    "engine is not initialized",
  );
} finally {
  module._bgc_wasm_dispose();
  module._bgc_wasm_free(arena);
}

const memoryBytes = module.HEAPU8.buffer.byteLength;
assert.ok(memoryBytes >= 33_554_432);
assert.ok(memoryBytes <= 134_217_728);

console.log(
  "Real GNUbg wasm checker (including two-ply), cube, cache-OOM, lifecycle, and fresh-module tests passed",
);
console.log(
  `Local Node timings: failed-module sequence ${(
    performance.now() - invalidModuleStart
  ).toFixed(1)} ms; valid module instantiation ${validInstantiation.milliseconds.toFixed(1)} ms; engine initialization ${engineInitializationMilliseconds.toFixed(1)} ms; memory ${memoryBytes} bytes`,
);
