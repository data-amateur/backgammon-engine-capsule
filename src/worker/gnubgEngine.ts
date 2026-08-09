/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  BEP_RUNTIME_LIMITS,
  BEP_VERSION,
  type BepBoard,
  type BepCheckerLocation,
  type BepChooseTurnRequest,
  type BepChooseTurnResult,
  type BepCubeDecision,
  type BepCubeDecisionRequest,
  type BepCubeDecisionResult,
  type BepEngineError,
  type BepEngineMetadata,
  type BepHelloRequest,
  type BepHelloResult,
  type BepPosition,
  type BepStrengthPreset,
  type Player,
} from "../protocol/types";

export interface GnubgAssetUrls {
  readonly moduleUrl: string;
  readonly wasmUrl: string;
  readonly dataUrl: string;
}

export interface GnubgWasmModule {
  HEAPU8: Uint8Array;
  _malloc(byteSize: number): number;
  _free(pointer: number): void;
  _bgc_wasm_abi_version(): number;
  _bgc_wasm_abi_descriptor_size(): number;
  _bgc_wasm_get_abi_descriptor(pointer: number, byteSize: number): number;
  _bgc_wasm_alloc(byteSize: number): number;
  _bgc_wasm_free(pointer: number): void;
  _bgc_wasm_init(
    arena: number,
    arenaSize: number,
    requestOffset: number,
    errorOffset: number,
  ): number;
  _bgc_wasm_choose_turn(
    arena: number,
    arenaSize: number,
    requestOffset: number,
    resultOffset: number,
    errorOffset: number,
  ): number;
  _bgc_wasm_decide_cube(
    arena: number,
    arenaSize: number,
    requestOffset: number,
    resultOffset: number,
    errorOffset: number,
  ): number;
  _bgc_wasm_reset(
    arena: number,
    arenaSize: number,
    errorOffset: number,
  ): number;
  _bgc_wasm_dispose(): void;
}

export type GnubgModuleFactory = (options: {
  readonly locateFile: (file: string) => string;
}) => Promise<GnubgWasmModule>;

export type GnubgModuleFactoryLoader = (
  moduleUrl: string,
) => Promise<GnubgModuleFactory>;

export class GnubgEngineError extends Error {
  public readonly bepError: BepEngineError;
  public readonly fatal: boolean;

  public constructor(
    bepError: BepEngineError,
    fatal: boolean,
    cause?: unknown,
  ) {
    super(bepError.message, cause === undefined ? undefined : { cause });
    this.name = "GnubgEngineError";
    this.bepError = bepError;
    this.fatal = fatal;
  }
}

const ABI_VERSION = 0x0001_0000;
const ABI_DESCRIPTOR_SIZE = 128;
const ABI_ENDIANNESS_MARKER = 0x0102_0304;
const ARENA_SIZE = 512 * 1024;
const ERROR_SIZE = 256;
const CHOOSE_REQUEST_SIZE = 176;
const CANDIDATE_SIZE = 104;
const SCORE_SIZE = 8;
const CHOOSE_RESULT_SIZE = 32;
const CUBE_REQUEST_SIZE = 192;
const CUBE_RESULT_SIZE = 64;
const INIT_REQUEST_SIZE = 32;
const INIT_ERROR_OFFSET = INIT_REQUEST_SIZE;
const INIT_WEIGHTS_OFFSET = INIT_ERROR_OFFSET + ERROR_SIZE;
const WEIGHTS_PATH = "/gnubg/gnubg.weights";
const MATCH_EQUITY_PATH = "/gnubg/met/Kazaross-XG2.xml";
const STATUS_OK = 0;

const EXPECTED_DESCRIPTOR_FIELDS: readonly (readonly [number, number])[] = [
  [0, ABI_VERSION],
  [4, ABI_DESCRIPTOR_SIZE],
  [8, ABI_ENDIANNESS_MARKER],
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
  [52, CANDIDATE_SIZE],
  [56, 16],
  [60, SCORE_SIZE],
  [64, ERROR_SIZE],
  [68, INIT_REQUEST_SIZE],
  [72, CHOOSE_REQUEST_SIZE],
  [76, CHOOSE_RESULT_SIZE],
  [80, CUBE_REQUEST_SIZE],
  [84, CUBE_RESULT_SIZE],
];

