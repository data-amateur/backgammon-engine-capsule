import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BepEngineError,
  BepMethod,
  BepRequestMessage,
} from "../../src/protocol/types";
import { BEP_PROTOCOL, BEP_VERSION } from "../../src/protocol/types";
import type { GnubgAssetUrls } from "../../src/worker/gnubgEngine";
import { createChooseRequest } from "./fixtures";

interface RuntimeHandlersDouble {
  readonly onResult: (
    requestId: string,
    method: BepMethod,
    payload: unknown,
  ) => void;
  readonly onError: (
    requestId: string,
    method: BepMethod,
    error: BepEngineError,
  ) => void;
  readonly onFatal: (error: Error) => void;
}

interface RuntimeDouble {
  readonly handlers: RuntimeHandlersDouble;
  readonly start: () => Promise<void>;
  readonly request: (request: BepRequestMessage) => void;
  readonly cancel: (requestId: string) => void;
  readonly dispose: () => void;
}

const runtimeHarness = vi.hoisted(() => ({
  instances: [] as RuntimeDouble[],
  startFactory: (): Promise<void> => Promise.resolve(),
}));

vi.mock("../../src/capsule/workerRuntime", () => ({
  WorkerRuntimeStartupError: class WorkerRuntimeStartupError extends Error {
    public constructor(public readonly bepError: BepEngineError) {
      super(bepError.message);
    }
  },
  WorkerRuntime: class {
    public readonly start = vi.fn(() => runtimeHarness.startFactory());
    public readonly request = vi.fn(() => undefined);
    public readonly dispose = vi.fn(() => undefined);
    public readonly cancel = vi.fn(() => {
      this.dispose();
    });

    public constructor(
      _workerAssetUrl: string,
      _engineAssets: GnubgAssetUrls,
      public readonly handlers: RuntimeHandlersDouble,
    ) {
      runtimeHarness.instances.push(this);
    }
  },
}));

import { CapsuleController } from "../../src/capsule/controller";
import { WorkerRuntimeStartupError } from "../../src/capsule/workerRuntime";

const NONCE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PARENT_ORIGIN = "http://localhost:3100";

class WindowDouble extends EventTarget {
  public constructor(public readonly parent: MessageEventSource) {
    super();
  }
}

interface Connection {
  readonly controller: CapsuleController;
  readonly hostPort: MessagePort;
  readonly received: unknown[];
}

const connections: Connection[] = [];

function createWindowMessage(
  parent: MessageEventSource,
  port: MessagePort,
): Event {
  const event = new Event("message");
  Object.defineProperties(event, {
    source: { value: parent },
    origin: { value: PARENT_ORIGIN },
    ports: { value: [port] },
    data: {
      value: {
        protocol: BEP_PROTOCOL,
        version: BEP_VERSION,
        sessionNonce: NONCE,
        kind: "bep.channel-connect",
      },
    },
  });
  return event;
}

function connectController(): Connection {
  const parent = {} as MessageEventSource;
  const windowDouble = new WindowDouble(parent);
  vi.stubGlobal("window", windowDouble);

  const channel = new MessageChannel();
  const received: unknown[] = [];
  channel.port2.addEventListener("message", (event) => {
    received.push(event.data);
  });
  channel.port2.start();

  const controller = new CapsuleController({
    allowedParentOrigins: new Set([PARENT_ORIGIN]),
    workerAssetUrl: "http://localhost:4174/gnubg-engine.worker.js",
    engineAssets: {
      moduleUrl: "http://localhost:4174/gnubg-wasm.mjs",
      wasmUrl: "http://localhost:4174/gnubg-wasm.wasm",
      dataUrl: "http://localhost:4174/gnubg-wasm.data",
    },
  });
  controller.start();
  windowDouble.dispatchEvent(createWindowMessage(parent, channel.port1));

  const connection = {
    controller,
    hostPort: channel.port2,
    received,
  };
  connections.push(connection);
  return connection;
}

function createChooseMessage(
  requestId = "request:choose",
): BepRequestMessage<"choose-turn"> {
  return {
    protocol: BEP_PROTOCOL,
    version: BEP_VERSION,
    sessionNonce: NONCE,
    kind: "bep.request",
    requestId,
    method: "choose-turn",
    payload: createChooseRequest(),
  };
}

function createHelloMessage(
  requestId = "request:hello",
): BepRequestMessage<"hello"> {
  return {
    protocol: BEP_PROTOCOL,
    version: BEP_VERSION,
    sessionNonce: NONCE,
    kind: "bep.request",
    requestId,
    method: "hello",
    payload: {
      supportedProtocolVersions: [BEP_VERSION],
      host: { name: "Controller unit test", version: "1" },
    },
  };
}

function createDeferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function getRuntime(index = 0): Promise<RuntimeDouble> {
  await vi.waitFor(() =>
    expect(runtimeHarness.instances.length).toBeGreaterThan(index),
  );
  return runtimeHarness.instances[index] as RuntimeDouble;
}

beforeEach(() => {
  runtimeHarness.instances.length = 0;
  runtimeHarness.startFactory = () => Promise.resolve();
});

afterEach(() => {
  for (const connection of connections.splice(0)) {
    connection.controller.dispose();
    connection.hostPort.close();
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CapsuleController", () => {
  it("preserves a structured engine startup error", async () => {
    const startupError: BepEngineError = {
      code: "version-mismatch",
      message: "GNUbg ABI descriptor is unsupported",
      retryable: false,
      details: { wasmStatus: 9 },
    };
    runtimeHarness.startFactory = () =>
      Promise.reject(new WorkerRuntimeStartupError(startupError));
    const { hostPort, received } = connectController();
    const request = createChooseMessage();
    hostPort.postMessage(request);

    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          kind: "bep.error",
          requestId: request.requestId,
          error: startupError,
        }),
      ),
    );
  });

  it("rejects a duplicate active request ID", async () => {
    const { hostPort, received } = connectController();
    const request = createChooseMessage();
    hostPort.postMessage(request);
    const runtime = await getRuntime();
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledOnce());

    hostPort.postMessage(request);

    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          kind: "bep.error",
          requestId: request.requestId,
          error: expect.objectContaining({ code: "busy" }),
        }),
      ),
    );
  });

  it("cancels a request before runtime startup completes", async () => {
    const startup = createDeferred();
    runtimeHarness.startFactory = () => startup.promise;
    const { hostPort } = connectController();
    const request = createChooseMessage();
    hostPort.postMessage(request);
    const runtime = await getRuntime();

    hostPort.postMessage({
      protocol: BEP_PROTOCOL,
      version: BEP_VERSION,
      sessionNonce: NONCE,
      kind: "bep.cancel",
      requestId: request.requestId,
      reason: "caller",
    });
    await vi.waitFor(() =>
      expect(runtime.cancel).toHaveBeenCalledWith(request.requestId),
    );

    startup.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.request).not.toHaveBeenCalled();
  });

  it("terminates a cancelled runtime and recreates it for the next request", async () => {
    const { hostPort, received } = connectController();
    const cancelledRequest = createChooseMessage("request:cancelled");
    hostPort.postMessage(cancelledRequest);
    const firstRuntime = await getRuntime();
    await vi.waitFor(() =>
      expect(firstRuntime.request).toHaveBeenCalledOnce(),
    );

    hostPort.postMessage({
      protocol: BEP_PROTOCOL,
      version: BEP_VERSION,
      sessionNonce: NONCE,
      kind: "bep.cancel",
      requestId: cancelledRequest.requestId,
      reason: "caller",
    });
    await vi.waitFor(() =>
      expect(firstRuntime.cancel).toHaveBeenCalledWith(
        cancelledRequest.requestId,
      ),
    );

    const nextRequest = createChooseMessage("request:next");
    hostPort.postMessage(nextRequest);
    const secondRuntime = await getRuntime(1);
    await vi.waitFor(() =>
      expect(secondRuntime.request).toHaveBeenCalledWith(nextRequest),
    );

    firstRuntime.handlers.onFatal(new Error("late old-runtime failure"));
    expect(secondRuntime.dispose).not.toHaveBeenCalled();

    secondRuntime.handlers.onResult(nextRequest.requestId, nextRequest.method, {
      positionRevision: nextRequest.payload.position.revision,
      chosenTurnId: nextRequest.payload.legalTurns[0]?.id,
      stats: { elapsedMs: 1, completed: true },
    });
    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          kind: "bep.result",
          requestId: nextRequest.requestId,
        }),
      ),
    );
    expect(
      received.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          Reflect.get(message, "requestId") === cancelledRequest.requestId,
      ),
    ).toBe(false);
  });

  it("fails other active requests when cancellation replaces their runtime", async () => {
    const { hostPort, received } = connectController();
    const cancelledRequest = createChooseMessage("request:cancelled-shared");
    const interruptedRequest = createHelloMessage("request:interrupted");
    hostPort.postMessage(cancelledRequest);
    hostPort.postMessage(interruptedRequest);
    const runtime = await getRuntime();
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledTimes(2));

    hostPort.postMessage({
      protocol: BEP_PROTOCOL,
      version: BEP_VERSION,
      sessionNonce: NONCE,
      kind: "bep.cancel",
      requestId: cancelledRequest.requestId,
      reason: "timeout",
    });

    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          kind: "bep.error",
          requestId: interruptedRequest.requestId,
          error: expect.objectContaining({
            code: "engine-crash",
            retryable: true,
          }),
        }),
      ),
    );
    expect(
      received.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          Reflect.get(message, "requestId") === cancelledRequest.requestId,
      ),
    ).toBe(false);
  });

  it.each([
    ["wrong revision", "position:wrong", "turn:first"],
    ["unknown turn", "position:1", "turn:unknown"],
  ])("rejects an invalid Worker result with %s", async (_label, revision, turnId) => {
    const { hostPort, received } = connectController();
    const request = createChooseMessage();
    hostPort.postMessage(request);
    const runtime = await getRuntime();
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledOnce());

    runtime.handlers.onResult(request.requestId, request.method, {
      positionRevision: revision,
      chosenTurnId: turnId,
      stats: { elapsedMs: 1, completed: true },
    });

    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          kind: "bep.error",
          requestId: request.requestId,
          error: expect.objectContaining({ code: "internal-error" }),
        }),
      ),
    );
  });

  it.each([
    {
      label: "an unknown ranked turn",
      candidateLimit: 2,
      rankedTurns: [
        { turnId: "turn:first", rank: 1 },
        { turnId: "turn:unknown", rank: 2 },
      ],
    },
    {
      label: "more rankings than requested",
      candidateLimit: 1,
      rankedTurns: [
        { turnId: "turn:first", rank: 1 },
        { turnId: "turn:second", rank: 2 },
      ],
    },
    {
      label: "a rank-one turn different from the chosen turn",
      candidateLimit: 2,
      rankedTurns: [
        { turnId: "turn:second", rank: 1 },
        { turnId: "turn:first", rank: 2 },
      ],
    },
    {
      label: "an empty ranking list",
      candidateLimit: 2,
      rankedTurns: [],
    },
  ])("rejects $label", async ({ candidateLimit, rankedTurns }) => {
    const { hostPort, received } = connectController();
    const baseRequest = createChooseMessage();
    const request: BepRequestMessage<"choose-turn"> = {
      ...baseRequest,
      payload: {
        ...baseRequest.payload,
        settings: {
          ...baseRequest.payload.settings,
          limits: {
            ...baseRequest.payload.settings.limits,
            candidateLimit,
          },
        },
      },
    };
    hostPort.postMessage(request);
    const runtime = await getRuntime();
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledOnce());

    runtime.handlers.onResult(request.requestId, request.method, {
      positionRevision: request.payload.position.revision,
      chosenTurnId: "turn:first",
      rankedTurns,
      stats: { elapsedMs: 1, completed: true },
    });

    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          kind: "bep.error",
          requestId: request.requestId,
          error: expect.objectContaining({ code: "internal-error" }),
        }),
      ),
    );
  });

  it("accepts a correlated ranked-turn result", async () => {
    const { hostPort, received } = connectController();
    const request = createChooseMessage();
    hostPort.postMessage(request);
    const runtime = await getRuntime();
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledOnce());

    runtime.handlers.onResult(request.requestId, request.method, {
      positionRevision: request.payload.position.revision,
      chosenTurnId: "turn:first",
      rankedTurns: [
        { turnId: "turn:second", rank: 2, score: 0.25 },
        { turnId: "turn:first", rank: 1, score: 0.5 },
      ],
      stats: { elapsedMs: 1, completed: true },
    });

    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          kind: "bep.result",
          requestId: request.requestId,
        }),
      ),
    );
  });

  it("routes a fatal Worker error to every active request", async () => {
    const { hostPort, received } = connectController();
    hostPort.postMessage(createChooseMessage());
    hostPort.postMessage(createHelloMessage());
    const runtime = await getRuntime();
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledTimes(2));

    runtime.handlers.onFatal(new Error("Worker stopped"));

    await vi.waitFor(() => {
      const fatalErrors = received.filter(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          Reflect.get(message, "kind") === "bep.error" &&
          Reflect.get(Reflect.get(message, "error"), "code") ===
            "engine-crash",
      );
      expect(fatalErrors).toHaveLength(2);
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("does not forward a request after disposal during startup", async () => {
    const startup = createDeferred();
    runtimeHarness.startFactory = () => startup.promise;
    const { controller, hostPort, received } = connectController();
    hostPort.postMessage(createChooseMessage());
    const runtime = await getRuntime();

    controller.dispose();
    startup.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.request).not.toHaveBeenCalled();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(received).toEqual([]);
  });
});
