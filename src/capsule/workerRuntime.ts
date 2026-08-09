import {
  hasBoundedJsonShape,
  isBepEngineError,
  isBepMethod,
  isRecord,
} from "../protocol/validation";
import type {
  BepEngineError,
  BepMethod,
  BepRequestMessage,
  BepRequestId,
} from "../protocol/types";
import type {
  CapsuleToWorkerMessage,
  CapsuleWorkerRequest,
} from "../worker/messages";
import type { GnubgAssetUrls } from "../worker/gnubgEngine";

const WORKER_READY_TIMEOUT_MS = 8_000;

export class WorkerRuntimeStartupError extends Error {
  public constructor(public readonly bepError: BepEngineError) {
    super(bepError.message);
    this.name = "WorkerRuntimeStartupError";
  }
}

export interface WorkerRuntimeHandlers {
  readonly onResult: (
    requestId: BepRequestId,
    method: BepMethod,
    payload: unknown,
  ) => void;
  readonly onError: (
    requestId: BepRequestId,
    method: BepMethod,
    error: BepEngineError,
  ) => void;
  readonly onFatal: (error: Error) => void;
}

export class WorkerRuntime {
  private readonly workerAssetUrl: string;
  private readonly engineAssets: GnubgAssetUrls;
  private readonly handlers: WorkerRuntimeHandlers;
  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private startupAbortController: AbortController | null = null;
  private ready = false;
  private disposed = false;