const PLAYER = { white: 0, black: 1 } as const;
const CUBE_STATE = {
  available: 0,
  offered: 1,
  accepted: 2,
  declined: 3,
} as const;
const MATCH_MODE = { money: 0, match: 1 } as const;
const CRAWFORD = {
  none: 0,
  crawford: 1,
  "post-crawford": 2,
} as const;
const LOCATION = { point: 0, bar: 1, "borne-off": 2 } as const;
const STRENGTH: Readonly<Record<BepStrengthPreset, number>> = {
  beginner: 0,
  casual: 1,
  intermediate: 2,
  expert: 3,
  maximum: 4,
};
const CUBE_ACTION: Readonly<Record<BepCubeDecision, number>> = {
  double: 0,
  "no-double": 1,
  "too-good": 2,
  take: 3,
  pass: 4,
  beaver: 5,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function safeBuildId(value: string | undefined): string {
  return value && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    ? value
    : "gnubg-1.08.003-wasm-abi1";
}

function optionalWebUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return !url.username && !url.password &&
      (url.protocol === "https:" || url.protocol === "http:")
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

const sourceUrl = optionalWebUrl(import.meta.env.VITE_SOURCE_URL) ??
  "https://github.com/data-amateur/backgammon-engine-capsule";
const licenseUrl = optionalWebUrl(import.meta.env.VITE_LICENSE_URL) ??
  "https://github.com/data-amateur/backgammon-engine-capsule/blob/main/LICENSES/GPL-3.0-or-later.txt";

export const GNUBG_ENGINE_METADATA: BepEngineMetadata = {
  engineId: "gnubg-capsule",
  name: "GNU Backgammon",
  version: "1.08.003",
  buildId: safeBuildId(import.meta.env.VITE_BUILD_ID),
  protocolVersions: [BEP_VERSION],
  license: {
    spdxId: "GPL-3.0-or-later",
    name: "GNU General Public License v3.0 or later",
    sourceUrl,
    licenseUrl,
  },
  runtime: {
    transport: "iframe",
    approximateDownloadBytes: 1_367_862,
    approximateMemoryBytes: 33_554_432,
  },
  capabilities: {
    chooseTurn: true,
    cubeOffer: true,
    cubeResponse: true,
    positionEvaluation: false,
    moveRanking: true,
    rollout: false,
    matchPlay: true,
    moneyPlay: true,
    cancellation: true,
    deterministic: true,
    variations: ["standard"],
    strengthPresets: [
      "beginner",
      "casual",
      "intermediate",
      "expert",
      "maximum",
    ],
  },
};

async function defaultFactoryLoader(
  moduleUrl: string,
): Promise<GnubgModuleFactory> {
  const namespace: unknown = await import(moduleUrl);
  if (
    typeof namespace !== "object" ||
    namespace === null ||
    !("default" in namespace) ||
    typeof namespace.default !== "function"
  ) {
    throw new Error("GNUbg module did not export a default factory");
  }
  return namespace.default as GnubgModuleFactory;
}

function engineError(
  code: BepEngineError["code"],
  message: string,
  retryable: boolean,
  fatal: boolean,
  cause?: unknown,
  details?: BepEngineError["details"],
): GnubgEngineError {
  return new GnubgEngineError(
    { code, message, retryable, ...(details ? { details } : {}) },
    fatal,
    cause,
  );
}

function assetError(message: string, cause?: unknown): GnubgEngineError {
  return engineError("asset-load-failed", message, true, true, cause);
}

function fatalError(message: string, cause?: unknown): GnubgEngineError {
  return engineError("engine-crash", message, true, true, cause);
}

function assertAbsoluteAssetUrl(value: string, label: string): void {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && url.protocol !== "http:")
    ) {
      throw new Error("unsupported URL");
    }
  } catch (cause) {
    throw assetError(`${label} must be an absolute HTTP(S) URL`, cause);
  }
}

function currentView(
  module: GnubgWasmModule,
  pointer: number,
  size: number,
): DataView {
  if (
    !Number.isInteger(pointer) ||
    pointer <= 0 ||
    !Number.isInteger(size) ||
    size <= 0 ||
    pointer + size > module.HEAPU8.byteLength
  ) {
    throw fatalError("GNUbg exposed an invalid WebAssembly memory range");
  }
  return new DataView(
    module.HEAPU8.buffer,
    module.HEAPU8.byteOffset + pointer,
    size,
  );
}

