export const BEP_PROTOCOL = "backgammon-engine-protocol" as const;
export const BEP_VERSION = 1 as const;

export const BEP_RUNTIME_LIMITS = {
  maxMessageBytes: 2 * 1024 * 1024,
  maxDepth: 16,
  maxNodes: 100_000,
  maxTimeMs: 120_000,
  maxMemoryMb: 4_096,
  maxCubeValue: 4_096,
  maxMatchLength: 64,
  maxMatchCubeValue: 64,
  maxStringLength: 64 * 1024,
  maxIdentifierLength: 128,
  minSessionNonceLength: 32,
  maxUrlLength: 2_048,
  maxArrayLength: 4_096,
  maxObjectKeys: 128,
  maxLegalTurns: 4_096,
  maxTurnSteps: 4,
} as const;

export type Player = "white" | "black";
export type BepProtocolVersion = typeof BEP_VERSION;
export type BepPositionRevision = string;
export type BepRequestId = string;
export type BepSessionNonce = string;

export type BepJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BepJsonValue[]
  | { readonly [key: string]: BepJsonValue };

export type BepPositionPhase =
  | "before-roll"
  | "checker-play"
  | "cube-response"
  | "game-over";

export interface BepPoint {
  readonly white: number;
  readonly black: number;
}

export interface BepCheckerCounts {
  readonly white: number;
  readonly black: number;
}

export interface BepBoard {
  /**
   * Absolute point numbering, 0 through 23. White enters on point 23 and
   * moves toward point 0; black enters on point 0 and moves toward point 23.
   */
  readonly points: readonly BepPoint[];
  readonly bar: BepCheckerCounts;
  readonly borneOff: BepCheckerCounts;
}

export type BepCubeState =
  | "available"
  | "offered"
  | "accepted"
  | "declined";

export interface BepCube {
  readonly value: number;
  readonly owner: Player | null;
  readonly state: BepCubeState;
  readonly offeredBy: Player | null;
}

export type BepMatchMode = "match" | "money";
export type BepCrawfordState = "none" | "crawford" | "post-crawford";

export interface BepMatch {
  readonly mode: BepMatchMode;
  readonly length: number | null;
  readonly score: BepCheckerCounts;
  readonly crawford: BepCrawfordState;
}

export interface BepRules {
  readonly variation: string;
  readonly jacoby: boolean;
  readonly beavers: boolean;
  readonly raccoons: boolean;
  readonly automaticDoubles: number;
}

export interface BepPosition {
  readonly revision: BepPositionRevision;
  readonly phase: BepPositionPhase;
  readonly board: BepBoard;
  readonly playerOnRoll: Player;
  readonly dice: readonly [] | readonly [number, number];
  readonly cube: BepCube;
  readonly match: BepMatch;
  readonly rules: BepRules;
}

export type BepCheckerLocation =
  | { readonly kind: "point"; readonly point: number }
  | { readonly kind: "bar" }
  | { readonly kind: "borne-off" };

export interface BepTurnStep {
  readonly from: BepCheckerLocation;
  readonly to: BepCheckerLocation;
  readonly die: number;
  readonly hit: boolean;
}

export interface BepLegalTurn {
  readonly id: string;
  readonly steps: readonly BepTurnStep[];
  readonly resultingBoard?: BepBoard;
}

export type BepStrengthPreset =
  | "beginner"
  | "casual"
  | "intermediate"
  | "expert"
  | "maximum";

export interface BepSearchLimits {
  /** Hard wall-clock budget enforced by the capsule around the compute Worker. */
  readonly timeMs?: number;
  /** Maximum requested search depth. Engines may return a shallower partial result. */
  readonly maxDepth?: number;
  /** Optional hard node ceiling; engines must reject it when they cannot count nodes. */
  readonly maxNodes?: number;
  /** Maximum memory available to the engine in MiB. */
  readonly memoryMb?: number;
  /** Maximum number of rankings returned; it does not reduce legal-turn evaluation. */
  readonly candidateLimit?: number;
}

