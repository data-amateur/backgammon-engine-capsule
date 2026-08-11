import { getTrustedBootstrap } from "./bootstrap";
import {
  WorkerRuntime,
  WorkerRuntimeStartupError,
} from "./workerRuntime";
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
import type { GnubgAssetUrls } from "../worker/gnubgEngine";

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
  readonly engineAssets: GnubgAssetUrls;
  readonly onStatusChange?: (status: CapsuleStatus, detail?: string) => void;
}

export class CapsuleController {
  private readonly allowedParentOrigins: ReadonlySet<string>;
  private readonly workerAssetUrl: string;
  private readonly engineAssets: GnubgAssetUrls;
  private readonly onStatusChange?: CapsuleControllerOptions["onStatusChange"];
  private connected = false;
  private disposed = false;
  private sessionNonce: string | null = null;
  private port: MessagePort | null = null;
  private runtime: WorkerRuntime | null = null;
  private runtimePromise: Promise<WorkerRuntime> | null = null;
  private readonly activeRequests = new Map<string, BepRequestMessage>();
  private readonly requestTimeouts = new Map<
    string,
    ReturnType<typeof globalThis.setTimeout>
  >();

  public constructor(options: CapsuleControllerOptions) {
    this.allowedParentOrigins = options.allowedParentOrigins;
    this.workerAssetUrl = options.workerAssetUrl;
    this.engineAssets = options.engineAssets;
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
    this.clearAllRequestTimeouts();
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
      this.cancelRequest(event.data.requestId);
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

    this.activeRequests.set(request.requestId, request);
    try {
      const runtime = await this.ensureRuntime();
      if (!this.activeRequests.has(request.requestId) || this.disposed) {
        return;
      }
      this.armRequestTimeout(runtime, request);
      runtime.request(request);
    } catch (error) {
      this.clearRequestTimeout(request.requestId);
      if (!this.activeRequests.delete(request.requestId)) {
        return;
      }
      const startupError =
        error instanceof WorkerRuntimeStartupError
          ? error.bepError
          : {
              code: "internal-error" as const,
              message: "Engine runtime failed unexpectedly during startup",
              retryable: false,
            };
      this.postError(request.requestId, request.method, startupError);
      this.onStatusChange?.("failed", startupError.message);
    }
  }

  private ensureRuntime(): Promise<WorkerRuntime> {
    if (this.runtime && this.runtimePromise) {
      return this.runtimePromise;
    }
    this.onStatusChange?.("initializing");
    const runtime = new WorkerRuntime(this.workerAssetUrl, this.engineAssets, {
      onResult: (requestId, method, payload) => {
        if (this.runtime === runtime) {
          this.handleWorkerResult(requestId, method, payload);
        }
      },
      onError: (requestId, method, error) => {
        this.clearRequestTimeout(requestId);
        if (
          this.runtime === runtime &&
          this.activeRequests.delete(requestId)
        ) {
          this.postError(requestId, method, error);
        }
      },
      onFatal: (error) => {
        this.handleWorkerFatal(runtime, error);
      },
    });
    this.runtime = runtime;
    this.runtimePromise = runtime
      .start()
      .then(() => {
        if (this.disposed) {
          throw new WorkerRuntimeStartupError({
            code: "disposed",
            message: "Capsule controller was disposed during startup",
            retryable: false,
          });
        }
        if (this.runtime !== runtime) {
          throw new WorkerRuntimeStartupError({
            code: "cancelled",
            message: "Worker runtime was superseded during startup",
            retryable: true,
          });
        }
        this.onStatusChange?.("ready");
        return runtime;
      })
      .catch((error: unknown) => {
        if (this.runtime === runtime) {
          this.runtime = null;
          this.runtimePromise = null;
          runtime.dispose();
        }
        throw error;
      });
    return this.runtimePromise;
  }