  public constructor(
    workerAssetUrl: string,
    engineAssets: GnubgAssetUrls,
    handlers: WorkerRuntimeHandlers,
  ) {
    this.workerAssetUrl = workerAssetUrl;
    this.engineAssets = engineAssets;
    this.handlers = handlers;
  }

  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("Worker runtime is disposed");
    }
    const abortController = new AbortController();
    this.startupAbortController = abortController;

    try {
      const response = await fetch(this.workerAssetUrl, {
        mode: "cors",
        credentials: "omit",
        cache: import.meta.env.DEV ? "no-store" : "default",
        signal: abortController.signal,
      });
      this.throwIfDisposed();
      if (!response.ok) {
        throw new Error(`Worker asset returned HTTP ${response.status}`);
      }
      const source = await response.text();
      this.throwIfDisposed();
      if (source.trim().length === 0) {
        throw new Error("Worker asset was empty");
      }
      this.blobUrl = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );

      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(this.blobUrl as string, {
          name: "backgammon-gnubg-engine",
        });
        this.worker = worker;
        const timeoutId = window.setTimeout(() => {
          cleanupStartupListeners();
          reject(new Error("Timed out initializing the capsule Worker"));
        }, WORKER_READY_TIMEOUT_MS);

        const cleanupStartupListeners = () => {
          window.clearTimeout(timeoutId);
          abortController.signal.removeEventListener(
            "abort",
            handleStartupAbort,
          );
          worker.removeEventListener("message", handleStartupMessage);
          worker.removeEventListener("error", handleStartupError);
          worker.removeEventListener(
            "messageerror",
            handleStartupMessageError,
          );
        };
        const handleStartupAbort = () => {
          cleanupStartupListeners();
          reject(new Error("Worker runtime is disposed"));
        };
        const handleStartupMessage = (event: MessageEvent<unknown>) => {
          if (!hasBoundedJsonShape(event.data) || !isRecord(event.data)) {
            cleanupStartupListeners();
            reject(new Error("Capsule Worker returned a malformed startup message"));
            return;
          }
          if (event.data.kind === "capsule.worker-ready") {
            cleanupStartupListeners();
            this.ready = true;
            worker.addEventListener("message", this.handleMessage);
            worker.addEventListener("error", this.handleError);
            worker.addEventListener("messageerror", this.handleMessageError);
            resolve();
            return;
          }
          if (event.data.kind === "capsule.worker-startup-error") {
            cleanupStartupListeners();
            reject(
              isBepEngineError(event.data.error)
                ? new WorkerRuntimeStartupError(event.data.error)
                : new Error("Capsule Worker returned an invalid startup error"),
            );
            return;
          }
          if (
            event.data.kind === "capsule.worker-fatal" &&
            typeof event.data.message === "string" &&
            event.data.message.trim().length > 0
          ) {
            cleanupStartupListeners();
            reject(
              new WorkerRuntimeStartupError({
                code: "engine-crash",
                message: event.data.message,
                retryable: true,
              }),
            );
            return;
          }
          cleanupStartupListeners();
          reject(new Error("Capsule Worker returned an unknown startup message"));
        };
        const handleStartupError = (event: ErrorEvent) => {
          cleanupStartupListeners();
          reject(
            new Error(
              event.message || "Capsule Worker crashed during initialization",
            ),
          );
        };
        const handleStartupMessageError = () => {
          cleanupStartupListeners();
          reject(new Error("Capsule Worker sent an unreadable ready message"));
        };

        abortController.signal.addEventListener("abort", handleStartupAbort, {
          once: true,
        });
        worker.addEventListener("message", handleStartupMessage);
        worker.addEventListener("error", handleStartupError, { once: true });
        worker.addEventListener("messageerror", handleStartupMessageError, {
          once: true,
        });
        const initializeMessage: CapsuleToWorkerMessage = {
          kind: "capsule.worker-initialize",
          assets: this.engineAssets,
        };
        try {
          worker.postMessage(initializeMessage);
        } catch (error) {
          cleanupStartupListeners();
          reject(
            error instanceof Error
              ? error
              : new Error("Failed to initialize the capsule Worker"),
          );
        }
      });
    } catch (error) {
      const wasDisposed = this.disposed;
      this.dispose();
      if (wasDisposed) {
        throw new Error("Worker runtime is disposed", { cause: error });
      }
      throw error;
    } finally {
      if (this.startupAbortController === abortController) {
        this.startupAbortController = null;
      }
    }
  }

  public request(request: BepRequestMessage): void {
    if (this.disposed || !this.ready || !this.worker) {
      throw new Error("Capsule Worker is not ready");
    }
    this.worker.postMessage(this.createWorkerRequest(request));
  }

  public cancel(requestId: BepRequestId): void {
    if (this.disposed) {
      return;
    }
    // GNUbg calls are synchronous inside the compute Worker. Posting a cancel
    // message cannot interrupt one, so cancellation terminates this module
    // instance immediately. The controller creates a fresh runtime on demand.
    void requestId;
    this.dispose();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.ready = false;
    this.startupAbortController?.abort();
    this.startupAbortController = null;
    if (this.worker) {
      const worker = this.worker;
      this.worker = null;
      const message: CapsuleToWorkerMessage = {
        kind: "capsule.worker-dispose",
      };
      try {
        worker.postMessage(message);
      } catch {
        // A crashed or already-closing Worker can reject postMessage. Local
        // teardown must still finish so cancellation and fatal recovery stay
        // terminal for this module instance.
      }
      worker.removeEventListener("message", this.handleMessage);
      worker.removeEventListener("error", this.handleError);
      worker.removeEventListener("messageerror", this.handleMessageError);
      worker.terminate();
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    if (this.disposed) {
      return;
    }
    if (!hasBoundedJsonShape(event.data) || !isRecord(event.data)) {
      this.fail(new Error("Capsule Worker returned a malformed message"));
      return;
    }
    const message = event.data;
    if (
      message.kind === "capsule.worker-fatal" &&
      typeof message.message === "string" &&
      message.message.trim().length > 0
    ) {
      this.fail(new Error(message.message));
      return;
    }
    if (
      (message.kind !== "capsule.worker-result" &&
        message.kind !== "capsule.worker-error") ||
      typeof message.requestId !== "string" ||
      !isBepMethod(message.method)
    ) {
      this.fail(new Error("Capsule Worker returned an unknown message"));
      return;
    }
    if (message.kind === "capsule.worker-error") {
      if (!isBepEngineError(message.error)) {
        this.fail(new Error("Capsule Worker returned an invalid error"));
        return;
      }
      this.handlers.onError(message.requestId, message.method, message.error);
      return;
    }
    // Payload validation and request correlation intentionally happen in the
    // controller before any Worker result can cross the public BEP boundary.
    this.handlers.onResult(message.requestId, message.method, message.payload);
  };

  private createWorkerRequest(
    request: BepRequestMessage,
  ): CapsuleWorkerRequest {
    // The repeated branches intentionally preserve method/payload correlation
    // while constructing the internal discriminated union without a cast.
    switch (request.method) {
      case "hello":
        return {
          kind: "capsule.worker-request",
          requestId: request.requestId,
          method: request.method,
          payload: request.payload,
        };
      case "choose-turn":
        return {
          kind: "capsule.worker-request",
          requestId: request.requestId,
          method: request.method,
          payload: request.payload,
        };
      case "decide-cube":
        return {
          kind: "capsule.worker-request",
          requestId: request.requestId,
          method: request.method,
          payload: request.payload,
        };
    }
    const exhaustiveRequest: never = request;
    throw new Error(`Unsupported BEP request: ${String(exhaustiveRequest)}`);
  }

  private readonly handleError = () => {
    this.fail(new Error("Capsule Worker crashed"));
  };

  private readonly handleMessageError = () => {
    this.fail(new Error("Capsule Worker returned an unreadable message"));
  };

  private fail(error: Error): void {
    if (this.disposed) {
      return;
    }
    this.dispose();
    this.handlers.onFatal(error);
  }

  private throwIfDisposed(): void {
    if (this.disposed) {
      throw new Error("Worker runtime is disposed");
    }
  }
}
