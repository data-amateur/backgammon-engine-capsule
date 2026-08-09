import type {
  BepEngineError,
  BepMethod,
  BepMethodPayloads,
  BepRequestId,
} from "../protocol/types";
import type { GnubgAssetUrls } from "./gnubgEngine";

export interface CapsuleWorkerInitialize {
  readonly kind: "capsule.worker-initialize";
  readonly assets: GnubgAssetUrls;
}

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
  | CapsuleWorkerInitialize
  | CapsuleWorkerRequest
  | CapsuleWorkerCancel
  | CapsuleWorkerDispose;

export interface CapsuleWorkerReady {
  readonly kind: "capsule.worker-ready";
}

export interface CapsuleWorkerStartupError {
  readonly kind: "capsule.worker-startup-error";
  readonly error: BepEngineError;
}

export interface CapsuleWorkerFatal {
  readonly kind: "capsule.worker-fatal";
  readonly message: string;
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
  | CapsuleWorkerStartupError
  | CapsuleWorkerFatal
  | CapsuleWorkerResult
  | CapsuleWorkerError;
