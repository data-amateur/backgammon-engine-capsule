/// <reference lib="webworker" />

/* SPDX-License-Identifier: GPL-3.0-or-later */

import type {
  BepEngineError,
  BepMethod,
} from "../protocol/types";
import {
  GnubgEngine,
  GnubgEngineError,
} from "./gnubgEngine";
import type {
  CapsuleToWorkerMessage,
  CapsuleWorkerError,
  CapsuleWorkerFatal,
  CapsuleWorkerRequest,
  CapsuleWorkerResult,
  CapsuleWorkerStartupError,
} from "./messages";

type WorkerState =
  | "waiting"
  | "initializing"
  | "ready"
  | "failed"
  | "disposed";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const cancelledRequests = new Set<string>();
let engine: GnubgEngine | null = null;
let state: WorkerState = "waiting";

function isDisposed(): boolean {
  return state === "disposed";
}

function safeMessage(error: unknown, fallback: string): string {
  const candidate =
    error instanceof GnubgEngineError
      ? error.bepError.message
      : error instanceof Error
        ? error.message
        : fallback;
  const sanitized = Array.from(candidate, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      ? " "
      : character;
  })
    .join("")
    .trim()
    .slice(0, 512);
  return sanitized || fallback;
}

function safeEngineError(error: BepEngineError): BepEngineError {
  return {
    ...error,
    message: safeMessage(
      new Error(error.message),
      "GNU Backgammon initialization failed",
    ),
  };
}

function postRequestError(
  requestId: string,
  method: BepMethod,
  error: BepEngineError,
): void {
  const message: CapsuleWorkerError = {
    kind: "capsule.worker-error",
    requestId,
    method,
    error,
  };
  workerScope.postMessage(message);
}

function releaseEngine(): void {
  const activeEngine = engine;
  engine = null;
  if (activeEngine) {
    try {
      activeEngine.dispose();
    } catch {
      // A terminal Worker is the recovery boundary even if native cleanup
      // itself traps after a fatal engine failure.
    }
  }
}

function disposeWorker(): void {
  if (state === "disposed") {
    return;
  }
  state = "disposed";
  cancelledRequests.clear();
  releaseEngine();
  workerScope.close();
}

function failWorker(error: unknown): void {
  if (state === "disposed") {
    return;
  }
  const message: CapsuleWorkerFatal = {
    kind: "capsule.worker-fatal",
    message: safeMessage(error, "GNU Backgammon Worker failed"),
  };
  workerScope.postMessage(message);
  disposeWorker();
}

async function initialize(
  message: Extract<CapsuleToWorkerMessage, {
    readonly kind: "capsule.worker-initialize";
  }>,
): Promise<void> {
  if (state !== "waiting") {
    failWorker(new Error("GNU Backgammon Worker was initialized more than once"));
    return;
  }
  state = "initializing";

  try {
    const created = await GnubgEngine.create(message.assets);
    if (isDisposed()) {
      created.dispose();
      return;
    }
    engine = created;
    state = "ready";
    workerScope.postMessage({ kind: "capsule.worker-ready" });
  } catch (error) {
    if (isDisposed()) {
      return;
    }
    state = "failed";
    const startupError: CapsuleWorkerStartupError = {
      kind: "capsule.worker-startup-error",
      error:
        error instanceof GnubgEngineError
          ? safeEngineError(error.bepError)
          : {
              code: "engine-crash",
              message: safeMessage(
                error,
                "GNU Backgammon initialization crashed",
              ),
              retryable: true,
            },
    };
    workerScope.postMessage(startupError);
    releaseEngine();
    workerScope.close();
  }
}

function runRequest(message: CapsuleWorkerRequest): void {
  const activeEngine = engine;
  if (state !== "ready" || !activeEngine) {
    postRequestError(message.requestId, message.method, {
      code: "not-ready",
      message: "GNU Backgammon is not ready",
      retryable: true,
    });
    return;
  }
  if (cancelledRequests.delete(message.requestId)) {
    return;
  }

  const startedAt = performance.now();
  try {
    let response: CapsuleWorkerResult;
    switch (message.method) {
      case "hello":
        response = {
          kind: "capsule.worker-result",
          requestId: message.requestId,
          method: message.method,
          payload: activeEngine.hello(message.payload),
        };
        break;
      case "choose-turn":
        response = {
          kind: "capsule.worker-result",
          requestId: message.requestId,
          method: message.method,
          payload: activeEngine.chooseTurn(message.payload, startedAt),
        };
        break;
      case "decide-cube":
        response = {
          kind: "capsule.worker-result",
          requestId: message.requestId,
          method: message.method,
          payload: activeEngine.decideCube(message.payload, startedAt),
        };
        break;
    }
    if (
      state === "ready" &&
      !cancelledRequests.delete(message.requestId)
    ) {
      workerScope.postMessage(response);
    }
  } catch (error) {
    if (state !== "ready" || cancelledRequests.delete(message.requestId)) {
      return;
    }
    if (error instanceof GnubgEngineError && !error.fatal) {
      postRequestError(message.requestId, message.method, error.bepError);
      return;
    }
    failWorker(error);
  }
}

workerScope.addEventListener(
  "message",
  (event: MessageEvent<CapsuleToWorkerMessage>) => {
    const message = event.data;
    switch (message.kind) {
      case "capsule.worker-initialize":
        void initialize(message);
        break;
      case "capsule.worker-request":
        runRequest(message);
        break;
      case "capsule.worker-cancel":
        cancelledRequests.add(message.requestId);
        break;
      case "capsule.worker-dispose":
        disposeWorker();
        break;
    }
  },
);
