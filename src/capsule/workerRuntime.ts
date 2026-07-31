import { hasBoundedJsonShape, isBepEngineError, isBepMethod, isRecord } from "../protocol/validation";
import type {
  BepEngineError,
  BepMethod,
  BepMethodPayloads,
  BepRequestId,
} from "../protocol/types";
import type {
  CapsuleToWorkerMessage,
  CapsuleWorkerRequest,
  WorkerToCapsuleMessage,
} from "../worker/messages";

const WORKER_READY_TIMEOUT_MS = 8_000;

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
  private readonly handlers: WorkerRuntimeHandlers;
  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private startupAbortController: AbortController | null = null;
  private ready = false;
  private disposed = false;

  public constructor(
    workerAssetUrl: string,
    handlers: WorkerRuntimeHandlers,
  ) {
    this.workerAssetUrl = workerAssetUrl;
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
          name: "backgammon-mock-engine",
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
          if (
            isRecord(event.data) &&
            event.data.kind === "capsule.worker-ready"
          ) {
            cleanupStartupListeners();
            this.ready = true;
            worker.addEventListener("message", this.handleMessage);
            worker.addEventListener("error", this.handleError);
            worker.addEventListener("messageerror", this.handleMessageError);
            resolve();
          }
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

  public request<M extends BepMethod>(
    requestId: BepRequestId,
    method: M,
    payload: BepMethodPayloads[M]["request"],
  ): void {
    if (this.disposed || !this.ready || !this.worker) {
      throw new Error("Capsule Worker is not ready");
    }
    const message: CapsuleWorkerRequest = {
      kind: "capsule.worker-request",
      requestId,
      method,
      payload,
    } as CapsuleWorkerRequest;
    this.worker.postMessage(message);
  }

  public cancel(requestId: BepRequestId): void {
    if (!this.worker || this.disposed) {
      return;
    }
    const message: CapsuleToWorkerMessage = {
      kind: "capsule.worker-cancel",
      requestId,
    };
    this.worker.postMessage(message);
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
      const message: CapsuleToWorkerMessage = {
        kind: "capsule.worker-dispose",
      };
      this.worker.postMessage(message);
      this.worker.removeEventListener("message", this.handleMessage);
      this.worker.removeEventListener("error", this.handleError);
      this.worker.removeEventListener("messageerror", this.handleMessageError);
      this.worker.terminate();
      this.worker = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    if (!hasBoundedJsonShape(event.data) || !isRecord(event.data)) {
      this.fail(new Error("Capsule Worker returned a malformed message"));
      return;
    }
    const message = event.data as unknown as WorkerToCapsuleMessage;
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
    this.handlers.onResult(message.requestId, message.method, message.payload);
  };

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