export interface BepRandomization {
  readonly mode: "deterministic" | "varied";
  readonly seed: string;
  readonly variability: number;
}

export interface BepEngineSettings {
  readonly strength: BepStrengthPreset;
  readonly limits: BepSearchLimits;
  readonly randomization: BepRandomization;
}

export interface BepEngineCapabilities {
  readonly chooseTurn: boolean;
  readonly cubeOffer: boolean;
  readonly cubeResponse: boolean;
  readonly positionEvaluation: boolean;
  readonly moveRanking: boolean;
  readonly rollout: boolean;
  readonly matchPlay: boolean;
  readonly moneyPlay: boolean;
  readonly cancellation: boolean;
  readonly deterministic: boolean;
  readonly variations: readonly string[];
  readonly strengthPresets: readonly BepStrengthPreset[];
  /** Optional BEP v1 extension; absence means analysis is unavailable. */
  readonly analysis?: BepAnalysisCapabilities;
}

export interface BepEngineLicense {
  readonly spdxId: string;
  readonly name?: string;
  readonly sourceUrl?: string;
  readonly licenseUrl?: string;
}

export interface BepEngineRuntime {
  readonly transport: "worker" | "iframe" | "http";
  readonly approximateDownloadBytes?: number;
  readonly approximateMemoryBytes?: number;
  /** Allocated linear memory sampled at hello; excludes browser/JS overhead. */
  readonly wasmMemoryBytes?: number;
  readonly wasmMemoryLimitBytes?: number;
}

export interface BepEngineMetadata {
  readonly engineId: string;
  readonly name: string;
  readonly version: string;
  readonly buildId: string;
  readonly protocolVersions: readonly BepProtocolVersion[];
  readonly license: BepEngineLicense;
  readonly runtime: BepEngineRuntime;
  readonly capabilities: BepEngineCapabilities;
}

export interface BepHelloRequest {
  readonly supportedProtocolVersions: readonly BepProtocolVersion[];
  readonly host: {
    readonly name: string;
    readonly version: string;
  };
}

export interface BepHelloResult {
  readonly selectedProtocolVersion: BepProtocolVersion;
  readonly metadata: BepEngineMetadata;
}

export interface BepChooseTurnRequest {
  readonly enginePlayer: Player;
  readonly position: BepPosition;
  readonly legalTurns: readonly BepLegalTurn[];
  readonly settings: BepEngineSettings;
}

export interface BepRankedTurn {
  readonly turnId: string;
  readonly rank: number;
  readonly score?: number;
}

export interface BepSearchStats {
  readonly elapsedMs: number;
  readonly nodes?: number;
  readonly depth?: number;
  readonly completed: boolean;
}

export interface BepChooseTurnResult {
  readonly positionRevision: BepPositionRevision;
  readonly chosenTurnId: string;
  readonly rankedTurns?: readonly BepRankedTurn[];
  readonly stats: BepSearchStats;
}

export type BepCubeDecision =
  | "double"
  | "no-double"
  | "too-good"
  | "take"
  | "pass"
  | "beaver";

export type BepCubeDecisionPhase = "consider-offer" | "respond-to-offer";

export interface BepCubeDecisionRequest {
  readonly enginePlayer: Player;
  readonly position: BepPosition;
  readonly phase: BepCubeDecisionPhase;
  readonly legalDecisions: readonly BepCubeDecision[];
  readonly settings: BepEngineSettings;
}

export interface BepCubeDecisionResult {
  readonly positionRevision: BepPositionRevision;
  readonly decision: BepCubeDecision;
  readonly stats: BepSearchStats;
}

export const BEP_ANALYSIS_SCHEMA_VERSION = 1 as const;
export const BEP_ANALYSIS_LIMITS = {
  maxAlternatives: 5,
  maxReturnedCandidates: 6,
  maxDeepRootPositions: 9,
  maxLegalPositions: 4_096,
  equityTolerance: 0.00001,
} as const;