  private cancelRequest(requestId: string): void {
    this.clearRequestTimeout(requestId);
    if (!this.activeRequests.delete(requestId)) {
      return;
    }

    const cancelledRuntime = this.runtime;
    if (!cancelledRuntime) {
      return;
    }
    this.runtime = null;
    this.runtimePromise = null;
    cancelledRuntime.cancel(requestId);

    const interruptedMessage =
      "Engine runtime restarted because another request was cancelled";
    for (const [activeId, request] of this.activeRequests) {
      this.clearRequestTimeout(activeId);
      this.postError(activeId, request.method, {
        code: "engine-crash",
        message: interruptedMessage,
        retryable: true,
      });
    }
    this.activeRequests.clear();
    if (!this.disposed) {
      this.onStatusChange?.("connected");
    }
  }

  private handleWorkerResult(
    requestId: string,
    method: BepMethod,
    payload: unknown,
  ): void {
    const activeRequest = this.activeRequests.get(requestId);
    if (!activeRequest || activeRequest.method !== method || !this.sessionNonce) {
      return;
    }
    this.clearRequestTimeout(requestId);

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
      !this.resultMatchesRequest(activeRequest, candidate)
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
      const legalTurnIds = new Set(
        request.payload.legalTurns.map(({ id }) => id),
      );
      if (
        result.payload.positionRevision !== request.payload.position.revision ||
        !legalTurnIds.has(result.payload.chosenTurnId)
      ) {
        return false;
      }
      const rankedTurns = result.payload.rankedTurns;
      if (rankedTurns === undefined) {
        return true;
      }
      const requestedCandidateLimit =
        request.payload.settings.limits.candidateLimit ?? legalTurnIds.size;
      const rankingLimit = Math.min(
        requestedCandidateLimit,
        legalTurnIds.size,
      );
      return (
        rankedTurns.length > 0 &&
        rankedTurns.length <= rankingLimit &&
        rankedTurns.every(({ turnId }) => legalTurnIds.has(turnId)) &&
        rankedTurns.find(({ rank }) => rank === 1)?.turnId ===
          result.payload.chosenTurnId
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

  private handleWorkerFatal(runtime: WorkerRuntime, error: Error): void {
    if (this.runtime !== runtime) {
      return;
    }
    this.runtime = null;
    this.runtimePromise = null;
    runtime.dispose();
    for (const [requestId, request] of this.activeRequests) {
      this.clearRequestTimeout(requestId);
      this.postError(requestId, request.method, {
        code: "engine-crash",
        message: error.message,
        retryable: true,
      });
    }
    this.activeRequests.clear();
    this.onStatusChange?.("failed", error.message);
  }

  private armRequestTimeout(
    runtime: WorkerRuntime,
    request: BepRequestMessage,
  ): void {
    if (request.method === "hello") {
      return;
    }
    const timeMs = request.payload.settings.limits.timeMs;
    if (timeMs === undefined) {
      return;
    }
    this.clearRequestTimeout(request.requestId);
    const timeoutId = globalThis.setTimeout(() => {
      if (
        this.runtime !== runtime ||
        !this.activeRequests.delete(request.requestId)
      ) {
        return;
      }
      this.clearRequestTimeout(request.requestId);
      const message = `Engine exceeded its ${timeMs} ms request budget`;
      this.postError(request.requestId, request.method, {
        code: "timeout",
        message,
        retryable: true,
      });

      this.runtime = null;
      this.runtimePromise = null;
      runtime.cancel(request.requestId);
      for (const [activeId, activeRequest] of this.activeRequests) {
        this.clearRequestTimeout(activeId);
        this.postError(activeId, activeRequest.method, {
          code: "engine-crash",
          message: "Engine runtime restarted after another request timed out",
          retryable: true,
        });
      }
      this.activeRequests.clear();
      this.onStatusChange?.("failed", message);
    }, timeMs);
    this.requestTimeouts.set(request.requestId, timeoutId);
  }

  private clearRequestTimeout(requestId: string): void {
    const timeoutId = this.requestTimeouts.get(requestId);
    if (timeoutId === undefined) {
      return;
    }
    globalThis.clearTimeout(timeoutId);
    this.requestTimeouts.delete(requestId);
  }

  private clearAllRequestTimeouts(): void {
    for (const timeoutId of this.requestTimeouts.values()) {
      globalThis.clearTimeout(timeoutId);
    }
    this.requestTimeouts.clear();
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