function verifyDescriptor(module: GnubgWasmModule): void {
  if (
    module._bgc_wasm_abi_version() !== ABI_VERSION ||
    module._bgc_wasm_abi_descriptor_size() !== ABI_DESCRIPTOR_SIZE
  ) {
    throw engineError(
      "version-mismatch",
      "GNUbg WebAssembly ABI version is not supported",
      false,
      true,
    );
  }
  const pointer = module._malloc(ABI_DESCRIPTOR_SIZE);
  if (!pointer) {
    throw fatalError("Could not allocate the GNUbg ABI descriptor");
  }
  try {
    if (
      module._bgc_wasm_get_abi_descriptor(pointer, ABI_DESCRIPTOR_SIZE) !==
      STATUS_OK
    ) {
      throw engineError(
        "version-mismatch",
        "GNUbg WebAssembly ABI descriptor could not be read",
        false,
        true,
      );
    }
    const view = currentView(module, pointer, ABI_DESCRIPTOR_SIZE);
    for (const [offset, expected] of EXPECTED_DESCRIPTOR_FIELDS) {
      if (view.getUint32(offset, true) !== expected) {
        throw engineError(
          "version-mismatch",
          `GNUbg WebAssembly ABI descriptor differs at byte ${offset}`,
          false,
          true,
        );
      }
    }
    for (let offset = 88; offset < ABI_DESCRIPTOR_SIZE; offset += 4) {
      if (view.getUint32(offset, true) !== 0) {
        throw engineError(
          "version-mismatch",
          "GNUbg WebAssembly ABI descriptor has nonzero reserved fields",
          false,
          true,
        );
      }
    }
  } finally {
    module._free(pointer);
  }
}

function readNativeError(
  module: GnubgWasmModule,
  arena: number,
  offset: number,
): string {
  const view = currentView(module, arena, offset + ERROR_SIZE);
  const bytes = new Uint8Array(ERROR_SIZE);
  for (let index = 0; index < ERROR_SIZE; index += 1) {
    bytes[index] = view.getUint8(offset + index);
  }
  const terminator = bytes.indexOf(0);
  if (terminator < 0) {
    throw fatalError("GNUbg returned an unterminated error message");
  }
  try {
    return decoder.decode(bytes.subarray(0, terminator)).trim();
  } catch (cause) {
    throw fatalError("GNUbg returned an invalid UTF-8 error message", cause);
  }
}

function mappedStatusError(
  status: number,
  nativeMessage: string,
): GnubgEngineError {
  const fallback = `GNUbg call failed with status ${status}`;
  const message = nativeMessage || fallback;
  const details = { wasmStatus: status } as const;
  switch (status) {
    case 1:
      return engineError("invalid-request", message, false, false, undefined, details);
    case 2:
      return engineError("invalid-position", message, false, false, undefined, details);
    case 3:
      return engineError("illegal-turn", message, false, false, undefined, details);
    case 4:
      return engineError("not-ready", message, true, true, undefined, details);
    case 5:
      return engineError("asset-load-failed", message, true, true, undefined, details);
    case 6:
      return engineError("internal-error", message, true, false, undefined, details);
    case 7:
      return engineError("unsupported", message, false, false, undefined, details);
    default:
      return engineError("engine-crash", message, true, true, undefined, details);
  }
}

function writePosition(view: DataView, offset: number, position: BepPosition): void {
  if (position.rules.variation !== "standard") {
    throw engineError(
      "unsupported",
      `GNUbg does not support variation ${position.rules.variation}`,
      false,
      false,
    );
  }
  position.board.points.forEach((point, index) => {
    view.setUint8(offset + index * 2, point.white);
    view.setUint8(offset + index * 2 + 1, point.black);
  });
  view.setUint8(offset + 48, position.board.bar.white);
  view.setUint8(offset + 49, position.board.bar.black);
  view.setUint8(offset + 50, position.board.borneOff.white);
  view.setUint8(offset + 51, position.board.borneOff.black);
  view.setUint32(offset + 52, PLAYER[position.playerOnRoll], true);
  view.setUint32(offset + 56, position.dice[0] ?? 0, true);
  view.setUint32(offset + 60, position.dice[1] ?? 0, true);
  view.setInt32(offset + 64, position.cube.value, true);
  view.setInt32(
    offset + 68,
    position.cube.owner === null ? -1 : PLAYER[position.cube.owner],
    true,
  );
  view.setUint32(offset + 72, CUBE_STATE[position.cube.state], true);
  view.setInt32(
    offset + 76,
    position.cube.offeredBy === null ? -1 : PLAYER[position.cube.offeredBy],
    true,
  );
  view.setUint32(offset + 80, MATCH_MODE[position.match.mode], true);
  view.setInt32(offset + 84, position.match.length ?? 0, true);
  view.setUint32(offset + 88, position.match.score.white, true);
  view.setUint32(offset + 92, position.match.score.black, true);
  view.setUint32(offset + 96, CRAWFORD[position.match.crawford], true);
  view.setUint32(offset + 100, 0, true);
  view.setUint32(offset + 104, position.rules.jacoby ? 1 : 0, true);
  view.setUint32(offset + 108, position.rules.beavers ? 1 : 0, true);
  view.setUint32(offset + 112, position.rules.raccoons ? 1 : 0, true);
  view.setUint32(offset + 116, position.rules.automaticDoubles, true);
}

