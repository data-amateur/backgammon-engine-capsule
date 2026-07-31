import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BepEngineError,
  BepMethod,
  BepRequestMessage,
} from "../../src/protocol/types";
import { BEP_PROTOCOL, BEP_VERSION } from "../../src/protocol/types";
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
  WorkerRuntime: class {
    public readonly start = vi.fn(() => runtimeHarness.startFactory());
    public readonly request = vi.fn(() => undefined);
    public readonly cancel = vi.fn(() => undefined);
    public readonly dispose = vi.fn(() => undefined);

    public constructor(
      _workerAssetUrl: string,
      public readonly handlers: RuntimeHandlersDouble,
    ) {
      runtimeHarness.instances.push(this);
    }
  },
}));

import { CapsuleController } from "../../src/capsule/controller";

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
    workerAssetUrl: "http://localhost:4174/mock-engine.worker.js",
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

async function getRuntime(): Promise<RuntimeDouble> {
  await vi.waitFor(() => expect(runtimeHarness.instances).toHaveLength(1));
  return runtimeHarness.instances[0] as RuntimeDouble;
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
