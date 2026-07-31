/// <reference lib="webworker" />

import type {
  BepChooseTurnRequest,
  BepCubeDecisionRequest,
  BepEngineError,
  BepHelloRequest,
  BepMethod,
} from "../protocol/types";
import { chooseTurn, decideCube, hello } from "./mockEngine";
import type {
  CapsuleToWorkerMessage,
  CapsuleWorkerError,
  CapsuleWorkerRequest,
  CapsuleWorkerResult,
} from "./messages";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const pending = new Map<string, number>();
let disposed = false;

function postError(
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

function runRequest(message: CapsuleWorkerRequest): void {
  if (disposed) {
    return;
  }
  const startedAt = performance.now();
  const timeoutId = workerScope.setTimeout(() => {
    pending.delete(message.requestId);
    if (disposed) {
      return;
    }
    try {
      let response: CapsuleWorkerResult;
      switch (message.method) {
        case "hello":
          response = {
            kind: "capsule.worker-result",
            requestId: message.requestId,
            method: message.method,
            payload: hello(message.payload as BepHelloRequest),
          };
          break;
        case "choose-turn":
          response = {
            kind: "capsule.worker-result",
            requestId: message.requestId,
            method: message.method,
            payload: chooseTurn(
              message.payload as BepChooseTurnRequest,
              startedAt,
            ),
          };
          break;
        case "decide-cube":
          response = {
            kind: "capsule.worker-result",
            requestId: message.requestId,
            method: message.method,
            payload: decideCube(
              message.payload as BepCubeDecisionRequest,
              startedAt,
            ),
          };
          break;
      }
      workerScope.postMessage(response);
    } catch (error) {
      postError(message.requestId, message.method, {
        code: "internal-error",
        message:
          error instanceof Error ? error.message : "Mock engine request failed",
        retryable: false,
      });
    }
  }, 0);
  pending.set(message.requestId, timeoutId);
}

workerScope.addEventListener(
  "message",
  (event: MessageEvent<CapsuleToWorkerMessage>) => {
    const message = event.data;
    if (message.kind === "capsule.worker-dispose") {
      disposed = true;
      for (const timeoutId of pending.values()) {
        workerScope.clearTimeout(timeoutId);
      }
      pending.clear();
      workerScope.close();
      return;
    }
    if (message.kind === "capsule.worker-cancel") {
      const timeoutId = pending.get(message.requestId);
      if (timeoutId !== undefined) {
        workerScope.clearTimeout(timeoutId);
        pending.delete(message.requestId);
      }
      return;
    }
    runRequest(message);
  },
);

workerScope.postMessage({ kind: "capsule.worker-ready" });