function writeLocation(
  view: DataView,
  offset: number,
  location: BepCheckerLocation,
): void {
  view.setUint32(offset, LOCATION[location.kind], true);
  view.setInt32(offset + 4, location.kind === "point" ? location.point : 0, true);
}

type MutableCounts = { white: number; black: number };
type MutableBoard = {
  points: MutableCounts[];
  bar: MutableCounts;
  borneOff: MutableCounts;
};

function cloneBoard(board: BepBoard): MutableBoard {
  return {
    points: board.points.map(({ white, black }) => ({ white, black })),
    bar: { ...board.bar },
    borneOff: { ...board.borneOff },
  };
}

function boardsEqual(left: MutableBoard, right: BepBoard): boolean {
  return left.bar.white === right.bar.white &&
    left.bar.black === right.bar.black &&
    left.borneOff.white === right.borneOff.white &&
    left.borneOff.black === right.borneOff.black &&
    left.points.every(
      (point, index) =>
        point.white === right.points[index]?.white &&
        point.black === right.points[index]?.black,
    );
}

function replayTurn(
  board: BepBoard,
  player: Player,
  steps: BepChooseTurnRequest["legalTurns"][number]["steps"],
): MutableBoard {
  const replayed = cloneBoard(board);
  const opponent: Player = player === "white" ? "black" : "white";
  for (const step of steps) {
    const source = step.from.kind === "point"
      ? replayed.points[step.from.point]
      : step.from.kind === "bar"
        ? replayed.bar
        : undefined;
    if (!source || source[player] < 1) {
      throw engineError("illegal-turn", "A legal turn has no checker at its source", false, false);
    }
    source[player] -= 1;
    if (step.to.kind === "point") {
      const destination = replayed.points[step.to.point];
      if (!destination) {
        throw engineError("illegal-turn", "A legal turn has an invalid destination", false, false);
      }
      if (step.hit) {
        if (destination[opponent] !== 1) {
          throw engineError("illegal-turn", "A legal turn has an inconsistent hit flag", false, false);
        }
        destination[opponent] = 0;
        replayed.bar[opponent] += 1;
      } else if (destination[opponent] !== 0) {
        throw engineError("illegal-turn", "A legal turn lands on an occupied point", false, false);
      }
      destination[player] += 1;
    } else if (step.to.kind === "borne-off") {
      replayed.borneOff[player] += 1;
    } else {
      throw engineError("illegal-turn", "A legal turn moves a checker to the bar", false, false);
    }
  }
  return replayed;
}

function verifyResultingBoards(request: BepChooseTurnRequest): void {
  for (const turn of request.legalTurns) {
    if (
      turn.resultingBoard &&
      !boardsEqual(
        replayTurn(request.position.board, request.enginePlayer, turn.steps),
        turn.resultingBoard,
      )
    ) {
      throw engineError(
        "illegal-turn",
        `Legal turn ${turn.id} does not produce its declared resulting board`,
        false,
        false,
      );
    }
  }
}

function elapsedSince(startedAt: number): number {
  return Number.isFinite(startedAt)
    ? Math.max(0, performance.now() - startedAt)
    : 0;
}

function cleanupModule(module: GnubgWasmModule, arena: number): void {
  try {
    module._bgc_wasm_dispose();
  } catch {
    // Terminating the Worker releases an already-aborted module.
  }
  if (arena) {
    try {
      module._bgc_wasm_free(arena);
    } catch {
      // Terminating the Worker releases an already-aborted module.
    }
  }
}

