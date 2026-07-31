import { getTrustedBootstrap } from "./bootstrap";
import { WorkerRuntime } from "./workerRuntime";
import {
  isBepEngineToHostMessage,
  isBepHostToEngineMessage,
} from "../protocol/validation";
import {
  BEP_PROTOCOL,
  BEP_RUNTIME_LIMITS,
  BEP_VERSION,
  type BepEngineError,
  type BepEngineToHostMessage,
  type BepMethod,
  type BepRequestMessage,
} from "../protocol/types";

export type CapsuleStatus =
  | "waiting"
  | "connected"
  | "initializing"
  | "ready"
  | "failed"
  | "disposed";

export interface CapsuleControllerOptions {
  readonly allowedParentOrigins: ReadonlySet<string>;
  readonly workerAssetUrl: string;
  readonly onStatusChange?: (status: CapsuleStatus, detail?: string) => void;
}

interface ActiveRequest {
  readonly request: BepRequestMessage;
}

export class CapsuleController {
  private readonly allowedParentOrigins: ReadonlySet<string>;
  private readonly workerAssetUrl: string;
  private readonly onStatusChange?: CapsuleControllerOptions["onStatusChange"];
  private connected = false;
  private disposed = false;
  private sessionNonce: string | null = null;
  private port: MessagePort | null = null;
  private runtime: WorkerRuntime | null = null;
  private runtimePromise: Promise<WorkerRuntime> | null = null;
  private readonly activeRequests = new Map<string, ActiveRequest>();

  public constructor(options: CapsuleControllerOptions) {
    this.allowedParentOrigins = options.allowedParentOrigins;
    this.workerAssetUrl = options.workerAssetUrl;
    this.onStatusChange = options.onStatusChange;
  }

  public start(): void {
    if (this.disposed) {
      throw new Error("Capsule controller is disposed");
    }
    window.addEventListener("message", this.handleBootstrapMessage);
    this.onStatusChange?.("waiting");
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    window.removeEventListener("message", this.handleBootstrapMessage);
    this.port?.removeEventListener("message", this.handlePortMessage);
    this.port?.removeEventListener("messageerror", this.handlePortMessageError);
    this.runtime?.dispose();
    this.runtime = null;
    this.runtimePromise = null;
    this.activeRequests.clear();
    this.port?.close();
    this.port = null;
    this.onStatusChange?.("disposed");
  }

  private readonly handleBootstrapMessage = (event: MessageEvent<unknown>) => {
    const trusted = getTrustedBootstrap(event, {
      parentWindow: window.parent,
      allowedParentOrigins: this.allowedParentOrigins,
      alreadyConnected: this.connected,
    });
    if (!trusted || this.disposed) {
      return;
    }

    this.connected = true;
    window.removeEventListener("message", this.handleBootstrapMessage);
    this.sessionNonce = trusted.message.sessionNonce;
    this.port = trusted.port;
    this.port.addEventListener("message", this.handlePortMessage);
    this.port.addEventListener("messageerror", this.handlePortMessageError);
    this.port.start();
    this.onStatusChange?.("connected");
  };

  private readonly handlePortMessage = (event: MessageEvent<unknown>) => {
    if (
      this.disposed ||
      !this.sessionNonce ||
      !isBepHostToEngineMessage(event.data, {
        maxMessageBytes: BEP_RUNTIME_LIMITS.maxMessageBytes,
      }) ||
      event.data.sessionNonce !== this.sessionNonce
    ) {
      return;
    }

    if (event.data.kind === "bep.dispose") {
      this.dispose();
      return;
    }
    if (event.data.kind === "bep.cancel") {
      this.activeRequests.delete(event.data.requestId);
      this.runtime?.cancel(event.data.requestId);
      return;
    }
    void this.handleRequest(event.data);
  };

  private readonly handlePortMessageError = () => {
    this.onStatusChange?.("failed", "Host sent an unreadable port message");
    this.dispose();
  };