export type BepAnalysisMethod = "analyze-checker" | "analyze-cube";
export type BepAnalysisProfile = "quick-0ply-v1" | "deep-2ply-v1";

export interface BepAnalysisCapabilities {
  readonly schemaVersions: readonly (typeof BEP_ANALYSIS_SCHEMA_VERSION)[];
  readonly methods: readonly BepAnalysisMethod[];
  readonly profiles: readonly BepAnalysisProfile[];
  /** Optional exact Quick identity, available after runtime initialization. */
  readonly quickProvenance?: BepAnalysisProvenance;
  /** Exact completed Deeper profile; independent of gameplay strength presets. */
  readonly deepProvenance?: BepAnalysisProvenance;
}

export interface BepAnalysisRequest {
  readonly schemaVersion: typeof BEP_ANALYSIS_SCHEMA_VERSION;
  readonly position: BepPosition;
  readonly actor: Player;
  readonly profile: BepAnalysisProfile;
  /** Hard budget enforced outside the synchronous compute Worker. */
  readonly timeMs: number;
}

export interface BepAnalyzeCheckerRequest extends BepAnalysisRequest {
  readonly playedTurn: { readonly steps: readonly BepTurnStep[] };
  readonly expectedResultingBoard: BepBoard;
  /** Output limit only; Quick always evaluates the complete legal root set. */
  readonly maxAlternatives: number;
}

export interface BepAnalysisSegment {
  readonly from: BepCheckerLocation;
  readonly to: BepCheckerLocation;
  readonly hit: boolean;
  /** No die attribution: GNUbg canonical segments do not supply it. */
}

export interface BepAnalysisCandidate {
  /** Absolute resulting-board identity; never a gameplay turn ID. */
  readonly id: string;
  readonly resultingBoard: BepBoard;
  readonly segments: readonly BepAnalysisSegment[];
  /** GNUbg normalized cubeful equity, from the decision actor's perspective. */
  readonly equity: number;
  readonly rank: number;
  readonly tiedWithBest: boolean;
}

export interface BepAnalysisProvenance {
  readonly engineId: string;
  readonly engineVersion: string;
  readonly buildId: string;
  /** Content-addressed identity of the exact module, WASM, data and build info. */
  readonly assetsId: string;
  readonly weightsSha256: string;
  readonly matchEquityTableId: string;
  readonly matchEquitySha256: string;
  readonly bearoff: "gnubg-heuristic-1.08.003-no-database";
  readonly requestedProfile: BepAnalysisProfile;
  readonly effectiveProfile: BepAnalysisProfile;
  readonly depth: 0 | 2;
  readonly cubeful: true;
  readonly deterministic: true;
  readonly noise: 0;
  readonly pruning: boolean;
  readonly filterPolicy: "all-unique-root-positions-v1" | "quick-top2-window160-max8-plus-played-v1";
  readonly completion: "complete";
}

export interface BepAnalyzeCheckerResult {
  readonly schemaVersion: typeof BEP_ANALYSIS_SCHEMA_VERSION;
  readonly positionRevision: BepPositionRevision;
  readonly actor: Player;
  readonly playedLegal: true;
  readonly playedCandidateId: string;
  readonly bestCandidateId: string;
  /** Top requested alternatives in rank order, plus played if outside them. */
  readonly candidates: readonly BepAnalysisCandidate[];
  /** A forced pass has one legal final position: the unchanged board. */
  readonly legalPositionCount: number;
  /** Roots fully evaluated at the effective depth, including the played root. */
  readonly evaluatedPositionCount: number;
  readonly forced: boolean;
  readonly noPlay: boolean;
  readonly equityLoss: number;
  readonly elapsedMs: number;
  readonly provenance: BepAnalysisProvenance;
}

export interface BepAnalyzeCubeRequest extends BepAnalysisRequest {
  /** Position retains the pre-offer board, cube and offerer's on-roll context. */
  readonly role: "offer" | "response";
  readonly recordedAction: "double" | "no-double" | "take" | "pass";
}

