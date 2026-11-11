/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type {
  BepAnalyzeCubeRequest,
  BepAnalyzeCheckerRequest,
  BepChooseTurnRequest,
  BepCubeDecisionRequest,
} from "../../src/protocol/types";
import {
  GNUBG_ENGINE_METADATA,
  GnubgEngine,
  GnubgEngineError,
  type GnubgAssetUrls,
  type GnubgModuleFactory,
  type GnubgWasmModule,
} from "../../src/worker/gnubgEngine";
import {
  createBoard,
  createChooseRequest,
  createCubeRequest,
  createPosition,
  settings,
} from "./fixtures";

const ABI_VERSION = 0x0001_0000;
const ARENA_SIZE = 512 * 1024;
const ASSETS: GnubgAssetUrls = {
  moduleUrl: "https://capsule.test/assets/gnubg-wasm.mjs",
  wasmUrl: "https://capsule.test/assets/gnubg-wasm.wasm",
  dataUrl: "https://capsule.test/assets/gnubg-wasm.data",
};

const DESCRIPTOR_FIELDS: readonly (readonly [number, number])[] = [
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

interface WasmCall {
  readonly arena: number;
  readonly arenaSize: number;
  readonly requestOffset?: number;
  readonly resultOffset?: number;
  readonly errorOffset: number;
}

class FakeGnubgModule implements GnubgWasmModule {
  public HEAPU8 = new Uint8Array(2 * 1024 * 1024);
  public readonly descriptorPointer = 64;
  public readonly arenaPointer = 4096;
  public descriptorOverrides = new Map<number, number>();
  public initStatus = 0;
  public chooseStatus = 0;
  public cubeStatus = 0;
  public resetStatus = 0;
  public initError = "";
  public chooseError = "";
  public cubeError = "";
  public resetError = "";
  public chooseSelectedIndex = 0;
  public chooseScores: readonly (readonly [number, number])[] | undefined;
  public cubeSelectedIndex = 0;
  public cubeEvaluated = false;
  public cubeEquities: readonly number[] = [0, 0, 0, 0, 0];
  public replaceHeapOnChoose = false;
  public replaceHeapOnCube = false;
  public readonly initCalls: WasmCall[] = [];
  public readonly chooseCalls: WasmCall[] = [];
  public readonly cubeCalls: WasmCall[] = [];
  public readonly resetCalls: WasmCall[] = [];
  public readonly freedPointers: number[] = [];
  public readonly rawFreedPointers: number[] = [];
  public allocatedArenaSize: number | undefined;
  public disposeCount = 0;
  public initSnapshot: Uint8Array | undefined;
  public chooseSnapshot: Uint8Array | undefined;
  public cubeSnapshot: Uint8Array | undefined;

  public _malloc = (): number => this.descriptorPointer;

  public _free = (pointer: number): void => {
    this.rawFreedPointers.push(pointer);
  };

  public _bgc_wasm_abi_version = (): number => ABI_VERSION;

  public _bgc_wasm_abi_descriptor_size = (): number => 128;

  public _bgc_wasm_get_abi_descriptor = (
    pointer: number,
    byteSize: number,
  ): number => {
    if (pointer !== this.descriptorPointer || byteSize !== 128) {
      return 1;
    }
    const view = this.view(pointer, byteSize);
    new Uint8Array(view.buffer, view.byteOffset, byteSize).fill(0);
    for (const [offset, value] of DESCRIPTOR_FIELDS) {
      view.setUint32(
        offset,
        this.descriptorOverrides.get(offset) ?? value,
        true,
      );
    }
    return 0;
  };

  public _bgc_wasm_alloc = (byteSize: number): number => {
    this.allocatedArenaSize = byteSize;
    return this.arenaPointer;
  };

  public _bgc_wasm_free = (pointer: number): void => {
    this.freedPointers.push(pointer);
  };

  public _bgc_wasm_init = (
    arena: number,
    arenaSize: number,
    requestOffset: number,
    errorOffset: number,
  ): number => {
    this.initCalls.push({ arena, arenaSize, requestOffset, errorOffset });
    this.initSnapshot = this.HEAPU8.slice(arena, arena + arenaSize);
    this.writeError(arena, errorOffset, this.initError);
    return this.initStatus;
  };

  public _bgc_wasm_choose_turn = (
    arena: number,
    arenaSize: number,
    requestOffset: number,
    resultOffset: number,
    errorOffset: number,
  ): number => {
    this.chooseCalls.push({
      arena,
      arenaSize,
      requestOffset,
      resultOffset,
      errorOffset,
    });
    this.chooseSnapshot = this.HEAPU8.slice(arena, arena + arenaSize);
    const request = this.view(arena, arenaSize);
    const candidateCount = request.getUint32(requestOffset + 132, true);
    const scoresOffset = request.getUint32(requestOffset + 136, true);
    if (this.replaceHeapOnChoose) {
      this.replaceHeap();
    }
    this.writeError(arena, errorOffset, this.chooseError);
    if (this.chooseStatus === 0) {
      const result = this.view(arena, arenaSize);
      result.setUint32(resultOffset, ABI_VERSION, true);
      result.setUint32(resultOffset + 4, 32, true);
      result.setUint32(resultOffset + 8, this.chooseSelectedIndex, true);
      result.setUint32(resultOffset + 12, candidateCount, true);
      for (let index = 0; index < candidateCount; index += 1) {
        const score = this.chooseScores?.[index] ?? [-index, -index];
        result.setFloat32(scoresOffset + index * 8, score[0], true);
        result.setFloat32(scoresOffset + index * 8 + 4, score[1], true);
      }
    }
    return this.chooseStatus;
  };

  public _bgc_wasm_decide_cube = (
    arena: number,
    arenaSize: number,
    requestOffset: number,
    resultOffset: number,
    errorOffset: number,
  ): number => {
    this.cubeCalls.push({
      arena,
      arenaSize,
      requestOffset,
      resultOffset,
      errorOffset,
    });
    this.cubeSnapshot = this.HEAPU8.slice(arena, arena + arenaSize);
    const request = this.view(arena, arenaSize);
    const decision = request.getUint32(
      requestOffset + 140 + this.cubeSelectedIndex * 4,
      true,
    );
    if (this.replaceHeapOnCube) {
      this.replaceHeap();
    }
    this.writeError(arena, errorOffset, this.cubeError);
    if (this.cubeStatus === 0) {
      const result = this.view(arena, arenaSize);
      result.setUint32(resultOffset, ABI_VERSION, true);
      result.setUint32(resultOffset + 4, 64, true);
      result.setUint32(resultOffset + 8, decision, true);
      result.setUint32(resultOffset + 12, this.cubeSelectedIndex, true);
      result.setUint32(resultOffset + 16, this.cubeEvaluated ? 1 : 0, true);
      if (this.cubeEvaluated) {
        this.cubeEquities.forEach((equity, index) => {
          result.setFloat32(resultOffset + 24 + index * 4, equity, true);
        });
      }
    }
    return this.cubeStatus;
  };

  public _bgc_wasm_reset = (
    arena: number,
    arenaSize: number,
    errorOffset: number,
  ): number => {
    this.resetCalls.push({ arena, arenaSize, errorOffset });
    this.writeError(arena, errorOffset, this.resetError);
    return this.resetStatus;
  };

  public _bgc_wasm_dispose = (): void => {
    this.disposeCount += 1;
  };

  public arenaView(size = ARENA_SIZE): DataView {
    return this.view(this.arenaPointer, size);
  }

  private view(pointer: number, byteSize: number): DataView {
    return new DataView(
      this.HEAPU8.buffer,
      this.HEAPU8.byteOffset + pointer,
      byteSize,
    );
  }

  private writeError(arena: number, offset: number, message: string): void {
    const output = this.HEAPU8.subarray(
      arena + offset,
      arena + offset + 256,
    );
    output.fill(0);
    output.set(new TextEncoder().encode(message).subarray(0, 255));
  }

  private replaceHeap(): void {
    const replacement = new Uint8Array(this.HEAPU8.byteLength * 2);
    replacement.set(this.HEAPU8);
    this.HEAPU8 = replacement;
  }
}

async function createEngine(
  module: FakeGnubgModule,
  inspectFactory?: (factory: Parameters<GnubgModuleFactory>[0]) => void,
): Promise<GnubgEngine> {
  return GnubgEngine.create(ASSETS, async (moduleUrl) => {
    expect(moduleUrl).toBe(ASSETS.moduleUrl);
    return async (options) => {
      inspectFactory?.(options);
      return module;
    };
  });
}

function snapshotView(snapshot: Uint8Array | undefined): DataView {
  expect(snapshot).toBeDefined();
  const present = snapshot as Uint8Array;
  return new DataView(
    present.buffer,
    present.byteOffset,
    present.byteLength,
  );
}

function expectEngineError(
  cause: unknown,
  code: BepEngineErrorCode,
  fatal: boolean,
): void {
  expect(cause).toBeInstanceOf(GnubgEngineError);
  const error = cause as GnubgEngineError;
  expect(error.bepError.code).toBe(code);
  expect(error.fatal).toBe(fatal);
}

type BepEngineErrorCode = GnubgEngineError["bepError"]["code"];

const terminalRequest = JSON.parse(readFileSync(
  new URL("../fixtures/bep-analysis-v1.json", import.meta.url), "utf8",
)).validHostMessages[0].payload as BepAnalyzeCheckerRequest;

async function createAnalysisEngine(options: {
  readonly corrupt?: (view: DataView, resultOffset: number, candidatesOffset: number) => void;
  readonly grow?: boolean;
  readonly badDescriptor?: boolean;
} = {}) {
  const module = new FakeGnubgModule();
  let snapshot: Uint8Array | undefined;
  Object.assign(module, {
    _bgc_wasm_analysis_descriptor_size: () => 64,
    _bgc_wasm_get_analysis_descriptor: (pointer: number, size: number) => {
      const view = new DataView(module.HEAPU8.buffer, pointer, size);
      const fields = [ABI_VERSION, 64, 0x01020304, 4, 312, 64, 152, 20, 4096, 5, 6, 0, 0, 0, 0, 0];
      fields.forEach((value, index) => view.setUint32(index * 4, value, true));
      if (options.badDescriptor) view.setUint32(24, 156, true);
      return 0;
    },
    _bgc_wasm_analyze_checker: (
      arena: number, size: number, requestOffset: number, resultOffset: number, errorOffset: number,
    ) => {
      snapshot = module.HEAPU8.slice(arena, arena + size);
      if (options.grow) {
        const next = new Uint8Array(module.HEAPU8.length * 2);
        next.set(module.HEAPU8);
        module.HEAPU8 = next;
      }
      const view = new DataView(module.HEAPU8.buffer, arena, size);
      const candidatesOffset = view.getUint32(requestOffset + 292, true);
      const steps = view.getUint32(requestOffset + 128, true);
      module.HEAPU8.fill(0, arena + candidatesOffset, arena + errorOffset + 256);
      // Independent terminal fixture: one forced single win at normalized +1.
      module.HEAPU8.copyWithin(arena + candidatesOffset, arena + requestOffset + 232, arena + requestOffset + 284);
      view.setUint32(candidatesOffset + 52, steps, true);
      for (let index = 0; index < steps; index++) {
        const from = requestOffset + 136 + index * 24;
        const to = candidatesOffset + 56 + index * 20;
        for (let field = 0; field < 16; field += 4)
          view.setUint32(to + field, view.getUint32(from + field, true), true);
        view.setUint32(to + 16, view.getUint32(from + 20, true), true);
      }
      view.setFloat32(candidatesOffset + 136, 1, true);
      view.setUint32(candidatesOffset + 140, 1, true);
      view.setUint32(candidatesOffset + 144, 1, true);
      const profile = view.getUint32(requestOffset + 284, true);
      const fields = [ABI_VERSION, 64, 1, 0, 1, 1, 1, steps === 0 ? 1 : 0, 0, profile === 2 ? 2 : 0, 1, 1, 0, profile === 2 ? 1 : 0, profile, 0];
      fields.forEach((value, index) => view.setUint32(resultOffset + index * 4, value, true));
      options.corrupt?.(view, resultOffset, candidatesOffset);
      return 0;
    },
  });
  const base = "https://capsule.test/engines/sha256-" + "0".repeat(64) + "/";
  const engine = await GnubgEngine.create({
    moduleUrl: base + "gnubg-wasm.mjs",
    wasmUrl: base + "gnubg-wasm.wasm",
    dataUrl: base + "gnubg-wasm.data",
  }, async () => async () => module);
  return { engine, module, snapshot: () => snapshot };
}

describe("analysis WASM decoding", () => {
  it("verifies the additive descriptor, exact layout, provenance and refreshed heap", async () => {
    const { engine, snapshot } = await createAnalysisEngine({ grow: true });
    expect(engine.hello({ supportedProtocolVersions: [1], host: { name: "Host", version: "1" } })
      .metadata.capabilities.analysis?.profiles).toEqual(["quick-0ply-v1", "deep-2ply-v1"]);
    const result = engine.analyzeChecker(terminalRequest);
    expect(engine.hello({ supportedProtocolVersions: [1], host: { name: "Host", version: "1" } })
      .metadata.capabilities.analysis?.quickProvenance).toEqual(result.provenance);
    expect(result).toMatchObject({
      forced: true, noPlay: false, playedLegal: true, equityLoss: 0,
      legalPositionCount: 1, evaluatedPositionCount: 1,
      provenance: { depth: 0, noise: 0, cubeful: true, pruning: false, effectiveProfile: "quick-0ply-v1" },
    });
    expect(result.candidates[0]?.segments).toEqual([
      { from: { kind: "point", point: 0 }, to: { kind: "borne-off" }, hit: false },
    ]);
    const request = snapshotView(snapshot());
    expect(request.getUint32(4, true)).toBe(312);
    expect(request.getUint32(128, true)).toBe(1);
    expect(request.getUint32(152, true)).toBe(2);
    expect(request.getUint8(282)).toBe(15);
    expect(request.getUint32(284, true)).toBe(1);
    expect(request.getUint32(288, true)).toBe(5);
    expect(request.getUint32(292, true)).toBe(312);
    expect(request.getUint32(296, true)).toBe(6);
    engine.dispose();
  });
  it("sends the fixed 2-ply profile and validates the native effective settings", async () => {
    const { engine, snapshot } = await createAnalysisEngine();
    const result = engine.analyzeChecker({ ...terminalRequest, profile: "deep-2ply-v1", timeMs: 1 });
    expect(snapshotView(snapshot()).getUint32(284, true)).toBe(2);
    expect(result.provenance).toMatchObject({ depth: 2, pruning: true, noise: 0, completion: "complete" });
    expect(engine.hello({ supportedProtocolVersions: [1], host: { name: "Host", version: "1" } })
      .metadata.capabilities.analysis?.deepProvenance).toEqual(result.provenance);
    engine.dispose();
  });
  it("rejects a weaker native result for Deeper rather than accepting a fallback", async () => {
    const { engine } = await createAnalysisEngine({ corrupt: (view, result) => view.setUint32(result + 36, 0, true) });
    expect(() => engine.analyzeChecker({ ...terminalRequest, profile: "deep-2ply-v1" })).toThrow(/invalid analysis settings/);
    engine.dispose();
  });
  it("rejects a changed analysis layout before initializing GNUbg", async () => {
    await expect(createAnalysisEngine({ badDescriptor: true })).rejects.toThrow(/layout/);
  });
  it.each([
    ["nonfinite equity", (view: DataView, _result: number, candidate: number) => view.setFloat32(candidate + 136, NaN, true)],
    ["excess candidates", (view: DataView, result: number) => view.setUint32(result + 8, 7, true)],
    ["wrong played board", (view: DataView, _result: number, candidate: number) => view.setUint8(candidate + 50, 14)],
    ["different effective depth", (view: DataView, result: number) => view.setUint32(result + 36, 2, true)],
    ["incomplete root coverage", (view: DataView, result: number) => view.setUint32(result + 16, 2, true)],
    ["bad rank", (view: DataView, _result: number, candidate: number) => view.setUint32(candidate + 140, 2, true)],
  ])("makes a corrupt %s terminal", async (_label, corrupt) => {
    const { engine } = await createAnalysisEngine({ corrupt });
    expect(() => engine.analyzeChecker(terminalRequest)).toThrow(GnubgEngineError);
    expect(() => engine.analyzeChecker(terminalRequest)).toThrow(/fresh Worker/);
    engine.dispose();
  });
});

describe("GNUbg WebAssembly engine", () => {
  it("verifies the descriptor, allowlists assets, and initializes exact virtual paths", async () => {
    const module = new FakeGnubgModule();
    const engine = await createEngine(module, ({ locateFile }) => {
      expect(locateFile("gnubg-wasm.wasm")).toBe(ASSETS.wasmUrl);
      expect(locateFile("gnubg-wasm.data")).toBe(ASSETS.dataUrl);
      expect(() => locateFile("surprise.bin")).toThrow(/Unexpected GNUbg asset/);
    });

    expect(module.allocatedArenaSize).toBe(ARENA_SIZE);
    expect(module.rawFreedPointers).toEqual([module.descriptorPointer]);
    expect(module.initCalls).toHaveLength(1);
    const call = module.initCalls[0];
    expect(call).toMatchObject({
      arena: module.arenaPointer,
      requestOffset: 0,
      errorOffset: 32,
    });
    const view = snapshotView(module.initSnapshot);
    expect(view.getUint32(0, true)).toBe(ABI_VERSION);
    expect(view.getUint32(4, true)).toBe(32);
    expect(view.getUint32(8, true)).toBe(288);
    const weightsLength = view.getUint32(12, true);
    const equityOffset = view.getUint32(16, true);
    const equityLength = view.getUint32(20, true);
    expect(view.getUint32(24, true)).toBe(0);
    expect(view.getUint32(28, true)).toBe(0);
    const decode = (offset: number, length: number) =>
      new TextDecoder().decode(module.initSnapshot?.subarray(offset, offset + length));
    expect(decode(288, weightsLength)).toBe("/gnubg/gnubg.weights");
    expect(equityOffset).toBe(288 + weightsLength);
    expect(decode(equityOffset, equityLength)).toBe(
      "/gnubg/met/Kazaross-XG2.xml",
    );

    const hello = engine.hello({
      supportedProtocolVersions: [1],
      host: { name: "Host", version: "1" },
    });
    expect(hello.metadata).toMatchObject({
      engineId: GNUBG_ENGINE_METADATA.engineId,
      version: GNUBG_ENGINE_METADATA.version,
    });
    // The frozen v1-only fake module still plays; it advertises no analysis.
    expect(hello.metadata.capabilities.analysis).toBeUndefined();
    expect(hello.metadata.license.spdxId).toBe("GPL-3.0-or-later");
    expect(hello.metadata.capabilities.moveRanking).toBe(true);
    engine.dispose();
  });

  it("rejects relative assets before invoking a loader", async () => {
    let called = false;
    await expect(
      GnubgEngine.create(
        { ...ASSETS, moduleUrl: "./gnubg-wasm.mjs" },
        async () => {
          called = true;
          throw new Error("must not run");
        },
      ),
    ).rejects.toMatchObject({
      bepError: { code: "asset-load-failed" },
      fatal: true,
    });
    expect(called).toBe(false);
  });

  it("rejects an ABI descriptor mismatch before allocating the arena", async () => {
    const module = new FakeGnubgModule();
    module.descriptorOverrides.set(52, 108);
    let caught: unknown;
    try {
      await createEngine(module);
    } catch (error) {
      caught = error;
    }
    expectEngineError(caught, "version-mismatch", true);
    expect(module.allocatedArenaSize).toBeUndefined();
    expect(module.disposeCount).toBe(1);
  });

  it("reports initialization failure and releases a consumed module", async () => {
    const module = new FakeGnubgModule();
    module.initStatus = 5;
    module.initError = "weights data is invalid";
    await expect(createEngine(module)).rejects.toMatchObject({
      bepError: {
        code: "asset-load-failed",
        message: "weights data is invalid",
        retryable: true,
      },
      fatal: true,
    });
    expect(module.disposeCount).toBe(1);
    expect(module.freedPointers).toEqual([module.arenaPointer]);
  });

  it("writes the exact checker layout and maps the selected index and ranking", async () => {
    const module = new FakeGnubgModule();
    module.chooseSelectedIndex = 1;
    module.chooseScores = [
      [0.25, 0.1],
      [0.75, 0.5],
    ];
    const engine = await createEngine(module);
    const base = createChooseRequest();
    const originalBoard = createBoard();
    const points = originalBoard.points.map((point) => ({ ...point }));
    points[0] = { white: 0, black: 1 };
    const board = {
      ...originalBoard,
      points,
      bar: { white: 0, black: 1 },
    };
    const request: BepChooseTurnRequest = {
      ...base,
      enginePlayer: "black",
      position: createPosition({
        board,
        playerOnRoll: "black",
        dice: [3, 6],
        cube: {
          value: 2,
          owner: "black",
          state: "accepted",
          offeredBy: null,
        },
        match: {
          mode: "match",
          length: 7,
          score: { white: 6, black: 4 },
          crawford: "post-crawford",
        },
        rules: {
          variation: "standard",
          jacoby: true,
          beavers: true,
          raccoons: false,
          automaticDoubles: 2,
        },
      }),
      legalTurns: [
        {
          id: "turn:bar",
          steps: [{
            from: { kind: "bar" },
            to: { kind: "point", point: 2 },
            die: 3,
            hit: false,
          }],
        },
        {
          id: "turn:off",
          steps: [{
            from: { kind: "point", point: 18 },
            to: { kind: "borne-off" },
            die: 6,
            hit: false,
          }],
        },
      ],
      settings: { ...settings, strength: "maximum" },
    };

    const result = engine.chooseTurn(request, performance.now());
    expect(result.chosenTurnId).toBe("turn:off");
    expect(result.stats).toMatchObject({ depth: 2, completed: true });
    expect(result.rankedTurns?.map(({ turnId }) => turnId)).toEqual([
      "turn:off",
      "turn:bar",
    ]);
    const call = module.chooseCalls[0];
    expect(call).toMatchObject({
      requestOffset: 0,
      resultOffset: 400,
      errorOffset: 432,
      arenaSize: 688,
    });
    const view = snapshotView(module.chooseSnapshot);
    expect(view.getUint32(0, true)).toBe(ABI_VERSION);
    expect(view.getUint32(4, true)).toBe(176);
    expect(view.getUint8(8)).toBe(0);
    expect(view.getUint8(9)).toBe(1);
    expect(view.getUint8(57)).toBe(1);
    expect(view.getUint32(68, true)).toBe(6);
    expect(view.getInt32(84, true)).toBe(-1);
    expect(view.getUint32(88, true)).toBe(1);
    expect(view.getInt32(92, true)).toBe(7);
    expect(view.getUint32(104, true)).toBe(2);
    expect(view.getUint32(112, true)).toBe(1);
    expect(view.getUint32(116, true)).toBe(1);
    expect(view.getUint32(124, true)).toBe(2);
    expect(view.getUint32(128, true)).toBe(176);
    expect(view.getUint32(132, true)).toBe(2);
    expect(view.getUint32(136, true)).toBe(384);
    expect(view.getUint32(140, true)).toBe(2);
    expect(view.getUint32(144, true)).toBe(4);
    expect(view.getUint32(176, true)).toBe(1);
    expect(view.getUint32(184, true)).toBe(1);
    expect(view.getInt32(188, true)).toBe(0);
    expect(view.getUint32(192, true)).toBe(0);
    expect(view.getInt32(196, true)).toBe(2);
    expect(view.getUint32(200, true)).toBe(3);
    const second = 176 + 104;
    expect(view.getUint32(second + 8, true)).toBe(0);
    expect(view.getInt32(second + 12, true)).toBe(18);
    expect(view.getUint32(second + 16, true)).toBe(2);
    expect(view.getInt32(second + 20, true)).toBe(0);
    engine.dispose();
  });

  it("uses a measured zero-ply partial result for an oversized maximum request", async () => {
    const module = new FakeGnubgModule();
    const engine = await createEngine(module);
    const base = createChooseRequest();
    const template = base.legalTurns[0] as BepChooseTurnRequest["legalTurns"][number];
    const result = engine.chooseTurn({
      ...base,
      legalTurns: Array.from({ length: 9 }, (_, index) => ({
        ...template,
        id: `turn:bounded-${index}`,
      })),
      settings: { ...base.settings, strength: "maximum" },
    });

    expect(snapshotView(module.chooseSnapshot).getUint32(144, true)).toBe(3);
    expect(result.stats).toMatchObject({ depth: 0, completed: false });
    engine.dispose();
  });

  it.each([
    ["a tighter time budget", { timeMs: 499 }],
    ["a shallower depth", { timeMs: 500, maxDepth: 1 }],
  ])("clamps maximum checker play for %s", async (_label, limits) => {
    const module = new FakeGnubgModule();
    const engine = await createEngine(module);
    const base = createChooseRequest();
    const result = engine.chooseTurn({
      ...base,
      settings: {
        ...base.settings,
        strength: "maximum",
        limits,
      },
    });

    expect(snapshotView(module.chooseSnapshot).getUint32(144, true)).toBe(3);
    expect(result.stats).toMatchObject({ depth: 0, completed: false });
    engine.dispose();
  });

  it("rejects unenforceable node and memory ceilings before native work", async () => {
    const module = new FakeGnubgModule();
    const engine = await createEngine(module);
    const base = createChooseRequest();
    for (const limits of [{ maxNodes: 1_000 }, { memoryMb: 127 }]) {
      let caught: unknown;
      try {
        engine.chooseTurn({
          ...base,
          settings: { ...base.settings, limits },
        });
      } catch (error) {
        caught = error;
      }
      expectEngineError(caught, "unsupported", false);
    }
    expect(module.chooseCalls).toHaveLength(0);

    expect(() => engine.chooseTurn({
      ...base,
      settings: { ...base.settings, limits: { memoryMb: 128 } },
    })).not.toThrow();
    engine.dispose();
  });

  it("refreshes memory views after growth and preserves score tie ordering and output limit", async () => {
    const module = new FakeGnubgModule();
    module.replaceHeapOnChoose = true;
    module.chooseSelectedIndex = 1;
    module.chooseScores = [
      [0.5, 0.1],
      [0.5, 0.2],
      [0.4, 0.9],
    ];
    const engine = await createEngine(module);
    const base = createChooseRequest();
    const request: BepChooseTurnRequest = {
      ...base,
      legalTurns: [
        base.legalTurns[0] as BepChooseTurnRequest["legalTurns"][number],
        { ...(base.legalTurns[0] as BepChooseTurnRequest["legalTurns"][number]), id: "turn:tie-winner" },
        { ...(base.legalTurns[1] as BepChooseTurnRequest["legalTurns"][number]), id: "turn:third" },
      ],
      settings: {
        ...base.settings,
        limits: { ...base.settings.limits, candidateLimit: 2 },
      },
    };
    const originalBuffer = module.HEAPU8.buffer;
    const helloRequest = { supportedProtocolVersions: [1] as const, host: { name: "Host", version: "1" } };
    const initialMemory = engine.hello(helloRequest).metadata.runtime.wasmMemoryBytes;
    expect(initialMemory).toBe(module.HEAPU8.byteLength);
    const result = engine.chooseTurn(request);
    expect(module.HEAPU8.buffer).not.toBe(originalBuffer);
    expect(engine.hello(helloRequest).metadata.runtime).toMatchObject({
      wasmMemoryBytes: module.HEAPU8.byteLength,
      wasmMemoryLimitBytes: 128 * 1024 * 1024,
    });
    expect(module.HEAPU8.byteLength).toBeGreaterThan(initialMemory!);
    expect(result.chosenTurnId).toBe("turn:tie-winner");
    expect(result.rankedTurns).toEqual([
      { turnId: "turn:tie-winner", rank: 1, score: 0.5 },
      { turnId: "turn:first", rank: 2, score: 0.5 },
    ]);
    engine.dispose();
  });

  it("fits all 4096 candidates in the frozen arena", async () => {
    const module = new FakeGnubgModule();
    const engine = await createEngine(module);
    const base = createChooseRequest();
    const template = base.legalTurns[0] as BepChooseTurnRequest["legalTurns"][number];
    const request: BepChooseTurnRequest = {
      ...base,
      legalTurns: Array.from({ length: 4096 }, (_, index) => ({
        ...template,
        id: `turn:${index}`,
      })),
      settings: { ...base.settings, limits: { candidateLimit: 1 } },
    };
    const result = engine.chooseTurn(request);
    expect(module.chooseCalls[0]?.arenaSize).toBe(459_216);
    expect(module.chooseCalls[0]?.resultOffset).toBe(458_928);
    expect(module.chooseCalls[0]?.errorOffset).toBe(458_960);
    expect(result.chosenTurnId).toBe("turn:0");
    expect(result.rankedTurns).toHaveLength(1);
    engine.dispose();
  });

  it("writes cube enums exactly and refreshes views after growth", async () => {
    const module = new FakeGnubgModule();
    module.replaceHeapOnCube = true;
    module.cubeSelectedIndex = 1;
    module.cubeEvaluated = true;
    module.cubeEquities = [0.2, 0.3, 0.4, 0.5, 1];
    const engine = await createEngine(module);
    const request: BepCubeDecisionRequest = {
      ...createCubeRequest(),
      enginePlayer: "black",
      position: createPosition({
        revision: "position:response",
        phase: "cube-response",
        dice: [],
        playerOnRoll: "white",
        cube: {
          value: 2,
          owner: "white",
          state: "offered",
          offeredBy: "white",
        },
        match: {
          mode: "money",
          length: null,
          score: { white: 0, black: 0 },
          crawford: "none",
        },
        rules: {
          variation: "standard",
          jacoby: true,
          beavers: true,
          raccoons: false,
          automaticDoubles: 0,
        },
      }),
      phase: "respond-to-offer",
      legalDecisions: ["take", "pass", "beaver"],
      settings: { ...settings, strength: "expert" },
    };
    const originalBuffer = module.HEAPU8.buffer;
    const result = engine.decideCube(request);
    expect(module.HEAPU8.buffer).not.toBe(originalBuffer);
    expect(result.decision).toBe("pass");
    expect(result.positionRevision).toBe("position:response");
    expect(module.cubeCalls[0]).toMatchObject({
      requestOffset: 0,
      resultOffset: 192,
      errorOffset: 256,
      arenaSize: 512,
    });
    const view = snapshotView(module.cubeSnapshot);
    expect(view.getUint32(128, true)).toBe(1);
    expect(view.getUint32(132, true)).toBe(1);
    expect(view.getUint32(136, true)).toBe(3);
    expect(view.getUint32(140, true)).toBe(3);
    expect(view.getUint32(144, true)).toBe(4);
    expect(view.getUint32(148, true)).toBe(5);
    expect(view.getUint32(164, true)).toBe(3);
    engine.dispose();
  });

  it.each([
    [1, "invalid-request", false, false],
    [2, "invalid-position", false, false],
    [3, "illegal-turn", false, false],
    [4, "not-ready", true, true],
    [5, "asset-load-failed", true, true],
    [6, "internal-error", true, false],
    [7, "unsupported", false, false],
    [99, "engine-crash", true, true],
  ] as const)(
    "maps native status %i to %s",
    async (status, code, retryable, fatal) => {
      const module = new FakeGnubgModule();
      module.chooseStatus = status;
      module.chooseError = `native status ${status}`;
      const engine = await createEngine(module);
      let caught: unknown;
      try {
        engine.chooseTurn(createChooseRequest());
      } catch (error) {
        caught = error;
      }
      expectEngineError(caught, code, fatal);
      expect((caught as GnubgEngineError).bepError.retryable).toBe(retryable);
      expect((caught as GnubgEngineError).bepError.message).toBe(
        `native status ${status}`,
      );
      engine.dispose();
    },
  );

  it("treats corrupt result identity as fatal", async () => {
    const module = new FakeGnubgModule();
    module.chooseSelectedIndex = 9;
    const engine = await createEngine(module);
    expect(() => engine.chooseTurn(createChooseRequest())).toThrowError(
      GnubgEngineError,
    );
    try {
      engine.chooseTurn(createChooseRequest());
    } catch (error) {
      expectEngineError(error, "engine-crash", true);
    }
    engine.dispose();
  });

  it("rejects a declared resulting board that replay does not produce", async () => {
    const module = new FakeGnubgModule();
    const engine = await createEngine(module);
    const base = createChooseRequest();
    const request: BepChooseTurnRequest = {
      ...base,
      legalTurns: [{
        ...(base.legalTurns[0] as BepChooseTurnRequest["legalTurns"][number]),
        resultingBoard: base.position.board,
      }],
    };
    let caught: unknown;
    try {
      engine.chooseTurn(request);
    } catch (error) {
      caught = error;
    }
    expectEngineError(caught, "illegal-turn", false);
    expect(module.chooseCalls).toHaveLength(0);
    engine.dispose();
  });

  it("resets, disposes idempotently, and rejects use after disposal", async () => {
    const module = new FakeGnubgModule();
    const engine = await createEngine(module);
    module.HEAPU8.fill(0xa5, module.arenaPointer, module.arenaPointer + 256);
    engine.reset();
    expect(module.resetCalls).toEqual([{
      arena: module.arenaPointer,
      arenaSize: 256,
      errorOffset: 0,
    }]);
    engine.dispose();
    engine.dispose();
    expect(module.disposeCount).toBe(1);
    expect(module.freedPointers).toEqual([module.arenaPointer]);
    try {
      engine.hello({
        supportedProtocolVersions: [1],
        host: { name: "Host", version: "1" },
      });
    } catch (error) {
      expectEngineError(error, "disposed", true);
    }
  });

  it("rejects unsupported variation but accepts varied settings as an ignorable hint", async () => {
    const module = new FakeGnubgModule();
    const engine = await createEngine(module);
    const varied = createChooseRequest();
    const result = engine.chooseTurn({
      ...varied,
      settings: {
        ...varied.settings,
        randomization: {
          mode: "varied",
          seed: "reproducible",
          variability: 0.5,
        },
      },
    });
    expect(result.chosenTurnId).toBe("turn:first");
    expect(() => engine.chooseTurn({
      ...varied,
      position: createPosition({
        rules: { ...varied.position.rules, variation: "nackgammon" },
      }),
    })).toThrowError(GnubgEngineError);
    engine.dispose();
  });
});

const cubeCorpus = JSON.parse(readFileSync(new URL("../fixtures/bep-analysis-v1.json", import.meta.url), "utf8")) as {validHostMessages: {method:string;payload:unknown}[]};
describe("cube analysis WASM decoding",()=>{
  it.each(["no-double","double","take","pass"] as const)("exposes native branch equities and correct loss for %s",async action=>{
    const {engine,module}=await createAnalysisEngine();module.cubeEvaluated=true;
    module.cubeEquities=[0.6,0.6,0.3,0.6,1];
    const response=action==="take"||action==="pass";
    module.cubeSelectedIndex=response?0:1;
    const request=structuredClone(cubeCorpus.validHostMessages.find(item=>item.method==="analyze-cube")!.payload) as BepAnalyzeCubeRequest;
    Object.assign(request,{role:response?"response":"offer",actor:response?"black":"white",recordedAction:action});
    const result=engine.analyzeCube(request);
    expect(result).toMatchObject({referenceCube:1,equityPerspective:"white",actor:request.actor,
      noDoubleEquity:expect.closeTo(0.3),doubleTakeEquity:expect.closeTo(0.6),doublePassEquity:1,
      equityLoss:expect.closeTo(action==="no-double"?0.3:action==="pass"?0.4:0)});
    expect(snapshotView(module.cubeSnapshot).getUint32(164,true)).toBe(3);
    engine.dispose();
  });
  it("does not publish placeholder equities when native evaluated=false; rejection is recoverable",async()=>{
    const {engine,module}=await createAnalysisEngine();
    const request=cubeCorpus.validHostMessages.find(item=>item.method==="analyze-cube")!.payload as BepAnalyzeCubeRequest;
    expect(()=>engine.analyzeCube(request)).toThrow(/did not evaluate/);
    module.cubeEvaluated=true;module.cubeEquities=[0.6,0.6,0.3,0.6,1];module.cubeSelectedIndex=1;
    expect(engine.analyzeCube(request).equityLoss).toBeCloseTo(0.3);engine.dispose();
  });
  it("retains native too-good semantics and rejects nonfinite output",async()=>{
    const {engine,module}=await createAnalysisEngine();
    const request=cubeCorpus.validHostMessages.find(item=>item.method==="analyze-cube")!.payload as BepAnalyzeCubeRequest;
    module.cubeEvaluated=true;module.cubeEquities=[1.4,1.4,1.4,2,1];module.cubeSelectedIndex=2;
    expect(engine.analyzeCube(request)).toMatchObject({tooGood:true,recommendedAction:"no-double",equityLoss:0});
    module.cubeEquities=[1.4,1.4,NaN,2,1];expect(()=>engine.analyzeCube(request)).toThrow(/cube equities/);engine.dispose();
  });
});