  private async handleRequest(request: BepRequestMessage): Promise<void> {
    if (this.activeRequests.has(request.requestId)) {
      this.postError(request.requestId, request.method, {
        code: "busy",
        message: "A request with this ID is already active",
        retryable: false,
      });
      return;
    }

    this.activeRequests.set(request.requestId, { request });
    try {
      const runtime = await this.ensureRuntime();
      if (!this.activeRequests.has(request.requestId) || this.disposed) {
        return;
      }
      runtime.request(request.requestId, request.method, request.payload);
    } catch (error) {
      if (!this.activeRequests.delete(request.requestId)) {
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to initialize engine";
      this.postError(request.requestId, request.method, {
        code: "asset-load-failed",
        message,
        retryable: true,
      });
      this.onStatusChange?.("failed", message);
    }
  }

  private ensureRuntime(): Promise<WorkerRuntime> {
    if (this.runtime && this.runtimePromise) {
      return this.runtimePromise;
    }
    this.onStatusChange?.("initializing");
    const runtime = new WorkerRuntime(this.workerAssetUrl, {
      onResult: (requestId, method, payload) => {
        this.handleWorkerResult(requestId, method, payload);
      },
      onError: (requestId, method, error) => {
        if (this.activeRequests.delete(requestId)) {
          this.postError(requestId, method, error);
        }
      },
      onFatal: (error) => {
        this.handleWorkerFatal(error);
      },
    });
    this.runtime = runtime;
    this.runtimePromise = runtime
      .start()
      .then(() => {
        this.onStatusChange?.("ready");
        return runtime;
      })
      .catch((error: unknown) => {
        if (this.runtime === runtime) {
          this.runtime = null;
          this.runtimePromise = null;
        }
        runtime.dispose();
        throw error;
      });
    return this.runtimePromise;
  }

  private handleWorkerResult(
    requestId: string,
    method: BepMethod,
    payload: unknown,
  ): void {
    const active = this.activeRequests.get(requestId);
    if (!active || active.request.method !== method || !this.sessionNonce) {
      return;
    }

    const candidate: unknown = {
      protocol: BEP_PROTOCOL,
      version: BEP_VERSION,
      sessionNonce: this.sessionNonce,
      kind: "bep.result",
      requestId,
      method,
      payload,
    };
    if (
      !isBepEngineToHostMessage(candidate) ||
      !this.resultMatchesRequest(active.request, candidate)
    ) {
      this.activeRequests.delete(requestId);
      this.postError(requestId, method, {
        code: "internal-error",
        message: "Engine produced an invalid or uncorrelated result",
        retryable: false,
      });
      return;
    }

    this.activeRequests.delete(requestId);
    this.port?.postMessage(candidate);
  }

  private resultMatchesRequest(
    request: BepRequestMessage,
    result: BepEngineToHostMessage,
  ): boolean {
    if (result.kind !== "bep.result" || result.method !== request.method) {
      return false;
    }
    if (request.method === "hello" && result.method === "hello") {
      return (
        result.payload.metadata.engineId === "gnubg-capsule" &&
        result.payload.metadata.runtime.transport === "iframe"
      );
    }
    if (request.method === "choose-turn" && result.method === "choose-turn") {
      return (
        result.payload.positionRevision === request.payload.position.revision &&
        request.payload.legalTurns.some(
          ({ id }) => id === result.payload.chosenTurnId,
        )
      );
    }
    if (request.method === "decide-cube" && result.method === "decide-cube") {
      return (
        result.payload.positionRevision === request.payload.position.revision &&
        request.payload.legalDecisions.includes(result.payload.decision)
      );
    }
    return false;
  }

  private handleWorkerFatal(error: Error): void {
    const failedRuntime = this.runtime;
    this.runtime = null;
    this.runtimePromise = null;
    failedRuntime?.dispose();
    for (const [requestId, { request }] of this.activeRequests) {
      this.postError(requestId, request.method, {
        code: "engine-crash",
        message: error.message,
        retryable: true,
      });
    }
    this.activeRequests.clear();
    this.onStatusChange?.("failed", error.message);
  }

  private postError(
    requestId: string,
    method: BepMethod,
    error: BepEngineError,
  ): void {
    if (!this.sessionNonce || this.disposed) {
      return;
    }
    const message: unknown = {
      protocol: BEP_PROTOCOL,
      version: BEP_VERSION,
      sessionNonce: this.sessionNonce,
      kind: "bep.error",
      requestId,
      method,
      error,
    };
    if (isBepEngineToHostMessage(message)) {
      this.port?.postMessage(message);
    }
  }
}
