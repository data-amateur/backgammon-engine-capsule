import type {
  BepEngineError,
  BepMethod,
  BepMethodPayloads,
  BepRequestId,
} from "../protocol/types";

export type CapsuleWorkerRequest = {
  [M in BepMethod]: {
    readonly kind: "capsule.worker-request";
    readonly requestId: BepRequestId;
    readonly method: M;
    readonly payload: BepMethodPayloads[M]["request"];
  };
}[BepMethod];

export interface CapsuleWorkerCancel {
  readonly kind: "capsule.worker-cancel";
  readonly requestId: BepRequestId;
}

export interface CapsuleWorkerDispose {
  readonly kind: "capsule.worker-dispose";
}

export type CapsuleToWorkerMessage =
  | CapsuleWorkerRequest
  | CapsuleWorkerCancel
  | CapsuleWorkerDispose;

export interface CapsuleWorkerReady {
  readonly kind: "capsule.worker-ready";
}

export type CapsuleWorkerResult = {
  [M in BepMethod]: {
    readonly kind: "capsule.worker-result";
    readonly requestId: BepRequestId;
    readonly method: M;
    readonly payload: BepMethodPayloads[M]["result"];
  };
}[BepMethod];

export interface CapsuleWorkerError {
  readonly kind: "capsule.worker-error";
  readonly requestId: BepRequestId;
  readonly method: BepMethod;
  readonly error: BepEngineError;
}

export type WorkerToCapsuleMessage =
  | CapsuleWorkerReady
  | CapsuleWorkerResult
  | CapsuleWorkerError;