export class GnubgEngine {
  private arena: number;
  private disposed = false;
  private terminal = false;

  private constructor(
    private readonly module: GnubgWasmModule,
    arena: number,
  ) {
    this.arena = arena;
  }

  public static async create(
    assets: GnubgAssetUrls,
    factoryLoader: GnubgModuleFactoryLoader = defaultFactoryLoader,
  ): Promise<GnubgEngine> {
    assertAbsoluteAssetUrl(assets.moduleUrl, "GNUbg module URL");
    assertAbsoluteAssetUrl(assets.wasmUrl, "GNUbg WebAssembly URL");
    assertAbsoluteAssetUrl(assets.dataUrl, "GNUbg data URL");

    let factory: GnubgModuleFactory;
    try {
      factory = await factoryLoader(assets.moduleUrl);
    } catch (cause) {
      if (cause instanceof GnubgEngineError) {
        throw cause;
      }
      throw assetError("Could not load the GNUbg module factory", cause);
    }

    let module: GnubgWasmModule;
    try {
      module = await factory({
        locateFile: (file) => {
          if (file === "gnubg-wasm.wasm") {
            return assets.wasmUrl;
          }
          if (file === "gnubg-wasm.data") {
            return assets.dataUrl;
          }
          throw new Error(`Unexpected GNUbg asset requested: ${file}`);
        },
      });
    } catch (cause) {
      throw assetError("Could not instantiate the GNUbg WebAssembly module", cause);
    }

    let arena = 0;
    try {
      verifyDescriptor(module);
      arena = module._bgc_wasm_alloc(ARENA_SIZE);
      if (!arena) {
        throw fatalError("Could not allocate the GNUbg request arena");
      }
      const engine = new GnubgEngine(module, arena);
      engine.initialize();
      return engine;
    } catch (cause) {
      cleanupModule(module, arena);
      if (cause instanceof GnubgEngineError) {
        throw cause;
      }
      throw fatalError("GNUbg initialization crashed", cause);
    }
  }

  public hello(request: BepHelloRequest): BepHelloResult {
    this.assertUsable();
    if (!request.supportedProtocolVersions.includes(BEP_VERSION)) {
      throw engineError("unsupported", "BEP v1 is not supported by the host", false, false);
    }
    return { selectedProtocolVersion: BEP_VERSION, metadata: GNUBG_ENGINE_METADATA };
  }

