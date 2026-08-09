import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkerRuntime,
  WorkerRuntimeStartupError,
} from "../../src/capsule/workerRuntime";
import {
  BEP_PROTOCOL,
  BEP_VERSION,
  type BepRequestMessage,
} from "../../src/protocol/types";
import type { GnubgAssetUrls } from "../../src/worker/gnubgEngine";
import { createChooseRequest } from "./fixtures";

const ASSETS: GnubgAssetUrls = {
  moduleUrl: "http://localhost:4174/engines/test/gnubg-wasm.mjs",
  wasmUrl: "http://localhost:4174/engines/test/gnubg-wasm.wasm",
  dataUrl: "http://localhost:4174/engines/test/gnubg-wasm.data",
};

class WorkerDouble extends EventTarget {
  public readonly postMessage = vi.fn((message: unknown) => {
    void message;
  });
  public readonly terminate = vi.fn(() => undefined);

  public emitMessage(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

interface RuntimeHarness {
  readonly runtime: WorkerRuntime;
  readonly worker: WorkerDouble;
  readonly handlers: {
    readonly onResult: ReturnType<typeof vi.fn>;
    readonly onError: ReturnType<typeof vi.fn>;
    readonly onFatal: ReturnType<typeof vi.fn>;
  };
}

function createRuntimeHarness(): RuntimeHarness {
  const worker = new WorkerDouble();
  const workerConstructor = vi.fn(function WorkerConstructor() {
    return worker;
  });
  const fetchMock = vi.fn<typeof fetch>(async () =>
    ({
      ok: true,
      status: 200,
      text: async () => "self.onmessage = () => undefined;",
    }) as Response,
  );
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Worker", workerConstructor);

  const handlers = {
    onResult: vi.fn(),
    onError: vi.fn(),
    onFatal: vi.fn(),
  };
  return {
    runtime: new WorkerRuntime(
      "http://localhost:4174/gnubg-engine.worker.js",
      ASSETS,
      handlers,
    ),
    worker,
    handlers,
  };
}

async function startRuntime(harness: RuntimeHarness): Promise<void> {
  const startup = harness.runtime.start();
  await vi.waitFor(() =>
    expect(harness.worker.postMessage).toHaveBeenCalledWith({
      kind: "capsule.worker-initialize",
      assets: ASSETS,
    }),
  );
  harness.worker.emitMessage({ kind: "capsule.worker-ready" });
  await startup;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkerRuntime startup", () => {
  it("passes explicit engine asset URLs before accepting ready", async () => {
    const harness = createRuntimeHarness();

    await startRuntime(harness);

    expect(harness.worker.postMessage).toHaveBeenCalledTimes(1);
    harness.runtime.dispose();
  });

  it("surfaces a structured startup error without waiting for timeout", async () => {
    const harness = createRuntimeHarness();
    const startup = harness.runtime.start();
    await vi.waitFor(() =>
      expect(harness.worker.postMessage).toHaveBeenCalledOnce(),
    );

    const engineError = {
      code: "version-mismatch" as const,
      message: "GNUbg ABI version is unsupported",
      retryable: false,
      details: { wasmStatus: 9 },
    };
    harness.worker.emitMessage({
      kind: "capsule.worker-startup-error",
      error: engineError,
    });

    let startupFailure: unknown;
    try {
      await startup;
    } catch (error) {
      startupFailure = error;
    }
    expect(startupFailure).toBeInstanceOf(WorkerRuntimeStartupError);
    expect(startupFailure).toMatchObject({
      message: engineError.message,
      bepError: engineError,
    });
    expect(harness.worker.terminate).toHaveBeenCalledOnce();
  });

  it("does not create a Worker when disposed while its source body is loading", async () => {
    let resolveSource!: (source: string) => void;
    let markTextStarted!: () => void;
    const source = new Promise<string>((resolve) => {
      resolveSource = resolve;
    });
    const textStarted = new Promise<void>((resolve) => {
      markTextStarted = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      ({
        ok: true,
        status: 200,
        text: () => {
          markTextStarted();
          return source;
        },
      }) as Response,
    );
    const workerMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Worker", workerMock);

    const runtime = new WorkerRuntime(
      "http://localhost:4174/gnubg-engine.worker.js",
      ASSETS,
      {
        onResult: vi.fn(),
        onError: vi.fn(),
        onFatal: vi.fn(),
      },
    );
    const startup = runtime.start();
    await textStarted;

    runtime.dispose();
    resolveSource("self.postMessage({ kind: 'capsule.worker-ready' });");

    await expect(startup).rejects.toThrow("Worker runtime is disposed");
    expect(workerMock).not.toHaveBeenCalled();
    const requestInit = fetchMock.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    expect(requestInit?.signal?.aborted).toBe(true);
  });
});

describe("WorkerRuntime lifecycle", () => {
  it("turns an internal fatal message into terminal runtime failure", async () => {
    const harness = createRuntimeHarness();
    await startRuntime(harness);

    harness.worker.emitMessage({
      kind: "capsule.worker-fatal",
      message: "GNUbg trapped",
    });

    expect(harness.handlers.onFatal).toHaveBeenCalledWith(
      expect.objectContaining({ message: "GNUbg trapped" }),
    );
    expect(harness.worker.terminate).toHaveBeenCalledOnce();
  });

  it("immediately terminates a synchronous engine when its request is cancelled", async () => {
    const harness = createRuntimeHarness();
    await startRuntime(harness);
    const request: BepRequestMessage<"choose-turn"> = {
      protocol: BEP_PROTOCOL,
      version: BEP_VERSION,
      sessionNonce: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      kind: "bep.request",
      requestId: "request:cancel",
      method: "choose-turn",
      payload: createChooseRequest(),
    };

    harness.runtime.request(request);
    harness.runtime.cancel(request.requestId);

    expect(harness.worker.terminate).toHaveBeenCalledOnce();
    expect(
      harness.worker.postMessage.mock.calls.some(
        ([message]) =>
          typeof message === "object" &&
          message !== null &&
          Reflect.get(message, "kind") === "capsule.worker-cancel",
      ),
    ).toBe(false);
  });
});
