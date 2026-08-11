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

  public emitError(cause: unknown): void {
    const event = new Event("error");
    Object.defineProperty(event, "error", { value: cause });
    this.dispatchEvent(event);
  }

  public emitMessageError(): void {
    this.dispatchEvent(new Event("messageerror"));
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

async function captureStartupFailure(
  startup: Promise<void>,
): Promise<WorkerRuntimeStartupError> {
  let startupFailure: unknown;
  try {
    await startup;
  } catch (error) {
    startupFailure = error;
  }
  expect(startupFailure).toBeInstanceOf(WorkerRuntimeStartupError);
  return startupFailure as WorkerRuntimeStartupError;
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

  it("classifies an unavailable Worker source as an asset failure", async () => {
    const harness = createRuntimeHarness();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        ({ ok: false, status: 404 }) as Response,
      ),
    );

    const failure = await captureStartupFailure(harness.runtime.start());

    expect(failure.bepError).toEqual({
      code: "asset-load-failed",
      message: "Worker asset returned HTTP 404",
      retryable: true,
    });
    expect(harness.worker.postMessage).not.toHaveBeenCalled();
  });

  it("classifies a Worker crash during initialization as an engine crash", async () => {
    const harness = createRuntimeHarness();
    const startup = harness.runtime.start();
    await vi.waitFor(() =>
      expect(harness.worker.postMessage).toHaveBeenCalledOnce(),
    );

    harness.worker.emitError(new Error("synthetic Worker failure"));
    const failure = await captureStartupFailure(startup);

    expect(failure.bepError).toEqual({
      code: "engine-crash",
      message: "Capsule Worker crashed during initialization",
      retryable: true,
    });
    expect(harness.worker.terminate).toHaveBeenCalledOnce();
  });

  it("classifies malformed startup protocol as a non-retryable internal error", async () => {
    const harness = createRuntimeHarness();
    const startup = harness.runtime.start();
    await vi.waitFor(() =>
      expect(harness.worker.postMessage).toHaveBeenCalledOnce(),
    );

    harness.worker.emitMessage(null);
    const failure = await captureStartupFailure(startup);

    expect(failure.bepError).toEqual({
      code: "internal-error",
      message: "Capsule Worker returned a malformed startup message",
      retryable: false,
    });
  });

  it("classifies an unreadable startup message as a transport error", async () => {
    const harness = createRuntimeHarness();
    const startup = harness.runtime.start();
    await vi.waitFor(() =>
      expect(harness.worker.postMessage).toHaveBeenCalledOnce(),
    );

    harness.worker.emitMessageError();
    const failure = await captureStartupFailure(startup);

    expect(failure.bepError).toEqual({
      code: "transport-error",
      message: "Capsule Worker sent an unreadable ready message",
      retryable: true,
    });
  });

  it("marks a persistent Worker security failure as non-retryable transport", async () => {
    const harness = createRuntimeHarness();
    const securityError = new Error("Worker creation blocked by policy");
    securityError.name = "SecurityError";
    vi.stubGlobal(
      "Worker",
      vi.fn(() => {
        throw securityError;
      }),
    );

    const failure = await captureStartupFailure(harness.runtime.start());

    expect(failure.bepError).toEqual({
      code: "transport-error",
      message: "Failed to create the capsule Worker transport",
      retryable: false,
    });
  });

  it("classifies an initialization clone failure as an internal error", async () => {
    const harness = createRuntimeHarness();
    const cloneError = new Error("synthetic clone failure");
    cloneError.name = "DataCloneError";
    harness.worker.postMessage.mockImplementationOnce(() => {
      throw cloneError;
    });

    const failure = await captureStartupFailure(harness.runtime.start());

    expect(failure.bepError).toEqual({
      code: "internal-error",
      message: "Capsule Worker initialization data could not be cloned",
      retryable: false,
    });
  });

  it("classifies the startup deadline as a retryable timeout", async () => {
    const harness = createRuntimeHarness();
    let startupTimeout: (() => void) | undefined;
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: () => void) => {
        startupTimeout = callback;
        return 1;
      }),
      clearTimeout: vi.fn(),
    });
    const startup = harness.runtime.start();
    await vi.waitFor(() =>
      expect(harness.worker.postMessage).toHaveBeenCalledOnce(),
    );
    expect(startupTimeout).toBeDefined();

    startupTimeout?.();
    const failure = await captureStartupFailure(startup);

    expect(failure.bepError).toEqual({
      code: "timeout",
      message: "Timed out initializing the capsule Worker",
      retryable: true,
    });
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