  public chooseTurn(
    request: BepChooseTurnRequest,
    startedAt = performance.now(),
  ): BepChooseTurnResult {
    this.assertUsable();
    const count = request.legalTurns.length;
    if (count < 1 || count > BEP_RUNTIME_LIMITS.maxLegalTurns) {
      throw engineError("invalid-request", "Checker candidate count is outside the BEP limit", false, false);
    }
    verifyResultingBoards(request);
    const candidatesOffset = CHOOSE_REQUEST_SIZE;
    const scoresOffset = candidatesOffset + count * CANDIDATE_SIZE;
    const resultOffset = scoresOffset + count * SCORE_SIZE;
    const errorOffset = resultOffset + CHOOSE_RESULT_SIZE;
    const usedSize = errorOffset + ERROR_SIZE;
    if (usedSize > ARENA_SIZE) {
      throw engineError("invalid-request", "Checker request exceeds the GNUbg arena", false, false);
    }

    const before = currentView(this.module, this.arena, usedSize);
    new Uint8Array(before.buffer, before.byteOffset, usedSize).fill(0);
    before.setUint32(0, ABI_VERSION, true);
    before.setUint32(4, CHOOSE_REQUEST_SIZE, true);
    writePosition(before, 8, request.position);
    before.setUint32(128, candidatesOffset, true);
    before.setUint32(132, count, true);
    before.setUint32(136, scoresOffset, true);
    before.setUint32(140, count, true);
    before.setUint32(144, STRENGTH[request.settings.strength], true);
    request.legalTurns.forEach((turn, candidateIndex) => {
      const candidateOffset = candidatesOffset + candidateIndex * CANDIDATE_SIZE;
      before.setUint32(candidateOffset, turn.steps.length, true);
      turn.steps.forEach((step, stepIndex) => {
        const stepOffset = candidateOffset + 8 + stepIndex * 24;
        writeLocation(before, stepOffset, step.from);
        writeLocation(before, stepOffset + 8, step.to);
        before.setUint32(stepOffset + 16, step.die, true);
        before.setUint32(stepOffset + 20, step.hit ? 1 : 0, true);
      });
    });

    let status: number;
    try {
      status = this.module._bgc_wasm_choose_turn(
        this.arena,
        usedSize,
        0,
        resultOffset,
        errorOffset,
      );
    } catch (cause) {
      this.terminal = true;
      throw fatalError("GNUbg checker evaluation crashed", cause);
    }
    const nativeMessage = readNativeError(this.module, this.arena, errorOffset);
    if (status !== STATUS_OK) {
      const error = mappedStatusError(status, nativeMessage);
      this.terminal ||= error.fatal;
      throw error;
    }

    const after = currentView(this.module, this.arena, usedSize);
    this.verifyHeader(after, resultOffset, CHOOSE_RESULT_SIZE, "checker result");
    const selectedIndex = after.getUint32(resultOffset + 8, true);
    const scoreCount = after.getUint32(resultOffset + 12, true);
    if (selectedIndex >= count || scoreCount !== count) {
      this.failIntegrity("GNUbg returned invalid checker result indices");
    }
    this.verifyZeroWords(after, resultOffset + 16, 4, "checker result");
    const scores = request.legalTurns.map((turn, index) => {
      const offset = scoresOffset + index * SCORE_SIZE;
      const score = after.getFloat32(offset, true);
      const cubeless = after.getFloat32(offset + 4, true);
      if (!Number.isFinite(score) || !Number.isFinite(cubeless)) {
        this.failIntegrity("GNUbg returned a non-finite checker score");
      }
      return { index, turnId: turn.id, score, cubeless };
    });
    const ranked = [...scores].sort(
      (left, right) =>
        right.score - left.score ||
        right.cubeless - left.cubeless ||
        left.index - right.index,
    );
    if (ranked[0]?.index !== selectedIndex) {
      this.failIntegrity("GNUbg checker selection disagrees with its scores");
    }
    const rankingLimit = Math.min(
      count,
      request.settings.limits.candidateLimit ?? count,
    );
    return {
      positionRevision: request.position.revision,
      chosenTurnId: request.legalTurns[selectedIndex]?.id ?? "",
      rankedTurns: ranked.slice(0, rankingLimit).map((entry, index) => ({
        turnId: entry.turnId,
        rank: index + 1,
        score: entry.score,
      })),
      stats: { elapsedMs: elapsedSince(startedAt), completed: true },
    };
  }

  public decideCube(
    request: BepCubeDecisionRequest,
    startedAt = performance.now(),
  ): BepCubeDecisionResult {
    this.assertUsable();
    const count = request.legalDecisions.length;
    if (count < 1 || count > 6) {
      throw engineError("invalid-request", "Cube action count is outside the ABI limit", false, false);
    }
    const resultOffset = CUBE_REQUEST_SIZE;
    const errorOffset = resultOffset + CUBE_RESULT_SIZE;
    const usedSize = errorOffset + ERROR_SIZE;
    const before = currentView(this.module, this.arena, usedSize);
    new Uint8Array(before.buffer, before.byteOffset, usedSize).fill(0);
    before.setUint32(0, ABI_VERSION, true);
    before.setUint32(4, CUBE_REQUEST_SIZE, true);
    writePosition(before, 8, request.position);
    before.setUint32(128, request.phase === "consider-offer" ? 0 : 1, true);
    before.setUint32(132, PLAYER[request.enginePlayer], true);
    before.setUint32(136, count, true);
    request.legalDecisions.forEach((decision, index) => {
      before.setUint32(140 + index * 4, CUBE_ACTION[decision], true);
    });
    before.setUint32(164, STRENGTH[request.settings.strength], true);

    let status: number;
    try {
      status = this.module._bgc_wasm_decide_cube(
        this.arena,
        usedSize,
        0,
        resultOffset,
        errorOffset,
      );
    } catch (cause) {
      this.terminal = true;
      throw fatalError("GNUbg cube evaluation crashed", cause);
    }
    const nativeMessage = readNativeError(this.module, this.arena, errorOffset);
    if (status !== STATUS_OK) {
      const error = mappedStatusError(status, nativeMessage);
      this.terminal ||= error.fatal;
      throw error;
    }

    const after = currentView(this.module, this.arena, usedSize);
    this.verifyHeader(after, resultOffset, CUBE_RESULT_SIZE, "cube result");
    const decision = after.getUint32(resultOffset + 8, true);
    const selectedIndex = after.getUint32(resultOffset + 12, true);
    const evaluated = after.getUint32(resultOffset + 16, true);
    if (
      selectedIndex >= count ||
      decision !== CUBE_ACTION[request.legalDecisions[selectedIndex] as BepCubeDecision] ||
      (evaluated !== 0 && evaluated !== 1) ||
      after.getUint32(resultOffset + 20, true) !== 0
    ) {
      this.failIntegrity("GNUbg returned an invalid cube result");
    }
    for (let offset = 24; offset <= 40; offset += 4) {
      const equity = after.getFloat32(resultOffset + offset, true);
      if ((evaluated === 1 && !Number.isFinite(equity)) || (evaluated === 0 && equity !== 0)) {
        this.failIntegrity("GNUbg returned invalid cube equities");
      }
    }
    this.verifyZeroWords(after, resultOffset + 44, 5, "cube result");
    return {
      positionRevision: request.position.revision,
      decision: request.legalDecisions[selectedIndex] as BepCubeDecision,
      stats: { elapsedMs: elapsedSince(startedAt), completed: true },
    };
  }