export interface BepAnalyzeCubeResult {
  readonly schemaVersion: typeof BEP_ANALYSIS_SCHEMA_VERSION;
  readonly positionRevision: BepPositionRevision;
  readonly actor: Player;
  readonly role: "offer" | "response";
  readonly availableActions: readonly ("double" | "no-double" | "take" | "pass")[];
  readonly recommendedAction: "double" | "no-double" | "take" | "pass";
  /** Branch equities retain the offerer's perspective at the pre-offer cube. */
  readonly equityPerspective: Player;
  readonly referenceCube: number;
  /** GNUbg's verified too-good classification; distinct from ordinary no double. */
  readonly tooGood?: boolean;
  readonly noDoubleEquity: number;
  readonly doubleTakeEquity: number;
  readonly doublePassEquity: number;
  readonly recordedActionEquity: number;
  readonly equityLoss: number;
  readonly elapsedMs: number;
  readonly provenance: BepAnalysisProvenance;
}

export type BepMethod = "hello" | "choose-turn" | "decide-cube" | BepAnalysisMethod;

export interface BepMethodPayloads {
  readonly "analyze-checker": {
    readonly request: BepAnalyzeCheckerRequest;
    readonly result: BepAnalyzeCheckerResult;
  };
  readonly "analyze-cube": {
    readonly request: BepAnalyzeCubeRequest;
    readonly result: BepAnalyzeCubeResult;
  };
  readonly hello: {
    readonly request: BepHelloRequest;
    readonly result: BepHelloResult;
  };
  readonly "choose-turn": {
    readonly request: BepChooseTurnRequest;
    readonly result: BepChooseTurnResult;
  };
  readonly "decide-cube": {
    readonly request: BepCubeDecisionRequest;
    readonly result: BepCubeDecisionResult;
  };
}

export type BepEngineErrorCode =
  | "unsupported"
  | "invalid-request"
  | "invalid-position"
  | "illegal-turn"
  | "not-ready"
  | "busy"
  | "timeout"
  | "cancelled"
  | "engine-crash"
  | "asset-load-failed"
  | "version-mismatch"
  | "transport-error"
  | "stale-position"
  | "disposed"
  | "internal-error";

export interface BepEngineError {
  readonly code: BepEngineErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, BepJsonValue>>;
}

export interface BepEnvelopeBase {
  readonly protocol: typeof BEP_PROTOCOL;
  readonly version: BepProtocolVersion;
  readonly sessionNonce: BepSessionNonce;
}

export interface BepChannelConnectMessage extends BepEnvelopeBase {
  readonly kind: "bep.channel-connect";
}

export type BepRequestMessage<M extends BepMethod = BepMethod> =
  M extends BepMethod
    ? BepEnvelopeBase & {
        readonly kind: "bep.request";
        readonly requestId: BepRequestId;
        readonly method: M;
        readonly payload: BepMethodPayloads[M]["request"];
      }
    : never;

export interface BepCancelMessage extends BepEnvelopeBase {
  readonly kind: "bep.cancel";
  readonly requestId: BepRequestId;
  readonly reason: "caller" | "timeout" | "stale" | "dispose";
}

export interface BepDisposeMessage extends BepEnvelopeBase {
  readonly kind: "bep.dispose";
}

export type BepResultMessage<M extends BepMethod = BepMethod> =
  M extends BepMethod
    ? BepEnvelopeBase & {
        readonly kind: "bep.result";
        readonly requestId: BepRequestId;
        readonly method: M;
        readonly payload: BepMethodPayloads[M]["result"];
      }
    : never;

export interface BepErrorMessage extends BepEnvelopeBase {
  readonly kind: "bep.error";
  readonly requestId: BepRequestId;
  readonly method: BepMethod;
  readonly error: BepEngineError;
}

export type BepHostToEngineMessage =
  | BepRequestMessage
  | BepCancelMessage
  | BepDisposeMessage;

export type BepEngineToHostMessage = BepResultMessage | BepErrorMessage;
