import { afterEach, describe, expect, it, vi } from "vitest";
import type { BepEngineError } from "../../src/protocol/types";
import type { CapsuleToWorkerMessage } from "../../src/worker/messages";
import { createChooseRequest } from "./fixtures";

const ASSETS = {
  moduleUrl: "http://localhost:4174/engine/gnubg-wasm.mjs",
  wasmUrl: "http://localhost:4174/engine/gnubg-wasm.wasm",
  dataUrl: "http://localhost:4174/engine/gnubg-wasm.data",
};

const engineHarness = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("../../src/worker/gnubgEngine", () => {
  class GnubgEngineError extends Error {
    public constructor(
      public readonly bepError: BepEngineError,
      public readonly fatal: boolean,
    ) {
      super(bepError.message);
    }
  }

  return {
    GnubgEngine: class {
      public static readonly create = engineHarness.create;
    },
    GnubgEngineError,
  };
});

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

interface WorkerHarness {
  readonly postMessage: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly dispatchMessage: (
    message: CapsuleToWorkerMessage,
  ) => void;
}

async function createWorkerHarness(
  configure?: () => void | Promise<void>,
): Promise<WorkerHarness> {
  let handleMessage:
    | ((event: MessageEvent<CapsuleToWorkerMessage>) => void)
    | null = null;
  const postMessage = vi.fn();
  const close = vi.fn();
  vi.stubGlobal(
    "addEventListener",
    vi.fn(
      (
        type: string,
        listener: (event: MessageEvent<CapsuleToWorkerMessage>) => void,
      ) => {
        if (type === "message") {
          handleMessage = listener;
        }
      },
    ),
  );
  vi.stubGlobal("postMessage", postMessage);
  vi.stubGlobal("close", close);

  vi.resetModules();
  await configure?.();
  await import("../../src/worker/gnubg.worker");
  expect(handleMessage).not.toBeNull();
  const dispatch = handleMessage as unknown as (
    event: MessageEvent<CapsuleToWorkerMessage>,
  ) => void;

  return {
    postMessage,
    close,
    dispatchMessage: (message) => {
      dispatch({ data: message } as MessageEvent<CapsuleToWorkerMessage>);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GNUbg compute Worker", () => {
  it("reports ready only after initialization and treats an unexpected trap as fatal", async () => {
    let handleMessage:
      | ((event: MessageEvent<CapsuleToWorkerMessage>) => void)
      | null = null;
    const postMessage = vi.fn();
    const close = vi.fn();
    vi.stubGlobal(
      "addEventListener",
      vi.fn(
        (
          type: string,
          listener: (event: MessageEvent<CapsuleToWorkerMessage>) => void,
        ) => {
          if (type === "message") {
            handleMessage = listener;
          }
        },
      ),
    );
    vi.stubGlobal("postMessage", postMessage);
    vi.stubGlobal("close", close);

    const initialization = createDeferred<{
      readonly hello: ReturnType<typeof vi.fn>;
      readonly chooseTurn: ReturnType<typeof vi.fn>;
      readonly decideCube: ReturnType<typeof vi.fn>;
      readonly dispose: ReturnType<typeof vi.fn>;
    }>();
    const fakeEngine = {
      hello: vi.fn(),
      chooseTurn: vi.fn(() => {
        throw new Error("fatal evaluator trap");
      }),
      decideCube: vi.fn(),
      dispose: vi.fn(),
    };
    engineHarness.create.mockReturnValueOnce(initialization.promise);

    vi.resetModules();
    await import("../../src/worker/gnubg.worker");
    expect(handleMessage).not.toBeNull();
    const dispatchMessage = handleMessage as unknown as (
      event: MessageEvent<CapsuleToWorkerMessage>,
    ) => void;

    dispatchMessage({
      data: { kind: "capsule.worker-initialize", assets: ASSETS },
    } as MessageEvent<CapsuleToWorkerMessage>);
    await Promise.resolve();
    expect(engineHarness.create).toHaveBeenCalledWith(ASSETS);
    expect(postMessage).not.toHaveBeenCalledWith({
      kind: "capsule.worker-ready",
    });

    initialization.resolve(fakeEngine);
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        kind: "capsule.worker-ready",
      }),
    );

    dispatchMessage({
      data: {
        kind: "capsule.worker-request",
        requestId: "request:fatal",
        method: "choose-turn",
        payload: createChooseRequest(),
      },
    } as MessageEvent<CapsuleToWorkerMessage>);

    expect(postMessage).toHaveBeenCalledWith({
      kind: "capsule.worker-fatal",
      message: "fatal evaluator trap",
    });
    expect(fakeEngine.dispose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves a structured GNUbg initialization error and closes without reporting ready", async () => {
    const engineError: BepEngineError = {
      code: "version-mismatch",
      message: `GNUbg\u0000 ABI\n${"x".repeat(600)}`,
      retryable: false,
      details: { wasmStatus: 9 },
    };
    const harness = await createWorkerHarness(async () => {
      const { GnubgEngineError } = await import(
        "../../src/worker/gnubgEngine"
      );
      engineHarness.create.mockRejectedValueOnce(
        new GnubgEngineError(engineError, true),
      );
    });

    harness.dispatchMessage({
      kind: "capsule.worker-initialize",
      assets: ASSETS,
    });

    await vi.waitFor(() =>
      expect(harness.postMessage).toHaveBeenCalledWith({
        kind: "capsule.worker-startup-error",
        error: {
          ...engineError,
          message: expect.any(String),
        },
      }),
    );
    const startupMessage = harness.postMessage.mock.calls
      .map(([message]) => message as { readonly kind?: string; readonly error?: BepEngineError })
      .find(({ kind }) => kind === "capsule.worker-startup-error");
    const sanitizedMessage = startupMessage?.error?.message;
    expect(sanitizedMessage).toHaveLength(512);
    expect(sanitizedMessage).toMatch(/^GNUbg {2}ABI /u);
    expect(sanitizedMessage).not.toContain("\u0000");
    expect(sanitizedMessage).not.toContain("\n");
    expect(harness.postMessage).not.toHaveBeenCalledWith({
      kind: "capsule.worker-ready",
    });
    expect(harness.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "capsule.worker-fatal" }),
    );
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it("maps an unexpected initialization exception to a retryable engine crash", async () => {
    const harness = await createWorkerHarness(() => {
      engineHarness.create.mockRejectedValueOnce(
        new Error("unexpected\u0007 initialization"),
      );
    });

    harness.dispatchMessage({
      kind: "capsule.worker-initialize",
      assets: ASSETS,
    });

    await vi.waitFor(() =>
      expect(harness.postMessage).toHaveBeenCalledWith({
        kind: "capsule.worker-startup-error",
        error: {
          code: "engine-crash",
          message: "unexpected  initialization",
          retryable: true,
        },
      }),
    );
    expect(harness.postMessage).not.toHaveBeenCalledWith({
      kind: "capsule.worker-ready",
    });
    expect(harness.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "capsule.worker-fatal" }),
    );
    expect(harness.close).toHaveBeenCalledOnce();
  });
});