  public reset(): void {
    this.assertUsable();
    const before = currentView(this.module, this.arena, ERROR_SIZE);
    new Uint8Array(before.buffer, before.byteOffset, ERROR_SIZE).fill(0);
    let status: number;
    try {
      status = this.module._bgc_wasm_reset(this.arena, ERROR_SIZE, 0);
    } catch (cause) {
      this.terminal = true;
      throw fatalError("GNUbg reset crashed", cause);
    }
    const nativeMessage = readNativeError(this.module, this.arena, 0);
    if (status !== STATUS_OK) {
      const error = mappedStatusError(status, nativeMessage);
      this.terminal ||= error.fatal;
      throw error;
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    cleanupModule(this.module, this.arena);
    this.arena = 0;
  }

  private initialize(): void {
    const weights = encoder.encode(WEIGHTS_PATH);
    const equity = encoder.encode(MATCH_EQUITY_PATH);
    const equityOffset = INIT_WEIGHTS_OFFSET + weights.length;
    const usedSize = equityOffset + equity.length;
    const before = currentView(this.module, this.arena, usedSize);
    new Uint8Array(before.buffer, before.byteOffset, usedSize).fill(0);
    before.setUint32(0, ABI_VERSION, true);
    before.setUint32(4, INIT_REQUEST_SIZE, true);
    before.setUint32(8, INIT_WEIGHTS_OFFSET, true);
    before.setUint32(12, weights.length, true);
    before.setUint32(16, equityOffset, true);
    before.setUint32(20, equity.length, true);
    new Uint8Array(before.buffer, before.byteOffset + INIT_WEIGHTS_OFFSET, weights.length).set(weights);
    new Uint8Array(before.buffer, before.byteOffset + equityOffset, equity.length).set(equity);
    let status: number;
    try {
      status = this.module._bgc_wasm_init(
        this.arena,
        usedSize,
        0,
        INIT_ERROR_OFFSET,
      );
    } catch (cause) {
      throw fatalError("GNUbg initialization crashed", cause);
    }
    const nativeMessage = readNativeError(this.module, this.arena, INIT_ERROR_OFFSET);
    if (status !== STATUS_OK) {
      throw mappedStatusError(status, nativeMessage);
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw engineError("disposed", "GNUbg engine is disposed", false, true);
    }
    if (this.terminal) {
      throw fatalError("GNUbg engine requires a fresh Worker");
    }
  }

  private verifyHeader(
    view: DataView,
    offset: number,
    size: number,
    label: string,
  ): void {
    if (
      view.getUint32(offset, true) !== ABI_VERSION ||
      view.getUint32(offset + 4, true) !== size
    ) {
      this.failIntegrity(`GNUbg returned an invalid ${label} header`);
    }
  }

  private verifyZeroWords(
    view: DataView,
    offset: number,
    count: number,
    label: string,
  ): void {
    for (let index = 0; index < count; index += 1) {
      if (view.getUint32(offset + index * 4, true) !== 0) {
        this.failIntegrity(`GNUbg returned nonzero reserved ${label} fields`);
      }
    }
  }

  private failIntegrity(message: string): never {
    this.terminal = true;
    throw fatalError(message);
  }
}
