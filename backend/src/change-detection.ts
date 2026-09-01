import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import cvModule from "@techstark/opencv-js";
import sharp from "sharp";
import { z } from "zod";
import { DETECTOR_VERSION, visionConfig } from "./vision/config.js";
import {
  createAdaptiveTiles,
  createOpenAIFrontierClient,
  deduplicateFrontierProposals,
  mapNormalizedBoxToNative,
  mapWithConcurrency,
  normalizeFrontierBox,
  sumFrontierUsage,
  type AnalysisMode,
  type FrontierCallAudit,
  type FrontierClient,
  type FrontierDeduplicationCluster,
  type FrontierDecision,
  type FrontierModelChange,
  type FrontierProposal,
  type FrontierUsage,
  type GeometryType,
  type NativeFrontierBox,
  type NormalizedFrontierBox,
  type ProposalSource
} from "./vision/frontier.js";

export type CandidateState = "accepted" | "needs_review" | "rejected";
export type SemanticDecision = "physical_change" | "likely_artifact" | "uncertain";

export type SemanticValidation = {
  candidateId: string;
  decision: SemanticDecision;
  label: string;
  confidence: number;
  evidence: string;
  artifactReason: string | null;
  model: string;
  raw?: unknown;
};

export type PercentBox = { x: number; y: number; width: number; height: number };

export type PixelPoint = [number, number];

export type Region = PercentBox & {
  id: string;
  label: string;
  confidence: number;
  evidence: string;
  sourceCandidateId?: string;
  changeType?: string;
  classificationConfidence?: number;
  pixelArea?: number;
  areaM2?: number | null;
  centroid?: PixelPoint;
  perimeter?: number;
  bbox?: { x: number; y: number; width: number; height: number };
  polygon?: PixelPoint[];
  geojson?: {
    type: "Feature";
    properties: { id: string; confidence: number; changeType: string; areaPixels: number };
    geometry: { type: "Polygon"; coordinates: PixelPoint[][] };
  };
  state?: CandidateState;
  reviewReason?: string | null;
  scoreFactors?: Record<string, { normalized: number; weight: number; contribution: number }>;
  semantic?: SemanticValidation | null;
  physicalDimensions?: { widthM: number; heightM: number } | null;
  crops?: { old: string; current: string; mask?: string; evidence?: string };
  proposalSource?: ProposalSource;
  deterministicScore?: number | null;
  frontierDecision?: FrontierDecision | null;
  frontierConfidence?: number | null;
  frontierScout?: FrontierDecisionSnapshot;
  frontierVerification?: FrontierDecisionSnapshot;
  verificationQueuePosition?: number | null;
  stateReason?: string;
  geometryType?: GeometryType;
};

export type FrontierAnalysisAudit = {
  requestedMode: AnalysisMode;
  effectiveMode: AnalysisMode;
  ran: boolean;
  fallbackReason: string | null;
  model: string | null;
  promptVersion: { scout: string; verification: string };
  globalScoutCount: number;
  tileScoutCount: number;
  deduplicationCount: number;
  deterministicOnlyCount: number;
  frontierOnlyCount: number;
  matchedCount: number;
  callCount: number;
  scoutCallCount: number;
  verificationCallCount: number;
  usage: FrontierUsage | null;
  latencyMs: number;
  warnings: string[];
  calls: FrontierCallAudit[];
  rawProposals: FrontierRawProposalAudit[];
  mappedProposals: FrontierMappedProposalAudit[];
  invalidProposals: FrontierMappedProposalAudit[];
  deduplicationClusters: FrontierDeduplicationCluster[];
  proposalLimitDecisions: ProposalLimitAudit[];
  mergeDecisions: MergeDecisionAudit[];
  localRefinementDecisions: LocalRefinementAudit[];
  candidateDecisions: CandidateDecisionAudit[];
  verificationQueue: VerificationQueueAudit[];
  funnel: PipelineFunnelMetrics;
};

export type FrontierVerificationStatus =
  | "not_required" | "queued" | "completed" | "failed" | "timed_out" | "skipped_call_limit";

export type FrontierDecisionSnapshot = {
  status: "not_run" | "not_found" | "completed" | "failed" | FrontierVerificationStatus;
  decision: FrontierDecision | null;
  confidence: number | null;
  explanation: string | null;
  model: string | null;
  promptVersion: string;
  source: string;
  latencyMs: number | null;
  usage: FrontierUsage | null;
};

export type FrontierRawProposalAudit = {
  proposalId: string;
  source: "frontier_global" | "frontier_tile";
  tileId: string | null;
  tile: NativeFrontierBox | null;
  originalNormalizedBox: NormalizedFrontierBox;
  decision: FrontierDecision;
  confidence: number;
  changeType: string;
  promptVersion: string;
  model: string;
  callId: string | null;
};

export type FrontierMappedProposalAudit = FrontierRawProposalAudit & {
  clampedNormalizedBox: NormalizedFrontierBox | null;
  nativeMappedBox: NativeFrontierBox | null;
  malformed: boolean;
  rejected: boolean;
  reasonCode: string | null;
  explanation: string;
  mapping: { frame: NativeFrontierBox; xScale: number; yScale: number };
};

export type ProposalLimitAudit = {
  proposalId: string;
  rankBeforeLimit: number;
  rankAfterLimit: number | null;
  included: boolean;
  limitType: "none" | "global" | "tile" | "candidate" | "cost" | "call";
  reasonCode: string | null;
  explanation: string;
};

export type MergeDecisionAudit = {
  proposalId: string;
  candidateId: string;
  matched: boolean;
  iou: number;
  containment: number;
  reasonCode: string;
  explanation: string;
};

export type LocalRefinementAudit = {
  proposalId: string;
  candidateId: string;
  selectedComponentIds: string[];
  selectedPixelCount: number;
  reliableLocalMask: boolean;
  geometryType: GeometryType;
  proposalSource: ProposalSource;
  reasonCode: string;
  explanation: string;
};

export type CandidateDecisionAudit = {
  candidateId: string;
  from: CandidateState | "candidate";
  to: CandidateState;
  reasonCode: string;
  explanation: string;
};

export type VerificationQueueAudit = {
  candidateId: string;
  priority: number;
  category: string;
  queuePosition: number;
  scheduled: boolean;
  ran: boolean;
  status: FrontierVerificationStatus;
  reasonCode: string | null;
  explanation: string;
};

export type PipelineFunnelMetrics = {
  rawGlobalScoutProposals: number;
  rawTileScoutProposals: number;
  invalidProposals: number;
  mappedProposals: number;
  proposalsRemovedByDeduplication: number;
  deduplicatedProposals: number;
  deterministicOnlyCandidates: number;
  frontierOnlyCandidates: number;
  matchedCandidates: number;
  candidatesRemovedByLimits: number;
  candidatesLocallyRefined: number;
  candidatesWithPixelMasks: number;
  candidatesWithCoarseBoxesOnly: number;
  verificationQueued: number;
  verificationCompleted: number;
  verificationSkippedByLimits: number;
  accepted: number;
  needsReview: number;
  rejected: number;
};

export type TraceRoiInput =
  | { x: number; y: number; width: number; height: number; radius?: never }
  | { x: number; y: number; radius: number; width?: never; height?: never };

export type RoiTrace = {
  roi: { x: number; y: number; width: number; height: number };
  registration: Record<string, unknown>;
  deterministicEvidence: Record<string, unknown>;
  deterministicCandidates: Array<Record<string, unknown>>;
  rawFrontierProposals: Array<FrontierRawProposalAudit & { overlapsRoi: boolean }>;
  coordinateValidation: Array<FrontierMappedProposalAudit & { overlapsRoi: boolean }>;
  deduplication: FrontierDeduplicationCluster[];
  proposalLimits: ProposalLimitAudit[];
  mergeAndRefinement: Array<MergeDecisionAudit | LocalRefinementAudit>;
  verificationScheduling: VerificationQueueAudit[];
  finalState: Array<Record<string, unknown>>;
};

export type AiAnalysis = {
  provider: "openai" | "mock";
  summary: string;
  evidence: string[];
  severity: "low" | "medium" | "high";
  confidence: number;
  recommendedAction: string;
  regions: Region[];
};

type AnalyzeInput = {
  before: string;
  after: string;
  title: string;
  type: string;
  location: string;
  beforeDate?: Date;
  afterDate?: Date;
};

export type PixelBox = { left: number; top: number; width: number; height: number };
type Viewport = PixelBox;

type ImageDiagnostics = {
  format?: string;
  originalWidth: number;
  originalHeight: number;
  exifOrientation: number;
  normalizedWidth: number;
  normalizedHeight: number;
  analysisWidth: number;
  analysisHeight: number;
  viewport: Viewport;
};

type PreparedImage = {
  source: Buffer;
  normalizedPng: Buffer;
  nativeData: Buffer;
  nativeWidth: number;
  nativeHeight: number;
  data: Buffer;
  width: number;
  height: number;
  diagnostics: ImageDiagnostics;
};

export type RegistrationDiagnostics = {
  matches: number;
  inliers: number;
  inlierRatio: number;
  landmarkCoverage: number;
  medianReprojectionError: number;
  p90ReprojectionError: number;
  p95ReprojectionError: number;
  postWarpEdgeAlignmentResidual: number;
  validOverlapPercent: number;
  gridResiduals: Array<{
    row: number;
    column: number;
    validPixels: number;
    edgeAlignmentResidual: number;
  }>;
  localResidualIndicatesParallax: boolean;
  localUnreliableCells: Array<{
    row: number;
    column: number;
    rawResidual: number;
    stableResidual: number | null;
    reason: string;
  }>;
  locallyUnreliablePixelCount: number;
  scaleRatio: number;
  ecc: {
    supported: boolean;
    attempted: boolean;
    applied: boolean;
    beforeEdgeResidual: number;
    candidateEdgeResidual: number | null;
    relativeImprovement: number | null;
    rejectionReason: string | null;
  };
  confidence: number;
  reliable: boolean;
  reason: string;
  homography: number[];
};

export type Registration = {
  afterData: Buffer;
  alignedBeforeData: Buffer;
  validMask: Buffer;
  width: number;
  height: number;
  diagnostics: RegistrationDiagnostics;
  keypoints: Array<{ x: number; y: number }>;
  registrationResidualMap: Buffer;
  edgeResidualMap: Buffer;
};

export type DetectionWarning = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
};

export type ComponentDiagnostic = {
  id: string;
  accepted: boolean;
  state: CandidateState;
  rejectionReasons: string[];
  reviewReasons: string[];
  stateTransitions: Array<{ from: CandidateState | "candidate"; to: CandidateState; reason: string; at: string }>;
  semantic: SemanticValidation | null;
  limitingFactor: string | null;
  bbox: { x: number; y: number; width: number; height: number };
  centroid: PixelPoint;
  polygon: PixelPoint[];
  metrics: {
    area: number;
    insideMean: number;
    insideMedian: number;
    annulusMean: number;
    annulusMedian: number;
    robustZScore: number;
    backgroundContrast: number;
    edgeOnlyFraction: number;
    compactness: number;
    density: number;
    thresholdStability: number;
    localRegistrationResidual: number;
    invalidBorderContact: number;
    structuralSupport: number;
    colorSupport: number;
    removalSupport: number;
    multiscaleSupport: number;
    edgeSupport: number;
    detectionConfidence: number;
    componentScore: number;
    requiredScore: number;
    factors: Record<string, { normalized: number; weight: number; contribution: number }>;
  };
};

export type ThresholdDiagnostics = {
  estimatorState: "STABLE_BACKGROUND" | "INSUFFICIENT_STABLE_BACKGROUND";
  validPixels: number;
  noiseSamplePixels: number;
  exclusions: {
    invalidOverlap: number;
    uiOrViewport: number;
    strongGradient: number;
    registrationResidual: number;
    provisionalChange: number;
    structuralChange: number;
    colorChange: number;
    extremeScoreTail: number;
  };
  scorePercentiles: Record<string, number>;
  stableScorePercentiles: Record<string, number>;
  noiseMedian: number;
  noiseMad: number;
  rawLow: number;
  rawHigh: number;
  low: number;
  high: number;
  lowFloorApplied: boolean;
  highFloorApplied: boolean;
  highCeilingApplied: boolean;
  quantileGuard: number;
  quantileGuardApplied: boolean;
  localThresholds: Array<{
    row: number;
    column: number;
    validPixels: number;
    stablePixels: number;
    noiseMedian: number;
    noiseMad: number;
    rawLow: number;
    rawHigh: number;
    low: number;
    high: number;
    lowClamped: boolean;
    highClamped: boolean;
  }>;
  highSeedPixels: number;
  highSeedPercent: number;
  lowMaskPixels: number;
  globalMaskPixels: number;
};

export type DetectionState =
  | "CHANGES_DETECTED"
  | "CHANGES_NEED_REVIEW"
  | "CHANGES_DETECTED_WITH_REVIEW"
  | "NO_DIFFERENCE_EVIDENCE"
  | "EVIDENCE_BELOW_THRESHOLD"
  | "COMPONENTS_REJECTED"
  | "REGISTRATION_UNRELIABLE"
  | "COMPATIBILITY_FAILURE"
  | "CANDIDATE_SATURATION"
  | "WIDESPREAD_CHANGE_REVIEW"
  | "RESOURCE_LIMIT_EXCEEDED";

export type ChangeDetectionResult = {
  state: DetectionState;
  registration: {
    matchedFeatures: number;
    inliers: number;
    registrationConfidence: number;
    reliable: boolean;
    warning: string | null;
    transform: number[];
    inlierRatio: number;
    spatialCoverage: number;
    medianReprojectionError: number;
    p90ReprojectionError: number;
    p95ReprojectionError: number;
    postWarpEdgeAlignmentResidual: number;
    validOverlapPercent: number;
    gridResiduals: RegistrationDiagnostics["gridResiduals"];
    localResidualIndicatesParallax: boolean;
    scaleRatio: number;
    ecc: RegistrationDiagnostics["ecc"];
    localUnreliableCells: RegistrationDiagnostics["localUnreliableCells"];
    locallyUnreliablePixelCount: number;
  };
  compatibility: { reliable: boolean; warnings: DetectionWarning[] };
  image: { width: number; height: number; oldOriginalWidth: number; oldOriginalHeight: number; currentOriginalWidth: number; currentOriginalHeight: number };
  scale: {
    metersPerPixel: number | null;
    known: boolean;
    uncertain: boolean;
    warning: string | null;
  };
  regions: Region[];
  reviewRegions: Region[];
  frontier: FrontierAnalysisAudit;
  roiTrace?: RoiTrace;
  metrics: {
    regionCount: number;
    totalChangedPixels: number;
    changedPercent: number;
    validOverlapPixels: number;
    finalChangedPixels: number;
    finalChangedPercentage: number;
    acceptedRegionCount: number;
    reviewRegionCount: number;
    rejectedRegionCount: number;
    acceptedPixels: number;
    reviewPixels: number;
    rejectedCandidatePixels: number;
    allCandidatePixels: number;
    saturationStatus: boolean;
    preTruncationCandidateCount: number;
    confidenceMethod: string;
    rawEvidencePixels: number;
    globalCandidatePixels: number;
    candidateComponentCount: number;
    rejectionReasonCounts: Record<string, number>;
    effectiveMinimumAreaPixels: number;
    minimumAreaMethod: string;
  };
  diagnostics: {
    normalization: RadiometricDiagnostics;
    thresholds: ThresholdDiagnostics;
    acceptedComponents: ComponentDiagnostic[];
    reviewComponents: ComponentDiagnostic[];
    rejectedComponents: ComponentDiagnostic[];
  };
  artifacts: {
    registeredOld: string;
    registeredCurrent: string;
    validOverlapMask: string;
    registrationResidualHeatmap: string;
    rawDifference: string;
    rawColorResidual: string;
    structuralResidual: string;
    removedStructureResidual: string;
    borderOverlayArtifactMask: string;
    edgeResidual: string;
    probabilityScore: string;
    highThresholdMask: string;
    lowThresholdMask: string;
    binaryMask: string;
    cleanedMask: string;
    acceptedMask: string;
    reviewMask: string;
    rejectedMask: string;
    allCandidateMask: string;
    acceptedComponents: string;
    reviewComponents: string;
    rejectedComponents: string;
    annotatedResult: string;
    registrationKeypoints: string;
    localAlignmentUnreliableMask: string;
  };
  audit: {
    inputHashes: { oldSha256: string; currentSha256: string };
    processedAt: string;
    detectorVersion: string;
    configVersion: string;
    thresholdConfiguration: Record<string, unknown>;
    registrationTransform: number[];
    imageDimensions: Record<string, number>;
    scale: { metersPerPixel: number | null; uncertain: boolean };
    candidateTransitions: Array<{ candidateId: string; transitions: ComponentDiagnostic["stateTransitions"] }>;
    semanticModel: string | null;
    semanticDecisions: SemanticValidation[];
    warnings: DetectionWarning[];
    annotationVersion: string | null;
  };
};

export type Candidate = {
  id: string;
  box: PixelBox;
  crop: PixelBox;
  changeDensity: number;
  changeStrength: number;
  maskedMedian?: number;
  thresholdStability?: number;
  validCoverage?: number;
  componentArea?: number;
  borderContact?: number;
  quality?: number;
  parentCandidateId?: string;
  refinedComponentId?: string;
  supportBox?: PixelBox;
  supportMask?: Buffer;
  rejectionReasons?: string[];
  insideMean?: number;
  insideMedian?: number;
  annulusMean?: number;
  annulusMedian?: number;
  robustZScore?: number;
  backgroundContrast?: number;
  edgeOnlyFraction?: number;
  compactness?: number;
  localRegistrationResidual?: number;
  structuralSupport?: number;
  colorSupport?: number;
  detectionConfidence?: number;
  componentScore?: number;
  limitingFactor?: string | null;
  scoreFactors?: Record<string, { normalized: number; weight: number; contribution: number }>;
  requiredScore?: number;
  state?: CandidateState;
  reviewReasons?: string[];
  stateTransitions?: ComponentDiagnostic["stateTransitions"];
  semantic?: SemanticValidation | null;
  maskCrop?: string;
  evidenceCrop?: string;
  highSeedPixels?: number;
  lowOnly?: boolean;
  proposalSource?: ProposalSource;
  geometryType?: GeometryType;
  frontierProposal?: FrontierProposal;
  frontierDecision?: FrontierDecision | null;
  frontierConfidence?: number | null;
  stateReason?: string;
  frontierScout?: FrontierDecisionSnapshot;
  frontierVerification?: FrontierDecisionSnapshot;
  verificationPriority?: number;
  verificationQueuePosition?: number;
  auditProposalIds?: string[];
  removalSupport?: number;
  multiscaleSupport?: number;
  edgeSupport?: number;
};

export type SemanticCandidateInput = {
  candidateId: string;
  state: Exclude<CandidateState, "rejected">;
  beforeCrop: string;
  currentCrop: string;
  maskCrop: string;
  evidenceCrop: string;
  bbox: PixelBox;
  spatialDiagnostics: {
    areaPixels: number;
    componentScore: number;
    structuralSupport: number;
    colorSupport: number;
    localRegistrationResidual: number;
    edgeOnlyFraction: number;
  };
};

export type DetectionOptions = {
  metersPerPixel?: number;
  semanticValidation?: boolean;
  semanticValidator?: (candidates: SemanticCandidateInput[]) => Promise<Array<Omit<SemanticValidation, "model"> & { model?: string }>>;
  annotationVersion?: string;
  analysisMode?: AnalysisMode;
  frontierClient?: FrontierClient;
  openAIApiKey?: string;
  openAIModel?: string;
  traceRoi?: TraceRoiInput;
  debugTrace?: boolean;
};

type RadiometricDiagnostics = {
  method: string;
  samples: number;
  excludedHighGradientPixels: number;
  excludedProvisionalChangePixels: number;
  sourceMedian: number[];
  targetMedian: number[];
  sourceMad: number[];
  targetMad: number[];
  scale: number[];
  offset: number[];
  rawMedianResidual: number;
  normalizedMedianResidual: number;
};

type GlobalChangeWorkspace = {
  colorResidual: Buffer;
  structuralResidual: Buffer;
  edgeResidual: Buffer;
  removedStructureResidual: Buffer;
  borderOverlayArtifactMask: Buffer;
  probabilityScore: Buffer;
  highMask: Buffer;
  lowMask: Buffer;
  globalMask: Buffer;
  finalMask: Buffer;
  reviewMask: Buffer;
  rejectedMask: Buffer;
  allCandidateMask: Buffer;
  localAlignmentUnreliableMask: Buffer;
  accepted: Candidate[];
  review: Candidate[];
  rejected: Candidate[];
  warnings: DetectionWarning[];
  reliable: boolean;
  saturation: boolean;
  preTruncationCandidateCount: number;
  candidateComponentCount: number;
  rawEvidencePixels: number;
  globalCandidatePixels: number;
  effectiveMinimumAreaPixels: number;
  minimumAreaMethod: string;
  scaleUncertain: boolean;
  thresholds: ThresholdDiagnostics;
  normalization: RadiometricDiagnostics;
  componentAudit: Array<{
    componentId: string;
    parentComponentId: string;
    bounds: PixelBox;
    area: number;
    split: boolean;
    state: string;
  }>;
};

type FrontierScoutRun = {
  proposals: FrontierProposal[];
  globalScoutCount: number;
  tileScoutCount: number;
  deduplicationCount: number;
  audits: FrontierCallAudit[];
  model: string | null;
  latencyMs: number;
  warnings: string[];
  rawProposals: FrontierRawProposalAudit[];
  mappedProposals: FrontierMappedProposalAudit[];
  invalidProposals: FrontierMappedProposalAudit[];
  deduplicationClusters: FrontierDeduplicationCluster[];
  proposalLimitDecisions: ProposalLimitAudit[];
};

type CandidateDecision = {
  sourceCandidateId: string;
  accepted: boolean;
  label: string;
  confidence: number;
  evidence: string;
};

type DebugRun = {
  enabled: boolean;
  directory?: string;
  json: (name: string, value: unknown) => Promise<void>;
  file: (name: string, value: Buffer) => Promise<void>;
};

const MAX_ANALYSIS_DIMENSION = visionConfig.processing.registrationMaxDimension;
const MAX_REGIONS = visionConfig.maximumRegions;
const MIN_REGION_CONFIDENCE = 0.62;

type BinaryComponent = {
  pixels: number[];
  area: number;
  box: PixelBox;
  centroid: { x: number; y: number };
};

let openCvPromise: Promise<any> | undefined;

export async function analyzeWithOpenAI(input: AnalyzeInput): Promise<AiAnalysis> {
  const debug = await createDebugRun();
  const [before, after] = await Promise.all([
    prepareImage(input.before),
    prepareImage(input.after)
  ]);

  await Promise.all([
    debug.json("01-original-metadata.json", {
      before: before.diagnostics,
      after: after.diagnostics
    }),
    debug.file(`01-before-original.${imageExtension(before.diagnostics.format)}`, before.source),
    debug.file(`01-after-original.${imageExtension(after.diagnostics.format)}`, after.source),
    debug.file("02-before-normalized.png", before.normalizedPng),
    debug.file("02-after-normalized.png", after.normalizedPng),
    debug.file("03-after-coordinate-reference.jpg", await addCoordinateGrid(after.normalizedPng))
  ]);

  const coarseRegistration = await registerCurrentToOld(before, after);
  const registration = await promoteRegistrationToNative(coarseRegistration, before, after);
  await Promise.all([
    debug.json("04-registration.json", registration.diagnostics),
    debug.file("04-aligned-before.jpg", await rgbToJpeg(registration.alignedBeforeData, registration.width, registration.height)),
    debug.file("04-aligned-current.jpg", await rgbToJpeg(registration.afterData, registration.width, registration.height))
  ]);

  if (!registration.diagnostics.reliable) {
    const result = unreliableResult(registration.diagnostics);
    await debug.json("11-final-response.json", result);
    return result;
  }

  const nativeViewport = { left: 0, top: 0, width: before.nativeWidth, height: before.nativeHeight };
  const workspace = await buildGlobalChangeWorkspace(
    registration,
    nativeViewport,
    nativeViewport,
    {}
  );
  await Promise.all([
    debug.json("05-global-accepted-components.json", workspace.accepted.map(candidateDebugValue)),
    debug.json("05-global-review-components.json", workspace.review.map(candidateDebugValue)),
    debug.json("05-global-rejected-components.json", workspace.rejected.map(candidateDebugValue)),
    debug.file("05-global-mask.png", await grayToPng(workspace.globalMask, registration.width, registration.height)),
    debug.file("05-probability-score.png", await grayToPng(workspace.probabilityScore, registration.width, registration.height)),
    debug.file("06-candidate-overlay.jpg", await drawCandidateOverlay(registration.afterData, registration.width, registration.height, [...workspace.accepted, ...workspace.review]))
  ]);

  if (!workspace.reliable || !(workspace.accepted.length + workspace.review.length)) {
    const result = noChangeResult(registration.diagnostics.confidence);
    await debug.json("11-final-response.json", result);
    return result;
  }

  const semanticDecisions = await applySemanticValidation(workspace, registration, { semanticValidation: true });
  const acceptedRegions = await Promise.all(workspace.accepted.map((candidate, index) =>
    candidateRegion(candidate, registration, index + 1)
  ));
  const reviewRegions = await Promise.all(workspace.review.map((candidate, index) =>
    candidateRegion(candidate, registration, index + 1)
  ));
  const regions = [...acceptedRegions, ...reviewRegions];
  await debug.json("10-converted-full-image-coordinates.json", {
    refinement: "Semantic validation used native registered crops and did not alter deterministic geometry.",
    semanticDecisions,
    regions
  });

  const result = buildAnalysis(regions, registration.diagnostics.confidence);
  await debug.json("11-final-response.json", result);
  return result;
}

export function isSupportedVisionImage(value: string) {
  if (/^https?:\/\//i.test(value)) return true;
  return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value);
}

export function cropRelativeToFull(crop: PercentBox, refined: PercentBox): PercentBox {
  const x = clampPercent(crop.x + refined.x * crop.width / 100);
  const y = clampPercent(crop.y + refined.y * crop.height / 100);
  return normalizePercentBox({
    x,
    y,
    width: refined.width * crop.width / 100,
    height: refined.height * crop.height / 100
  });
}

export function normalizePercentBox(box: PercentBox): PercentBox {
  const x = clampPercent(box.x);
  const y = clampPercent(box.y);
  return {
    x,
    y,
    width: clampToPercentEdge(box.width, x),
    height: clampToPercentEdge(box.height, y)
  };
}

function emptyThresholdDiagnostics(pixels: number): ThresholdDiagnostics {
  return {
    estimatorState: "INSUFFICIENT_STABLE_BACKGROUND",
    validPixels: 0,
    noiseSamplePixels: 0,
    exclusions: {
      invalidOverlap: pixels,
      uiOrViewport: 0,
      strongGradient: 0,
      registrationResidual: 0,
      provisionalChange: 0,
      structuralChange: 0,
      colorChange: 0,
      extremeScoreTail: 0
    },
    scorePercentiles: {},
    stableScorePercentiles: {},
    noiseMedian: 0,
    noiseMad: 0,
    rawLow: 0,
    rawHigh: 0,
    low: 0,
    high: 0,
    lowFloorApplied: false,
    highFloorApplied: false,
    highCeilingApplied: false,
    quantileGuard: 0,
    quantileGuardApplied: false,
    localThresholds: [],
    highSeedPixels: 0,
    highSeedPercent: 0,
    lowMaskPixels: 0,
    globalMaskPixels: 0
  };
}

function coherentProvisionalChangeMask(
  score: Uint8Array,
  colorResidual: Uint8Array,
  structuralResidual: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number
) {
  const provisional = Buffer.alloc(score.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      if (!validMask[pixel]) continue;
      const supported = score[pixel] >= visionConfig.scoring.absoluteHighFloor ||
        (score[pixel] >= visionConfig.scoring.absoluteLowFloor &&
          structuralResidual[pixel] >= 92 && colorResidual[pixel] >= 14);
      if (!supported) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighbor = (y + dy) * width + x + dx;
          if (validMask[neighbor] && score[neighbor] >= visionConfig.scoring.absoluteLowFloor) neighbors += 1;
        }
      }
      if (neighbors >= 4) provisional[pixel] = 255;
    }
  }
  return binaryDilate(provisional, width, height, 2);
}

function estimateStableNoiseThresholds(input: {
  score: Uint8Array;
  colorResidual: Uint8Array;
  structuralResidual: Uint8Array;
  referenceGradient: Uint8Array;
  currentGradient: Uint8Array;
  registrationResidual: Uint8Array;
  validMask: Uint8Array;
  provisionalChangeMask: Uint8Array;
  width: number;
  height: number;
  oldViewport: Viewport;
  currentViewport: Viewport;
}): Omit<ThresholdDiagnostics, "highSeedPixels" | "highSeedPercent" | "lowMaskPixels" | "globalMaskPixels"> {
  const exclusions = {
    invalidOverlap: 0,
    uiOrViewport: 0,
    strongGradient: 0,
    registrationResidual: 0,
    provisionalChange: 0,
    structuralChange: 0,
    colorChange: 0,
    extremeScoreTail: 0
  };
  const validScores: number[] = [];
  const stableCandidates: number[] = [];
  let validPixels = 0;
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const pixel = y * input.width + x;
      if (!pointInsideBox({ x, y }, input.oldViewport) ||
        !pointInsideBox({ x, y }, input.currentViewport) || isKnownUiPixel(x, y, input.width, input.height)) {
        exclusions.uiOrViewport += 1;
        continue;
      }
      if (!input.validMask[pixel]) {
        exclusions.invalidOverlap += 1;
        continue;
      }
      validPixels += 1;
      validScores.push(input.score[pixel]);
      if (input.referenceGradient[pixel] > visionConfig.scoring.noiseGradientExclusionThreshold ||
        input.currentGradient[pixel] > visionConfig.scoring.noiseGradientExclusionThreshold) {
        exclusions.strongGradient += 1;
      } else if (input.registrationResidual[pixel] > visionConfig.scoring.noiseRegistrationResidualMaximum) {
        exclusions.registrationResidual += 1;
      } else if (input.provisionalChangeMask[pixel]) {
        exclusions.provisionalChange += 1;
      } else if (input.structuralResidual[pixel] > visionConfig.scoring.noiseStructuralResidualMaximum) {
        exclusions.structuralChange += 1;
      } else if (input.colorResidual[pixel] > visionConfig.scoring.noiseColorResidualMaximum) {
        exclusions.colorChange += 1;
      } else {
        stableCandidates.push(input.score[pixel]);
      }
    }
  }
  const candidateMedian = median(stableCandidates);
  const candidateMad = median(stableCandidates.map((value) => Math.abs(value - candidateMedian)));
  const tailLimit = candidateMedian + visionConfig.scoring.extremeTailMadMultiplier * Math.max(2, candidateMad);
  const stableScores = stableCandidates.filter((value) => {
    if (value <= tailLimit) return true;
    exclusions.extremeScoreTail += 1;
    return false;
  });
  const minimumSamples = Math.max(
    visionConfig.scoring.minimumStableNoisePixels,
    Math.round(validPixels * visionConfig.scoring.minimumStableNoiseFraction)
  );
  const estimatorState = stableScores.length >= minimumSamples
    ? "STABLE_BACKGROUND" as const
    : "INSUFFICIENT_STABLE_BACKGROUND" as const;
  const noiseValues = stableScores.length ? stableScores : stableCandidates.length ? stableCandidates : validScores;
  const noiseMedian = median(noiseValues);
  const noiseMad = median(noiseValues.map((value) => Math.abs(value - noiseMedian)));
  const rawHigh = noiseMedian + visionConfig.scoring.highNoiseMadMultiplier * Math.max(2, noiseMad);
  const quantileGuard = percentileNumber(validScores, 1 - visionConfig.scoring.maximumHighSeedFraction);
  const dataDrivenHigh = Math.max(rawHigh, quantileGuard);
  const highAfterFloor = Math.max(visionConfig.scoring.absoluteHighFloor, dataDrivenHigh);
  const high = clampNumber(
    highAfterFloor,
    visionConfig.scoring.absoluteHighFloor,
    visionConfig.scoring.absoluteHighCeiling
  );
  const rawLow = Math.max(
    high * visionConfig.scoring.lowToHighRatio,
    noiseMedian + visionConfig.scoring.lowNoiseMadMultiplier * Math.max(2, noiseMad)
  );
  const low = clampNumber(rawLow, visionConfig.scoring.absoluteLowFloor, Math.max(visionConfig.scoring.absoluteLowFloor, high - 1));
  return {
    estimatorState,
    validPixels,
    noiseSamplePixels: stableScores.length,
    exclusions,
    scorePercentiles: diagnosticPercentiles(validScores),
    stableScorePercentiles: diagnosticPercentiles(stableScores),
    noiseMedian: round(noiseMedian),
    noiseMad: round(noiseMad),
    rawLow: round(rawLow),
    rawHigh: round(rawHigh),
    low: round(low),
    high: round(high),
    lowFloorApplied: rawLow < visionConfig.scoring.absoluteLowFloor,
    highFloorApplied: dataDrivenHigh < visionConfig.scoring.absoluteHighFloor,
    highCeilingApplied: highAfterFloor > visionConfig.scoring.absoluteHighCeiling,
    quantileGuard: round(quantileGuard),
    quantileGuardApplied: quantileGuard > rawHigh,
    localThresholds: []
  };
}

function localThresholdMaps(input: {
  score: Uint8Array;
  colorResidual: Uint8Array;
  structuralResidual: Uint8Array;
  referenceGradient: Uint8Array;
  currentGradient: Uint8Array;
  registrationResidual: Uint8Array;
  validMask: Uint8Array;
  provisionalChangeMask: Uint8Array;
  width: number;
  height: number;
  oldViewport: Viewport;
  currentViewport: Viewport;
}, global: Omit<ThresholdDiagnostics, "highSeedPixels" | "highSeedPercent" | "lowMaskPixels" | "globalMaskPixels">) {
  const columns = visionConfig.scoring.localThresholdColumns;
  const rows = visionConfig.scoring.localThresholdRows;
  const highMap = Buffer.alloc(input.score.length);
  const lowMap = Buffer.alloc(input.score.length);
  const diagnostics: ThresholdDiagnostics["localThresholds"] = [];
  for (let row = 0; row < rows; row += 1) {
    const top = Math.floor(row * input.height / rows);
    const bottom = Math.floor((row + 1) * input.height / rows);
    for (let column = 0; column < columns; column += 1) {
      const left = Math.floor(column * input.width / columns);
      const right = Math.floor((column + 1) * input.width / columns);
      const valid: number[] = [];
      const stableCandidates: number[] = [];
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const pixel = y * input.width + x;
          if (!input.validMask[pixel] || !pointInsideBox({ x, y }, input.oldViewport) ||
            !pointInsideBox({ x, y }, input.currentViewport) || isKnownUiPixel(x, y, input.width, input.height)) continue;
          valid.push(input.score[pixel]);
          if (input.referenceGradient[pixel] > visionConfig.scoring.noiseGradientExclusionThreshold ||
            input.currentGradient[pixel] > visionConfig.scoring.noiseGradientExclusionThreshold ||
            input.registrationResidual[pixel] > visionConfig.scoring.noiseRegistrationResidualMaximum ||
            input.provisionalChangeMask[pixel] ||
            input.structuralResidual[pixel] > visionConfig.scoring.noiseStructuralResidualMaximum ||
            input.colorResidual[pixel] > visionConfig.scoring.noiseColorResidualMaximum) continue;
          stableCandidates.push(input.score[pixel]);
        }
      }
      const firstMedian = median(stableCandidates);
      const firstMad = median(stableCandidates.map((value) => Math.abs(value - firstMedian)));
      const tail = firstMedian + visionConfig.scoring.extremeTailMadMultiplier * Math.max(2, firstMad);
      const stable = stableCandidates.filter((value) => value <= tail);
      const values = stable.length ? stable : valid;
      const noiseMedian = median(values);
      const noiseMad = median(values.map((value) => Math.abs(value - noiseMedian)));
      const rawHigh = noiseMedian + visionConfig.scoring.highNoiseMadMultiplier * Math.max(2, noiseMad);
      const localQuantile = percentileNumber(valid, 1 - visionConfig.scoring.maximumHighSeedFraction);
      const unclampedHigh = Math.max(rawHigh, localQuantile, visionConfig.scoring.absoluteHighFloor);
      const highMinimum = Math.max(visionConfig.scoring.absoluteHighFloor, global.high * visionConfig.scoring.localHighMinimumRatio);
      const highMaximum = Math.min(visionConfig.scoring.absoluteHighCeiling, global.high * visionConfig.scoring.localHighMaximumRatio);
      const high = clampNumber(unclampedHigh, highMinimum, Math.max(highMinimum, highMaximum));
      const rawLow = Math.max(
        high * visionConfig.scoring.lowToHighRatio,
        noiseMedian + visionConfig.scoring.lowNoiseMadMultiplier * Math.max(2, noiseMad)
      );
      const lowMinimum = Math.max(visionConfig.scoring.absoluteLowFloor, global.low * 0.72);
      const low = clampNumber(rawLow, lowMinimum, Math.max(lowMinimum, high - 1));
      diagnostics.push({
        row, column, validPixels: valid.length, stablePixels: stable.length,
        noiseMedian: round(noiseMedian), noiseMad: round(noiseMad), rawLow: round(rawLow), rawHigh: round(rawHigh),
        low: round(low), high: round(high), lowClamped: round(low) !== round(rawLow), highClamped: round(high) !== round(unclampedHigh)
      });
      for (let y = top; y < bottom; y += 1) {
        highMap.fill(Math.round(high), y * input.width + left, y * input.width + right);
        lowMap.fill(Math.round(low), y * input.width + left, y * input.width + right);
      }
    }
  }
  return { highMap, lowMap, diagnostics };
}

function diagnosticPercentiles(values: number[]): Record<string, number> {
  if (!values.length) return {};
  return {
    p05: round(percentileNumber(values, 0.05)),
    p25: round(percentileNumber(values, 0.25)),
    p50: round(percentileNumber(values, 0.5)),
    p75: round(percentileNumber(values, 0.75)),
    p90: round(percentileNumber(values, 0.9)),
    p95: round(percentileNumber(values, 0.95)),
    p99: round(percentileNumber(values, 0.99))
  };
}

function assessLocalAlignment(input: {
  registration: Registration;
  referenceGradient: Uint8Array;
  currentGradient: Uint8Array;
  provisionalChangeMask: Uint8Array;
}) {
  const { registration } = input;
  const columns = visionConfig.registration.gridColumns;
  const rows = visionConfig.registration.gridRows;
  const stable = Array.from({ length: rows * columns }, () => ({ edges: 0, unmatched: 0 }));
  for (let y = 0; y < registration.height; y += 1) {
    for (let x = 0; x < registration.width; x += 1) {
      const pixel = y * registration.width + x;
      if (!registration.validMask[pixel] || input.provisionalChangeMask[pixel]) continue;
      if (input.referenceGradient[pixel] < visionConfig.registration.localStableEdgeGradient &&
        input.currentGradient[pixel] < visionConfig.registration.localStableEdgeGradient) continue;
      const cell = Math.min(rows - 1, Math.floor(y / registration.height * rows)) * columns +
        Math.min(columns - 1, Math.floor(x / registration.width * columns));
      stable[cell].edges += 1;
      if (registration.edgeResidualMap[pixel]) stable[cell].unmatched += 1;
    }
  }
  const rawSevere = registration.diagnostics.gridResiduals.filter((cell) =>
    cell.edgeAlignmentResidual > visionConfig.registration.maximumLocalEdgeResidual
  );
  const rawKeys = new Set(rawSevere.map((cell) => `${cell.row}:${cell.column}`));
  const adjacentRawKeys = new Set<string>();
  for (const cell of rawSevere) {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbor = `${cell.row + dr}:${cell.column + dc}`;
      if (rawKeys.has(neighbor)) {
        adjacentRawKeys.add(`${cell.row}:${cell.column}`);
        adjacentRawKeys.add(neighbor);
      }
    }
  }
  const cells: RegistrationDiagnostics["localUnreliableCells"] = [];
  for (const raw of registration.diagnostics.gridResiduals) {
    const index = raw.row * columns + raw.column;
    const stableResidual = stable[index].edges >= visionConfig.registration.minimumStableEdgesPerCell
      ? stable[index].unmatched / stable[index].edges
      : null;
    const stableSevere = stableResidual != null && stableResidual > visionConfig.registration.maximumLocalEdgeResidual;
    const adjacentRaw = adjacentRawKeys.has(`${raw.row}:${raw.column}`);
    if (!stableSevere && !adjacentRaw) continue;
    cells.push({
      row: raw.row,
      column: raw.column,
      rawResidual: round(raw.edgeAlignmentResidual),
      stableResidual: stableResidual == null ? null : round(stableResidual),
      reason: stableSevere ? "STABLE_EDGE_RESIDUAL_HIGH" : "ADJACENT_SEVERE_RAW_RESIDUAL"
    });
  }
  const cellKeys = new Set(cells.map((cell) => `${cell.row}:${cell.column}`));
  const mask = Buffer.alloc(registration.width * registration.height);
  for (let y = 0; y < registration.height; y += 1) {
    for (let x = 0; x < registration.width; x += 1) {
      const key = `${Math.min(rows - 1, Math.floor(y / registration.height * rows))}:${Math.min(columns - 1, Math.floor(x / registration.width * columns))}`;
      const pixel = y * registration.width + x;
      if (cellKeys.has(key) && !input.provisionalChangeMask[pixel] &&
        registration.registrationResidualMap[pixel] > visionConfig.scoring.noiseRegistrationResidualMaximum) {
        mask[pixel] = 255;
      }
    }
  }
  return { cells, mask };
}

function effectiveMinimumComponentArea(
  width: number,
  height: number,
  metersPerPixel: number | undefined,
  analysisToSourceScale: number
) {
  if (metersPerPixel && metersPerPixel > 0) {
    const analysisMetersPerPixel = metersPerPixel * Math.max(1, analysisToSourceScale);
    const physical = Math.ceil(visionConfig.components.minimumPhysicalAreaM2 / analysisMetersPerPixel ** 2);
    const knownSafety = visionConfig.scale.knownScaleSafetyMinimumPixels;
    return {
      pixels: Math.max(knownSafety, physical),
      method: `${visionConfig.components.minimumPhysicalAreaM2} m² at ${round(analysisMetersPerPixel)} native m/pixel with ${knownSafety}px raster safety floor`
    };
  }
  return {
    pixels: visionConfig.scale.fallbackMinimumPixels,
    method: `scale-uncertain fallback of ${visionConfig.scale.fallbackMinimumPixels} native pixels; no physical-size claim`
  };
}

function segmentationScaleParameters(metersPerPixel?: number) {
  const known = Boolean(metersPerPixel && metersPerPixel > 0);
  const resolution = known ? metersPerPixel as number : null;
  const pixelRadius = (meters: number, fallback: number, maximum: number) => known
    ? clampNumber(Math.round(meters / Math.max(0.001, resolution as number)), 0, maximum)
    : fallback;
  const closingRadius = pixelRadius(
    visionConfig.scale.morphologyClosingMeters,
    1,
    visionConfig.scale.maximumMorphologyRadiusPixels
  );
  const openingRadius = pixelRadius(
    visionConfig.scale.morphologyOpeningMeters,
    1,
    visionConfig.scale.maximumMorphologyRadiusPixels
  );
  const displacementRadius = pixelRadius(
    visionConfig.scale.displacementToleranceMeters,
    visionConfig.scoring.displacementTolerancePixels,
    visionConfig.scale.maximumDisplacementPixels
  );
  const holeAreaPixels = known
    ? Math.max(1, Math.round(visionConfig.scale.holeFillAreaM2 / (resolution as number) ** 2))
    : 16;
  return { known, resolution, closingRadius, openingRadius, displacementRadius, holeAreaPixels };
}

export function pixelBoxToPercent(box: PixelBox, width: number, height: number): PercentBox {
  return normalizePercentBox({
    x: box.left * 100 / width,
    y: box.top * 100 / height,
    width: box.width * 100 / width,
    height: box.height * 100 / height
  });
}

export function scaleHomography(
  homography: number[],
  beforeScale: { x: number; y: number },
  afterScale: { x: number; y: number }
) {
  if (homography.length !== 9) throw new Error("A 3x3 homography is required.");
  const sourceScale = [beforeScale.x, 0, 0, 0, beforeScale.y, 0, 0, 0, 1];
  const destinationInverse = [1 / afterScale.x, 0, 0, 0, 1 / afterScale.y, 0, 0, 0, 1];
  return multiply3x3(destinationInverse, multiply3x3(homography, sourceScale));
}

export function projectPoint(homography: number[], x: number, y: number) {
  const denominator = homography[6] * x + homography[7] * y + homography[8];
  return {
    x: (homography[0] * x + homography[1] * y + homography[2]) / denominator,
    y: (homography[3] * x + homography[4] * y + homography[5]) / denominator
  };
}

export async function normalizeImageBufferForTest(source: Buffer, maxDimension = MAX_ANALYSIS_DIMENSION) {
  const image = await prepareImageBuffer(source, maxDimension);
  return image.diagnostics;
}

function inputExceedsResourceLimits(metadata: { width?: number; height?: number }) {
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  return !width || !height || width > visionConfig.processing.maximumNativeDimension ||
    height > visionConfig.processing.maximumNativeDimension ||
    width * height > visionConfig.processing.maximumNativePixels;
}

function resourceLimitResult(input: {
  oldMetadata: { width?: number; height?: number };
  currentMetadata: { width?: number; height?: number };
  options: DetectionOptions;
  hashes: { oldSha256: string; currentSha256: string };
  processedAt: string;
}): ChangeDetectionResult {
  const oldWidth = input.oldMetadata.width || 0;
  const oldHeight = input.oldMetadata.height || 0;
  const currentWidth = input.currentMetadata.width || 0;
  const currentHeight = input.currentMetadata.height || 0;
  const warning: DetectionWarning = {
    code: "RESOURCE_LIMIT_EXCEEDED",
    severity: "error",
    message: `Native imagery exceeds the configured limit of ${visionConfig.processing.maximumNativePixels.toLocaleString()} pixels and ${visionConfig.processing.maximumNativeDimension.toLocaleString()} pixels per dimension.`
  };
  const emptyArtifact = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const thresholds = emptyThresholdDiagnostics(1);
  return {
    state: "RESOURCE_LIMIT_EXCEEDED",
    registration: {
      matchedFeatures: 0, inliers: 0, registrationConfidence: 0, reliable: false,
      warning: warning.message, transform: [], inlierRatio: 0, spatialCoverage: 0,
      medianReprojectionError: 0, p90ReprojectionError: 0, p95ReprojectionError: 0,
      postWarpEdgeAlignmentResidual: 1, validOverlapPercent: 0, gridResiduals: [],
      localResidualIndicatesParallax: false, scaleRatio: 0,
      ecc: { supported: false, attempted: false, applied: false, beforeEdgeResidual: 1, candidateEdgeResidual: null, relativeImprovement: null, rejectionReason: null },
      localUnreliableCells: [], locallyUnreliablePixelCount: 0
    },
    compatibility: { reliable: false, warnings: [warning] },
    image: {
      width: oldWidth, height: oldHeight,
      oldOriginalWidth: oldWidth, oldOriginalHeight: oldHeight,
      currentOriginalWidth: currentWidth, currentOriginalHeight: currentHeight
    },
    scale: {
      metersPerPixel: input.options.metersPerPixel || null,
      known: Boolean(input.options.metersPerPixel),
      uncertain: !input.options.metersPerPixel,
      warning: input.options.metersPerPixel ? null : "Ground resolution was not supplied."
    },
    regions: [],
    reviewRegions: [],
    frontier: emptyFrontierAudit(requestedAnalysisMode(input.options), "RESOURCE_LIMIT_EXCEEDED"),
    metrics: {
      regionCount: 0, totalChangedPixels: 0, changedPercent: 0, validOverlapPixels: 0,
      finalChangedPixels: 0, finalChangedPercentage: 0, acceptedRegionCount: 0,
      reviewRegionCount: 0, rejectedRegionCount: 0, acceptedPixels: 0, reviewPixels: 0,
      rejectedCandidatePixels: 0, allCandidatePixels: 0, saturationStatus: false,
      preTruncationCandidateCount: 0, confidenceMethod: "No scoring: resource compatibility failed.",
      rawEvidencePixels: 0, globalCandidatePixels: 0, candidateComponentCount: 0,
      rejectionReasonCounts: {}, effectiveMinimumAreaPixels: 0, minimumAreaMethod: "not evaluated"
    },
    diagnostics: {
      normalization: {
        method: visionConfig.normalization.method, samples: 0, excludedHighGradientPixels: 0,
        excludedProvisionalChangePixels: 0, sourceMedian: [0, 0, 0], targetMedian: [0, 0, 0],
        sourceMad: [0, 0, 0], targetMad: [0, 0, 0], scale: [1, 1, 1], offset: [0, 0, 0],
        rawMedianResidual: 0, normalizedMedianResidual: 0
      },
      thresholds,
      acceptedComponents: [], reviewComponents: [], rejectedComponents: []
    },
    artifacts: {
      registeredOld: emptyArtifact, registeredCurrent: emptyArtifact, validOverlapMask: emptyArtifact,
      registrationResidualHeatmap: emptyArtifact, rawDifference: emptyArtifact, rawColorResidual: emptyArtifact,
      structuralResidual: emptyArtifact, removedStructureResidual: emptyArtifact, borderOverlayArtifactMask: emptyArtifact,
      edgeResidual: emptyArtifact, probabilityScore: emptyArtifact,
      highThresholdMask: emptyArtifact, lowThresholdMask: emptyArtifact, binaryMask: emptyArtifact,
      cleanedMask: emptyArtifact, acceptedMask: emptyArtifact, reviewMask: emptyArtifact,
      rejectedMask: emptyArtifact, allCandidateMask: emptyArtifact, acceptedComponents: emptyArtifact,
      reviewComponents: emptyArtifact, rejectedComponents: emptyArtifact, annotatedResult: emptyArtifact,
      registrationKeypoints: emptyArtifact, localAlignmentUnreliableMask: emptyArtifact
    },
    audit: {
      inputHashes: input.hashes, processedAt: input.processedAt, detectorVersion: DETECTOR_VERSION,
      configVersion: DETECTOR_VERSION, thresholdConfiguration: { processing: visionConfig.processing },
      registrationTransform: [],
      imageDimensions: { oldOriginalWidth: oldWidth, oldOriginalHeight: oldHeight, currentOriginalWidth: currentWidth, currentOriginalHeight: currentHeight },
      scale: { metersPerPixel: input.options.metersPerPixel || null, uncertain: !input.options.metersPerPixel },
      candidateTransitions: [], semanticModel: null, semanticDecisions: [], warnings: [warning],
      annotationVersion: input.options.annotationVersion || null
    }
  };
}

/**
 * Deterministic Stage A: registration, native tiled segmentation, state assignment,
 * and mask-derived polygons. Optional semantic review runs only after hard gates.
 */
export async function detectChanges(
  oldSource: Buffer,
  currentSource: Buffer,
  options: DetectionOptions = {}
): Promise<ChangeDetectionResult> {
  const processedAt = new Date().toISOString();
  const hashes = {
    oldSha256: createHash("sha256").update(oldSource).digest("hex"),
    currentSha256: createHash("sha256").update(currentSource).digest("hex")
  };
  const [oldMetadata, currentMetadata] = await Promise.all([sharp(oldSource).metadata(), sharp(currentSource).metadata()]);
  if (inputExceedsResourceLimits(oldMetadata) || inputExceedsResourceLimits(currentMetadata)) {
    return resourceLimitResult({ oldMetadata, currentMetadata, options, hashes, processedAt });
  }
  const debug = await createDebugRun();
  const [oldImage, currentImage] = await Promise.all([
    prepareImageBuffer(oldSource, MAX_ANALYSIS_DIMENSION),
    prepareImageBuffer(currentSource, MAX_ANALYSIS_DIMENSION)
  ]);
  const coarseRegistration = await registerCurrentToOld(oldImage, currentImage);
  const registration = await promoteRegistrationToNative(coarseRegistration, oldImage, currentImage);
  // Native evidence uses the full frame. Known UI masks are explicit; the
  // conservative auto viewport is used only for registration feature search.
  const nativeViewport = { left: 0, top: 0, width: oldImage.nativeWidth, height: oldImage.nativeHeight };
  const requestedMode = requestedAnalysisMode(options);
  const frontierSetup = configureFrontier(options, requestedMode);
  // Start the independent complete-image and paired-tile scout before deterministic
  // segmentation can reject any candidate evidence.
  const frontierScoutPromise = frontierSetup.client
    ? runFrontierScouting(registration, frontierSetup.client)
    : null;
  const workspace = registration.diagnostics.reliable
    ? await buildGlobalChangeWorkspace(
      registration,
      nativeViewport,
      nativeViewport,
      {
        metersPerPixel: options.metersPerPixel,
        analysisToSourceScale: 1
      }
    )
    : emptyGlobalChangeWorkspace(registration);
  if (!options.metersPerPixel) {
    workspace.warnings.push({
      code: "GROUND_RESOLUTION_MISSING",
      severity: "warning",
      message: "Ground resolution is missing. Pixel coordinates remain valid, but physical area, morphology, and minimum-size interpretation are scale-uncertain."
    });
  }
  const semanticDecisions = await applySemanticValidation(workspace, registration, options);
  const frontier = await applyFrontierAnalysis({
    workspace,
    registration,
    requestedMode,
    setup: frontierSetup,
    scoutPromise: frontierScoutPromise
  });
  if (!frontier.ran) {
    frontier.deterministicOnlyCount = workspace.accepted.length + workspace.review.length;
    frontier.candidateDecisions = candidateDecisionAudits(workspace);
    frontier.funnel = buildPipelineFunnel(frontier, workspace);
  }
  const regions = await Promise.all(workspace.accepted.map((candidate, index) =>
    candidateRegion(candidate, registration, index + 1, options.metersPerPixel)
  ));
  const reviewRegions = await Promise.all(workspace.review.map((candidate, index) =>
    candidateRegion(candidate, registration, index + 1, options.metersPerPixel)
  ));
  const rejectedRegions = await Promise.all(workspace.rejected.map((candidate, index) =>
    candidateRegion(candidate, registration, index + 1)
  ));
  const acceptedDiagnostics = workspace.accepted.map((candidate, index) =>
    componentDiagnostic(candidate, regions[index], true)
  );
  const reviewDiagnostics = workspace.review.map((candidate, index) =>
    componentDiagnostic(candidate, reviewRegions[index], false)
  );
  const rejectedDiagnostics = workspace.rejected.map((candidate, index) =>
    componentDiagnostic(candidate, rejectedRegions[index], false)
  );
  const roiTrace = options.debugTrace && options.traceRoi
    ? buildRoiTrace({
      requested: options.traceRoi,
      registration,
      workspace,
      frontier,
      diagnostics: [...acceptedDiagnostics, ...reviewDiagnostics, ...rejectedDiagnostics]
    })
    : undefined;
  const validOverlapPixels = countNonZeroBuffer(registration.validMask);
  const totalChangedPixels = countNonZeroBuffer(workspace.finalMask);
  const reviewPixels = countNonZeroBuffer(workspace.reviewMask);
  const rejectedCandidatePixels = countNonZeroBuffer(workspace.rejectedMask);
  const allCandidatePixels = countNonZeroBuffer(workspace.allCandidateMask);
  const changedPercent = totalChangedPixels * 100 / Math.max(1, validOverlapPixels);
  const compatibilityWarnings: DetectionWarning[] = registration.diagnostics.reliable
    ? workspace.warnings
    : [{ code: "REGISTRATION_UNRELIABLE", severity: "error", message: registration.diagnostics.reason }];
  const compatibilityReliable = registration.diagnostics.reliable && workspace.reliable;
  const rejectionReasonCounts = rejectionReasonHistogram(rejectedDiagnostics);
  const state = detectionState({
    registrationReliable: registration.diagnostics.reliable,
    compatibilityReliable,
    warnings: compatibilityWarnings,
    rawEvidencePixels: workspace.rawEvidencePixels,
    globalCandidatePixels: workspace.globalCandidatePixels,
    candidateComponentCount: workspace.candidateComponentCount,
    acceptedRegionCount: regions.length,
    reviewRegionCount: reviewRegions.length,
    saturation: workspace.saturation
  });
  const [
    registeredOld,
    registeredCurrent,
    validOverlapMask,
    registrationResidualHeatmap,
    rawColorResidual,
    structuralResidual,
    removedStructureResidual,
    borderOverlayArtifactMask,
    edgeResidual,
    probabilityScore,
    highThresholdMask,
    lowThresholdMask,
    globalMask,
    cleaned,
    reviewMask,
    rejectedMask,
    allCandidateMask,
    acceptedOverlay,
    reviewOverlay,
    rejectedOverlay,
    combinedOverlay,
    keypoints,
    localAlignmentUnreliableMask
  ] = await Promise.all([
    rgbToJpeg(registration.alignedBeforeData, registration.width, registration.height),
    rgbToJpeg(registration.afterData, registration.width, registration.height),
    grayToPng(registration.validMask, registration.width, registration.height),
    residualHeatmapToPng(registration.registrationResidualMap, registration.width, registration.height),
    grayToPng(workspace.colorResidual, registration.width, registration.height),
    grayToPng(workspace.structuralResidual, registration.width, registration.height),
    grayToPng(workspace.removedStructureResidual, registration.width, registration.height),
    grayToPng(workspace.borderOverlayArtifactMask, registration.width, registration.height),
    grayToPng(workspace.edgeResidual, registration.width, registration.height),
    grayToPng(workspace.probabilityScore, registration.width, registration.height),
    grayToPng(workspace.highMask, registration.width, registration.height),
    grayToPng(workspace.lowMask, registration.width, registration.height),
    grayToPng(workspace.globalMask, registration.width, registration.height),
    grayToPng(workspace.finalMask, registration.width, registration.height),
    grayToPng(workspace.reviewMask, registration.width, registration.height),
    grayToPng(workspace.rejectedMask, registration.width, registration.height),
    grayToPng(workspace.allCandidateMask, registration.width, registration.height),
    drawPolygonOverlay(registration.afterData, registration.width, registration.height, regions),
    drawReviewPolygonOverlay(registration.afterData, registration.width, registration.height, reviewRegions),
    drawRejectedPolygonOverlay(registration.afterData, registration.width, registration.height, rejectedDiagnostics),
    drawCombinedPolygonOverlay(registration.afterData, registration.width, registration.height, regions, reviewRegions),
    drawRegistrationKeypoints(registration.alignedBeforeData, registration.width, registration.height, registration.keypoints),
    grayToPng(workspace.localAlignmentUnreliableMask, registration.width, registration.height)
  ]);
  const annotated = combinedOverlay;
  await Promise.all([
    debug.file(`01-original-old.${imageExtension(oldImage.diagnostics.format)}`, oldSource),
    debug.file(`01-original-current.${imageExtension(currentImage.diagnostics.format)}`, currentSource),
    debug.file("02-registered-old.jpg", registeredOld),
    debug.file("02-registered-current.jpg", registeredCurrent),
    debug.file("03-valid-overlap-mask.png", validOverlapMask),
    debug.file("04-registration-keypoints.jpg", keypoints),
    debug.file("05-registration-residual-heatmap.png", registrationResidualHeatmap),
    debug.file("06-raw-color-residual.png", rawColorResidual),
    debug.file("07-structural-residual.png", structuralResidual),
    debug.file("07-removed-structure-residual.png", removedStructureResidual),
    debug.file("07-border-overlay-artifact-mask.png", borderOverlayArtifactMask),
    debug.file("08-edge-residual.png", edgeResidual),
    debug.file("09-probability-score.png", probabilityScore),
    debug.file("10-high-threshold-mask.png", highThresholdMask),
    debug.file("11-low-threshold-mask.png", lowThresholdMask),
    debug.file("12-globally-cleaned-mask.png", globalMask),
    debug.file("13-final-accepted-mask.png", cleaned),
    debug.file("13-review-mask.png", reviewMask),
    debug.file("13-rejected-mask.png", rejectedMask),
    debug.file("13-all-candidate-mask.png", allCandidateMask),
    debug.file("14-accepted-components.jpg", acceptedOverlay),
    debug.file("14-review-components.jpg", reviewOverlay),
    debug.file("15-rejected-components.jpg", rejectedOverlay),
    debug.file("16-final-polygons.jpg", annotated),
    debug.file("16-local-alignment-unreliable-mask.png", localAlignmentUnreliableMask),
    debug.json("02-registration.json", registration.diagnostics),
    debug.json("06-normalization.json", workspace.normalization),
    debug.json("10-thresholds.json", workspace.thresholds),
    debug.json("14-accepted-components.json", acceptedDiagnostics),
    debug.json("14-review-components.json", reviewDiagnostics),
    debug.json("15-rejected-components.json", rejectedDiagnostics),
    debug.json("17-compatibility-warnings.json", compatibilityWarnings)
  ]);
  const result: ChangeDetectionResult = {
    state,
    registration: {
      matchedFeatures: registration.diagnostics.matches,
      inliers: registration.diagnostics.inliers,
      registrationConfidence: round(registration.diagnostics.confidence),
      reliable: registration.diagnostics.reliable,
      warning: registration.diagnostics.reliable ? null : registration.diagnostics.reason,
      transform: registration.diagnostics.homography,
      inlierRatio: round(registration.diagnostics.inlierRatio),
      spatialCoverage: round(registration.diagnostics.landmarkCoverage),
      medianReprojectionError: round(registration.diagnostics.medianReprojectionError),
      p90ReprojectionError: round(registration.diagnostics.p90ReprojectionError),
      p95ReprojectionError: round(registration.diagnostics.p95ReprojectionError),
      postWarpEdgeAlignmentResidual: round(registration.diagnostics.postWarpEdgeAlignmentResidual),
      validOverlapPercent: round(registration.diagnostics.validOverlapPercent),
      gridResiduals: registration.diagnostics.gridResiduals,
      localResidualIndicatesParallax: registration.diagnostics.localResidualIndicatesParallax,
      localUnreliableCells: registration.diagnostics.localUnreliableCells,
      locallyUnreliablePixelCount: registration.diagnostics.locallyUnreliablePixelCount,
      scaleRatio: round(registration.diagnostics.scaleRatio),
      ecc: registration.diagnostics.ecc
    },
    compatibility: { reliable: compatibilityReliable, warnings: compatibilityWarnings },
    image: {
      width: registration.width,
      height: registration.height,
      oldOriginalWidth: oldImage.diagnostics.originalWidth,
      oldOriginalHeight: oldImage.diagnostics.originalHeight,
      currentOriginalWidth: currentImage.diagnostics.originalWidth,
      currentOriginalHeight: currentImage.diagnostics.originalHeight
    },
    scale: {
      metersPerPixel: options.metersPerPixel || null,
      known: Boolean(options.metersPerPixel),
      uncertain: !options.metersPerPixel,
      warning: options.metersPerPixel ? null : "Ground resolution was not supplied; physical-size claims are disabled."
    },
    regions,
    reviewRegions,
    frontier,
    roiTrace,
    metrics: {
      regionCount: regions.length,
      totalChangedPixels,
      changedPercent: round(changedPercent),
      validOverlapPixels,
      finalChangedPixels: totalChangedPixels,
      finalChangedPercentage: round(changedPercent),
      acceptedRegionCount: regions.length,
      reviewRegionCount: reviewRegions.length,
      rejectedRegionCount: rejectedDiagnostics.length,
      acceptedPixels: totalChangedPixels,
      reviewPixels,
      rejectedCandidatePixels,
      allCandidatePixels,
      saturationStatus: workspace.saturation,
      preTruncationCandidateCount: workspace.preTruncationCandidateCount,
      confidenceMethod: "Monotonic deterministic evidence score used for ranking and accepted-versus-review assignment, not as a probability. Hard rejection is limited to physical/scale area, invalid geometry or viewport, UI/label artifacts, incoherent support, pair incompatibility, and extreme local registration failure.",
      rawEvidencePixels: workspace.rawEvidencePixels,
      globalCandidatePixels: workspace.globalCandidatePixels,
      candidateComponentCount: workspace.candidateComponentCount,
      rejectionReasonCounts,
      effectiveMinimumAreaPixels: workspace.effectiveMinimumAreaPixels,
      minimumAreaMethod: workspace.minimumAreaMethod
    },
    diagnostics: {
      normalization: workspace.normalization,
      thresholds: workspace.thresholds,
      acceptedComponents: acceptedDiagnostics,
      reviewComponents: reviewDiagnostics,
      rejectedComponents: rejectedDiagnostics
    },
    artifacts: {
      registeredOld: dataUrl(registeredOld, "image/jpeg"),
      registeredCurrent: dataUrl(registeredCurrent, "image/jpeg"),
      validOverlapMask: dataUrl(validOverlapMask, "image/png"),
      registrationResidualHeatmap: dataUrl(registrationResidualHeatmap, "image/png"),
      rawDifference: dataUrl(rawColorResidual, "image/png"),
      rawColorResidual: dataUrl(rawColorResidual, "image/png"),
      structuralResidual: dataUrl(structuralResidual, "image/png"),
      removedStructureResidual: dataUrl(removedStructureResidual, "image/png"),
      borderOverlayArtifactMask: dataUrl(borderOverlayArtifactMask, "image/png"),
      edgeResidual: dataUrl(edgeResidual, "image/png"),
      probabilityScore: dataUrl(probabilityScore, "image/png"),
      highThresholdMask: dataUrl(highThresholdMask, "image/png"),
      lowThresholdMask: dataUrl(lowThresholdMask, "image/png"),
      binaryMask: dataUrl(globalMask, "image/png"),
      cleanedMask: dataUrl(cleaned, "image/png"),
      acceptedMask: dataUrl(cleaned, "image/png"),
      reviewMask: dataUrl(reviewMask, "image/png"),
      rejectedMask: dataUrl(rejectedMask, "image/png"),
      allCandidateMask: dataUrl(allCandidateMask, "image/png"),
      acceptedComponents: dataUrl(acceptedOverlay, "image/jpeg"),
      reviewComponents: dataUrl(reviewOverlay, "image/jpeg"),
      rejectedComponents: dataUrl(rejectedOverlay, "image/jpeg"),
      annotatedResult: dataUrl(annotated, "image/jpeg"),
      registrationKeypoints: dataUrl(keypoints, "image/jpeg"),
      localAlignmentUnreliableMask: dataUrl(localAlignmentUnreliableMask, "image/png")
    },
    audit: {
      inputHashes: hashes,
      processedAt,
      detectorVersion: DETECTOR_VERSION,
      configVersion: DETECTOR_VERSION,
      thresholdConfiguration: {
        scoring: visionConfig.scoring,
        components: visionConfig.components,
        processing: visionConfig.processing,
        scale: visionConfig.scale,
        frontier: visionConfig.frontier
      },
      registrationTransform: registration.diagnostics.homography,
      imageDimensions: {
        canvasWidth: registration.width,
        canvasHeight: registration.height,
        oldOriginalWidth: oldImage.diagnostics.originalWidth,
        oldOriginalHeight: oldImage.diagnostics.originalHeight,
        currentOriginalWidth: currentImage.diagnostics.originalWidth,
        currentOriginalHeight: currentImage.diagnostics.originalHeight
      },
      scale: { metersPerPixel: options.metersPerPixel || null, uncertain: !options.metersPerPixel },
      candidateTransitions: [...acceptedDiagnostics, ...reviewDiagnostics, ...rejectedDiagnostics]
        .map((component) => ({ candidateId: component.id, transitions: component.stateTransitions })),
      semanticModel: semanticDecisions[0]?.model || null,
      semanticDecisions,
      warnings: compatibilityWarnings,
      annotationVersion: options.annotationVersion || null
    }
  };
  await debug.json("18-final-response-summary.json", {
    registration: result.registration,
    compatibility: result.compatibility,
    state: result.state,
    metrics: result.metrics,
    thresholds: result.diagnostics.thresholds,
    rejectionReasonCounts
  });
  await debug.json("19-audit-record.json", result.audit);
  return result;
}

function requestedAnalysisMode(options: DetectionOptions): AnalysisMode {
  if (options.analysisMode) return options.analysisMode;
  return (options.openAIApiKey || process.env.OPENAI_API_KEY) ? "hybrid" : "deterministic";
}

function configureFrontier(options: DetectionOptions, mode: AnalysisMode): {
  client: FrontierClient | null;
  model: string | null;
  fallbackReason: string | null;
} {
  if (mode === "deterministic") return { client: null, model: null, fallbackReason: null };
  if (options.frontierClient) {
    return { client: options.frontierClient, model: options.openAIModel || "mock", fallbackReason: null };
  }
  const apiKey = options.openAIApiKey || process.env.OPENAI_API_KEY;
  const model = options.openAIModel || process.env.OPENAI_MODEL;
  if (!apiKey) return { client: null, model: model || null, fallbackReason: "OPENAI_API_KEY_MISSING" };
  if (!model) return { client: null, model: null, fallbackReason: "OPENAI_MODEL_MISSING" };
  return {
    client: createOpenAIFrontierClient({
      apiKey,
      model,
      timeoutMs: visionConfig.frontier.timeoutMs,
      maximumRetries: visionConfig.frontier.maximumRetries,
      maximumOutputTokens: visionConfig.frontier.maximumOutputTokens,
      detail: visionConfig.frontier.defaultDetail,
      fallbackToHigh: visionConfig.frontier.fallbackToHigh
    }),
    model,
    fallbackReason: null
  };
}

function emptyFrontierAudit(requestedMode: AnalysisMode, fallbackReason: string | null = null): FrontierAnalysisAudit {
  return {
    requestedMode,
    effectiveMode: "deterministic",
    ran: false,
    fallbackReason,
    model: null,
    promptVersion: {
      scout: visionConfig.frontier.scoutPromptVersion,
      verification: visionConfig.frontier.verificationPromptVersion
    },
    globalScoutCount: 0,
    tileScoutCount: 0,
    deduplicationCount: 0,
    deterministicOnlyCount: 0,
    frontierOnlyCount: 0,
    matchedCount: 0,
    callCount: 0,
    scoutCallCount: 0,
    verificationCallCount: 0,
    usage: null,
    latencyMs: 0,
    warnings: [],
    calls: [],
    rawProposals: [],
    mappedProposals: [],
    invalidProposals: [],
    deduplicationClusters: [],
    proposalLimitDecisions: [],
    mergeDecisions: [],
    localRefinementDecisions: [],
    candidateDecisions: [],
    verificationQueue: [],
    funnel: emptyPipelineFunnel()
  };
}

function emptyPipelineFunnel(): PipelineFunnelMetrics {
  return {
    rawGlobalScoutProposals: 0,
    rawTileScoutProposals: 0,
    invalidProposals: 0,
    mappedProposals: 0,
    proposalsRemovedByDeduplication: 0,
    deduplicatedProposals: 0,
    deterministicOnlyCandidates: 0,
    frontierOnlyCandidates: 0,
    matchedCandidates: 0,
    candidatesRemovedByLimits: 0,
    candidatesLocallyRefined: 0,
    candidatesWithPixelMasks: 0,
    candidatesWithCoarseBoxesOnly: 0,
    verificationQueued: 0,
    verificationCompleted: 0,
    verificationSkippedByLimits: 0,
    accepted: 0,
    needsReview: 0,
    rejected: 0
  };
}

async function runFrontierScouting(registration: Registration, client: FrontierClient): Promise<FrontierScoutRun> {
  const started = Date.now();
  const audits: FrontierCallAudit[] = [];
  const warnings: string[] = [];
  const rawProposals: FrontierRawProposalAudit[] = [];
  const mappedProposals: FrontierMappedProposalAudit[] = [];
  const invalidProposals: FrontierMappedProposalAudit[] = [];
  const proposalLimitDecisions: ProposalLimitAudit[] = [];
  const fullFrame = { left: 0, top: 0, width: registration.width, height: registration.height };
  const [oldImage, currentImage] = await Promise.all([
    rgbToJpeg(registration.alignedBeforeData, registration.width, registration.height),
    rgbToJpeg(registration.afterData, registration.width, registration.height)
  ]);
  const global = await client.scout({
    stage: "global_scout",
    oldImage: dataUrl(oldImage, "image/jpeg"),
    currentImage: dataUrl(currentImage, "image/jpeg"),
    imageWidth: registration.width,
    imageHeight: registration.height,
    promptVersion: visionConfig.frontier.scoutPromptVersion
  });
  audits.push(global.audit);
  const globalMapped = auditAndMapFrontierChanges(
    global.changes,
    fullFrame,
    "frontier_global",
    null,
    global.audit
  );
  rawProposals.push(...globalMapped.raw);
  mappedProposals.push(...globalMapped.mapped);
  invalidProposals.push(...globalMapped.invalid);
  const globalLimited = limitFrontierProposals(
    globalMapped.proposals,
    visionConfig.frontier.maximumCandidates,
    "global",
    proposalLimitDecisions
  );
  const globalProposals = globalLimited;

  const allTiles = createAdaptiveTiles({
    width: registration.width,
    height: registration.height,
    preferredSize: visionConfig.frontier.preferredTileSize,
    overlapFraction: visionConfig.frontier.tileOverlapFraction,
    maximumTiles: visionConfig.frontier.maximumTiles
  });
  let pairedMegapixels = registration.width * registration.height * 2 / 1_000_000;
  const tiles = allTiles.filter((tile) => {
    const cost = tile.width * tile.height * 2 / 1_000_000;
    if (pairedMegapixels + cost > visionConfig.frontier.maximumPairedMegapixels) return false;
    pairedMegapixels += cost;
    return true;
  }).slice(0, Math.max(0, visionConfig.frontier.maximumCalls - 1));
  if (tiles.length < allTiles.length) warnings.push("FRONTIER_TILE_COST_LIMIT_REACHED");
  const tileResponses = await mapWithConcurrency(tiles, visionConfig.frontier.concurrency, async (tile) => {
    try {
      const crop: PixelBox = tile;
      const [oldTile, currentTile] = await Promise.all([
        cropRgbDataUrl(registration.alignedBeforeData, registration.width, registration.height, crop),
        cropRgbDataUrl(registration.afterData, registration.width, registration.height, crop)
      ]);
      const response = await client.scout({
        stage: "tile_scout",
        oldImage: oldTile,
        currentImage: currentTile,
        imageWidth: tile.width,
        imageHeight: tile.height,
        promptVersion: visionConfig.frontier.scoutPromptVersion,
        tile
      });
      return { tile, response };
    } catch (error) {
      warnings.push(`TILE_SCOUT_FAILED:${tile.id}:${errorMessage(error)}`);
      return null;
    }
  });
  const tileProposals: FrontierProposal[] = [];
  for (const item of tileResponses) {
    if (!item) continue;
    audits.push(item.response.audit);
    const mapped = auditAndMapFrontierChanges(
      item.response.changes,
      item.tile,
      "frontier_tile",
      item.tile.id,
      item.response.audit
    );
    rawProposals.push(...mapped.raw);
    mappedProposals.push(...mapped.mapped);
    invalidProposals.push(...mapped.invalid);
    tileProposals.push(...limitFrontierProposals(
      mapped.proposals,
      visionConfig.frontier.maximumCandidates,
      "tile",
      proposalLimitDecisions
    ));
  }
  const deduplicated = deduplicateFrontierProposals(
    [...globalProposals, ...tileProposals],
    {
      iou: visionConfig.frontier.deduplicationIou,
      containment: visionConfig.frontier.deduplicationContainment,
      centerDistanceRatio: visionConfig.frontier.deduplicationCenterDistance,
      sizeRatio: visionConfig.frontier.deduplicationSizeRatio,
      semanticSimilarity: visionConfig.frontier.deduplicationSemanticSimilarity
    }
  );
  const finalProposals = limitFrontierProposals(
    deduplicated.proposals,
    visionConfig.frontier.maximumCandidates,
    "candidate",
    proposalLimitDecisions
  );
  return {
    proposals: finalProposals,
    globalScoutCount: globalProposals.length,
    tileScoutCount: tileProposals.length,
    deduplicationCount: deduplicated.removedCount,
    audits,
    model: audits[0]?.model || null,
    latencyMs: Date.now() - started,
    warnings,
    rawProposals,
    mappedProposals,
    invalidProposals,
    deduplicationClusters: deduplicated.clusters,
    proposalLimitDecisions
  };
}

function auditAndMapFrontierChanges(
  changes: FrontierModelChange[],
  frame: NativeFrontierBox,
  source: "frontier_global" | "frontier_tile",
  tileId: string | null,
  callAudit: FrontierCallAudit
) {
  const raw: FrontierRawProposalAudit[] = [];
  const mapped: FrontierMappedProposalAudit[] = [];
  const invalid: FrontierMappedProposalAudit[] = [];
  const proposals: FrontierProposal[] = [];
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const proposalId = tileId ? `${tileId}:${change.id}` : `global:${change.id}`;
    const rawRecord: FrontierRawProposalAudit = {
      proposalId,
      source,
      tileId,
      tile: tileId ? { ...frame } : null,
      originalNormalizedBox: { ...change.bbox },
      decision: change.decision,
      confidence: change.confidence,
      changeType: change.changeType,
      promptVersion: callAudit.promptVersion,
      model: callAudit.model,
      callId: callAudit.requestId
    };
    raw.push(rawRecord);
    const clampedNormalizedBox = normalizeFrontierBox(change.bbox);
    const nativeMappedBox = clampedNormalizedBox ? mapNormalizedBoxToNative(clampedNormalizedBox, frame) : null;
    const wasClamped = Boolean(clampedNormalizedBox && (
      clampedNormalizedBox.x !== change.bbox.x || clampedNormalizedBox.y !== change.bbox.y ||
      clampedNormalizedBox.width !== change.bbox.width || clampedNormalizedBox.height !== change.bbox.height
    ));
    const mappedRecord: FrontierMappedProposalAudit = {
      ...rawRecord,
      clampedNormalizedBox,
      nativeMappedBox,
      malformed: !nativeMappedBox,
      rejected: !nativeMappedBox,
      reasonCode: nativeMappedBox ? null : "invalid_frontier_box",
      explanation: nativeMappedBox
        ? `${wasClamped ? "Clamped the normalized box, then mapped" : "Mapped normalized coordinates"} through frame ${frame.left},${frame.top},${frame.width},${frame.height}.`
        : "The normalized box could not be mapped to a positive native-pixel area.",
      mapping: {
        frame: { ...frame },
        xScale: frame.width / 1000,
        yScale: frame.height / 1000
      }
    };
    mapped.push(mappedRecord);
    if (!nativeMappedBox) {
      invalid.push(mappedRecord);
      continue;
    }
    const proposal = frontierChangeToProposal(change, frame, source, tileId ? [tileId] : [], proposalId);
    if (proposal) proposals.push({ ...proposal, id: proposalId });
  }
  return { raw, mapped, invalid, proposals };
}

function limitFrontierProposals(
  proposals: FrontierProposal[],
  limit: number,
  limitType: ProposalLimitAudit["limitType"],
  audits: ProposalLimitAudit[]
) {
  const ranked = [...proposals].sort((a, b) => b.confidence - a.confidence);
  for (let index = 0; index < ranked.length; index += 1) {
    const included = index < limit;
    audits.push({
      proposalId: ranked[index].id,
      rankBeforeLimit: index + 1,
      rankAfterLimit: included ? index + 1 : null,
      included,
      limitType: included ? "none" : limitType,
      reasonCode: included ? null : "candidate_limit_exceeded",
      explanation: included
        ? "Proposal remained within the configured ranked limit."
        : `Proposal rank ${index + 1} exceeded the configured ${limitType} limit of ${limit}.`
    });
  }
  return ranked.slice(0, limit);
}

function frontierChangeToProposal(
  change: FrontierModelChange,
  frame: NativeFrontierBox,
  source: "frontier_global" | "frontier_tile",
  tileIds: string[],
  sourceId: string
): FrontierProposal | null {
  const bbox = mapNormalizedBoxToNative(change.bbox, frame);
  if (!bbox) return null;
  return {
    id: String(change.id),
    decision: change.decision,
    changeType: String(change.changeType),
    confidence: Number(change.confidence),
    bbox,
    beforeDescription: String(change.beforeDescription),
    afterDescription: String(change.afterDescription),
    evidence: String(change.evidence),
    artifactRisk: String(change.artifactRisk),
    smallObject: change.smallObject === true,
    source,
    sourceIds: [sourceId],
    tileIds
  };
}

async function applyFrontierAnalysis(input: {
  workspace: GlobalChangeWorkspace;
  registration: Registration;
  requestedMode: AnalysisMode;
  setup: { client: FrontierClient | null; model: string | null; fallbackReason: string | null };
  scoutPromise: Promise<FrontierScoutRun> | null;
}): Promise<FrontierAnalysisAudit> {
  const audit = emptyFrontierAudit(input.requestedMode, input.setup.fallbackReason);
  audit.model = input.setup.model;
  if (!input.scoutPromise || !input.setup.client) return audit;
  let scout: FrontierScoutRun;
  try {
    scout = await input.scoutPromise;
  } catch (error) {
    audit.fallbackReason = `FRONTIER_SCOUT_FAILED:${errorMessage(error)}`;
    audit.warnings.push(audit.fallbackReason);
    input.workspace.warnings.push({
      code: "FRONTIER_FALLBACK",
      severity: "warning",
      message: "Frontier analysis failed safely; deterministic results were retained."
    });
    return audit;
  }
  audit.ran = true;
  audit.effectiveMode = input.requestedMode;
  audit.fallbackReason = null;
  audit.model = scout.model || input.setup.model;
  audit.globalScoutCount = scout.globalScoutCount;
  audit.tileScoutCount = scout.tileScoutCount;
  audit.deduplicationCount = scout.deduplicationCount;
  audit.latencyMs = scout.latencyMs;
  audit.warnings.push(...scout.warnings);
  audit.calls.push(...scout.audits);
  audit.scoutCallCount = scout.audits.length;
  audit.rawProposals = scout.rawProposals;
  audit.mappedProposals = scout.mappedProposals;
  audit.invalidProposals = scout.invalidProposals;
  audit.deduplicationClusters = scout.deduplicationClusters;
  audit.proposalLimitDecisions = scout.proposalLimitDecisions;

  const deterministic = [...input.workspace.accepted, ...input.workspace.review];
  for (const candidate of deterministic) {
    candidate.proposalSource = "deterministic";
    candidate.geometryType = "pixel_mask";
    candidate.stateReason = candidate.state === "accepted"
      ? "Strong deterministic evidence pending semantic confirmation."
      : "Coherent deterministic evidence requires review."
    candidate.frontierScout = {
      status: "not_found",
      decision: null,
      confidence: null,
      explanation: "No retained scout proposal matched this deterministic component.",
      model: audit.model,
      promptVersion: visionConfig.frontier.scoutPromptVersion,
      source: "global_and_tile_scouts",
      latencyMs: null,
      usage: null
    };
    candidate.frontierVerification = unstartedVerification("not_required");
  }
  if (input.requestedMode === "frontier_baseline") {
    input.workspace.accepted = [];
    input.workspace.review = [];
  }
  const availableDeterministic = input.requestedMode === "hybrid" ? deterministic : [];
  for (const proposal of scout.proposals) {
    const match = bestFrontierMatch(proposal.bbox, availableDeterministic);
    if (match?.candidate) {
      const candidate = match.candidate;
      candidate.proposalSource = "deterministic_and_frontier";
      candidate.frontierProposal = proposal;
      candidate.frontierDecision = proposal.decision;
      candidate.frontierConfidence = proposal.confidence;
      candidate.auditProposalIds = [...new Set([...(candidate.auditProposalIds || []), ...proposal.sourceIds])];
      candidate.frontierScout = scoutSnapshot(proposal, audit.model);
      audit.mergeDecisions.push({
        proposalId: proposal.id,
        candidateId: candidate.id,
        matched: true,
        iou: round(match.iou),
        containment: round(match.containment),
        reasonCode: "matched_deterministic_candidate",
        explanation: "The scout hint overlaps a deterministic pixel component under the configured merge rule."
      });
      audit.matchedCount += 1;
      continue;
    }
    const refined = refineFrontierProposal(proposal, input.workspace, input.registration);
    refined.frontierScout = scoutSnapshot(proposal, audit.model);
    refined.frontierVerification = unstartedVerification("not_required");
    refined.auditProposalIds = [...proposal.sourceIds];
    input.workspace.review.push(refined);
    audit.mergeDecisions.push({
      proposalId: proposal.id,
      candidateId: refined.id,
      matched: false,
      iou: match?.iou || 0,
      containment: match?.containment || 0,
      reasonCode: "frontier_only_candidate",
      explanation: "No deterministic component met the merge thresholds; the scout proposal remains independently visible."
    });
    audit.localRefinementDecisions.push({
      proposalId: proposal.id,
      candidateId: refined.id,
      selectedComponentIds: refined.refinedComponentId ? [refined.refinedComponentId] : [],
      selectedPixelCount: refined.componentArea || 0,
      reliableLocalMask: refined.geometryType === "pixel_mask",
      geometryType: refined.geometryType || "frontier_bbox",
      proposalSource: refined.proposalSource || proposal.source,
      reasonCode: refined.geometryType === "pixel_mask" ? "local_refinement_succeeded" : "local_refinement_failed",
      explanation: refined.stateReason || "Local deterministic refinement completed."
    });
    audit.frontierOnlyCount += 1;
  }
  audit.deterministicOnlyCount = input.requestedMode === "hybrid"
    ? deterministic.filter((candidate) => candidate.proposalSource === "deterministic").length
    : 0;

  const merged = [...input.workspace.accepted, ...input.workspace.review];
  const availableCalls = Math.max(0, visionConfig.frontier.maximumCalls - audit.calls.length);
  const scheduled = scheduleVerificationCandidates(
    merged,
    Math.min(availableCalls, visionConfig.frontier.maximumCandidates)
  );
  const scheduledSet = new Set(scheduled.map((item) => item.candidate));
  for (let index = 0; index < scheduled.length; index += 1) {
    const item = scheduled[index];
    item.candidate.verificationPriority = item.priority;
    item.candidate.verificationQueuePosition = index + 1;
    item.candidate.frontierVerification = {
      ...unstartedVerification("queued"),
      source: item.candidate.proposalSource || "deterministic"
    };
    audit.verificationQueue.push({
      candidateId: item.candidate.id,
      priority: item.priority,
      category: item.category,
      queuePosition: index + 1,
      scheduled: true,
      ran: false,
      status: "queued",
      reasonCode: null,
      explanation: "Candidate was scheduled within the reserved and total verification capacity."
    });
  }
  for (const candidate of merged.filter((value) => !scheduledSet.has(value))) {
    const queuePosition = audit.verificationQueue.length + 1;
    audit.verificationQueue.push(markCandidateSkippedByCallLimit(candidate, queuePosition));
  }
  if (scheduled.length < merged.length) audit.warnings.push("FRONTIER_CANDIDATE_VERIFICATION_LIMIT_REACHED");
  const verificationResults = await mapWithConcurrency(
    scheduled,
    visionConfig.frontier.concurrency,
    async (item) => verifyFrontierCandidate(item.candidate, input.workspace, input.registration, input.setup.client!, audit)
  );
  const originalAccepted = new Set(input.workspace.accepted);
  const accepted: Candidate[] = [];
  const review: Candidate[] = [];
  const rejected: Candidate[] = [...input.workspace.rejected];
  for (let index = 0; index < scheduled.length; index += 1) {
    const candidate = scheduled[index].candidate;
    const verification = verificationResults[index];
    const previous = candidate.state || "needs_review";
    const strongDeterministic = originalAccepted.has(candidate) && candidate.proposalSource !== "frontier_global" && candidate.proposalSource !== "frontier_tile";
    if (!verification) {
      candidate.state = "needs_review";
      candidate.stateReason = "Frontier verification failed; plausible change was preserved for review.";
      recordCandidateTransition(candidate, previous, "needs_review", "verification_failed_preserved_for_review");
      review.push(candidate);
    } else if (verification.decision === "likely_artifact") {
      if (strongDeterministicEvidence(candidate)) {
        candidate.state = "needs_review";
        candidate.reviewReasons = [...new Set([...(candidate.reviewReasons || []), "semantic_pixel_evidence_conflict"])];
        candidate.stateReason = "Semantic verification suggests an artifact, but strong coherent pixel evidence conflicts; human review is required.";
        recordCandidateTransition(candidate, previous, "needs_review", "semantic_pixel_evidence_conflict");
        review.push(candidate);
      } else {
        candidate.state = "rejected";
        candidate.stateReason = "Crop verification identified a likely artifact and deterministic physical-change evidence was weak.";
        candidate.rejectionReasons = [...(candidate.rejectionReasons || []), "FRONTIER_VERIFIED_ARTIFACT"];
        recordCandidateTransition(candidate, previous, "rejected", "likely_artifact_with_weak_pixel_support");
        rejected.push(candidate);
      }
    } else if (verification.decision === "physical_change" && strongDeterministic) {
      candidate.state = "accepted";
      candidate.stateReason = "Strong deterministic evidence was confirmed as a physical change in the native crop.";
      recordCandidateTransition(candidate, previous, "accepted", "frontier_verification_confirmed_physical_change");
      accepted.push(candidate);
    } else {
      candidate.state = "needs_review";
      candidate.stateReason = verification.decision === "uncertain"
        ? "Crop verification was uncertain; the plausible change remains visible for review."
        : "Frontier-only or weaker deterministic evidence cannot be accepted before calibration.";
      recordCandidateTransition(candidate, previous, "needs_review",
        verification.decision === "uncertain" ? "frontier_verification_uncertain" : "weaker_evidence_requires_review");
      review.push(candidate);
    }
  }
  review.push(...merged.filter((candidate) => !scheduledSet.has(candidate)));
  input.workspace.accepted = accepted;
  input.workspace.review = review;
  input.workspace.rejected = rejected;
  rebuildWorkspaceMasks(input.workspace, input.registration.width, input.registration.height);
  audit.verificationCallCount = audit.verificationQueue.filter((item) => item.ran).length;
  audit.callCount = audit.scoutCallCount + audit.verificationCallCount;
  audit.usage = sumFrontierUsage(audit.calls);
  audit.latencyMs = Math.max(audit.latencyMs, audit.calls.reduce((sum, call) => sum + call.latencyMs, 0));
  audit.candidateDecisions = candidateDecisionAudits(input.workspace);
  audit.funnel = buildPipelineFunnel(audit, input.workspace);
  return audit;
}

function candidateDecisionAudits(workspace: GlobalChangeWorkspace) {
  return [...workspace.accepted, ...workspace.review, ...workspace.rejected]
    .flatMap((candidate) => (candidate.stateTransitions || []).map((transition) => ({
      candidateId: candidate.id,
      from: transition.from,
      to: transition.to,
      reasonCode: normalizeReasonCode(transition.reason),
      explanation: humanReason(transition.reason)
    })));
}

function recordCandidateTransition(
  candidate: Candidate,
  from: CandidateState | "candidate",
  to: CandidateState,
  reason: string
) {
  candidate.stateTransitions ||= [];
  candidate.stateTransitions.push({ from, to, reason, at: new Date().toISOString() });
}

function bestFrontierMatch(box: NativeFrontierBox, candidates: Candidate[]) {
  return candidates.map((candidate) => ({
    candidate,
    iou: intersectionOverUnion(candidate.box, box),
    containment: intersectionOverSmaller(candidate.box, box)
  }))
    .filter((value) => value.iou >= visionConfig.frontier.mergeIou ||
      value.containment >= visionConfig.frontier.mergeContainment)
    .sort((first, second) => second.containment - first.containment || second.iou - first.iou)[0];
}

function scoutSnapshot(proposal: FrontierProposal, model: string | null): FrontierDecisionSnapshot {
  return {
    status: "completed",
    decision: proposal.decision,
    confidence: proposal.confidence,
    explanation: proposal.evidence,
    model,
    promptVersion: visionConfig.frontier.scoutPromptVersion,
    source: proposal.source,
    latencyMs: null,
    usage: null
  };
}

function unstartedVerification(status: FrontierVerificationStatus): FrontierDecisionSnapshot {
  return {
    status,
    decision: null,
    confidence: null,
    explanation: status === "skipped_call_limit" ? "Crop verification did not run because bounded call capacity was exhausted." : null,
    model: null,
    promptVersion: visionConfig.frontier.verificationPromptVersion,
    source: "candidate_crop",
    latencyMs: null,
    usage: null
  };
}

function verificationCategory(candidate: Candidate) {
  const frontierOnly = candidate.proposalSource === "frontier_global" || candidate.proposalSource === "frontier_tile";
  if (frontierOnly) return "frontier_only";
  if (candidate.frontierProposal?.smallObject) return "unmatched_small_object";
  if (isRemovalCandidate(candidate)) return "possible_removal";
  if (candidate.state === "needs_review" && candidate.proposalSource === "deterministic_and_frontier") {
    return "frontier_supported_deterministic_review";
  }
  if (candidate.state === "needs_review") return "deterministic_review";
  return "strong_deterministic_accepted";
}

function verificationPriority(candidate: Candidate) {
  const categories = [
    "frontier_only",
    "unmatched_small_object",
    "possible_removal",
    "frontier_supported_deterministic_review",
    "deterministic_review",
    "strong_deterministic_accepted"
  ];
  return categories.indexOf(verificationCategory(candidate)) + 1;
}

function isRemovalCandidate(candidate: Candidate) {
  const text = `${candidate.frontierProposal?.changeType || ""} ${candidate.frontierProposal?.beforeDescription || ""} ${candidate.frontierProposal?.afterDescription || ""}`;
  return /remov|disappear|demol|absent|replaced|cleared|loss/i.test(text) || (candidate.removalSupport || 0) >= 0.34;
}

function scheduleVerificationCandidates(candidates: Candidate[], capacity: number) {
  if (capacity <= 0) return [];
  const ranked = [...candidates].sort((a, b) =>
    verificationPriority(a) - verificationPriority(b) ||
    (a.componentArea || a.box.width * a.box.height) - (b.componentArea || b.box.width * b.box.height) ||
    (b.componentScore || b.frontierConfidence || 0) - (a.componentScore || a.frontierConfidence || 0)
  );
  const selected: Candidate[] = [];
  const addReserved = (predicate: (candidate: Candidate) => boolean, count: number) => {
    for (const candidate of ranked) {
      if (selected.length >= capacity || count <= 0) break;
      if (!selected.includes(candidate) && predicate(candidate)) {
        selected.push(candidate);
        count -= 1;
      }
    }
  };
  addReserved(
    (candidate) => candidate.proposalSource === "frontier_global" || candidate.proposalSource === "frontier_tile",
    visionConfig.frontier.verificationReserveFrontierOnly
  );
  addReserved((candidate) => candidate.frontierProposal?.smallObject === true, visionConfig.frontier.verificationReserveSmallObject);
  addReserved(isRemovalCandidate, visionConfig.frontier.verificationReserveRemoval);
  for (const candidate of ranked) {
    if (selected.length >= capacity) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected.map((candidate) => ({
    candidate,
    priority: verificationPriority(candidate),
    category: verificationCategory(candidate)
  }));
}

export function scheduleVerificationCandidatesForTest(candidates: Candidate[], capacity: number) {
  return scheduleVerificationCandidates(candidates, capacity).map((item) => ({
    candidateId: item.candidate.id,
    priority: item.priority,
    category: item.category
  }));
}

export function applyVerificationLimitForTest(candidates: Candidate[], capacity: number) {
  const scheduled = scheduleVerificationCandidates(candidates, capacity);
  const selected = new Set(scheduled.map((item) => item.candidate));
  let queuePosition = scheduled.length;
  const skipped = candidates.filter((candidate) => !selected.has(candidate)).map((candidate) => {
    queuePosition += 1;
    return markCandidateSkippedByCallLimit(candidate, queuePosition);
  });
  return { scheduled: scheduled.map((item) => item.candidate), skipped };
}

function markCandidateSkippedByCallLimit(candidate: Candidate, queuePosition: number): VerificationQueueAudit {
  const previous = candidate.state || "needs_review";
  candidate.state = "needs_review";
  candidate.reviewReasons = [...new Set([...(candidate.reviewReasons || []), "not_verified_due_to_call_limit"])];
  candidate.stateReason = "not_verified_due_to_call_limit: plausible evidence remains visible because bounded verification capacity was exhausted.";
  candidate.frontierVerification = {
    ...unstartedVerification("skipped_call_limit"),
    source: candidate.proposalSource || "deterministic"
  };
  candidate.verificationQueuePosition = queuePosition;
  recordCandidateTransition(candidate, previous, "needs_review", "not_verified_due_to_call_limit");
  return {
    candidateId: candidate.id,
    priority: verificationPriority(candidate),
    category: verificationCategory(candidate),
    queuePosition,
    scheduled: false,
    ran: false,
    status: "skipped_call_limit",
    reasonCode: "not_verified_due_to_call_limit",
    explanation: "The candidate remains needs_review because the bounded crop-verification budget was exhausted."
  };
}

function strongDeterministicEvidence(candidate: Candidate) {
  return candidate.geometryType === "pixel_mask" &&
    (candidate.componentScore || 0) >= (candidate.requiredScore || visionConfig.components.minimumComponentScore) &&
    (candidate.structuralSupport || 0) >= visionConfig.components.minimumStructuralSupport &&
    (candidate.backgroundContrast || 0) >= visionConfig.components.minimumBackgroundContrast;
}

function normalizeReasonCode(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

function humanReason(value: string) {
  return value.replace(/[|_]+/g, " ").toLowerCase();
}

function buildPipelineFunnel(audit: FrontierAnalysisAudit, workspace: GlobalChangeWorkspace): PipelineFunnelMetrics {
  const finalCandidates = [...workspace.accepted, ...workspace.review, ...workspace.rejected];
  const deterministicOnlyCandidates = finalCandidates.filter((candidate) =>
    !candidate.proposalSource || candidate.proposalSource === "deterministic"
  ).length;
  const frontierOnlyCandidates = finalCandidates.filter((candidate) =>
    candidate.proposalSource === "frontier_global" || candidate.proposalSource === "frontier_tile"
  ).length;
  const matchedCandidates = finalCandidates.filter((candidate) =>
    candidate.proposalSource === "deterministic_and_frontier"
  ).length;
  audit.deterministicOnlyCount = deterministicOnlyCandidates;
  audit.frontierOnlyCount = frontierOnlyCandidates;
  audit.matchedCount = matchedCandidates;
  return {
    rawGlobalScoutProposals: audit.rawProposals.filter((proposal) => proposal.source === "frontier_global").length,
    rawTileScoutProposals: audit.rawProposals.filter((proposal) => proposal.source === "frontier_tile").length,
    invalidProposals: audit.invalidProposals.length,
    mappedProposals: audit.mappedProposals.filter((proposal) => !proposal.rejected).length,
    proposalsRemovedByDeduplication: audit.deduplicationCount,
    deduplicatedProposals: audit.deduplicationClusters.length,
    deterministicOnlyCandidates,
    frontierOnlyCandidates,
    matchedCandidates,
    candidatesRemovedByLimits: audit.proposalLimitDecisions.filter((decision) => !decision.included).length,
    candidatesLocallyRefined: audit.localRefinementDecisions.filter((decision) => decision.reliableLocalMask).length,
    candidatesWithPixelMasks: finalCandidates.filter((candidate) => candidate.geometryType !== "frontier_bbox").length,
    candidatesWithCoarseBoxesOnly: finalCandidates.filter((candidate) => candidate.geometryType === "frontier_bbox").length,
    verificationQueued: audit.verificationQueue.filter((item) => item.scheduled).length,
    verificationCompleted: audit.verificationQueue.filter((item) => item.status === "completed").length,
    verificationSkippedByLimits: audit.verificationQueue.filter((item) => item.status === "skipped_call_limit").length,
    accepted: workspace.accepted.length,
    needsReview: workspace.review.length,
    rejected: workspace.rejected.length
  };
}

function buildRoiTrace(input: {
  requested: TraceRoiInput;
  registration: Registration;
  workspace: GlobalChangeWorkspace;
  frontier: FrontierAnalysisAudit;
  diagnostics: ComponentDiagnostic[];
}): RoiTrace {
  const roi = normalizeTraceRoi(input.requested, input.registration.width, input.registration.height);
  const pixelIndexes: number[] = [];
  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) pixelIndexes.push(y * input.registration.width + x);
  }
  const validIndexes = pixelIndexes.filter((pixel) => input.registration.validMask[pixel]);
  const values = (plane: Uint8Array, divisor = 255) => validIndexes.map((pixel) => plane[pixel] / divisor);
  const probability = values(input.workspace.probabilityScore);
  const lowComponents = connectedComponentsBuffer(input.workspace.lowMask, input.registration.width, input.registration.height)
    .filter((component) => pixelBoxesOverlap(component.box, traceBox(roi)));
  const coherentComponents = connectedComponentsBuffer(input.workspace.globalMask, input.registration.width, input.registration.height)
    .filter((component) => pixelBoxesOverlap(component.box, traceBox(roi)));
  const highComponents = connectedComponentsBuffer(input.workspace.highMask, input.registration.width, input.registration.height);
  const unreliableCells = input.registration.diagnostics.localUnreliableCells.filter((cell) => {
    const cellBox = gridCellBox(
      cell.row,
      cell.column,
      visionConfig.registration.gridRows,
      visionConfig.registration.gridColumns,
      input.registration.width,
      input.registration.height
    );
    return pixelBoxesOverlap(cellBox, traceBox(roi));
  });
  const candidates = [...input.workspace.accepted, ...input.workspace.review, ...input.workspace.rejected]
    .filter((candidate) => pixelBoxesOverlap(candidate.box, traceBox(roi)));
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const mappedById = new Map(input.frontier.mappedProposals.map((proposal) => [proposal.proposalId, proposal]));
  const proposalTouches = (proposalId: string) => {
    const box = mappedById.get(proposalId)?.nativeMappedBox;
    return Boolean(box && pixelBoxesOverlap(box, traceBox(roi)));
  };
  const rawFrontierProposals = input.frontier.rawProposals
    .map((proposal) => ({ ...proposal, overlapsRoi: proposalTouches(proposal.proposalId) }))
    .filter((proposal) => proposal.overlapsRoi)
    .slice(0, 200);
  const coordinateValidation = input.frontier.mappedProposals
    .map((proposal) => ({ ...proposal, overlapsRoi: Boolean(proposal.nativeMappedBox && pixelBoxesOverlap(proposal.nativeMappedBox, traceBox(roi))) }))
    .filter((proposal) => proposal.overlapsRoi)
    .slice(0, 200);
  const diagnosticsById = new Map(input.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]));
  return {
    roi,
    registration: {
      insideValidOverlap: validIndexes.length === pixelIndexes.length,
      validOverlapPixelCount: validIndexes.length,
      validOverlapPercent: round(validIndexes.length * 100 / Math.max(1, pixelIndexes.length)),
      borderMaskContact: roiBorderContact(roi, input.registration.validMask, input.registration.width),
      localRegistrationResidual: round(mean(values(input.registration.registrationResidualMap))),
      unreliableGridCellDiscounting: unreliableCells.length > 0,
      unreliableGridCells: unreliableCells,
      borderOverlayArtifactPixelCount: pixelIndexes.filter((pixel) => input.workspace.borderOverlayArtifactMask[pixel]).length
    },
    deterministicEvidence: {
      probabilityMean: round(mean(probability)),
      probabilityMaximum: round(Math.max(0, ...probability)),
      probabilityPercentiles: diagnosticPercentiles(probability.map((value) => value * 255)),
      lowThresholdPixelCount: pixelIndexes.filter((pixel) => input.workspace.lowMask[pixel]).length,
      highThresholdPixelCount: pixelIndexes.filter((pixel) => input.workspace.highMask[pixel]).length,
      structuralDifferenceSupport: round(mean(values(input.workspace.structuralResidual))),
      colorDifferenceSupport: round(mean(values(input.workspace.colorResidual, 64).map(clamp01))),
      edgeSupport: round(mean(values(input.workspace.edgeResidual))),
      removedStructureSupport: round(mean(values(input.workspace.removedStructureResidual))),
      localContrast: round(roiLocalContrast(roi, input.workspace.probabilityScore, input.registration.validMask, input.registration.width, input.registration.height)),
      multiscaleSupport: round(mean(values(input.workspace.structuralResidual))),
      coherentComponentCount: coherentComponents.length,
      componentSizes: coherentComponents.map((component) => component.area),
      lowOnlyComponentExisted: lowComponents.some((component) => !highComponents.some((high) => pixelBoxesOverlap(component.box, high.box))),
      components: input.workspace.componentAudit.filter((component) => pixelBoxesOverlap(component.bounds, traceBox(roi)))
    },
    deterministicCandidates: candidates.slice(0, 200).map((candidate) => ({
      candidateId: candidate.id,
      bounds: candidate.box,
      score: round(candidate.componentScore || 0),
      area: candidate.componentArea || 0,
      state: candidate.state,
      stateTransitions: candidate.stateTransitions || [],
      rejectionReasons: candidate.rejectionReasons || [],
      reviewReasons: candidate.reviewReasons || [],
      componentIdBeforeSplit: candidate.parentCandidateId || null,
      componentIdAfterSplit: candidate.refinedComponentId || null,
      metrics: diagnosticsById.get(candidate.id)?.metrics || null
    })),
    rawFrontierProposals,
    coordinateValidation,
    deduplication: input.frontier.deduplicationClusters.filter((cluster) =>
      cluster.proposalIds.some(proposalTouches)
    ).slice(0, 200),
    proposalLimits: input.frontier.proposalLimitDecisions.filter((decision) => proposalTouches(decision.proposalId)).slice(0, 200),
    mergeAndRefinement: [
      ...input.frontier.mergeDecisions.filter((decision) => candidateIds.has(decision.candidateId) || proposalTouches(decision.proposalId)),
      ...input.frontier.localRefinementDecisions.filter((decision) => candidateIds.has(decision.candidateId) || proposalTouches(decision.proposalId))
    ].slice(0, 200),
    verificationScheduling: input.frontier.verificationQueue.filter((decision) => candidateIds.has(decision.candidateId)).slice(0, 200),
    finalState: candidates.slice(0, 200).map((candidate) => ({
      finalCandidateId: candidate.id,
      state: candidate.state,
      geometryType: candidate.geometryType || "pixel_mask",
      stateReason: candidate.stateReason || candidate.reviewReasons?.[0] || candidate.rejectionReasons?.[0] || null,
      deterministicCandidateIds: candidate.proposalSource === "frontier_global" || candidate.proposalSource === "frontier_tile" ? [] : [candidate.id],
      frontierProposalIds: candidate.auditProposalIds || [],
      frontierScout: candidate.frontierScout || null,
      frontierVerification: candidate.frontierVerification || null
    }))
  };
}

function normalizeTraceRoi(requested: TraceRoiInput, width: number, height: number) {
  const radiusValue = (requested as { radius?: number }).radius;
  const radius = typeof radiusValue === "number"
    ? clampNumber(Math.round(radiusValue), 1, Math.max(width, height))
    : null;
  const left = radius == null ? requested.x : requested.x - radius;
  const top = radius == null ? requested.y : requested.y - radius;
  const requestedWidth = radius == null ? (requested as { width: number }).width : radius * 2 + 1;
  const requestedHeight = radius == null ? (requested as { height: number }).height : radius * 2 + 1;
  const x = clampNumber(Math.floor(left), 0, Math.max(0, width - 1));
  const y = clampNumber(Math.floor(top), 0, Math.max(0, height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.ceil(requestedWidth))),
    height: Math.max(1, Math.min(height - y, Math.ceil(requestedHeight)))
  };
}

function traceBox(roi: RoiTrace["roi"]): PixelBox {
  return { left: roi.x, top: roi.y, width: roi.width, height: roi.height };
}

function pixelBoxesOverlap(a: PixelBox, b: PixelBox) {
  return Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)) > 0;
}

function gridCellBox(row: number, column: number, rows: number, columns: number, width: number, height: number): PixelBox {
  const left = Math.floor(column * width / columns);
  const top = Math.floor(row * height / rows);
  const right = Math.floor((column + 1) * width / columns);
  const bottom = Math.floor((row + 1) * height / rows);
  return { left, top, width: right - left, height: bottom - top };
}

function roiBorderContact(roi: RoiTrace["roi"], validMask: Uint8Array, width: number) {
  let border = 0;
  let invalid = 0;
  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      if (x !== roi.x && x !== roi.x + roi.width - 1 && y !== roi.y && y !== roi.y + roi.height - 1) continue;
      border += 1;
      if (!validMask[y * width + x]) invalid += 1;
    }
  }
  return round(invalid / Math.max(1, border));
}

function roiLocalContrast(
  roi: RoiTrace["roi"],
  plane: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number
) {
  const inside: number[] = [];
  const ring: number[] = [];
  const padding = visionConfig.components.annulusRadius;
  for (let y = Math.max(0, roi.y - padding); y < Math.min(height, roi.y + roi.height + padding); y += 1) {
    for (let x = Math.max(0, roi.x - padding); x < Math.min(width, roi.x + roi.width + padding); x += 1) {
      const pixel = y * width + x;
      if (!validMask[pixel]) continue;
      if (x >= roi.x && x < roi.x + roi.width && y >= roi.y && y < roi.y + roi.height) inside.push(plane[pixel]);
      else ring.push(plane[pixel]);
    }
  }
  return (median(inside) - median(ring)) / 255;
}

function refineFrontierProposal(
  proposal: FrontierProposal,
  workspace: GlobalChangeWorkspace,
  registration: Registration
): Candidate {
  const viewport = { left: 0, top: 0, width: registration.width, height: registration.height };
  const padded = padBoxWithinViewport(
    proposal.bbox,
    visionConfig.frontier.proposalPaddingPixels,
    registration.width,
    registration.height,
    viewport
  );
  const localLow = Buffer.alloc(registration.width * registration.height);
  for (let y = padded.top; y < padded.top + padded.height; y += 1) {
    for (let x = padded.left; x < padded.left + padded.width; x += 1) {
      const pixel = y * registration.width + x;
      if (workspace.lowMask[pixel]) localLow[pixel] = 255;
    }
  }
  const components = connectedComponentsBuffer(localLow, registration.width, registration.height)
    .filter((component) => intersectionOverSmaller(component.box, proposal.bbox) >= 0.05);
  const pixels = [...new Set(components.flatMap((component) => component.pixels))];
  const meanScore = pixels.length ? mean(pixels.map((pixel) => workspace.probabilityScore[pixel] / 255)) : 0;
  const structuralSupport = pixels.length ? mean(pixels.map((pixel) => workspace.structuralResidual[pixel] / 255)) : 0;
  const colorSupport = pixels.length ? mean(pixels.map((pixel) => workspace.colorResidual[pixel] / 64)) : 0;
  const edgeSupport = pixels.length ? mean(pixels.map((pixel) => workspace.edgeResidual[pixel] / 255)) : 0;
  const localChecks = [
    meanScore >= workspace.thresholds.low / 255,
    structuralSupport >= visionConfig.components.minimumStructuralSupport * 0.7,
    colorSupport >= 0.28,
    edgeSupport >= 0.16
  ];
  const reliableMask = pixels.length >= visionConfig.frontier.minimumLocalMaskPixels &&
    localChecks.filter(Boolean).length >= 2;
  const supportBox = reliableMask ? boxForPixels(pixels, registration.width) : undefined;
  const supportMask = supportBox ? componentMask(componentFromPixels(pixels, supportBox, registration.width), supportBox, registration.width) : undefined;
  const box = supportBox || proposal.bbox;
  return {
    id: `F-${proposal.sourceIds[0]}`.slice(0, 120),
    box,
    crop: padBoxWithinViewport(box, visionConfig.frontier.proposalPaddingPixels, registration.width, registration.height, viewport),
    changeDensity: supportBox ? pixels.length / Math.max(1, supportBox.width * supportBox.height) : 0,
    changeStrength: meanScore,
    componentArea: reliableMask ? pixels.length : undefined,
    supportBox,
    supportMask,
    detectionConfidence: reliableMask ? meanScore : undefined,
    componentScore: reliableMask ? meanScore : undefined,
    structuralSupport,
    colorSupport,
    edgeOnlyFraction: edgeSupport > 0.35 && colorSupport < 0.35 && structuralSupport < 0.3 ? edgeSupport : 0,
    edgeSupport,
    requiredScore: visionConfig.components.minimumComponentScore,
    state: "needs_review",
    reviewReasons: [reliableMask ? "FRONTIER_PROPOSAL_LOCALLY_REFINED" : "FRONTIER_COARSE_BOX_NO_RELIABLE_PIXEL_MASK"],
    proposalSource: proposal.source,
    geometryType: reliableMask ? "pixel_mask" : "frontier_bbox",
    frontierProposal: proposal,
    frontierDecision: proposal.decision,
    frontierConfidence: proposal.confidence,
    stateReason: reliableMask
      ? "Frontier location hint was refined to overlapping low-threshold pixel evidence and remains review-only."
      : "No reliable local pixel mask was available; coarse frontier geometry remains review-only."
  };
}

async function verifyFrontierCandidate(
  candidate: Candidate,
  workspace: GlobalChangeWorkspace,
  registration: Registration,
  client: FrontierClient,
  audit: FrontierAnalysisAudit
) {
  try {
    const [oldCrop, currentCrop, overlay] = await Promise.all([
      cropRgbDataUrl(registration.alignedBeforeData, registration.width, registration.height, candidate.crop),
      cropRgbDataUrl(registration.afterData, registration.width, registration.height, candidate.crop),
      candidateMaskCropDataUrl(candidate).then((mask) => mask || cropPlaneDataUrl(workspace.probabilityScore, registration.width, candidate.crop))
    ]);
    const response = await client.verify({
      candidateId: candidate.id,
      oldCrop,
      currentCrop,
      maskOrEvidenceOverlay: overlay,
      bbox: candidate.box,
      source: candidate.proposalSource || "deterministic",
      geometryType: candidate.geometryType || "pixel_mask",
      deterministicMetrics: {
        componentScore: candidate.componentScore || 0,
        areaPixels: candidate.componentArea || 0,
        structuralSupport: candidate.structuralSupport || 0,
        colorSupport: candidate.colorSupport || 0,
        localRegistrationResidual: candidate.localRegistrationResidual || 0
      },
      promptVersion: visionConfig.frontier.verificationPromptVersion
    });
    audit.calls.push(response.audit);
    candidate.frontierDecision = response.decision;
    candidate.frontierConfidence = response.confidence;
    candidate.semantic = {
      candidateId: candidate.id,
      decision: response.decision,
      label: cautiousLabel(response.changeType),
      confidence: response.confidence,
      evidence: response.evidence,
      artifactReason: response.artifactRisk,
      model: response.audit.model
    };
    candidate.frontierVerification = {
      status: "completed",
      decision: response.decision,
      confidence: response.confidence,
      explanation: response.evidence,
      model: response.audit.model,
      promptVersion: response.audit.promptVersion,
      source: candidate.proposalSource || "deterministic",
      latencyMs: response.audit.latencyMs,
      usage: response.audit.usage
    };
    const queue = audit.verificationQueue.find((item) => item.candidateId === candidate.id);
    if (queue) {
      queue.ran = true;
      queue.status = "completed";
      queue.explanation = "Crop verification completed successfully.";
    }
    return response;
  } catch (error) {
    audit.warnings.push(`CANDIDATE_VERIFICATION_FAILED:${candidate.id}:${errorMessage(error)}`);
    const timedOut = error instanceof Error && (error.name === "AbortError" || /timeout|timed out/i.test(error.message));
    candidate.frontierVerification = {
      ...unstartedVerification(timedOut ? "timed_out" : "failed"),
      explanation: errorMessage(error),
      source: candidate.proposalSource || "deterministic"
    };
    const queue = audit.verificationQueue.find((item) => item.candidateId === candidate.id);
    if (queue) {
      queue.ran = true;
      queue.status = timedOut ? "timed_out" : "failed";
      queue.reasonCode = timedOut ? "verification_timed_out" : "verification_failed";
      queue.explanation = errorMessage(error);
    }
    return null;
  }
}

function rebuildWorkspaceMasks(workspace: GlobalChangeWorkspace, width: number, height: number) {
  workspace.finalMask = Buffer.alloc(width * height);
  workspace.reviewMask = Buffer.alloc(width * height);
  workspace.rejectedMask = Buffer.alloc(width * height);
  workspace.allCandidateMask = Buffer.alloc(width * height);
  writeCandidatesToMask(workspace.accepted, workspace.finalMask, width);
  writeCandidatesToMask(workspace.review, workspace.reviewMask, width);
  writeCandidatesToMask(workspace.rejected, workspace.rejectedMask, width);
  writeCandidatesToMask([...workspace.accepted, ...workspace.review, ...workspace.rejected], workspace.allCandidateMask, width);
  workspace.preTruncationCandidateCount = workspace.accepted.length + workspace.review.length;
}

function componentFromPixels(pixels: number[], box: PixelBox, width: number): BinaryComponent {
  let sumX = 0;
  let sumY = 0;
  for (const pixel of pixels) {
    sumX += pixel % width;
    sumY += Math.floor(pixel / width);
  }
  return { pixels, area: pixels.length, box, centroid: { x: sumX / Math.max(1, pixels.length), y: sumY / Math.max(1, pixels.length) } };
}

function boxForPixels(pixels: number[], width: number): PixelBox {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = 0;
  let bottom = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + 1);
    bottom = Math.max(bottom, y + 1);
  }
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown error";
}

function configuredOpenAIModel() {
  const model = process.env.OPENAI_MODEL;
  if (!model) throw new Error("OPENAI_MODEL is required for frontier or semantic model analysis.");
  return model;
}

export function comparePrediction(predictedMask: Uint8Array, groundTruthMask: Uint8Array) {
  if (predictedMask.length !== groundTruthMask.length) {
    throw new Error("Prediction and ground-truth masks must have identical dimensions.");
  }
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (let index = 0; index < predictedMask.length; index += 1) {
    const predicted = predictedMask[index] > 0;
    const expected = groundTruthMask[index] > 0;
    if (predicted && expected) truePositive += 1;
    else if (predicted) falsePositive += 1;
    else if (expected) falseNegative += 1;
  }
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  return {
    precision: round(precision),
    recall: round(recall),
    f1: round(2 * precision * recall / Math.max(Number.EPSILON, precision + recall)),
    iou: round(truePositive / Math.max(1, truePositive + falsePositive + falseNegative))
  };
}

/** Register CURRENT into OLD coordinates while preserving old/current semantics downstream. */
async function registerCurrentToOld(oldImage: PreparedImage, currentImage: PreparedImage): Promise<Registration> {
  const registered = await registerImages(currentImage, oldImage);
  return {
    ...registered,
    alignedBeforeData: registered.afterData,
    afterData: registered.alignedBeforeData
  };
}

async function getOpenCv() {
  if (!openCvPromise) {
    openCvPromise = (async () => {
      const module = cvModule as any;
      if (module instanceof Promise) return module;
      if (module.Mat) return module;
      return new Promise<any>((resolve) => {
        module.onRuntimeInitialized = () => resolve(module);
      });
    })();
  }
  return openCvPromise;
}

async function prepareImage(source: string) {
  return prepareImageBuffer(await loadImage(source), MAX_ANALYSIS_DIMENSION);
}

async function prepareImageBuffer(source: Buffer, maxDimension: number): Promise<PreparedImage> {
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image dimensions could not be read.");
  const normalized = await sharp(source)
    .rotate()
    .removeAlpha()
    .toColourspace("srgb")
    .png()
    .toBuffer({ resolveWithObject: true });
  const [native, analysis] = await Promise.all([
    sharp(normalized.data).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true }),
    sharp(normalized.data)
      .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true })
  ]);
  const data = Buffer.from(analysis.data);
  const viewport = detectMapViewport(data, analysis.info.width, analysis.info.height);
  return {
    source,
    normalizedPng: normalized.data,
    nativeData: Buffer.from(native.data),
    nativeWidth: native.info.width,
    nativeHeight: native.info.height,
    data,
    width: analysis.info.width,
    height: analysis.info.height,
    diagnostics: {
      format: metadata.format,
      originalWidth: metadata.width,
      originalHeight: metadata.height,
      exifOrientation: metadata.orientation || 1,
      normalizedWidth: normalized.info.width,
      normalizedHeight: normalized.info.height,
      analysisWidth: analysis.info.width,
      analysisHeight: analysis.info.height,
      viewport
    }
  };
}

async function promoteRegistrationToNative(
  coarse: Registration,
  oldImage: PreparedImage,
  currentImage: PreparedImage
): Promise<Registration> {
  if (!coarse.diagnostics.reliable) return coarse;
  const width = oldImage.nativeWidth;
  const height = oldImage.nativeHeight;
  const homography = scaleHomography(
    coarse.diagnostics.homography,
    { x: currentImage.width / currentImage.nativeWidth, y: currentImage.height / currentImage.nativeHeight },
    { x: oldImage.width / oldImage.nativeWidth, y: oldImage.height / oldImage.nativeHeight }
  );
  const cv = await getOpenCv();
  const sourceRgb = rgbMat(cv, currentImage.nativeData, currentImage.nativeWidth, currentImage.nativeHeight);
  const targetRgb = rgbMat(cv, oldImage.nativeData, width, height);
  // Feature extraction uses the conservative auto-detected viewport, but valid
  // overlap uses the full image bounds minus known UI. Dark, low-chroma terrain
  // near an edge must not be mistaken for a toolbar and silently excluded.
  const sourceValid = overlapMask(cv, currentImage.nativeWidth, currentImage.nativeHeight);
  const targetValid = overlapMask(cv, width, height);
  const warpedCurrent = new cv.Mat();
  const warpedValid = new cv.Mat();
  const matrix = cv.matFromArray(3, 3, cv.CV_64F, homography);
  try {
    const size = new cv.Size(width, height);
    cv.warpPerspective(sourceRgb, warpedCurrent, matrix, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    cv.warpPerspective(sourceValid, warpedValid, matrix, size, cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
    cv.bitwise_and(warpedValid, targetValid, warpedValid);
    const afterData = Buffer.from(warpedCurrent.data);
    const validMask = Buffer.from(warpedValid.data);
    const residuals = calculateRegistrationResiduals(oldImage.nativeData, afterData, validMask, width, height);
    const xScale = width / oldImage.width;
    const yScale = height / oldImage.height;
    return {
      alignedBeforeData: Buffer.from(oldImage.nativeData),
      afterData,
      validMask,
      width,
      height,
      keypoints: coarse.keypoints.map((point) => ({ x: point.x * xScale, y: point.y * yScale })),
      registrationResidualMap: residuals.residualMap,
      edgeResidualMap: residuals.edgeResidualMap,
      diagnostics: {
        ...coarse.diagnostics,
        homography,
        validOverlapPercent: residuals.validOverlapPercent,
        postWarpEdgeAlignmentResidual: residuals.edgeAlignmentResidual,
        gridResiduals: residuals.gridResiduals,
        localResidualIndicatesParallax: residuals.localResidualIndicatesParallax,
        scaleRatio: homographyScaleRatio(
          homography,
          currentImage.nativeWidth,
          currentImage.nativeHeight,
          width,
          height
        )
      }
    };
  } finally {
    sourceRgb.delete();
    targetRgb.delete();
    sourceValid.delete();
    targetValid.delete();
    warpedCurrent.delete();
    warpedValid.delete();
    matrix.delete();
  }
}

function scalePixelBox(box: PixelBox, xScale: number, yScale: number, width: number, height: number): PixelBox {
  const left = Math.max(0, Math.floor(box.left * xScale));
  const top = Math.max(0, Math.floor(box.top * yScale));
  const right = Math.min(width, Math.ceil((box.left + box.width) * xScale));
  const bottom = Math.min(height, Math.ceil((box.top + box.height) * yScale));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

async function registerImages(before: PreparedImage, after: PreparedImage): Promise<Registration> {
  const cv = await getOpenCv();
  const beforeRgb = rgbMat(cv, before.data, before.width, before.height);
  const afterRgb = rgbMat(cv, after.data, after.width, after.height);
  const beforeGray = new cv.Mat();
  const afterGray = new cv.Mat();
  const beforeEqualized = new cv.Mat();
  const afterEqualized = new cv.Mat();
  const beforeMask = featureMask(cv, before.width, before.height, before.diagnostics.viewport);
  const afterMask = featureMask(cv, after.width, after.height, after.diagnostics.viewport);
  const beforeKeypoints = new cv.KeyPointVector();
  const afterKeypoints = new cv.KeyPointVector();
  const beforeDescriptors = new cv.Mat();
  const afterDescriptors = new cv.Mat();
  const orb = new cv.ORB();
  const matches = new cv.DMatchVectorVector();
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  let homography = new cv.Mat();
  let inlierMask = new cv.Mat();

  try {
    cv.cvtColor(beforeRgb, beforeGray, cv.COLOR_RGB2GRAY);
    cv.cvtColor(afterRgb, afterGray, cv.COLOR_RGB2GRAY);
    cv.equalizeHist(beforeGray, beforeEqualized);
    cv.equalizeHist(afterGray, afterEqualized);
    orb.setMaxFeatures(4000);
    orb.setFastThreshold(10);
    orb.detectAndCompute(beforeEqualized, beforeMask, beforeKeypoints, beforeDescriptors, false);
    orb.detectAndCompute(afterEqualized, afterMask, afterKeypoints, afterDescriptors, false);

    if (!beforeDescriptors.rows || !afterDescriptors.rows) {
      return failedRegistration(after, "No stable landmarks were detected.");
    }

    matcher.knnMatch(beforeDescriptors, afterDescriptors, matches, 2);
    const good: Array<{ beforeIndex: number; afterIndex: number; distance: number }> = [];
    for (let index = 0; index < matches.size(); index += 1) {
      const pair = matches.get(index);
      try {
        if (pair.size() < 2) continue;
        const first = pair.get(0);
        const second = pair.get(1);
        if (first.distance < second.distance * 0.74 && first.distance < 72) {
          good.push({ beforeIndex: first.queryIdx, afterIndex: first.trainIdx, distance: first.distance });
        }
      } finally {
        pair.delete();
      }
    }
    good.sort((a, b) => a.distance - b.distance);
    const selected = good.slice(0, 700);
    if (selected.length < visionConfig.registration.minimumMatches) {
      return failedRegistration(after, `Only ${selected.length} reliable landmark matches were found.`);
    }

    const beforePoints: number[] = [];
    const afterPoints: number[] = [];
    for (const match of selected) {
      const sourcePoint = beforeKeypoints.get(match.beforeIndex).pt;
      const destinationPoint = afterKeypoints.get(match.afterIndex).pt;
      beforePoints.push(sourcePoint.x, sourcePoint.y);
      afterPoints.push(destinationPoint.x, destinationPoint.y);
    }
    const sourceMat = cv.matFromArray(selected.length, 1, cv.CV_32FC2, beforePoints);
    const destinationMat = cv.matFromArray(selected.length, 1, cv.CV_32FC2, afterPoints);
    try {
      homography = cv.findHomography(sourceMat, destinationMat, cv.RANSAC, 3.5, inlierMask);
    } finally {
      sourceMat.delete();
      destinationMat.delete();
    }
    if (homography.empty()) return failedRegistration(after, "Landmark matching did not produce a stable homography.");

    let matrix = Array.from(homography.data64F as Float64Array);
    let inliers = 0;
    const inlierDestinations: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < selected.length; index += 1) {
      if (!inlierMask.data[index]) continue;
      inliers += 1;
      const point = afterKeypoints.get(selected[index].afterIndex).pt;
      inlierDestinations.push({ x: point.x, y: point.y });
    }
    const inlierRatio = inliers / selected.length;
    const coverage = pointCoverage(inlierDestinations, after.diagnostics.viewport);
    const sane = homographyIsSane(matrix, before.width, before.height, after.width, after.height);
    const featureConfidence = clamp01(
      Math.min(1, inliers / 55) * 0.42 +
      Math.min(1, inlierRatio / 0.55) * 0.33 +
      Math.min(1, coverage / 0.35) * 0.25
    );
    const featureReliable = sane &&
      inliers >= visionConfig.registration.minimumInliers &&
      inlierRatio >= visionConfig.registration.minimumInlierRatio &&
      coverage >= visionConfig.registration.minimumSpatialCoverage &&
      featureConfidence >= visionConfig.minimumRegistrationConfidence;
    const featureReason = featureReliable
      ? "ORB landmarks and the RANSAC homography passed inlier, coverage, and geometry checks."
      : `Registration rejected: ${inliers} inliers, ${round(inlierRatio)} inlier ratio, ${round(coverage)} coverage, sane=${sane}.`;

    if (!featureReliable) {
      return failedRegistration(after, featureReason, {
        matches: selected.length,
        inliers,
        inlierRatio,
        landmarkCoverage: coverage,
        confidence: featureConfidence,
        homography: matrix
      });
    }

    const alignedBefore = new cv.Mat();
    const sourceValid = featureMask(cv, before.width, before.height, before.diagnostics.viewport);
    const warpedValid = new cv.Mat();
    const afterCandidateMask = featureMask(cv, after.width, after.height, after.diagnostics.viewport);
    try {
      const size = new cv.Size(after.width, after.height);
      cv.warpPerspective(beforeRgb, alignedBefore, homography, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
      cv.warpPerspective(sourceValid, warpedValid, homography, size, cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
      cv.bitwise_and(warpedValid, afterCandidateMask, warpedValid);
      let alignedData = Buffer.from(alignedBefore.data);
      let validData = Buffer.from(warpedValid.data);
      let residuals = calculateRegistrationResiduals(
        Buffer.from(afterRgb.data),
        alignedData,
        validData,
        after.width,
        after.height
      );
      const eccSupported = typeof cv.findTransformECC === "function";
      const eccAttempted = eccSupported && visionConfig.registration.eccRefinement;
      let eccApplied = false;
      const edgeResidualBeforeEcc = residuals.edgeAlignmentResidual;
      let eccCandidateResidual: number | null = null;
      let eccRelativeImprovement: number | null = null;
      let eccRejectionReason: string | null = eccAttempted ? "ECC did not converge to a usable homography." : null;
      if (eccAttempted) {
        const refinement = tryEccHomographyRefinement({
          cv,
          initialHomography: matrix,
          sourceGray: beforeEqualized,
          targetGray: afterEqualized,
          sourceRgb: beforeRgb,
          targetRgb: afterRgb,
          sourceValid,
          targetValid: afterCandidateMask,
          width: after.width,
          height: after.height
        });
        if (refinement) {
          eccCandidateResidual = refinement.residuals.edgeAlignmentResidual;
          eccRelativeImprovement = (edgeResidualBeforeEcc - eccCandidateResidual) /
            Math.max(0.001, edgeResidualBeforeEcc);
          const saneRefinement = homographyIsSane(
            refinement.homography,
            before.width,
            before.height,
            after.width,
            after.height
          );
          if (!saneRefinement) {
            eccRejectionReason = "ECC produced an implausible homography.";
          } else if (eccRelativeImprovement < visionConfig.registration.minimumEccRelativeImprovement) {
            eccRejectionReason = `ECC improved edge validation by only ${round(eccRelativeImprovement * 100)}%.`;
          } else {
            matrix = refinement.homography;
            alignedData = refinement.alignedData;
            validData = refinement.validData;
            residuals = refinement.residuals;
            eccApplied = true;
            eccRejectionReason = null;
          }
        }
      }
      const reprojectionErrors: number[] = [];
      for (let index = 0; index < selected.length; index += 1) {
        if (!inlierMask.data[index]) continue;
        const projected = projectPoint(matrix, beforePoints[index * 2], beforePoints[index * 2 + 1]);
        reprojectionErrors.push(Math.hypot(
          projected.x - afterPoints[index * 2],
          projected.y - afterPoints[index * 2 + 1]
        ));
      }
      const medianReprojectionError = percentileNumber(reprojectionErrors, 0.5);
      const p90ReprojectionError = percentileNumber(reprojectionErrors, 0.9);
      const p95ReprojectionError = percentileNumber(reprojectionErrors, 0.95);
      const reprojectionReliable = medianReprojectionError <= visionConfig.registration.maximumMedianReprojectionError &&
        p95ReprojectionError <= visionConfig.registration.maximumP95ReprojectionError;
      // Local residual clusters are handled as warnings and masks downstream.
      // Rejecting the entire pair here would confuse a genuine physical change
      // with a failed global transform.
      const changeTolerantResidualReliable =
        residuals.edgeAlignmentResidual <= visionConfig.registration.maximumChangeTolerantEdgeResidual &&
        medianReprojectionError <= 1 && p95ReprojectionError <= 2 && inlierRatio >= 0.5;
      const residualReliable = residuals.edgeAlignmentResidual <= visionConfig.registration.maximumEdgeAlignmentResidual ||
        changeTolerantResidualReliable;
      const overlapReliable = residuals.validOverlapPercent >= visionConfig.registration.minimumValidOverlap;
      const scaleRatio = homographyScaleRatio(matrix, before.width, before.height, after.width, after.height);
      const scaleReliable = scaleRatio >= visionConfig.registration.minimumScaleRatio &&
        scaleRatio <= visionConfig.registration.maximumScaleRatio;
      const reliable = featureReliable && reprojectionReliable && residualReliable && overlapReliable && scaleReliable;
      const edgeQuality = clamp01(1 - residuals.edgeAlignmentResidual /
        Math.max(0.01, visionConfig.registration.maximumEdgeAlignmentResidual));
      const reprojectionQuality = clamp01(1 - p95ReprojectionError /
        Math.max(1, visionConfig.registration.maximumP95ReprojectionError * 1.5));
      const overlapQuality = clamp01(residuals.validOverlapPercent /
        Math.max(0.01, visionConfig.registration.minimumValidOverlap));
      const confidence = clamp01(
        featureConfidence * 0.55 + edgeQuality * 0.25 + reprojectionQuality * 0.15 + overlapQuality * 0.05
      );
      const failedChecks = [
        !reprojectionReliable ? `reprojection median/p95 ${round(medianReprojectionError)}/${round(p95ReprojectionError)}px` : "",
        !residualReliable ? `post-warp edge residual ${round(residuals.edgeAlignmentResidual)}` : "",
        !overlapReliable ? `valid overlap ${round(residuals.validOverlapPercent * 100)}%` : "",
        !scaleReliable ? `scale ratio ${round(scaleRatio)}` : ""
      ].filter(Boolean);
      const reason = reliable
        ? "ORB/RANSAC registration passed feature, reprojection, valid-overlap, and post-warp residual checks."
        : `Registration rejected after warping: ${failedChecks.join(", ")}.`;
      return {
        afterData: Buffer.from(afterRgb.data),
        alignedBeforeData: alignedData,
        validMask: validData,
        width: after.width,
        height: after.height,
        keypoints: inlierDestinations,
        registrationResidualMap: residuals.residualMap,
        edgeResidualMap: residuals.edgeResidualMap,
        diagnostics: {
          matches: selected.length,
          inliers,
          inlierRatio,
          landmarkCoverage: coverage,
          medianReprojectionError,
          p90ReprojectionError,
          p95ReprojectionError,
          postWarpEdgeAlignmentResidual: residuals.edgeAlignmentResidual,
          validOverlapPercent: residuals.validOverlapPercent,
          gridResiduals: residuals.gridResiduals,
          localResidualIndicatesParallax: residuals.localResidualIndicatesParallax,
          localUnreliableCells: [],
          locallyUnreliablePixelCount: 0,
          scaleRatio,
          ecc: {
            supported: eccSupported,
            attempted: eccAttempted,
            applied: eccApplied,
            beforeEdgeResidual: round(edgeResidualBeforeEcc),
            candidateEdgeResidual: eccCandidateResidual == null ? null : round(eccCandidateResidual),
            relativeImprovement: eccRelativeImprovement == null ? null : round(eccRelativeImprovement),
            rejectionReason: eccRejectionReason
          },
          confidence,
          reliable,
          reason,
          homography: matrix
        }
      };
    } finally {
      alignedBefore.delete();
      sourceValid.delete();
      warpedValid.delete();
      afterCandidateMask.delete();
    }
  } finally {
    beforeRgb.delete();
    afterRgb.delete();
    beforeGray.delete();
    afterGray.delete();
    beforeEqualized.delete();
    afterEqualized.delete();
    beforeMask.delete();
    afterMask.delete();
    beforeKeypoints.delete();
    afterKeypoints.delete();
    beforeDescriptors.delete();
    afterDescriptors.delete();
    orb.delete();
    matches.delete();
    matcher.delete();
    homography.delete();
    inlierMask.delete();
  }
}

function failedRegistration(
  after: PreparedImage,
  reason: string,
  partial: Partial<RegistrationDiagnostics> = {}
): Registration {
  return {
    afterData: after.data,
    alignedBeforeData: Buffer.alloc(after.width * after.height * 3),
    validMask: Buffer.alloc(after.width * after.height),
    width: after.width,
    height: after.height,
    keypoints: [],
    registrationResidualMap: Buffer.alloc(after.width * after.height),
    edgeResidualMap: Buffer.alloc(after.width * after.height),
    diagnostics: {
      matches: partial.matches || 0,
      inliers: partial.inliers || 0,
      inlierRatio: partial.inlierRatio || 0,
      landmarkCoverage: partial.landmarkCoverage || 0,
      medianReprojectionError: partial.medianReprojectionError || 0,
      p90ReprojectionError: partial.p90ReprojectionError || 0,
      p95ReprojectionError: partial.p95ReprojectionError || 0,
      postWarpEdgeAlignmentResidual: partial.postWarpEdgeAlignmentResidual || 1,
      validOverlapPercent: partial.validOverlapPercent || 0,
      gridResiduals: partial.gridResiduals || [],
      localResidualIndicatesParallax: partial.localResidualIndicatesParallax || false,
      localUnreliableCells: partial.localUnreliableCells || [],
      locallyUnreliablePixelCount: partial.locallyUnreliablePixelCount || 0,
      scaleRatio: partial.scaleRatio || 0,
      ecc: partial.ecc || {
        supported: false,
        attempted: false,
        applied: false,
        beforeEdgeResidual: 1,
        candidateEdgeResidual: null,
        relativeImprovement: null,
        rejectionReason: null
      },
      confidence: partial.confidence || 0,
      reliable: false,
      reason,
      homography: partial.homography || []
    }
  };
}

function calculateRegistrationResiduals(
  referenceRgb: Buffer,
  warpedRgb: Buffer,
  validMask: Buffer,
  width: number,
  height: number
) {
  const referenceGray = rgbToGrayPlane(referenceRgb, width, height);
  const warpedGray = rgbToGrayPlane(warpedRgb, width, height);
  const referenceGradient = gradientMagnitude(referenceGray, width, height);
  const warpedGradient = gradientMagnitude(warpedGray, width, height);
  const radius = visionConfig.registration.displacementTolerancePixels;
  const residualMap = Buffer.alloc(width * height);
  const edgeResidualMap = Buffer.alloc(width * height);
  const columns = visionConfig.registration.gridColumns;
  const rows = visionConfig.registration.gridRows;
  const grid = Array.from({ length: rows * columns }, (_, index) => ({
    row: Math.floor(index / columns),
    column: index % columns,
    validPixels: 0,
    edgePixels: 0,
    unmatchedEdges: 0
  }));
  let validPixels = 0;
  let edgePixels = 0;
  let unmatchedEdges = 0;

  const nearbyEdge = (plane: Uint8Array, x: number, y: number) => {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const pixel = ny * width + nx;
        if (validMask[pixel] && plane[pixel] >= 42) return true;
      }
    }
    return false;
  };
  const tolerantGrayDifference = (source: Uint8Array, target: Uint8Array, x: number, y: number) => {
    const value = source[y * width + x];
    let best = 255;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const pixel = ny * width + nx;
        if (!validMask[pixel]) continue;
        best = Math.min(best, Math.abs(value - target[pixel]));
      }
    }
    return best;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!validMask[pixel]) continue;
      validPixels += 1;
      const cell = grid[
        Math.min(rows - 1, Math.floor(y / Math.max(1, height) * rows)) * columns +
        Math.min(columns - 1, Math.floor(x / Math.max(1, width) * columns))
      ];
      cell.validPixels += 1;
      const referenceEdge = referenceGradient[pixel] >= 42;
      const warpedEdge = warpedGradient[pixel] >= 42;
      const unionEdge = referenceEdge || warpedEdge;
      const unmatched = (referenceEdge && !nearbyEdge(warpedGradient, x, y)) ||
        (warpedEdge && !nearbyEdge(referenceGradient, x, y));
      if (unionEdge) {
        edgePixels += 1;
        cell.edgePixels += 1;
      }
      if (unmatched) {
        unmatchedEdges += 1;
        cell.unmatchedEdges += 1;
        edgeResidualMap[pixel] = 255;
      }
      const grayResidual = Math.round((
        tolerantGrayDifference(referenceGray, warpedGray, x, y) +
        tolerantGrayDifference(warpedGray, referenceGray, x, y)
      ) / 2);
      residualMap[pixel] = Math.max(edgeResidualMap[pixel], Math.min(255, grayResidual * 3));
    }
  }

  const gridResiduals = grid.map(({ edgePixels: cellEdges, unmatchedEdges: cellUnmatched, ...cell }) => ({
    ...cell,
    edgeAlignmentResidual: round(cellUnmatched / Math.max(1, cellEdges))
  }));
  const highResidualCells = gridResiduals.filter((cell) =>
    cell.validPixels > width * height / Math.max(1, rows * columns) * 0.25 &&
    cell.edgeAlignmentResidual > visionConfig.registration.maximumLocalEdgeResidual
  );
  return {
    residualMap,
    edgeResidualMap,
    validOverlapPercent: validPixels / Math.max(1, width * height),
    edgeAlignmentResidual: unmatchedEdges / Math.max(1, edgePixels),
    gridResiduals,
    localResidualIndicatesParallax: hasSevereAdjacentGridCells(highResidualCells) ||
      highResidualCells.length >= Math.max(3, Math.floor(rows * columns * 0.2))
  };
}

function hasSevereAdjacentGridCells(cells: Array<{ row: number; column: number }>) {
  const keys = new Set(cells.map((cell) => `${cell.row}:${cell.column}`));
  return cells.some((cell) =>
    keys.has(`${cell.row + 1}:${cell.column}`) || keys.has(`${cell.row}:${cell.column + 1}`)
  );
}

export function severeAdjacentGridCellsForTest(cells: Array<{ row: number; column: number; edgeAlignmentResidual: number }>) {
  return hasSevereAdjacentGridCells(cells.filter((cell) =>
    cell.edgeAlignmentResidual > visionConfig.registration.maximumLocalEdgeResidual
  ));
}

function rgbToGrayPlane(data: Uint8Array, width: number, height: number) {
  const output = Buffer.alloc(width * height);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    const offset = pixel * 3;
    output[pixel] = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
  }
  return output;
}

function gradientMagnitude(gray: Uint8Array, width: number, height: number) {
  const output = Buffer.alloc(gray.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      const gx = -gray[pixel - width - 1] + gray[pixel - width + 1] -
        2 * gray[pixel - 1] + 2 * gray[pixel + 1] -
        gray[pixel + width - 1] + gray[pixel + width + 1];
      const gy = -gray[pixel - width - 1] - 2 * gray[pixel - width] - gray[pixel - width + 1] +
        gray[pixel + width - 1] + 2 * gray[pixel + width] + gray[pixel + width + 1];
      output[pixel] = Math.min(255, Math.round(Math.hypot(gx, gy) / 4));
    }
  }
  return output;
}

function percentileNumber(values: number[], percentile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * percentile)))];
}

function homographyScaleRatio(matrix: number[], sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  if (matrix.length !== 9) return 0;
  const corners = [
    projectPoint(matrix, 0, 0),
    projectPoint(matrix, sourceWidth, 0),
    projectPoint(matrix, sourceWidth, sourceHeight),
    projectPoint(matrix, 0, sourceHeight)
  ];
  return polygonArea(corners) / Math.max(1, targetWidth * targetHeight);
}

function tryEccHomographyRefinement(input: {
  cv: any;
  initialHomography: number[];
  sourceGray: any;
  targetGray: any;
  sourceRgb: any;
  targetRgb: any;
  sourceValid: any;
  targetValid: any;
  width: number;
  height: number;
}) {
  const { cv } = input;
  const inverse = invert3x3(input.initialHomography);
  if (!inverse) return undefined;
  const warp = cv.matFromArray(3, 3, cv.CV_32F, inverse);
  const aligned = new cv.Mat();
  const valid = new cv.Mat();
  try {
    const criteria = new cv.TermCriteria(
      cv.TermCriteria_COUNT | cv.TermCriteria_EPS,
      45,
      1e-5
    );
    cv.findTransformECC(
      input.targetGray,
      input.sourceGray,
      warp,
      cv.MOTION_HOMOGRAPHY,
      criteria,
      input.targetValid,
      5
    );
    const refinedInverse = Array.from(warp.data32F as Float32Array);
    const homography = invert3x3(refinedInverse);
    if (!homography) return undefined;
    const matrix = cv.matFromArray(3, 3, cv.CV_64F, homography);
    try {
      const size = new cv.Size(input.width, input.height);
      cv.warpPerspective(input.sourceRgb, aligned, matrix, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
      cv.warpPerspective(input.sourceValid, valid, matrix, size, cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
      cv.bitwise_and(valid, input.targetValid, valid);
      const alignedData = Buffer.from(aligned.data);
      const validData = Buffer.from(valid.data);
      return {
        homography,
        alignedData,
        validData,
        residuals: calculateRegistrationResiduals(
          Buffer.from(input.targetRgb.data),
          alignedData,
          validData,
          input.width,
          input.height
        )
      };
    } finally {
      matrix.delete();
    }
  } catch {
    return undefined;
  } finally {
    warp.delete();
    aligned.delete();
    valid.delete();
  }
}

function invert3x3(matrix: number[]) {
  if (matrix.length !== 9) return undefined;
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return undefined;
  return [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant
  ];
}

function emptyGlobalChangeWorkspace(registration: Registration): GlobalChangeWorkspace {
  const pixels = registration.width * registration.height;
  const empty = () => Buffer.alloc(pixels);
  return {
    colorResidual: empty(),
    structuralResidual: empty(),
    edgeResidual: Buffer.from(registration.edgeResidualMap),
    removedStructureResidual: empty(),
    borderOverlayArtifactMask: empty(),
    probabilityScore: empty(),
    highMask: empty(),
    lowMask: empty(),
    globalMask: empty(),
    finalMask: empty(),
    reviewMask: empty(),
    rejectedMask: empty(),
    allCandidateMask: empty(),
    localAlignmentUnreliableMask: empty(),
    accepted: [],
    review: [],
    rejected: [],
    warnings: [],
    reliable: false,
    saturation: false,
    preTruncationCandidateCount: 0,
    candidateComponentCount: 0,
    rawEvidencePixels: 0,
    globalCandidatePixels: 0,
    effectiveMinimumAreaPixels: 0,
    minimumAreaMethod: "registration unavailable",
    scaleUncertain: true,
    thresholds: emptyThresholdDiagnostics(pixels),
    normalization: {
      method: visionConfig.normalization.method,
      samples: 0,
      excludedHighGradientPixels: 0,
      excludedProvisionalChangePixels: 0,
      sourceMedian: [0, 0, 0],
      targetMedian: [0, 0, 0],
      sourceMad: [0, 0, 0],
      targetMad: [0, 0, 0],
      scale: [1, 1, 1],
      offset: [0, 0, 0],
      rawMedianResidual: 0,
      normalizedMedianResidual: 0
    },
    componentAudit: []
  };
}

async function buildGlobalChangeWorkspace(
  registration: Registration,
  oldViewport: Viewport,
  currentViewport: Viewport,
  scaleOptions: { metersPerPixel?: number; analysisToSourceScale?: number }
): Promise<GlobalChangeWorkspace> {
  const { width, height, validMask } = registration;
  const normalizationResult = robustNormalizeCurrent(
    registration.alignedBeforeData,
    registration.afterData,
    validMask,
    width,
    height
  );
  const normalizedCurrent = normalizationResult.normalized;
  const scale = segmentationScaleParameters(scaleOptions.metersPerPixel);
  const evidence = buildTiledEvidence({
    reference: registration.alignedBeforeData,
    current: normalizedCurrent,
    validMask,
    width,
    height,
    displacementRadius: scale.displacementRadius
  });
  const { colorResidual, structuralResidual, edgeResidual, removedStructureResidual, referenceGradient, currentGradient } = evidence;
  const borderOverlayArtifactMask = detectChangedBorderOverlayBands(
    directRgbResidualPlane(registration.alignedBeforeData, registration.afterData),
    gradientMagnitude(rgbToGrayPlane(registration.afterData, width, height), width, height),
    width,
    height
  );
  const borderOverlayPixelCount = countNonZeroBuffer(borderOverlayArtifactMask);
  if (borderOverlayPixelCount) {
    for (let pixel = 0; pixel < borderOverlayArtifactMask.length; pixel += 1) {
      if (!borderOverlayArtifactMask[pixel]) continue;
      colorResidual[pixel] = 0;
      structuralResidual[pixel] = 0;
      edgeResidual[pixel] = 0;
      removedStructureResidual[pixel] = 0;
    }
  }
  const probabilityScore = combineChangeEvidence(
    colorResidual,
    structuralResidual,
    edgeResidual,
    removedStructureResidual,
    validMask
  );
  const provisionalChangeMask = coherentProvisionalChangeMask(
    probabilityScore,
    colorResidual,
    structuralResidual,
    validMask,
    width,
    height
  );
  const localAlignment = assessLocalAlignment({
    registration,
    referenceGradient,
    currentGradient,
    provisionalChangeMask
  });
  registration.diagnostics.localUnreliableCells = localAlignment.cells;
  registration.diagnostics.locallyUnreliablePixelCount = countNonZeroBuffer(localAlignment.mask);
  registration.diagnostics.localResidualIndicatesParallax =
    registration.diagnostics.localResidualIndicatesParallax || localAlignment.cells.length > 0;
  for (let pixel = 0; pixel < probabilityScore.length; pixel += 1) {
    if (localAlignment.mask[pixel]) probabilityScore[pixel] = Math.round(probabilityScore[pixel] * 0.35);
  }
  const thresholdInput = {
    score: probabilityScore,
    colorResidual,
    structuralResidual,
    referenceGradient,
    currentGradient,
    registrationResidual: registration.registrationResidualMap,
    validMask,
    provisionalChangeMask,
    width,
    height,
    oldViewport,
    currentViewport
  };
  const thresholdResult = estimateStableNoiseThresholds(thresholdInput);
  const localThreshold = localThresholdMaps(thresholdInput, thresholdResult);
  thresholdResult.localThresholds = localThreshold.diagnostics;
  const masks = globalHysteresisMasks(
    probabilityScore,
    structuralResidual,
    colorResidual,
    removedStructureResidual,
    validMask,
    width,
    height,
    thresholdResult.low,
    thresholdResult.high,
    localThreshold.lowMap,
    localThreshold.highMap,
    scale
  );
  const thresholds: ThresholdDiagnostics = {
    ...thresholdResult,
    highSeedPixels: countNonZeroBuffer(masks.high),
    highSeedPercent: round(countNonZeroBuffer(masks.high) * 100 / Math.max(1, countNonZeroBuffer(validMask))),
    lowMaskPixels: countNonZeroBuffer(masks.low),
    globalMaskPixels: countNonZeroBuffer(masks.globalMask)
  };
  const warnings: DetectionWarning[] = [];
  if (borderOverlayPixelCount) {
    warnings.push({
      code: "BORDER_OVERLAY_ARTIFACT_EXCLUDED",
      severity: "warning",
      message: `${borderOverlayPixelCount.toLocaleString()} pixels in changed, low-texture border overlay bands were excluded from physical-change evidence.`
    });
  }
  const validPixels = countNonZeroBuffer(validMask);
  const provisionalChangedPercent = countNonZeroBuffer(masks.globalMask) / Math.max(1, validPixels);
  let edgeOnlyPixels = 0;
  for (let pixel = 0; pixel < probabilityScore.length; pixel += 1) {
    if (validMask[pixel] && registration.edgeResidualMap[pixel] > 0 &&
      colorResidual[pixel] < 44 && structuralResidual[pixel] < 64) edgeOnlyPixels += 1;
  }
  const edgeOnlyPercent = edgeOnlyPixels / Math.max(1, validPixels);
  const oldUiPercent = 1 - oldViewport.width * oldViewport.height / Math.max(1, width * height);
  const currentUiPercent = 1 - currentViewport.width * currentViewport.height / Math.max(1, width * height);
  if (Math.max(oldUiPercent, currentUiPercent) > visionConfig.compatibility.maximumViewportUiPercent) {
    warnings.push({
      code: "UI_ELEMENTS_DETECTED",
      severity: "warning",
      message: "Map UI occupies a material part of at least one image. Use label-free source imagery from the same provider and style when possible."
    });
  }
  if (localAlignment.cells.length) {
    warnings.push({
      code: "LOCAL_ALIGNMENT_UNRELIABLE",
      severity: "warning",
      message: `${localAlignment.cells.length} local grid ${localAlignment.cells.length === 1 ? "cell is" : "cells are"} unreliable. Unstable background pixels were discounted while coherent candidate evidence was preserved.`
    });
  }
  if (thresholds.estimatorState === "INSUFFICIENT_STABLE_BACKGROUND") {
    warnings.push({
      code: "THRESHOLD_ESTIMATOR_UNCERTAIN",
      severity: "warning",
      message: `Only ${thresholds.noiseSamplePixels.toLocaleString()} stable background pixels were available for noise estimation; configured safety floors were retained.`
    });
  }
  if (normalizationResult.diagnostics.rawMedianResidual > visionConfig.compatibility.maximumRawRadiometricMedian) {
    warnings.push({
      code: "STRONG_RADIOMETRIC_SHIFT",
      severity: "warning",
      message: "The pair has a strong brightness or color shift; robust shared-region normalization was applied."
    });
  }
  let reliable = true;
  if (provisionalChangedPercent > visionConfig.compatibility.maximumChangedPercent) {
    warnings.push({
      code: "WIDESPREAD_CHANGE_REVIEW",
      severity: "warning",
      message: `${round(provisionalChangedPercent * 100)}% of valid overlap survived global segmentation. Valid regions are returned, but the pair requires widespread-change review.`
    });
  }
  if (edgeOnlyPercent > visionConfig.compatibility.maximumEdgeOnlyPercent) {
    reliable = false;
    warnings.push({
      code: "INCONSISTENT_RENDERING_OR_LABELS",
      severity: "error",
      message: "Widespread edge-only disagreement suggests inconsistent labels, rendering, compression, or local alignment."
    });
  }

  const rawComponents = connectedComponentsBuffer(masks.globalMask, width, height);
  const componentAudit: GlobalChangeWorkspace["componentAudit"] = [];
  const components = rawComponents.flatMap((component, parentIndex) => {
    const split = splitLargeWeakComponent(component, probabilityScore, width, height, thresholds.high);
    for (let childIndex = 0; childIndex < split.length; childIndex += 1) {
      componentAudit.push({
        componentId: `C${parentIndex + 1}.${childIndex + 1}`,
        parentComponentId: `C${parentIndex + 1}`,
        bounds: split[childIndex].box,
        area: split[childIndex].area,
        split: split.length > 1,
        state: split.length > 1 ? "split_preserved" : "preserved"
      });
    }
    return split;
  });
  const minimumArea = effectiveMinimumComponentArea(
    width,
    height,
    scaleOptions.metersPerPixel,
    scaleOptions.analysisToSourceScale || 1
  );
  const accepted: Candidate[] = [];
  const review: Candidate[] = [];
  const rejected: Candidate[] = [];
  if (components.length > visionConfig.processing.maximumCandidateComponents) {
    warnings.push({
      code: "CANDIDATE_COMPONENT_LIMIT",
      severity: "warning",
      message: `${components.length} components exceeded the auditable processing limit of ${visionConfig.processing.maximumCandidateComponents}; no component was silently dropped.`
    });
  }
  for (let index = 0; index < components.length; index += 1) {
    const evaluated = evaluateGlobalComponent({
      component: components[index],
      componentNumber: index + 1,
      registration,
      score: probabilityScore,
      structuralResidual,
      colorResidual,
      removedStructureResidual,
      globalMask: masks.globalMask,
      lowThreshold: thresholds.low,
      highThreshold: thresholds.high,
      viewport: oldViewport,
      effectiveMinimumAreaPixels: minimumArea.pixels,
      metersPerPixel: scaleOptions.metersPerPixel,
      scaleKnown: scale.known
    });
    evaluated.highSeedPixels = components[index].pixels.filter((pixel) => masks.high[pixel]).length;
    evaluated.parentCandidateId = componentAudit[index]?.parentComponentId;
    evaluated.refinedComponentId = componentAudit[index]?.componentId;
    evaluated.lowOnly = evaluated.highSeedPixels === 0;
    if (!reliable) evaluated.rejectionReasons = [
      ...(evaluated.rejectionReasons || []),
      "PAIR_COMPATIBILITY_FAILED"
    ];
    if (evaluated.rejectionReasons?.length) {
      evaluated.state = "rejected";
      evaluated.stateTransitions = [{ from: "candidate", to: "rejected", reason: evaluated.rejectionReasons.join("|"), at: new Date().toISOString() }];
      rejected.push(evaluated);
    } else if (!evaluated.lowOnly && (evaluated.componentScore || 0) >= (evaluated.requiredScore || visionConfig.components.minimumComponentScore)) {
      evaluated.state = "accepted";
      evaluated.stateTransitions = [{ from: "candidate", to: "accepted", reason: "STRONG_DETERMINISTIC_EVIDENCE", at: new Date().toISOString() }];
      accepted.push(evaluated);
    } else {
      evaluated.state = "needs_review";
      const reason = evaluated.lowOnly ? "COHERENT_LOW_THRESHOLD_EVIDENCE_WITHOUT_HIGH_SEED" : "COHERENT_EVIDENCE_BELOW_ACCEPTED_RANK";
      evaluated.reviewReasons = [reason];
      evaluated.stateTransitions = [{ from: "candidate", to: "needs_review", reason, at: new Date().toISOString() }];
      review.push(evaluated);
    }
  }
  const rankedAccepted = accepted.sort((a, b) =>
    (b.componentScore || 0) - (a.componentScore || 0) || candidateRank(b) - candidateRank(a)
  );
  const rankedReview = review.sort((a, b) =>
    (b.componentScore || 0) - (a.componentScore || 0) || candidateRank(b) - candidateRank(a)
  );
  const preTruncationCandidateCount = rankedAccepted.length + rankedReview.length;
  const saturation = preTruncationCandidateCount > visionConfig.maximumRegions;
  if (saturation) {
    warnings.push({
      code: "CANDIDATE_SATURATION",
      severity: "warning",
      message: `${preTruncationCandidateCount} valid components exceeded the preferred review workload of ${visionConfig.maximumRegions}; every accepted and review component is still returned.`
    });
  }
  const finalMask = Buffer.alloc(width * height);
  const reviewMask = Buffer.alloc(width * height);
  const rejectedMask = Buffer.alloc(width * height);
  const allCandidateMask = Buffer.alloc(width * height);
  writeCandidatesToMask(rankedAccepted, finalMask, width);
  writeCandidatesToMask(rankedReview, reviewMask, width);
  writeCandidatesToMask(rejected, rejectedMask, width);
  writeCandidatesToMask([...rankedAccepted, ...rankedReview, ...rejected], allCandidateMask, width);
  return {
    colorResidual,
    structuralResidual,
    edgeResidual,
    removedStructureResidual,
    borderOverlayArtifactMask,
    probabilityScore,
    highMask: masks.high,
    lowMask: masks.low,
    globalMask: masks.globalMask,
    finalMask,
    reviewMask,
    rejectedMask,
    allCandidateMask,
    localAlignmentUnreliableMask: localAlignment.mask,
    accepted: rankedAccepted.map((candidate) => ({ ...candidate, id: `A${candidate.id.slice(1)}` })),
    review: rankedReview.map((candidate) => ({ ...candidate, id: `V${candidate.id.slice(1)}` })),
    rejected: rejected.map((candidate) => ({ ...candidate, id: `X${candidate.id.slice(1)}` })),
    warnings,
    reliable,
    saturation,
    preTruncationCandidateCount,
    candidateComponentCount: components.length,
    rawEvidencePixels: thresholds.lowMaskPixels,
    globalCandidatePixels: thresholds.globalMaskPixels,
    effectiveMinimumAreaPixels: minimumArea.pixels,
    minimumAreaMethod: minimumArea.method,
    scaleUncertain: !scale.known,
    thresholds,
    normalization: normalizationResult.diagnostics,
    componentAudit
  };
}

function robustNormalizeCurrent(
  reference: Buffer,
  current: Buffer,
  validMask: Buffer,
  width: number,
  height: number
) {
  const referenceGray = rgbToGrayPlane(reference, width, height);
  const currentGray = rgbToGrayPlane(current, width, height);
  const referenceGradient = gradientMagnitude(referenceGray, width, height);
  const currentGradient = gradientMagnitude(currentGray, width, height);
  const validCount = countNonZeroBuffer(validMask);
  const stride = Math.max(1, Math.floor(validCount / visionConfig.normalization.maximumSamples));
  const firstPass: number[] = [];
  let excludedHighGradientPixels = 0;
  let seen = 0;
  for (let pixel = 0; pixel < validMask.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    if (referenceGradient[pixel] > visionConfig.normalization.gradientExclusionThreshold ||
      currentGradient[pixel] > visionConfig.normalization.gradientExclusionThreshold) {
      excludedHighGradientPixels += 1;
      continue;
    }
    if (seen++ % stride === 0) firstPass.push(pixel);
  }
  if (firstPass.length < 100) {
    for (let pixel = 0; pixel < validMask.length; pixel += stride) if (validMask[pixel]) firstPass.push(pixel);
  }
  const firstTransform = estimateRadiometricTransform(reference, current, firstPass);
  const provisionalResiduals = firstPass.map((pixel) => transformedPixelResidual(reference, current, pixel, firstTransform));
  const provisionalLimit = percentileNumber(provisionalResiduals, visionConfig.normalization.provisionalChangePercentile);
  const stable = firstPass.filter((_, index) => provisionalResiduals[index] <= provisionalLimit);
  const transform = estimateRadiometricTransform(reference, current, stable.length >= 100 ? stable : firstPass);
  const normalized = Buffer.from(current);
  for (let pixel = 0; pixel < validMask.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    const offset = pixel * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      normalized[offset + channel] = Math.round(clampNumber(
        current[offset + channel] * transform.scale[channel] + transform.offset[channel],
        0,
        255
      ));
    }
  }
  const rawResiduals = firstPass.map((pixel) => {
    const offset = pixel * 3;
    return (Math.abs(reference[offset] - current[offset]) +
      Math.abs(reference[offset + 1] - current[offset + 1]) +
      Math.abs(reference[offset + 2] - current[offset + 2])) / 3;
  });
  const normalizedResiduals = stable.map((pixel) => {
    const offset = pixel * 3;
    return (Math.abs(reference[offset] - normalized[offset]) +
      Math.abs(reference[offset + 1] - normalized[offset + 1]) +
      Math.abs(reference[offset + 2] - normalized[offset + 2])) / 3;
  });
  const diagnostics: RadiometricDiagnostics = {
    method: visionConfig.normalization.method,
    samples: stable.length,
    excludedHighGradientPixels,
    excludedProvisionalChangePixels: Math.max(0, firstPass.length - stable.length),
    sourceMedian: transform.sourceMedian.map(round),
    targetMedian: transform.targetMedian.map(round),
    sourceMad: transform.sourceMad.map(round),
    targetMad: transform.targetMad.map(round),
    scale: transform.scale.map(round),
    offset: transform.offset.map(round),
    rawMedianResidual: round(median(rawResiduals)),
    normalizedMedianResidual: round(median(normalizedResiduals))
  };
  return { normalized, diagnostics };
}

function buildTiledEvidence(input: {
  reference: Buffer;
  current: Buffer;
  validMask: Buffer;
  width: number;
  height: number;
  displacementRadius: number;
}) {
  const colorResidual = Buffer.alloc(input.width * input.height);
  const structuralResidual = Buffer.alloc(input.width * input.height);
  const edgeResidual = Buffer.alloc(input.width * input.height);
  const removedStructureResidual = Buffer.alloc(input.width * input.height);
  const referenceGradient = Buffer.alloc(input.width * input.height);
  const currentGradient = Buffer.alloc(input.width * input.height);
  const tileSize = visionConfig.processing.tileSize;
  const requiredOverlap = visionConfig.scoring.ssimRadius + input.displacementRadius +
    visionConfig.scoring.multiscaleRadiusPixels + 2;
  const overlap = Math.max(visionConfig.processing.tileOverlap, requiredOverlap);
  for (let coreTop = 0; coreTop < input.height; coreTop += tileSize) {
    for (let coreLeft = 0; coreLeft < input.width; coreLeft += tileSize) {
      const coreRight = Math.min(input.width, coreLeft + tileSize);
      const coreBottom = Math.min(input.height, coreTop + tileSize);
      const left = Math.max(0, coreLeft - overlap);
      const top = Math.max(0, coreTop - overlap);
      const right = Math.min(input.width, coreRight + overlap);
      const bottom = Math.min(input.height, coreBottom + overlap);
      const tileWidth = right - left;
      const tileHeight = bottom - top;
      const reference = extractRgbTile(input.reference, input.width, left, top, tileWidth, tileHeight);
      const current = extractRgbTile(input.current, input.width, left, top, tileWidth, tileHeight);
      const valid = extractPlaneTile(input.validMask, input.width, left, top, tileWidth, tileHeight);
      const referenceGray = rgbToGrayPlane(reference, tileWidth, tileHeight);
      const currentGray = rgbToGrayPlane(current, tileWidth, tileHeight);
      const tileReferenceGradient = gradientMagnitude(referenceGray, tileWidth, tileHeight);
      const tileCurrentGradient = gradientMagnitude(currentGray, tileWidth, tileHeight);
      const tileColor = symmetricPatchColorResidual(
        reference, current, valid, tileWidth, tileHeight, input.displacementRadius
      );
      const fineStructural = neighborhoodTolerantStructuralResidual(
        referenceGray, currentGray, valid, tileWidth, tileHeight, input.displacementRadius
      );
      const coarseStructural = maskedBoxMeanPlane(
        fineStructural,
        valid,
        tileWidth,
        tileHeight,
        visionConfig.scoring.multiscaleRadiusPixels
      );
      const tileStructural = Buffer.alloc(fineStructural.length);
      for (let pixel = 0; pixel < tileStructural.length; pixel += 1) {
        if (!valid[pixel]) continue;
        tileStructural[pixel] = Math.min(255, Math.round(Math.max(
          fineStructural[pixel],
          fineStructural[pixel] * 0.72 + coarseStructural[pixel] * 0.34
        )));
      }
      const tileEdge = symmetricDisplacementTolerantPlaneResidual(
        tileReferenceGradient,
        tileCurrentGradient,
        valid,
        tileWidth,
        tileHeight,
        input.displacementRadius
      );
      const tileRemoved = removedStructureEvidence(
        referenceGray,
        currentGray,
        tileReferenceGradient,
        tileCurrentGradient,
        tileStructural,
        valid,
        tileWidth,
        tileHeight
      );
      const sourceCore = {
        left: coreLeft - left,
        top: coreTop - top,
        width: coreRight - coreLeft,
        height: coreBottom - coreTop
      };
      copyPlaneCore(tileColor, tileWidth, colorResidual, input.width, sourceCore, coreLeft, coreTop);
      copyPlaneCore(tileStructural, tileWidth, structuralResidual, input.width, sourceCore, coreLeft, coreTop);
      copyPlaneCore(tileEdge, tileWidth, edgeResidual, input.width, sourceCore, coreLeft, coreTop);
      copyPlaneCore(tileRemoved, tileWidth, removedStructureResidual, input.width, sourceCore, coreLeft, coreTop);
      copyPlaneCore(tileReferenceGradient, tileWidth, referenceGradient, input.width, sourceCore, coreLeft, coreTop);
      copyPlaneCore(tileCurrentGradient, tileWidth, currentGradient, input.width, sourceCore, coreLeft, coreTop);
    }
  }
  return { colorResidual, structuralResidual, edgeResidual, removedStructureResidual, referenceGradient, currentGradient };
}

function removedStructureEvidence(
  reference: Uint8Array,
  current: Uint8Array,
  referenceGradient: Uint8Array,
  currentGradient: Uint8Array,
  structuralResidual: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number
) {
  const radius = Math.max(3, visionConfig.scoring.multiscaleRadiusPixels);
  const oldMean = maskedBoxMeanPlane(reference, validMask, width, height, radius);
  const currentMean = maskedBoxMeanPlane(current, validMask, width, height, radius);
  const oldEdgeMean = maskedBoxMeanPlane(referenceGradient, validMask, width, height, 3);
  const currentEdgeMean = maskedBoxMeanPlane(currentGradient, validMask, width, height, 3);
  const output = Buffer.alloc(reference.length);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    const edgeLoss = Math.max(0, oldEdgeMean[pixel] - currentEdgeMean[pixel]);
    const oldInteriorContrast = Math.abs(reference[pixel] - oldMean[pixel]);
    const currentInteriorContrast = Math.abs(current[pixel] - currentMean[pixel]);
    const contrastLoss = Math.max(0, oldInteriorContrast - currentInteriorContrast);
    const localHistogramChange = Math.abs(oldMean[pixel] - currentMean[pixel]);
    const multiscale = structuralResidual[pixel];
    const coherence = clamp01((edgeLoss / 18 + contrastLoss / 16) / 2);
    output[pixel] = Math.round(clampNumber((
      edgeLoss * 2.4 + contrastLoss * 1.9 + localHistogramChange * 0.45 + multiscale * 0.12
    ) * coherence, 0, 255));
  }
  return output;
}

function extractRgbTile(
  source: Uint8Array,
  sourceWidth: number,
  left: number,
  top: number,
  width: number,
  height: number
) {
  const output = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * sourceWidth + left) * 3;
    output.set(source.subarray(sourceStart, sourceStart + width * 3), y * width * 3);
  }
  return output;
}

function extractPlaneTile(
  source: Uint8Array,
  sourceWidth: number,
  left: number,
  top: number,
  width: number,
  height: number
) {
  const output = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (top + y) * sourceWidth + left;
    output.set(source.subarray(sourceStart, sourceStart + width), y * width);
  }
  return output;
}

function copyPlaneCore(
  source: Uint8Array,
  sourceWidth: number,
  target: Buffer,
  targetWidth: number,
  core: PixelBox,
  targetLeft: number,
  targetTop: number
) {
  for (let y = 0; y < core.height; y += 1) {
    const sourceStart = (core.top + y) * sourceWidth + core.left;
    const targetStart = (targetTop + y) * targetWidth + targetLeft;
    target.set(source.subarray(sourceStart, sourceStart + core.width), targetStart);
  }
}

function estimateRadiometricTransform(reference: Buffer, current: Buffer, indexes: number[]) {
  const sourceMedian: number[] = [];
  const targetMedian: number[] = [];
  const sourceMad: number[] = [];
  const targetMad: number[] = [];
  const scale: number[] = [];
  const offset: number[] = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceValues = indexes.map((pixel) => current[pixel * 3 + channel]);
    const targetValues = indexes.map((pixel) => reference[pixel * 3 + channel]);
    const sourceStats = clippedMedianMad(sourceValues);
    const targetStats = clippedMedianMad(targetValues);
    const channelScale = clampNumber(
      targetStats.mad / Math.max(1, sourceStats.mad),
      visionConfig.normalization.minimumScale,
      visionConfig.normalization.maximumScale
    );
    sourceMedian.push(sourceStats.median);
    targetMedian.push(targetStats.median);
    sourceMad.push(sourceStats.mad);
    targetMad.push(targetStats.mad);
    scale.push(channelScale);
    offset.push(targetStats.median - sourceStats.median * channelScale);
  }
  return { sourceMedian, targetMedian, sourceMad, targetMad, scale, offset };
}

function clippedMedianMad(values: number[]) {
  if (!values.length) return { median: 0, mad: 1 };
  const sorted = [...values].sort((a, b) => a - b);
  const clip = visionConfig.normalization.percentileClip;
  const start = Math.floor(sorted.length * clip);
  const end = Math.max(start + 1, Math.ceil(sorted.length * (1 - clip)));
  const clipped = sorted.slice(start, end);
  const center = median(clipped);
  return { median: center, mad: Math.max(1, median(clipped.map((value) => Math.abs(value - center))) * 1.4826) };
}

function transformedPixelResidual(
  reference: Buffer,
  current: Buffer,
  pixel: number,
  transform: { scale: number[]; offset: number[] }
) {
  const offset = pixel * 3;
  let residual = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    residual += Math.abs(reference[offset + channel] - clampNumber(
      current[offset + channel] * transform.scale[channel] + transform.offset[channel], 0, 255
    ));
  }
  return residual / 3;
}

function directedDisplacementTolerantColorResidual(
  reference: Uint8Array,
  current: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  radius: number
) {
  const output = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!validMask[pixel]) continue;
      const currentOffset = pixel * 3;
      let best = 255;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (!validMask[neighbor]) continue;
          const referenceOffset = neighbor * 3;
          const residual = (
            Math.abs(current[currentOffset] - reference[referenceOffset]) +
            Math.abs(current[currentOffset + 1] - reference[referenceOffset + 1]) +
            Math.abs(current[currentOffset + 2] - reference[referenceOffset + 2])
          ) / 3;
          if (residual < best) best = residual;
        }
      }
      output[pixel] = Math.round(best);
    }
  }
  return output;
}

function symmetricPatchColorResidual(
  reference: Uint8Array,
  current: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  radius: number
) {
  const currentToReference = directedDisplacementTolerantColorResidual(
    reference, current, validMask, width, height, radius
  );
  const referenceToCurrent = directedDisplacementTolerantColorResidual(
    current, reference, validMask, width, height, radius
  );
  const symmetric = Buffer.alloc(width * height);
  for (let pixel = 0; pixel < symmetric.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    const maximum = Math.max(currentToReference[pixel], referenceToCurrent[pixel]);
    const average = (currentToReference[pixel] + referenceToCurrent[pixel]) / 2;
    symmetric[pixel] = Math.round(maximum * 0.6 + average * 0.4);
  }
  const localConsistency = maskedBoxMeanPlane(symmetric, validMask, width, height, 1);
  const output = Buffer.alloc(symmetric.length);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    output[pixel] = Math.round(Math.max(
      symmetric[pixel] * 0.82,
      symmetric[pixel] * 0.68 + localConsistency[pixel] * 0.32
    ));
  }
  return output;
}

function displacementTolerantPlaneResidual(
  reference: Uint8Array,
  current: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  radius: number
) {
  const output = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!validMask[pixel]) continue;
      let best = 255;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (validMask[neighbor]) best = Math.min(best, Math.abs(current[pixel] - reference[neighbor]));
        }
      }
      output[pixel] = best;
    }
  }
  return output;
}

function symmetricDisplacementTolerantPlaneResidual(
  reference: Uint8Array,
  current: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  radius: number
) {
  const currentToReference = displacementTolerantPlaneResidual(
    reference, current, validMask, width, height, radius
  );
  const referenceToCurrent = displacementTolerantPlaneResidual(
    current, reference, validMask, width, height, radius
  );
  const output = Buffer.alloc(width * height);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    const maximum = Math.max(currentToReference[pixel], referenceToCurrent[pixel]);
    output[pixel] = Math.round(maximum * 0.6 +
      (currentToReference[pixel] + referenceToCurrent[pixel]) * 0.2);
  }
  return output;
}

function neighborhoodTolerantStructuralResidual(
  reference: Uint8Array,
  current: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  displacementRadius: number
) {
  const sameCoordinateSsim = localSsimResidual(reference, current, validMask, width, height);
  const tolerantSsim = minimumFilterPlane(
    sameCoordinateSsim,
    validMask,
    width,
    height,
    displacementRadius
  );
  const patchReference = maskedBoxMeanPlane(
    reference, validMask, width, height, visionConfig.scoring.ssimRadius
  );
  const patchCurrent = maskedBoxMeanPlane(
    current, validMask, width, height, visionConfig.scoring.ssimRadius
  );
  const patchMeanResidual = symmetricDisplacementTolerantPlaneResidual(
    patchReference, patchCurrent, validMask, width, height, displacementRadius
  );
  const referenceTexture = Buffer.alloc(reference.length);
  const currentTexture = Buffer.alloc(current.length);
  for (let pixel = 0; pixel < reference.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    referenceTexture[pixel] = Math.abs(reference[pixel] - patchReference[pixel]);
    currentTexture[pixel] = Math.abs(current[pixel] - patchCurrent[pixel]);
  }
  const textureResidual = symmetricDisplacementTolerantPlaneResidual(
    referenceTexture, currentTexture, validMask, width, height, displacementRadius
  );
  const output = Buffer.alloc(reference.length);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    output[pixel] = Math.round(clampNumber(
      tolerantSsim[pixel] * 0.5 +
      Math.min(255, patchMeanResidual[pixel] * 3) * 0.35 +
      Math.min(255, textureResidual[pixel] * 3) * 0.15,
      0,
      255
    ));
  }
  return output;
}

function maskedBoxMeanPlane(
  plane: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  radius: number
) {
  const integralWidth = width + 1;
  const sums = new Float64Array(integralWidth * (height + 1));
  const counts = new Uint32Array(integralWidth * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    let rowCount = 0;
    for (let x = 1; x <= width; x += 1) {
      const pixel = (y - 1) * width + x - 1;
      if (validMask[pixel]) {
        rowSum += plane[pixel];
        rowCount += 1;
      }
      const integralPixel = y * integralWidth + x;
      sums[integralPixel] = sums[integralPixel - integralWidth] + rowSum;
      counts[integralPixel] = counts[integralPixel - integralWidth] + rowCount;
    }
  }
  const rectangle = (data: Float64Array | Uint32Array, left: number, top: number, right: number, bottom: number) =>
    data[bottom * integralWidth + right] - data[top * integralWidth + right] -
    data[bottom * integralWidth + left] + data[top * integralWidth + left];
  const output = Buffer.alloc(plane.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!validMask[pixel]) continue;
      const left = Math.max(0, x - radius);
      const top = Math.max(0, y - radius);
      const right = Math.min(width, x + radius + 1);
      const bottom = Math.min(height, y + radius + 1);
      output[pixel] = Math.round(rectangle(sums, left, top, right, bottom) /
        Math.max(1, rectangle(counts, left, top, right, bottom)));
    }
  }
  return output;
}

function minimumFilterPlane(
  plane: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  radius: number
) {
  if (!radius) return Buffer.from(plane);
  const output = Buffer.alloc(plane.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!validMask[pixel]) continue;
      let best = plane[pixel];
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (validMask[neighbor]) best = Math.min(best, plane[neighbor]);
        }
      }
      output[pixel] = best;
    }
  }
  return output;
}

function localSsimResidual(
  reference: Uint8Array,
  current: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number
) {
  const integralWidth = width + 1;
  const length = integralWidth * (height + 1);
  const sumReference = new Float64Array(length);
  const sumCurrent = new Float64Array(length);
  const sumReferenceSquared = new Float64Array(length);
  const sumCurrentSquared = new Float64Array(length);
  const sumProduct = new Float64Array(length);
  for (let y = 1; y <= height; y += 1) {
    let rowReference = 0;
    let rowCurrent = 0;
    let rowReferenceSquared = 0;
    let rowCurrentSquared = 0;
    let rowProduct = 0;
    for (let x = 1; x <= width; x += 1) {
      const pixel = (y - 1) * width + x - 1;
      const referenceValue = reference[pixel];
      const currentValue = current[pixel];
      rowReference += referenceValue;
      rowCurrent += currentValue;
      rowReferenceSquared += referenceValue * referenceValue;
      rowCurrentSquared += currentValue * currentValue;
      rowProduct += referenceValue * currentValue;
      const integralPixel = y * integralWidth + x;
      const above = integralPixel - integralWidth;
      sumReference[integralPixel] = sumReference[above] + rowReference;
      sumCurrent[integralPixel] = sumCurrent[above] + rowCurrent;
      sumReferenceSquared[integralPixel] = sumReferenceSquared[above] + rowReferenceSquared;
      sumCurrentSquared[integralPixel] = sumCurrentSquared[above] + rowCurrentSquared;
      sumProduct[integralPixel] = sumProduct[above] + rowProduct;
    }
  }
  const rectangleSum = (integral: Float64Array, left: number, top: number, right: number, bottom: number) =>
    integral[bottom * integralWidth + right] - integral[top * integralWidth + right] -
    integral[bottom * integralWidth + left] + integral[top * integralWidth + left];
  const radius = visionConfig.scoring.ssimRadius;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const output = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!validMask[pixel]) continue;
      const left = Math.max(0, x - radius);
      const top = Math.max(0, y - radius);
      const right = Math.min(width, x + radius + 1);
      const bottom = Math.min(height, y + radius + 1);
      const count = Math.max(1, (right - left) * (bottom - top));
      const meanReference = rectangleSum(sumReference, left, top, right, bottom) / count;
      const meanCurrent = rectangleSum(sumCurrent, left, top, right, bottom) / count;
      const varianceReference = Math.max(0,
        rectangleSum(sumReferenceSquared, left, top, right, bottom) / count - meanReference ** 2
      );
      const varianceCurrent = Math.max(0,
        rectangleSum(sumCurrentSquared, left, top, right, bottom) / count - meanCurrent ** 2
      );
      const covariance = rectangleSum(sumProduct, left, top, right, bottom) / count -
        meanReference * meanCurrent;
      const ssim = ((2 * meanReference * meanCurrent + c1) * (2 * covariance + c2)) /
        Math.max(Number.EPSILON, (meanReference ** 2 + meanCurrent ** 2 + c1) *
          (varianceReference + varianceCurrent + c2));
      output[pixel] = Math.round(clampNumber((1 - ssim) / 1.2 * 255, 0, 255));
    }
  }
  return output;
}

function combineChangeEvidence(
  colorResidual: Uint8Array,
  structuralResidual: Uint8Array,
  textureResidual: Uint8Array,
  removedStructureResidual: Uint8Array,
  validMask: Uint8Array
) {
  const output = Buffer.alloc(colorResidual.length);
  const totalWeight = Math.max(0.01,
    visionConfig.scoring.colorWeight + visionConfig.scoring.structuralWeight + visionConfig.scoring.textureWeight
  );
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    const color = clamp01(colorResidual[pixel] / 64);
    const structural = structuralResidual[pixel] / 255;
    const texture = clamp01(textureResidual[pixel] / 96);
    const removedStructure = removedStructureResidual[pixel] / 255;
    let probability = (
      color * visionConfig.scoring.colorWeight +
      structural * visionConfig.scoring.structuralWeight +
      texture * visionConfig.scoring.textureWeight
    ) / totalWeight;
    // Thin displaced edges cannot score as change without color or patch support.
    if (color < 0.18 && structural < 0.22) probability *= 0.18;
    else if (texture > 0.55 && color < 0.25 && structural < 0.3) probability *= 0.45;
    if (removedStructure >= 0.28 && structural >= 0.18) {
      const removalProbability = removedStructure * (0.42 + visionConfig.scoring.removedStructureWeight) +
        structural * 0.12 + texture * 0.04;
      probability = Math.max(probability, removalProbability);
    }
    output[pixel] = Math.round(clamp01(probability) * 255);
  }
  return output;
}

function globalHysteresisMasks(
  score: Uint8Array,
  structuralResidual: Uint8Array,
  colorResidual: Uint8Array,
  removedStructureResidual: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  lowThreshold: number,
  highThreshold: number,
  lowThresholdMap?: Uint8Array,
  highThresholdMap?: Uint8Array,
  scale = segmentationScaleParameters()
) {
  const high = Buffer.alloc(score.length);
  const low = Buffer.alloc(score.length);
  for (let pixel = 0; pixel < score.length; pixel += 1) {
    if (!validMask[pixel]) continue;
    if (score[pixel] >= (highThresholdMap?.[pixel] || highThreshold)) high[pixel] = 255;
    if (score[pixel] >= (lowThresholdMap?.[pixel] || lowThreshold)) low[pixel] = 255;
  }
  // Close one-pixel registration gaps, then remove isolated single-pixel noise.
  // A one-pixel-radius cross preserves coherent structures at least three
  // pixels wide; narrow-regression fixtures guard this behavior.
  const closed = scale.closingRadius > 0
    ? binaryErode(binaryDilate(low, width, height, scale.closingRadius), width, height, scale.closingRadius)
    : Buffer.from(low);
  const opened = scale.openingRadius > 0
    ? binaryDilate(binaryErode(closed, width, height, scale.openingRadius), width, height, scale.openingRadius)
    : closed;
  const morphology = fillSmallHoles(opened, width, height, scale.holeAreaPixels);
  const components = connectedComponentsBuffer(morphology, width, height)
    .filter((component) => componentTouchesSeed(component, high, width) || coherentLowOnlyComponent(
      component,
      score,
      structuralResidual,
      colorResidual,
      removedStructureResidual,
      morphology,
      validMask,
      width,
      height,
      lowThreshold
    ));
  return { high, low, globalMask: maskFromComponents(components, score.length) };
}

function coherentLowOnlyComponent(
  component: BinaryComponent,
  score: Uint8Array,
  structuralResidual: Uint8Array,
  colorResidual: Uint8Array,
  removedStructureResidual: Uint8Array,
  componentMaskPlane: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  lowThreshold: number
) {
  if (component.area < visionConfig.components.lowOnlyMinimumPixels) return false;
  const insideScore = median(component.pixels.map((pixel) => score[pixel]));
  const structural = mean(component.pixels.map((pixel) => structuralResidual[pixel] / 255));
  const color = mean(component.pixels.map((pixel) => clamp01(colorResidual[pixel] / 64)));
  const removal = mean(component.pixels.map((pixel) => removedStructureResidual[pixel] / 255));
  const density = component.area / Math.max(1, component.box.width * component.box.height);
  const annulus = componentAnnulusValues(
    component,
    score,
    componentMaskPlane,
    validMask,
    width,
    height,
    visionConfig.components.annulusRadius
  );
  const contrast = (insideScore - median(annulus)) / 255;
  const multiscaleSupport = component.box.width >= 4 && component.box.height >= 4 && density >= 0.12;
  const checks = [
    insideScore >= lowThreshold * 1.08,
    structural >= visionConfig.components.minimumStructuralSupport * 0.7,
    color >= 0.28,
    removal >= 0.34,
    contrast >= visionConfig.components.minimumBackgroundContrast * 0.55,
    multiscaleSupport
  ];
  return checks.filter(Boolean).length >= visionConfig.components.lowOnlyMinimumEvidenceChecks;
}

function splitLargeWeakComponent(
  component: BinaryComponent,
  score: Uint8Array,
  width: number,
  height: number,
  highThreshold: number
): BinaryComponent[] {
  const density = component.area / Math.max(1, component.box.width * component.box.height);
  if (component.area < visionConfig.components.splitMinimumAreaPixels ||
    Math.min(component.box.width, component.box.height) < 48 || density > 0.42) return [component];
  const values = component.pixels.map((pixel) => score[pixel]);
  const strongThreshold = Math.max(
    highThreshold * visionConfig.components.splitStrongThresholdRatio,
    percentileNumber(values, 0.78)
  );
  const strongMask = Buffer.alloc(width * height);
  for (const pixel of component.pixels) if (score[pixel] >= strongThreshold) strongMask[pixel] = 255;
  const cores = connectedComponentsBuffer(strongMask, width, height)
    .filter((core) => core.area >= visionConfig.components.splitStrongCoreMinimumPixels);
  if (cores.length < 2) return [component];
  const corePixels = new Set(cores.flatMap((core) => core.pixels));
  const residualMask = Buffer.alloc(width * height);
  for (const pixel of component.pixels) if (!corePixels.has(pixel)) residualMask[pixel] = 255;
  const residuals = connectedComponentsBuffer(residualMask, width, height)
    .filter((residual) => residual.area >= visionConfig.components.lowOnlyMinimumPixels);
  const separated = [...cores, ...residuals];
  if (separated.length < 2) return [component];
  return separated.sort((first, second) => first.box.top - second.box.top || first.box.left - second.box.left);
}

export function hysteresisMasksForTest(input: {
  score: Uint8Array;
  structuralResidual: Uint8Array;
  colorResidual: Uint8Array;
  removedStructureResidual?: Uint8Array;
  validMask: Uint8Array;
  width: number;
  height: number;
  lowThreshold: number;
  highThreshold: number;
}) {
  return globalHysteresisMasks(
    input.score,
    input.structuralResidual,
    input.colorResidual,
    input.removedStructureResidual || new Uint8Array(input.score.length),
    input.validMask,
    input.width,
    input.height,
    input.lowThreshold,
    input.highThreshold,
    undefined,
    undefined,
    { ...segmentationScaleParameters(), closingRadius: 0, openingRadius: 0 }
  );
}

export function splitLargeWeakComponentForTest(input: {
  mask: Uint8Array;
  score: Uint8Array;
  width: number;
  height: number;
  highThreshold: number;
}) {
  return connectedComponentsBuffer(input.mask, input.width, input.height).flatMap((component) =>
    splitLargeWeakComponent(component, input.score, input.width, input.height, input.highThreshold)
  );
}

function evaluateGlobalComponent(input: {
  component: BinaryComponent;
  componentNumber: number;
  registration: Registration;
  score: Uint8Array;
  structuralResidual: Uint8Array;
  colorResidual: Uint8Array;
  removedStructureResidual: Uint8Array;
  globalMask: Uint8Array;
  lowThreshold: number;
  highThreshold: number;
  viewport: Viewport;
  effectiveMinimumAreaPixels: number;
  metersPerPixel?: number;
  scaleKnown: boolean;
}): Candidate {
  const { component, registration, score, structuralResidual, colorResidual, removedStructureResidual, globalMask } = input;
  const { width, height } = registration;
  const insideValues = component.pixels.map((pixel) => score[pixel] / 255);
  const annulusValues = componentAnnulusValues(
    component,
    score,
    globalMask,
    registration.validMask,
    width,
    height,
    visionConfig.components.annulusRadius
  ).map((value) => value / 255);
  const insideMean = mean(insideValues);
  const insideMedian = median(insideValues);
  const annulusMean = mean(annulusValues);
  const annulusMedian = median(annulusValues);
  const annulusMad = median(annulusValues.map((value) => Math.abs(value - annulusMedian)));
  const backgroundContrast = insideMedian - annulusMedian;
  const robustZScore = backgroundContrast / Math.max(0.025, annulusMad * 1.4826);
  const boundary = componentBoundaryStatistics(component, width, registration.edgeResidualMap);
  const edgeSupport = mean(component.pixels.map((pixel) => registration.edgeResidualMap[pixel] / 255));
  const density = component.area / Math.max(1, component.box.width * component.box.height);
  const compactness = clamp01(4 * Math.PI * component.area / Math.max(1, boundary.perimeter ** 2));
  const thickness = component.area / Math.max(component.box.width, component.box.height);
  const edgeOnlyFraction = clamp01(Math.max(
    boundary.edgeMismatchFraction,
    boundary.boundaryFraction * (thickness < 5 ? 1 : 0.35)
  ));
  const structuralSupport = mean(component.pixels.map((pixel) => structuralResidual[pixel] / 255));
  const colorSupport = mean(component.pixels.map((pixel) => clamp01(colorResidual[pixel] / 64)));
  const removalSupport = mean(component.pixels.map((pixel) => removedStructureResidual[pixel] / 255));
  const multiscaleSupport = mean(component.pixels.map((pixel) => structuralResidual[pixel] / 255));
  const thresholdStability = globalComponentThresholdStability(
    component,
    score,
    input.lowThreshold,
    input.highThreshold
  );
  const localRegistrationResidual = localRegistrationResidualForComponent(
    component,
    registration,
    globalMask
  );
  const invalidBorderContact = componentInvalidBorderContact(component, registration.validMask, width, height);
  const lowNormalized = input.lowThreshold / 255;
  const normalizedFactors = {
    strength: clamp01((insideMedian - lowNormalized) / Math.max(0.1, 0.82 - lowNormalized)),
    color: clamp01(colorSupport / 0.9),
    structure: clamp01((structuralSupport - 0.12) / 0.68),
    contrast: clamp01((backgroundContrast - 0.05) / 0.45),
    robustZ: clamp01((robustZScore - 1.25) / 4.75),
    stability: clamp01((thresholdStability - 0.25) / 0.65),
    alignment: clamp01(1 - localRegistrationResidual / 0.62),
    edgeIntegrity: clamp01(1 - edgeOnlyFraction),
    shape: clamp01(compactness * 0.35 + density * 0.65)
  };
  const scoreResult = componentScore(normalizedFactors);
  const componentScoreValue = scoreResult.score;
  const rejectionReasons: string[] = [];
  if (component.area < input.effectiveMinimumAreaPixels) rejectionReasons.push("AREA_TOO_SMALL");
  if (localRegistrationResidual > visionConfig.components.hardMaximumLocalRegistrationResidual) {
    rejectionReasons.push("LOCAL_REGISTRATION_RESIDUAL_HIGH");
  }
  if (invalidBorderContact > visionConfig.components.maximumInvalidBorderContact) {
    rejectionReasons.push("INVALID_BORDER_CONTACT");
  }
  if (!pointInsideBox(component.centroid, input.viewport)) rejectionReasons.push("OUTSIDE_VALID_VIEWPORT");
  const likelyTextOrUi = component.box.height <= height * 0.06 &&
    component.box.width / Math.max(1, component.box.height) >= 2 &&
    density >= 0.55 && edgeOnlyFraction >= 0.35;
  if (likelyTextOrUi) rejectionReasons.push("UI_OR_LABEL_ARTIFACT");
  const coherenceChecks = [
    thresholdStability >= visionConfig.components.minimumThresholdStability,
    structuralSupport >= visionConfig.components.minimumStructuralSupport,
    colorSupport >= 0.35,
    removalSupport >= 0.34,
    backgroundContrast >= visionConfig.components.minimumBackgroundContrast,
    robustZScore >= visionConfig.components.minimumRobustZScore * 0.5
  ];
  const minimumCoherenceChecks = input.scaleKnown ? 4 : 5;
  const noCoherentSupport = thresholdStability < 0.2 ||
    coherenceChecks.filter(Boolean).length < minimumCoherenceChecks;
  if (noCoherentSupport) rejectionReasons.push("NO_COHERENT_SEED_OR_SUPPORT");
  if (edgeOnlyFraction > visionConfig.components.maximumEdgeOnlyFraction &&
    (structuralSupport < 0.35 || colorSupport < 0.5)) {
    rejectionReasons.push("INCOHERENT_EDGE_ONLY_NOISE");
  }
  const requiredScore = visionConfig.components.minimumComponentScore;
  const limitingFactor = rejectionReasons.length
    ? rejectionReasons[0]
    : scoreResult.limitingFactor;
  const supportMask = componentMask(component, component.box, width);
  const finalBox = component.box;
  return {
    id: `G${input.componentNumber}`,
    box: finalBox,
    crop: padBoxWithinViewport(
      finalBox,
      input.metersPerPixel
        ? Math.max(
          visionConfig.scale.minimumCropPaddingPixels,
          Math.round(visionConfig.scale.cropPaddingMeters / input.metersPerPixel)
        )
        : Math.max(visionConfig.scale.minimumCropPaddingPixels, Math.round(Math.max(finalBox.width, finalBox.height) * 0.7)),
      width,
      height,
      input.viewport
    ),
    changeDensity: density,
    changeStrength: insideMean,
    maskedMedian: insideMedian,
    thresholdStability,
    validCoverage: planeCoverage(registration.validMask, width, finalBox),
    componentArea: component.area,
    borderContact: invalidBorderContact,
    quality: componentScoreValue,
    supportBox: component.box,
    supportMask,
    rejectionReasons,
    insideMean,
    insideMedian,
    annulusMean,
    annulusMedian,
    robustZScore,
    backgroundContrast,
    edgeOnlyFraction,
    compactness,
    localRegistrationResidual,
    structuralSupport,
    colorSupport,
    removalSupport,
    multiscaleSupport,
    edgeSupport,
    detectionConfidence: componentScoreValue,
    componentScore: componentScoreValue,
    requiredScore,
    limitingFactor,
    scoreFactors: scoreResult.factors
  };
}

const COMPONENT_SCORE_WEIGHTS = {
  strength: 0.15,
  color: 0.13,
  structure: 0.16,
  contrast: 0.17,
  robustZ: 0.12,
  stability: 0.1,
  alignment: 0.1,
  edgeIntegrity: 0.05,
  shape: 0.02
} as const;

function componentScore(factors: Record<keyof typeof COMPONENT_SCORE_WEIGHTS, number>) {
  const contributions = {} as Record<string, { normalized: number; weight: number; contribution: number }>;
  let score = 0;
  let limitingFactor = "strength";
  let limitingValue = Number.POSITIVE_INFINITY;
  for (const [name, weight] of Object.entries(COMPONENT_SCORE_WEIGHTS)) {
    const normalized = clamp01(factors[name as keyof typeof COMPONENT_SCORE_WEIGHTS]);
    const contribution = normalized * weight;
    contributions[name] = { normalized: round(normalized), weight, contribution: round(contribution) };
    score += contribution;
    if (name !== "shape" && normalized < limitingValue) {
      limitingValue = normalized;
      limitingFactor = name;
    }
  }
  return { score: clamp01(score), limitingFactor, factors: contributions };
}

export function componentScoreForTest(factors: Record<keyof typeof COMPONENT_SCORE_WEIGHTS, number>) {
  return componentScore(factors);
}

function componentAnnulusValues(
  component: BinaryComponent,
  score: Uint8Array,
  globalMask: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  radius: number
) {
  const values: number[] = [];
  const left = Math.max(0, component.box.left - radius);
  const top = Math.max(0, component.box.top - radius);
  const right = Math.min(width, component.box.left + component.box.width + radius);
  const bottom = Math.min(height, component.box.top + component.box.height + radius);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const pixel = y * width + x;
      if (!validMask[pixel] || globalMask[pixel]) continue;
      values.push(score[pixel]);
    }
  }
  return values;
}

function componentBoundaryStatistics(component: BinaryComponent, width: number, edgeResidualMap: Uint8Array) {
  const pixels = new Set(component.pixels);
  let boundaryPixels = 0;
  let perimeter = 0;
  let edgeMismatchPixels = 0;
  for (const pixel of component.pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    let boundary = false;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (!pixels.has((y + dy) * width + x + dx)) {
        boundary = true;
        perimeter += 1;
      }
    }
    if (boundary) boundaryPixels += 1;
    if (edgeResidualMap[pixel]) edgeMismatchPixels += 1;
  }
  return {
    perimeter,
    boundaryFraction: boundaryPixels / Math.max(1, component.area),
    edgeMismatchFraction: edgeMismatchPixels / Math.max(1, component.area)
  };
}

function globalComponentThresholdStability(
  component: BinaryComponent,
  score: Uint8Array,
  lowThreshold: number,
  highThreshold: number
) {
  let stableCore = 0;
  let highSeeds = 0;
  for (const pixel of component.pixels) {
    if (score[pixel] >= lowThreshold * 1.12) stableCore += 1;
    if (score[pixel] >= highThreshold) highSeeds += 1;
  }
  const coreFraction = stableCore / Math.max(1, component.area);
  const seedFraction = highSeeds / Math.max(1, component.area);
  const medianMargin = clamp01((median(component.pixels.map((pixel) => score[pixel])) - lowThreshold) /
    Math.max(1, highThreshold - lowThreshold));
  return clamp01(
    Math.min(1, coreFraction / 0.55) * 0.42 +
    Math.min(1, seedFraction / 0.12) * 0.34 +
    medianMargin * 0.24
  );
}

function localRegistrationResidualForComponent(
  component: BinaryComponent,
  registration: Registration,
  globalMask: Uint8Array
) {
  const radius = visionConfig.components.annulusRadius * 2;
  const left = Math.max(0, component.box.left - radius);
  const top = Math.max(0, component.box.top - radius);
  const right = Math.min(registration.width, component.box.left + component.box.width + radius);
  const bottom = Math.min(registration.height, component.box.top + component.box.height + radius);
  let residual = 0;
  let valid = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const pixel = y * registration.width + x;
      if (!registration.validMask[pixel] || globalMask[pixel]) continue;
      residual += registration.edgeResidualMap[pixel] / 255;
      valid += 1;
    }
  }
  return clamp01(residual / Math.max(1, valid) * 2);
}

function componentInvalidBorderContact(
  component: BinaryComponent,
  validMask: Uint8Array,
  width: number,
  height: number
) {
  const pixels = new Set(component.pixels);
  let boundary = 0;
  let invalid = 0;
  for (const pixel of component.pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    let isBoundary = false;
    let touchesInvalid = false;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !pixels.has(ny * width + nx)) isBoundary = true;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !validMask[ny * width + nx]) touchesInvalid = true;
    }
    if (isBoundary) boundary += 1;
    if (isBoundary && touchesInvalid) invalid += 1;
  }
  return invalid / Math.max(1, boundary);
}

function countNonZeroBuffer(data: Uint8Array) {
  let count = 0;
  for (const value of data) if (value) count += 1;
  return count;
}

function writeCandidatesToMask(candidates: Candidate[], mask: Buffer, width: number) {
  for (const candidate of candidates) {
    if (!candidate.supportMask || !candidate.supportBox) continue;
    for (let y = 0; y < candidate.supportBox.height; y += 1) {
      for (let x = 0; x < candidate.supportBox.width; x += 1) {
        if (!candidate.supportMask[y * candidate.supportBox.width + x]) continue;
        mask[(candidate.supportBox.top + y) * width + candidate.supportBox.left + x] = 255;
      }
    }
  }
}

function rejectionReasonHistogram(components: ComponentDiagnostic[]) {
  const counts: Record<string, number> = {};
  for (const component of components) {
    for (const reason of component.rejectionReasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function detectionState(input: {
  registrationReliable: boolean;
  compatibilityReliable: boolean;
  warnings: DetectionWarning[];
  rawEvidencePixels: number;
  globalCandidatePixels: number;
  candidateComponentCount: number;
  acceptedRegionCount: number;
  reviewRegionCount: number;
  saturation: boolean;
}): DetectionState {
  if (!input.registrationReliable) return "REGISTRATION_UNRELIABLE";
  if (!input.compatibilityReliable) return "COMPATIBILITY_FAILURE";
  if (input.warnings.some((warning) => warning.code === "WIDESPREAD_CHANGE_REVIEW")) {
    return "WIDESPREAD_CHANGE_REVIEW";
  }
  if (input.acceptedRegionCount > 0 && input.reviewRegionCount > 0) return "CHANGES_DETECTED_WITH_REVIEW";
  if (input.acceptedRegionCount > 0) return "CHANGES_DETECTED";
  if (input.reviewRegionCount > 0) return "CHANGES_NEED_REVIEW";
  if (input.candidateComponentCount > 0) return "COMPONENTS_REJECTED";
  if (input.rawEvidencePixels > 0 || input.globalCandidatePixels > 0) return "EVIDENCE_BELOW_THRESHOLD";
  return "NO_DIFFERENCE_EVIDENCE";
}

function padBoxWithinViewport(box: PixelBox, padding: number, width: number, height: number, viewport: Viewport): PixelBox {
  const left = Math.max(0, viewport.left, Math.floor(box.left - padding));
  const top = Math.max(0, viewport.top, Math.floor(box.top - padding));
  const right = Math.min(width, viewport.left + viewport.width, Math.ceil(box.left + box.width + padding));
  const bottom = Math.min(height, viewport.top + viewport.height, Math.ceil(box.top + box.height + padding));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function binaryErode(mask: Uint8Array, width: number, height: number, radius: number) {
  const output = Buffer.alloc(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let keep = true;
      for (let dy = -radius; dy <= radius && keep; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius + 1) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) {
            keep = false;
            break;
          }
        }
      }
      if (keep) output[y * width + x] = 255;
    }
  }
  return output;
}

function binaryDilate(mask: Uint8Array, width: number, height: number, radius: number) {
  const output = Buffer.alloc(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let set = false;
      for (let dy = -radius; dy <= radius && !set; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius + 1) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) {
            set = true;
            break;
          }
        }
      }
      if (set) output[y * width + x] = 255;
    }
  }
  return output;
}

function fillSmallHoles(mask: Uint8Array, width: number, height: number, maximumArea: number) {
  const inverse = Buffer.alloc(mask.length);
  for (let pixel = 0; pixel < mask.length; pixel += 1) inverse[pixel] = mask[pixel] ? 0 : 255;
  const output = Buffer.from(mask);
  for (const component of connectedComponentsBuffer(inverse, width, height)) {
    const touchesEdge = component.box.left === 0 || component.box.top === 0 ||
      component.box.left + component.box.width === width || component.box.top + component.box.height === height;
    if (!touchesEdge && component.area <= maximumArea) {
      for (const pixel of component.pixels) output[pixel] = 255;
    }
  }
  return output;
}

export function connectedComponentsForTest(mask: Uint8Array, width: number, height: number) {
  return connectedComponentsBuffer(mask, width, height).map(({ pixels: _pixels, ...component }) => component);
}

function connectedComponentsBuffer(mask: Uint8Array, width: number, height: number): BinaryComponent[] {
  const visited = new Uint8Array(mask.length);
  const components: BinaryComponent[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    const pixels: number[] = [];
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    let sumX = 0;
    let sumY = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      pixels.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
      sumX += x;
      sumY += y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (mask[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }
    }
    components.push({
      pixels,
      area: pixels.length,
      box: { left, top, width: right - left, height: bottom - top },
      centroid: { x: sumX / pixels.length, y: sumY / pixels.length }
    });
  }
  return components;
}

function componentTouchesSeed(component: BinaryComponent, highMask: Uint8Array, width: number) {
  for (const pixel of component.pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny * width + nx < highMask.length && highMask[ny * width + nx]) return true;
      }
    }
  }
  return false;
}

function maskFromComponents(components: BinaryComponent[], length: number) {
  const mask = Buffer.alloc(length);
  for (const component of components) for (const pixel of component.pixels) mask[pixel] = 255;
  return mask;
}

function componentMask(component: BinaryComponent, box: PixelBox, sourceWidth: number) {
  const mask = Buffer.alloc(box.width * box.height);
  for (const pixel of component.pixels) {
    const x = pixel % sourceWidth - box.left;
    const y = Math.floor(pixel / sourceWidth) - box.top;
    if (x >= 0 && y >= 0 && x < box.width && y < box.height) mask[y * box.width + x] = 255;
  }
  return mask;
}

function planeCoverage(data: Uint8Array, sourceWidth: number, box: PixelBox) {
  let valid = 0;
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) if (data[y * sourceWidth + x]) valid += 1;
  }
  return valid / Math.max(1, box.width * box.height);
}

function candidateDebugValue(candidate: Candidate) {
  return {
    id: candidate.id,
    parentCandidateId: candidate.parentCandidateId,
    refinedComponentId: candidate.refinedComponentId,
    box: candidate.box,
    crop: candidate.crop,
    changeDensity: candidate.changeDensity,
    changeStrength: candidate.changeStrength,
    maskedMedian: candidate.maskedMedian,
    thresholdStability: candidate.thresholdStability,
    validCoverage: candidate.validCoverage,
    componentArea: candidate.componentArea,
    borderContact: candidate.borderContact,
    quality: candidate.quality
  };
}

function disabledDebugRun(): DebugRun {
  return { enabled: false, json: async () => {}, file: async () => {} };
}

function translateBox(box: PixelBox, x: number, y: number): PixelBox {
  return { left: box.left + x, top: box.top + y, width: box.width, height: box.height };
}

function boxCenter(box: PixelBox) {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function pointInsideBox(point: { x: number; y: number }, box: PixelBox) {
  return point.x >= box.left && point.y >= box.top &&
    point.x < box.left + box.width && point.y < box.top + box.height;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

async function createCandidateSheets(registration: Registration, candidates: Candidate[], debug: DebugRun) {
  const beforeTiles: Buffer[] = [];
  const afterTiles: Buffer[] = [];
  for (const candidate of candidates) {
    const [beforeTile, afterTile] = await Promise.all([
      candidateTile(registration.alignedBeforeData, registration.width, registration.height, candidate),
      candidateTile(registration.afterData, registration.width, registration.height, candidate)
    ]);
    beforeTiles.push(beforeTile);
    afterTiles.push(afterTile);
    await Promise.all([
      debug.file(`crops/${candidate.id}-before.jpg`, beforeTile),
      debug.file(`crops/${candidate.id}-after.jpg`, afterTile)
    ]);
  }
  return {
    before: await contactSheet(beforeTiles),
    after: await contactSheet(afterTiles)
  };
}

async function applySemanticValidation(
  workspace: GlobalChangeWorkspace,
  registration: Registration,
  options: DetectionOptions
): Promise<SemanticValidation[]> {
  if (!options.semanticValidation && !options.semanticValidator) return [];
  if (!options.semanticValidator && !process.env.OPENAI_API_KEY) {
    workspace.warnings.push({
      code: "SEMANTIC_VALIDATION_SKIPPED_NO_API_KEY",
      severity: "warning",
      message: "Semantic validation was requested but no API key is configured. Deterministic accepted and review candidates were preserved."
    });
    return [];
  }
  const validCandidates = [...workspace.accepted, ...workspace.review];
  const inputs = await Promise.all(validCandidates.map(async (candidate): Promise<SemanticCandidateInput> => {
    const [beforeCrop, currentCrop, maskCrop, evidenceCrop] = await Promise.all([
      cropRgbDataUrl(registration.alignedBeforeData, registration.width, registration.height, candidate.crop),
      cropRgbDataUrl(registration.afterData, registration.width, registration.height, candidate.crop),
      candidateMaskCropDataUrl(candidate),
      cropPlaneDataUrl(workspace.probabilityScore, registration.width, candidate.crop)
    ]);
    candidate.maskCrop = maskCrop;
    candidate.evidenceCrop = evidenceCrop;
    return {
      candidateId: candidate.id,
      state: candidate.state === "accepted" ? "accepted" : "needs_review",
      beforeCrop,
      currentCrop,
      maskCrop: maskCrop || dataUrl(await grayToPng(Buffer.alloc(1), 1, 1), "image/png"),
      evidenceCrop,
      bbox: candidate.box,
      spatialDiagnostics: {
        areaPixels: candidate.componentArea || 0,
        componentScore: round(candidate.componentScore || 0),
        structuralSupport: round(candidate.structuralSupport || 0),
        colorSupport: round(candidate.colorSupport || 0),
        localRegistrationResidual: round(candidate.localRegistrationResidual || 0),
        edgeOnlyFraction: round(candidate.edgeOnlyFraction || 0)
      }
    };
  }));
  let rawDecisions: Array<Omit<SemanticValidation, "model"> & { model?: string }>;
  try {
    rawDecisions = options.semanticValidator
      ? await options.semanticValidator(inputs)
      : await requestSemanticCandidateDecisions(inputs);
  } catch (error) {
    workspace.warnings.push({
      code: "SEMANTIC_VALIDATION_FAILED",
      severity: "warning",
      message: `Semantic validation failed; deterministic states were preserved. ${error instanceof Error ? error.message : String(error)}`
    });
    return [];
  }
  const byId = new Map(validCandidates.map((candidate) => [candidate.id, candidate]));
  const decisions: SemanticValidation[] = [];
  for (const raw of rawDecisions) {
    const candidate = byId.get(raw.candidateId);
    if (!candidate || decisions.some((decision) => decision.candidateId === raw.candidateId)) continue;
    const decision: SemanticValidation = {
      candidateId: raw.candidateId,
      decision: raw.decision === "physical_change" || raw.decision === "likely_artifact" ? raw.decision : "uncertain",
      label: cautiousLabel(raw.label || "visible surface change"),
      confidence: round(clamp01(Number(raw.confidence || 0))),
      evidence: String(raw.evidence || "The paired crop is inconclusive."),
      artifactReason: raw.artifactReason ? String(raw.artifactReason) : null,
      model: raw.model || (options.semanticValidator ? "mock" : (process.env.OPENAI_MODEL || "unconfigured")),
      raw
    };
    candidate.semantic = decision;
    const previous = candidate.state || "needs_review";
    if (decision.decision === "physical_change") {
      candidate.state = "accepted";
      candidate.reviewReasons = [];
      candidate.rejectionReasons = [];
      if (previous !== "accepted") candidate.stateTransitions?.push({
        from: previous,
        to: "accepted",
        reason: "SEMANTIC_PHYSICAL_CHANGE",
        at: new Date().toISOString()
      });
    } else if (decision.decision === "likely_artifact") {
      if (strongDeterministicEvidence(candidate)) {
        candidate.state = "needs_review";
        candidate.reviewReasons = [...new Set([...(candidate.reviewReasons || []), "semantic_pixel_evidence_conflict"])];
        candidate.stateTransitions?.push({
          from: previous,
          to: "needs_review",
          reason: "semantic_pixel_evidence_conflict",
          at: new Date().toISOString()
        });
      } else {
        candidate.state = "rejected";
        candidate.rejectionReasons = [...new Set([...(candidate.rejectionReasons || []), "SEMANTIC_LIKELY_ARTIFACT"])];
        candidate.reviewReasons = [];
        candidate.stateTransitions?.push({
          from: previous,
          to: "rejected",
          reason: decision.artifactReason || "SEMANTIC_LIKELY_ARTIFACT",
          at: new Date().toISOString()
        });
      }
    } else {
      candidate.state = "needs_review";
      candidate.reviewReasons = [...new Set([...(candidate.reviewReasons || []), "SEMANTIC_UNCERTAIN"])];
      if (previous !== "needs_review") candidate.stateTransitions?.push({
        from: previous,
        to: "needs_review",
        reason: "SEMANTIC_UNCERTAIN",
        at: new Date().toISOString()
      });
    }
    decisions.push(decision);
  }
  const all = [...validCandidates, ...workspace.rejected];
  workspace.accepted = all.filter((candidate) => candidate.state === "accepted")
    .sort((a, b) => (b.componentScore || 0) - (a.componentScore || 0));
  workspace.review = all.filter((candidate) => candidate.state === "needs_review")
    .sort((a, b) => (b.componentScore || 0) - (a.componentScore || 0));
  workspace.rejected = all.filter((candidate) => candidate.state === "rejected");
  workspace.finalMask.fill(0);
  workspace.reviewMask.fill(0);
  workspace.rejectedMask.fill(0);
  workspace.allCandidateMask.fill(0);
  writeCandidatesToMask(workspace.accepted, workspace.finalMask, registration.width);
  writeCandidatesToMask(workspace.review, workspace.reviewMask, registration.width);
  writeCandidatesToMask(workspace.rejected, workspace.rejectedMask, registration.width);
  writeCandidatesToMask(all, workspace.allCandidateMask, registration.width);
  return decisions;
}

async function cropPlaneDataUrl(data: Uint8Array, sourceWidth: number, crop: PixelBox) {
  const plane = extractPlaneTile(data, sourceWidth, crop.left, crop.top, crop.width, crop.height);
  return dataUrl(await grayToPng(plane, crop.width, crop.height), "image/png");
}

async function requestSemanticCandidateDecisions(inputs: SemanticCandidateInput[]) {
  const ids = inputs.map((input) => input.candidateId);
  const prompt = `Review registered native-resolution before/after crops for deterministic change candidates.
Return exactly one decision per candidate ID: ${ids.join(", ")}.
Use physical_change only when the paired imagery supports a physical surface/object change inside the supplied mask. Use likely_artifact for labels, UI, shadows, seasonal/radiometric differences, compression, or registration ghosts. Otherwise use uncertain. Use cautious visual labels; do not call a colored patch or roof a building unless the imagery proves that conclusion. Evidence must be one short before-versus-after statement. Geometry is fixed and cannot be overridden.`;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      decisions: {
        type: "array",
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidateId: { type: "string", enum: ids },
            semanticDecision: { type: "string", enum: ["physical_change", "likely_artifact", "uncertain"] },
            cautiousLabel: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidence: { type: "string" },
            artifactReason: { type: ["string", "null"] }
          },
          required: ["candidateId", "semanticDecision", "cautiousLabel", "confidence", "evidence", "artifactReason"]
        }
      }
    },
    required: ["decisions"]
  };
  const response = await requestStructuredVision<unknown>({
    prompt,
    images: inputs.flatMap((input) => [
      { label: `${input.candidateId} REGISTERED BEFORE NATIVE CROP`, data: input.beforeCrop },
      { label: `${input.candidateId} CURRENT NATIVE CROP`, data: input.currentCrop },
      { label: `${input.candidateId} CANDIDATE MASK`, data: input.maskCrop },
      { label: `${input.candidateId} LOCAL DIFFERENCE EVIDENCE`, data: input.evidenceCrop }
    ]),
    schemaName: "change_candidate_semantic_review",
    schema
  });
  const decisionSchema = z.object({
    candidateId: z.string().refine((value) => ids.includes(value)),
    semanticDecision: z.enum(["physical_change", "likely_artifact", "uncertain"]),
    cautiousLabel: z.string().min(1).max(120),
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1).max(1200),
    artifactReason: z.string().max(600).nullable()
  }).strict();
  const parsed = z.object({ decisions: z.array(decisionSchema).length(ids.length) }).strict().safeParse(response.parsed);
  if (!parsed.success || new Set(parsed.data.decisions.map((decision) => decision.candidateId)).size !== ids.length) {
    throw new Error("Malformed semantic validation response.");
  }
  return parsed.data.decisions.map((decision) => ({
    candidateId: decision.candidateId,
    decision: decision.semanticDecision,
    label: decision.cautiousLabel,
    confidence: decision.confidence,
    evidence: decision.evidence,
    artifactReason: decision.artifactReason,
    model: process.env.OPENAI_MODEL || "unconfigured"
  }));
}

async function candidateTile(data: Buffer, width: number, height: number, candidate: Candidate) {
  const { crop, box } = candidate;
  const rectangle = Buffer.from(`<svg width="${crop.width}" height="${crop.height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${box.left - crop.left}" y="${box.top - crop.top}" width="${box.width}" height="${box.height}" fill="none" stroke="#ffdd38" stroke-width="4"/>
    <rect x="4" y="4" width="42" height="25" fill="#111813"/>
    <text x="25" y="22" text-anchor="middle" fill="#ffdd38" font-family="Arial" font-size="15" font-weight="700">${candidate.id}</text>
  </svg>`);
  return sharp(data, { raw: { width, height, channels: 3 } })
    .extract(crop)
    .composite([{ input: rectangle }])
    .jpeg({ quality: 91 })
    .toBuffer();
}

async function contactSheet(tiles: Buffer[]) {
  const columns = Math.min(3, tiles.length);
  const rows = Math.ceil(tiles.length / columns);
  const cellWidth = 320;
  const cellHeight = 230;
  const resized = await Promise.all(tiles.map((tile) => sharp(tile)
    .resize(cellWidth - 12, cellHeight - 12, { fit: "contain", background: "#111813" })
    .jpeg({ quality: 88 })
    .toBuffer()));
  return sharp({
    create: { width: columns * cellWidth, height: rows * cellHeight, channels: 3, background: "#111813" }
  }).composite(resized.map((input, index) => ({
    input,
    left: (index % columns) * cellWidth + 6,
    top: Math.floor(index / columns) * cellHeight + 6
  }))).jpeg({ quality: 90 }).toBuffer();
}

async function validateCandidates(input: AnalyzeInput, candidates: Candidate[], beforeSheet: Buffer, afterSheet: Buffer) {
  const ids = candidates.map((candidate) => candidate.id);
  const prompt = `Validate deterministic visual-difference candidates from two registered map-image sheets.

Image 1 is BEFORE (${input.beforeDate?.toISOString().slice(0, 10) || "unknown"}). Image 2 is AFTER (${input.afterDate?.toISOString().slice(0, 10) || "unknown"}). Tiles with the same C-number show the same ground crop. The yellow rectangle is the fixed candidate; do not return coordinates.

Return one decision for every ID: ${ids.join(", ")}.
- Accept only a visible physical change inside the yellow rectangle that is absent before and present/altered after.
- Reject registration ghosts, resolution/color differences, shadows, seasonal vegetation, water, roads, labels, controls, and unchanged objects.
- Prefer rejection when uncertain. Do not accept surrounding land just because a nearby object changed.
- Labels must be cautious 2–5 word visual noun phrases. Say "cyan-roof object" or "surface change" unless the imagery clearly proves a building footprint.
- Evidence must be one short before-versus-after sentence about that exact rectangle.
- Confidence is candidate-specific and includes confidence in both matching and physical change.

Monitoring context (${input.title}; ${input.type}; ${input.location}) is a search hint only, never evidence.`;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      decisions: {
        type: "array",
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sourceCandidateId: { type: "string", enum: ids },
            accepted: { type: "boolean" },
            label: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidence: { type: "string" }
          },
          required: ["sourceCandidateId", "accepted", "label", "confidence", "evidence"]
        }
      }
    },
    required: ["decisions"]
  };
  const response = await requestStructuredVision<unknown>({
    prompt,
    images: [
      { label: "IMAGE 1 — REGISTERED BEFORE CANDIDATE SHEET", data: dataUrl(beforeSheet, "image/jpeg") },
      { label: "IMAGE 2 — AFTER CANDIDATE SHEET", data: dataUrl(afterSheet, "image/jpeg") }
    ],
    schemaName: "candidate_change_validation",
    schema
  });
  const decisionSchema = z.object({
    sourceCandidateId: z.string().refine((value) => ids.includes(value)),
    accepted: z.boolean(),
    label: z.string().min(1).max(120),
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1).max(1200)
  }).strict();
  const parsed = z.object({ decisions: z.array(decisionSchema).length(ids.length) }).strict().safeParse(response.parsed);
  if (!parsed.success || new Set(parsed.data.decisions.map((decision) => decision.sourceCandidateId)).size !== ids.length) {
    throw new Error("Malformed candidate validation response.");
  }
  return { ...response, parsed: parsed.data };
}

async function requestStructuredVision<T>(input: {
  prompt: string;
  images: Array<{ label: string; data: string }>;
  schemaName: string;
  schema: object;
}) {
  for (let attempt = 0; attempt <= visionConfig.frontier.maximumRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), visionConfig.frontier.timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: configuredOpenAIModel(),
          store: false,
          max_output_tokens: visionConfig.frontier.maximumOutputTokens,
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: input.prompt },
              ...input.images.flatMap((image) => [
                { type: "input_text", text: image.label },
                { type: "input_image", image_url: image.data, detail: "high" }
              ])
            ]
          }],
          text: { format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } }
        })
      });
      const body = await response.text();
      if (!response.ok) {
        if (attempt < visionConfig.frontier.maximumRetries && retryableProviderStatus(response.status)) continue;
        throw new Error(`OpenAI analysis failed (${response.status}). ${safeProviderError(body.slice(0, 2_000))}`);
      }
      const data = JSON.parse(body) as {
        output_text?: string;
        output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      };
      const rawText = data.output_text || data.output?.flatMap((output) => output.content || [])
        .filter((content) => content.type === "output_text" || content.text)
        .map((content) => content.text || "").join("\n") || "";
      if (!rawText) throw new Error("OpenAI analysis returned no structured text.");
      return {
        parsed: JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, "")) as T,
        rawText
      };
    } catch (error) {
      if (attempt < visionConfig.frontier.maximumRetries && retryableProviderError(error)) continue;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("OpenAI analysis failed after bounded retries.");
}

function retryableProviderStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryableProviderError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /fetch|network|timeout/i.test(error.message));
}

function normalizeDecisions(
  value: unknown,
  candidates: Candidate[],
  registrationConfidence: number,
  width: number,
  height: number
): Region[] {
  if (!Array.isArray(value)) return [];
  const decisions = new Map<string, CandidateDecision>();
  for (const item of value) {
    const decision = item as Partial<CandidateDecision>;
    if (!decision.sourceCandidateId || decisions.has(decision.sourceCandidateId)) continue;
    decisions.set(decision.sourceCandidateId, {
      sourceCandidateId: decision.sourceCandidateId,
      accepted: decision.accepted === true,
      label: cautiousLabel(String(decision.label || "visible surface change")),
      confidence: clamp01(Number(decision.confidence || 0)),
      evidence: String(decision.evidence || "Visible pixels differ within the registered candidate.")
    });
  }

  const regions = candidates.flatMap((candidate) => {
    const decision = decisions.get(candidate.id);
    if (!decision?.accepted) return [];
    const candidateConfidence = clamp01(0.5 + candidate.changeStrength * 0.3 + candidate.changeDensity * 0.2);
    const confidence = Math.min(
      decision.confidence,
      0.5 + registrationConfidence * 0.45,
      0.52 + candidateConfidence * 0.43
    );
    if (confidence < MIN_REGION_CONFIDENCE) return [];
    return [{
      id: `R${candidate.id.slice(1)}`,
      ...pixelBoxToPercent(candidate.box, width, height),
      label: decision.label,
      confidence: round(confidence),
      evidence: decision.evidence,
      sourceCandidateId: candidate.id
    }];
  });

  return deduplicateRegions([...regions].sort((a, b) =>
    b.confidence - a.confidence || a.width * a.height - b.width * b.height
  ))
    .slice(0, MAX_REGIONS)
    .map((region, index) => ({ ...region, id: `R${index + 1}` }));
}

function buildAnalysis(regions: Region[], registrationConfidence: number): AiAnalysis {
  if (!regions.length) return noChangeResult(registrationConfidence);
  const confidence = round(regions.reduce((sum, region) => sum + region.confidence, 0) / regions.length);
  return {
    provider: "openai",
    summary: `${regions.length} potential ${regions.length === 1 ? "change region was" : "change regions were"} found after deterministic image registration.`,
    evidence: regions.map((region) => region.evidence),
    severity: confidence >= 0.85 ? "high" : confidence >= 0.72 ? "medium" : "low",
    confidence,
    recommendedAction: "Review each numbered region against the aligned image pair before scheduling a field inspection.",
    regions
  };
}

function noChangeResult(registrationConfidence: number): AiAnalysis {
  return {
    provider: "openai",
    summary: "No physical change could be localized with enough confidence.",
    evidence: [],
    severity: "low",
    confidence: round(Math.min(0.49, registrationConfidence * 0.45)),
    recommendedAction: "Use images with closer framing and resolution, or review the pair manually.",
    regions: []
  };
}

function unreliableResult(registration: RegistrationDiagnostics): AiAnalysis {
  return {
    provider: "openai",
    summary: "The images could not be registered reliably, so no change polygons were produced.",
    evidence: [],
    severity: "low",
    confidence: round(Math.min(0.45, registration.confidence * 0.45)),
    recommendedAction: "Upload captures with more shared landmarks, similar scale, and less map UI.",
    regions: []
  };
}

function detectMapViewport(data: Buffer, width: number, height: number): Viewport {
  const darkColumnRatio = (x: number) => {
    let dark = 0;
    let total = 0;
    for (let y = Math.floor(height * 0.06); y < Math.floor(height * 0.94); y += 3) {
      const offset = (y * width + x) * 3;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const luma = red * 0.299 + green * 0.587 + blue * 0.114;
      if (luma < 82 && Math.max(red, green, blue) - Math.min(red, green, blue) < 42) dark += 1;
      total += 1;
    }
    return dark / total;
  };
  const darkRowRatio = (y: number, right: number) => {
    let dark = 0;
    let total = 0;
    for (let x = Math.floor(width * 0.03); x < right; x += 3) {
      const offset = (y * width + x) * 3;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const luma = red * 0.299 + green * 0.587 + blue * 0.114;
      if (luma < 76 && Math.max(red, green, blue) - Math.min(red, green, blue) < 48) dark += 1;
      total += 1;
    }
    return dark / total;
  };

  let right = width;
  let darkRun = 0;
  for (let x = width - 1; x >= Math.floor(width * 0.88); x -= 1) {
    if (darkColumnRatio(x) > 0.56) {
      darkRun += 1;
      right = x;
    } else if (darkRun >= Math.max(8, width * 0.012)) {
      break;
    } else {
      darkRun = 0;
      right = width;
    }
  }
  if (width - right > width * 0.12 || width - right < width * 0.01) right = width;

  let bottom = height;
  let rowRun = 0;
  for (let y = height - 1; y >= Math.floor(height * 0.92); y -= 1) {
    if (darkRowRatio(y, right) > 0.5) {
      rowRun += 1;
      bottom = y;
    } else if (rowRun >= Math.max(6, height * 0.008)) {
      break;
    } else {
      rowRun = 0;
      bottom = height;
    }
  }
  if (height - bottom > height * 0.08 || height - bottom < height * 0.006) bottom = height;
  return { left: 0, top: 0, width: right, height: bottom };
}

function featureMask(cv: any, width: number, height: number, viewport: Viewport) {
  const mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(0));
  cv.rectangle(
    mask,
    new cv.Point(viewport.left, viewport.top),
    new cv.Point(viewport.left + viewport.width - 1, viewport.top + viewport.height - 1),
    new cv.Scalar(255),
    -1
  );
  for (const box of knownUiBoxes(width, height)) {
    cv.rectangle(
      mask,
      new cv.Point(Math.floor(box.left), Math.floor(box.top)),
      new cv.Point(Math.ceil(box.left + box.width), Math.ceil(box.top + box.height)),
      new cv.Scalar(0),
      -1
    );
  }
  return mask;
}

function overlapMask(cv: any, width: number, height: number) {
  return featureMask(cv, width, height, { left: 0, top: 0, width, height });
}

function detectChangedBorderOverlayBands(
  colorResidual: Uint8Array,
  currentGradient: Uint8Array,
  width: number,
  height: number
) {
  const mask = Buffer.alloc(width * height);
  const eligible = (pixel: number) =>
    colorResidual[pixel] >= visionConfig.compatibility.borderOverlayMinimumColorResidual &&
    currentGradient[pixel] <= visionConfig.compatibility.borderOverlayMaximumGradient;
  const columnCoverage = Array.from({ length: width }, (_, x) => {
    let count = 0;
    for (let y = 0; y < height; y += 1) if (eligible(y * width + x)) count += 1;
    return count / Math.max(1, height);
  });
  const rowCoverage = Array.from({ length: height }, (_, y) => {
    let count = 0;
    for (let x = 0; x < width; x += 1) if (eligible(y * width + x)) count += 1;
    return count / Math.max(1, width);
  });
  const qualifyingRuns = (coverage: number[], maximumThickness: number) => {
    const runs: Array<[number, number]> = [];
    for (let start = 0; start < coverage.length;) {
      if (coverage[start] < visionConfig.compatibility.borderOverlayMinimumCoverage) {
        start += 1;
        continue;
      }
      let end = start + 1;
      while (end < coverage.length && coverage[end] >= visionConfig.compatibility.borderOverlayMinimumCoverage) end += 1;
      const touchesBorder = start === 0 || end === coverage.length;
      if (touchesBorder && end - start >= 2 && end - start <= maximumThickness) runs.push([start, end]);
      start = end;
    }
    return runs;
  };
  const columnRuns = qualifyingRuns(
    columnCoverage,
    Math.max(2, Math.floor(width * visionConfig.compatibility.borderOverlayMaximumThickness))
  );
  const rowRuns = qualifyingRuns(
    rowCoverage,
    Math.max(2, Math.floor(height * visionConfig.compatibility.borderOverlayMaximumThickness))
  );
  for (const [left, right] of columnRuns) {
    for (let y = 0; y < height; y += 1) mask.fill(255, y * width + left, y * width + right);
  }
  for (const [top, bottom] of rowRuns) mask.fill(255, top * width, bottom * width);
  return mask;
}

function directRgbResidualPlane(reference: Uint8Array, current: Uint8Array) {
  const pixels = Math.min(reference.length, current.length) / 3;
  const residual = Buffer.alloc(pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 3;
    residual[pixel] = Math.max(
      Math.abs(reference[offset] - current[offset]),
      Math.abs(reference[offset + 1] - current[offset + 1]),
      Math.abs(reference[offset + 2] - current[offset + 2])
    );
  }
  return residual;
}

function knownUiBoxes(width: number, height: number): PixelBox[] {
  return [
    { left: 0, top: 0, width, height: height * 0.1 },
    { left: 0, top: height * 0.045, width: width * 0.055, height: height * 0.24 },
    { left: width * 0.955, top: height * 0.075, width: width * 0.045, height: height * 0.72 },
    { left: 0, top: height * 0.955, width, height: height * 0.045 },
    { left: 0, top: height * 0.9, width: width * 0.22, height: height * 0.055 }
  ];
}

function isKnownUiPixel(x: number, y: number, width: number, height: number) {
  return knownUiBoxes(width, height).some((box) => pointInsideBox({ x, y }, box));
}

function rgbMat(cv: any, data: Buffer, width: number, height: number) {
  const mat = new cv.Mat(height, width, cv.CV_8UC3);
  mat.data.set(data);
  return mat;
}

function grayMat(cv: any, data: Buffer, width: number, height: number) {
  const mat = new cv.Mat(height, width, cv.CV_8UC1);
  mat.data.set(data);
  return mat;
}

function pointCoverage(points: Array<{ x: number; y: number }>, viewport: Viewport) {
  if (points.length < 2) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / (viewport.width * viewport.height);
}

function homographyIsSane(matrix: number[], beforeWidth: number, beforeHeight: number, afterWidth: number, afterHeight: number) {
  if (matrix.length !== 9 || matrix.some((value) => !Number.isFinite(value))) return false;
  const corners = [
    projectPoint(matrix, 0, 0),
    projectPoint(matrix, beforeWidth, 0),
    projectPoint(matrix, beforeWidth, beforeHeight),
    projectPoint(matrix, 0, beforeHeight)
  ];
  if (corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const area = polygonArea(corners);
  const ratio = area / (afterWidth * afterHeight);
  const horizontalTop = distance(corners[0], corners[1]);
  const horizontalBottom = distance(corners[3], corners[2]);
  const verticalLeft = distance(corners[0], corners[3]);
  const verticalRight = distance(corners[1], corners[2]);
  return ratio > 0.35 && ratio < 2.8 &&
    horizontalTop / horizontalBottom > 0.45 && horizontalTop / horizontalBottom < 2.2 &&
    verticalLeft / verticalRight > 0.45 && verticalLeft / verticalRight < 2.2;
}

function boxInsideViewport(box: PixelBox, viewport: Viewport, width: number, height: number) {
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  return centerX >= viewport.left && centerX <= viewport.left + viewport.width &&
    centerY >= viewport.top && centerY <= viewport.top + viewport.height &&
    box.left > width * 0.01 && box.top > height * 0.01;
}

function padPixelBox(box: PixelBox, padding: number, width: number, height: number): PixelBox {
  const left = Math.max(0, Math.floor(box.left - padding));
  const top = Math.max(0, Math.floor(box.top - padding));
  const right = Math.min(width, Math.ceil(box.left + box.width + padding));
  const bottom = Math.min(height, Math.ceil(box.top + box.height + padding));
  return { left, top, width: right - left, height: bottom - top };
}

function deduplicateCandidates(candidates: Candidate[]) {
  const ranked = [...candidates].sort((a, b) => candidateRank(b) - candidateRank(a));
  const result: Candidate[] = [];
  for (const candidate of ranked) {
    if (result.some((existing) => intersectionOverUnion(existing.box, candidate.box) > 0.58)) continue;
    result.push(candidate);
  }
  return result;
}

function deduplicateRegions(regions: Region[]) {
  const result: Region[] = [];
  for (const region of regions) {
    const box = { left: region.x, top: region.y, width: region.width, height: region.height };
    if (result.some((existing) => {
      const existingBox = { left: existing.x, top: existing.y, width: existing.width, height: existing.height };
      return percentIntersectionOverUnion(existing, region) > 0.5 || intersectionOverSmaller(existingBox, box) > 0.68;
    })) continue;
    result.push(region);
  }
  return result;
}

function candidateRank(candidate: Candidate) {
  return Math.sqrt(candidate.box.width * candidate.box.height) * (0.45 + candidate.changeDensity + candidate.changeStrength);
}

function intersectionOverUnion(a: PixelBox, b: PixelBox) {
  const intersectionWidth = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const intersectionHeight = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const intersection = intersectionWidth * intersectionHeight;
  return intersection / (a.width * a.height + b.width * b.height - intersection || 1);
}

function intersectionOverSmaller(a: PixelBox, b: PixelBox) {
  const intersectionWidth = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const intersectionHeight = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const intersection = intersectionWidth * intersectionHeight;
  return intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function percentIntersectionOverUnion(a: PercentBox, b: PercentBox) {
  return intersectionOverUnion(
    { left: a.x, top: a.y, width: a.width, height: a.height },
    { left: b.x, top: b.y, width: b.width, height: b.height }
  );
}

function cautiousLabel(value: string) {
  let label = value.trim().replace(/\s+/g, " ").split(" ").slice(0, 5).join(" ");
  if (/illegal|temporary|complex|construction site/i.test(label)) label = "visible surface change";
  if (/building cluster|many buildings/i.test(label)) label = "changed roof objects";
  return label || "visible surface change";
}

async function enrichRegions(regions: Region[], candidates: Candidate[], registration: Registration) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return Promise.all(regions.map(async (region, index) => {
    const candidate = region.sourceCandidateId ? byId.get(region.sourceCandidateId) : undefined;
    if (!candidate) return region;
    const geometry = await candidateRegion(candidate, registration, index + 1);
    return {
      ...geometry,
      id: region.id,
      label: region.label,
      changeType: region.label,
      classificationConfidence: region.confidence,
      evidence: region.evidence,
      sourceCandidateId: region.sourceCandidateId
    };
  }));
}

async function candidateRegion(
  candidate: Candidate,
  registration: Registration,
  number: number,
  metersPerPixel?: number
): Promise<Region> {
  if (candidate.crop.width < 1 || candidate.crop.height < 1) {
    candidate.crop = padPixelBox(candidate.box, visionConfig.scale.minimumCropPaddingPixels, registration.width, registration.height);
  }
  if (!candidate.supportMask || !candidate.supportBox) {
    const box = candidate.box;
    const state = candidate.state || "needs_review";
    const percent = pixelBoxToPercent(box, registration.width, registration.height);
    const [oldCrop, currentCrop] = await Promise.all([
      cropRgbDataUrl(registration.alignedBeforeData, registration.width, registration.height, candidate.crop),
      cropRgbDataUrl(registration.afterData, registration.width, registration.height, candidate.crop)
    ]);
    return {
      id: state === "needs_review" ? `V${number}` : candidate.id,
      ...percent,
      label: candidate.semantic?.label || candidate.frontierProposal?.changeType || "Potential surface change",
      changeType: candidate.frontierProposal?.changeType || "unknown",
      confidence: round(candidate.frontierConfidence || 0),
      evidence: candidate.semantic?.evidence || candidate.frontierProposal?.evidence || "Coarse frontier proposal requires human review.",
      sourceCandidateId: candidate.id,
      areaM2: null,
      centroid: [round(box.left + box.width / 2), round(box.top + box.height / 2)],
      bbox: { x: box.left, y: box.top, width: box.width, height: box.height },
      state,
      reviewReason: state === "needs_review" ? candidate.reviewReasons?.[0] || "FRONTIER_COARSE_BOX_NO_RELIABLE_PIXEL_MASK" : null,
      semantic: candidate.semantic || null,
      crops: { old: oldCrop, current: currentCrop, evidence: candidate.evidenceCrop },
      proposalSource: candidate.proposalSource || "frontier_global",
      deterministicScore: candidate.componentScore ?? null,
      frontierDecision: candidate.frontierDecision ?? candidate.frontierProposal?.decision ?? null,
      frontierConfidence: candidate.frontierConfidence ?? candidate.frontierProposal?.confidence ?? null,
      frontierScout: candidate.frontierScout,
      frontierVerification: candidate.frontierVerification,
      verificationQueuePosition: candidate.verificationQueuePosition ?? null,
      stateReason: candidate.stateReason || "Frontier-only coarse geometry remains review-only.",
      geometryType: "frontier_bbox"
    };
  }
  const cv = await getOpenCv();
  const source = grayMat(cv, candidate.supportMask, candidate.supportBox.width, candidate.supportBox.height);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const approximation = new cv.Mat();
  let polygon: PixelPoint[] = [];
  let perimeter = 0;
  try {
    cv.findContours(source, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let largest: any | undefined;
    let largestArea = -1;
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const area = cv.contourArea(contour, false);
      if (area > largestArea) {
        largest?.delete();
        largest = contour;
        largestArea = area;
      } else {
        contour.delete();
      }
    }
    if (!largest) throw new Error(`No contour could be extracted for ${candidate.id}.`);
    try {
      perimeter = cv.arcLength(largest, true);
      cv.approxPolyDP(largest, approximation, Math.max(1, perimeter * visionConfig.polygonSimplification), true);
      const points = approximation.data32S as Int32Array;
      for (let index = 0; index + 1 < points.length; index += 2) {
        polygon.push([
          points[index] + candidate.supportBox.left,
          points[index + 1] + candidate.supportBox.top
        ]);
      }
      if (polygon.length < 3) {
        const fallback = largest.data32S as Int32Array;
        polygon = [];
        for (let index = 0; index + 1 < fallback.length; index += 2) {
          polygon.push([
            fallback[index] + candidate.supportBox.left,
            fallback[index + 1] + candidate.supportBox.top
          ]);
        }
      }
    } finally {
      largest.delete();
    }
  } finally {
    source.delete();
    contours.delete();
    hierarchy.delete();
    approximation.delete();
  }

  let pixelArea = 0;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < candidate.supportMask.length; index += 1) {
    if (!candidate.supportMask[index]) continue;
    pixelArea += 1;
    sumX += index % candidate.supportBox.width + candidate.supportBox.left;
    sumY += Math.floor(index / candidate.supportBox.width) + candidate.supportBox.top;
  }
  const centroid: PixelPoint = [round(sumX / Math.max(1, pixelArea)), round(sumY / Math.max(1, pixelArea))];
  const compactness = clamp01(4 * Math.PI * pixelArea / Math.max(1, perimeter * perimeter));
  const consistency = clamp01(
    (candidate.thresholdStability || 0) * 0.35 +
    candidate.changeDensity * 0.25 +
    compactness * 0.2 +
    (candidate.validCoverage || 0) * 0.2 -
    (candidate.borderContact || 0) * 0.25
  );
  const baseline = visionConfig.scoring.absoluteLowFloor / 255 * 0.5;
  const differenceStrength = clamp01((candidate.changeStrength - baseline) / Math.max(0.01, 1 - baseline));
  const criticalMinimum = Math.min(differenceStrength, registration.diagnostics.confidence, consistency);
  const fallbackConfidence = criticalMinimum * 0.6 +
    (differenceStrength * 0.4 + registration.diagnostics.confidence * 0.35 + consistency * 0.25) * 0.4;
  const confidence = round(candidate.detectionConfidence ?? fallbackConfidence);
  const box = candidate.supportBox;
  const percent = pixelBoxToPercent(box, registration.width, registration.height);
  const [oldCrop, currentCrop] = await Promise.all([
    cropRgbDataUrl(registration.alignedBeforeData, registration.width, registration.height, candidate.crop),
    cropRgbDataUrl(registration.afterData, registration.width, registration.height, candidate.crop)
  ]);
  const maskCrop = candidate.maskCrop || await candidateMaskCropDataUrl(candidate);
  const state = candidate.state || "accepted";
  return {
    id: state === "accepted" ? `R${number}` : state === "needs_review" ? `V${number}` : candidate.id,
    ...percent,
    label: candidate.semantic?.label || "Potential surface change",
    changeType: "unknown",
    confidence,
    evidence: candidate.semantic?.evidence || (state === "needs_review"
      ? "Coherent connected evidence passed hard validity gates but remains below the accepted-evidence ranking threshold."
      : state === "rejected"
        ? "The component remains visible in diagnostics after a hard validity or semantic-artifact rejection."
        : "Connected evidence passed hard validity gates and the accepted-evidence ranking threshold."),
    sourceCandidateId: candidate.id,
    pixelArea,
    areaM2: metersPerPixel && metersPerPixel > 0 ? round(pixelArea * metersPerPixel * metersPerPixel) : null,
    centroid,
    perimeter: round(perimeter),
    bbox: { x: box.left, y: box.top, width: box.width, height: box.height },
    polygon,
    state,
    reviewReason: candidate.reviewReasons?.[0] || null,
    scoreFactors: candidate.scoreFactors,
    semantic: candidate.semantic || null,
    physicalDimensions: metersPerPixel && metersPerPixel > 0
      ? { widthM: round(box.width * metersPerPixel), heightM: round(box.height * metersPerPixel) }
      : null,
    crops: { old: oldCrop, current: currentCrop, mask: maskCrop, evidence: candidate.evidenceCrop },
    proposalSource: candidate.proposalSource || "deterministic",
    deterministicScore: candidate.componentScore ?? null,
    frontierDecision: candidate.frontierDecision ?? candidate.semantic?.decision ?? null,
    frontierConfidence: candidate.frontierConfidence ?? candidate.semantic?.confidence ?? null,
    frontierScout: candidate.frontierScout,
    frontierVerification: candidate.frontierVerification,
    verificationQueuePosition: candidate.verificationQueuePosition ?? null,
    stateReason: candidate.stateReason || (state === "accepted"
      ? "Strong deterministic evidence passed the accepted threshold."
      : "Candidate remains visible for review."),
    geometryType: candidate.geometryType || "pixel_mask"
  };
}

async function candidateMaskCropDataUrl(candidate: Candidate) {
  if (!candidate.supportMask || !candidate.supportBox) return undefined;
  const cropMask = Buffer.alloc(candidate.crop.width * candidate.crop.height);
  for (let y = 0; y < candidate.supportBox.height; y += 1) {
    for (let x = 0; x < candidate.supportBox.width; x += 1) {
      if (!candidate.supportMask[y * candidate.supportBox.width + x]) continue;
      const cropX = candidate.supportBox.left - candidate.crop.left + x;
      const cropY = candidate.supportBox.top - candidate.crop.top + y;
      if (cropX >= 0 && cropY >= 0 && cropX < candidate.crop.width && cropY < candidate.crop.height) {
        cropMask[cropY * candidate.crop.width + cropX] = 255;
      }
    }
  }
  return dataUrl(await grayToPng(cropMask, candidate.crop.width, candidate.crop.height), "image/png");
}

function componentDiagnostic(candidate: Candidate, region: Region, accepted: boolean): ComponentDiagnostic {
  return {
    id: candidate.id,
    accepted: candidate.state === "accepted" || accepted,
    state: candidate.state || (accepted ? "accepted" : "rejected"),
    rejectionReasons: candidate.rejectionReasons || [],
    reviewReasons: candidate.reviewReasons || [],
    stateTransitions: candidate.stateTransitions || [],
    semantic: candidate.semantic || null,
    limitingFactor: candidate.limitingFactor || null,
    bbox: region.bbox || { x: candidate.box.left, y: candidate.box.top, width: candidate.box.width, height: candidate.box.height },
    centroid: region.centroid || [
      round(candidate.box.left + candidate.box.width / 2),
      round(candidate.box.top + candidate.box.height / 2)
    ],
    polygon: region.polygon || [],
    metrics: {
      area: candidate.componentArea || region.pixelArea || 0,
      insideMean: round(candidate.insideMean || 0),
      insideMedian: round(candidate.insideMedian || 0),
      annulusMean: round(candidate.annulusMean || 0),
      annulusMedian: round(candidate.annulusMedian || 0),
      robustZScore: round(candidate.robustZScore || 0),
      backgroundContrast: round(candidate.backgroundContrast || 0),
      edgeOnlyFraction: round(candidate.edgeOnlyFraction || 0),
      compactness: round(candidate.compactness || 0),
      density: round(candidate.changeDensity || 0),
      thresholdStability: round(candidate.thresholdStability || 0),
      localRegistrationResidual: round(candidate.localRegistrationResidual || 0),
      invalidBorderContact: round(candidate.borderContact || 0),
      structuralSupport: round(candidate.structuralSupport || 0),
      colorSupport: round(candidate.colorSupport || 0),
      removalSupport: round(candidate.removalSupport || 0),
      multiscaleSupport: round(candidate.multiscaleSupport || candidate.structuralSupport || 0),
      edgeSupport: round(candidate.edgeSupport || 0),
      detectionConfidence: round(candidate.detectionConfidence || 0),
      componentScore: round(candidate.componentScore || candidate.detectionConfidence || 0),
      requiredScore: round(candidate.requiredScore || visionConfig.components.minimumComponentScore),
      factors: candidate.scoreFactors || {}
    }
  };
}

async function cropRgbDataUrl(data: Buffer, width: number, height: number, crop: PixelBox) {
  const buffer = await sharp(data, { raw: { width, height, channels: 3 } })
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .jpeg({ quality: 88 })
    .toBuffer();
  return dataUrl(buffer, "image/jpeg");
}

async function drawPolygonOverlay(data: Buffer, width: number, height: number, regions: Region[]) {
  const shapes = regions.map((region, index) => {
    const points = (region.polygon || []).map(([x, y]) => `${x},${y}`).join(" ");
    const [x, y] = region.centroid || [0, 0];
    return `<g><polygon points="${points}" fill="#efc53e" fill-opacity=".18" stroke="#ffe27a" stroke-width="3"/><circle cx="${x}" cy="${y}" r="12" fill="#171c18" stroke="#ffe27a" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="#ffe27a" font-family="Arial" font-size="11" font-weight="700">${index + 1}</text></g>`;
  }).join("");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`);
  return sharp(data, { raw: { width, height, channels: 3 } }).composite([{ input: overlay }]).jpeg({ quality: 91 }).toBuffer();
}

async function drawReviewPolygonOverlay(data: Buffer, width: number, height: number, regions: Region[]) {
  const shapes = regions.map((region, index) => {
    const points = (region.polygon || []).map(([x, y]) => `${x},${y}`).join(" ");
    const [x, y] = region.centroid || [0, 0];
    const geometry = region.geometryType === "frontier_bbox" && region.bbox
      ? `<rect x="${region.bbox.x}" y="${region.bbox.y}" width="${region.bbox.width}" height="${region.bbox.height}" fill="none" stroke="#a5f3fc" stroke-width="4" stroke-dasharray="14 9"/>`
      : `<polygon points="${points}" fill="url(#reviewHatch)" fill-opacity=".36" stroke="#67e8f9" stroke-width="4" stroke-dasharray="10 6"/>`;
    return `<g>${geometry}<rect x="${x - 14}" y="${y - 11}" width="28" height="22" rx="2" fill="#083344" stroke="#a5f3fc" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="#ecfeff" font-family="Arial" font-size="10" font-weight="700">V${index + 1}</text></g>`;
  }).join("");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="reviewHatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" stroke="#67e8f9" stroke-width="3"/></pattern></defs>${shapes}</svg>`);
  return sharp(data, { raw: { width, height, channels: 3 } }).composite([{ input: overlay }]).jpeg({ quality: 91 }).toBuffer();
}

async function drawCombinedPolygonOverlay(
  data: Buffer,
  width: number,
  height: number,
  accepted: Region[],
  review: Region[]
) {
  const acceptedShapes = accepted.map((region, index) => {
    const points = (region.polygon || []).map(([x, y]) => `${x},${y}`).join(" ");
    const [x, y] = region.centroid || [0, 0];
    return `<g><polygon points="${points}" fill="#efc53e" fill-opacity=".2" stroke="#ffe27a" stroke-width="4"/><circle cx="${x}" cy="${y}" r="13" fill="#171c18" stroke="#ffe27a" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="#ffe27a" font-family="Arial" font-size="10" font-weight="700">A${index + 1}</text></g>`;
  }).join("");
  const reviewShapes = review.map((region, index) => {
    const points = (region.polygon || []).map(([x, y]) => `${x},${y}`).join(" ");
    const [x, y] = region.centroid || [0, 0];
    const geometry = region.geometryType === "frontier_bbox" && region.bbox
      ? `<rect x="${region.bbox.x}" y="${region.bbox.y}" width="${region.bbox.width}" height="${region.bbox.height}" fill="none" stroke="#a5f3fc" stroke-width="4" stroke-dasharray="14 9"/>`
      : `<polygon points="${points}" fill="url(#combinedReviewHatch)" fill-opacity=".34" stroke="#67e8f9" stroke-width="4" stroke-dasharray="10 6"/>`;
    return `<g>${geometry}<rect x="${x - 14}" y="${y - 11}" width="28" height="22" rx="2" fill="#083344" stroke="#a5f3fc" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="#ecfeff" font-family="Arial" font-size="10" font-weight="700">V${index + 1}</text></g>`;
  }).join("");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="combinedReviewHatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" stroke="#67e8f9" stroke-width="3"/></pattern></defs>${acceptedShapes}${reviewShapes}</svg>`);
  return sharp(data, { raw: { width, height, channels: 3 } }).composite([{ input: overlay }]).jpeg({ quality: 91 }).toBuffer();
}

async function drawRejectedPolygonOverlay(
  data: Buffer,
  width: number,
  height: number,
  components: ComponentDiagnostic[]
) {
  const shapes = components.map((component, index) => {
    const points = component.polygon.map((point) => point.join(",")).join(" ");
    const labelX = component.centroid[0];
    const labelY = component.centroid[1];
    return `<g><polygon points="${points}" fill="#d946ef" fill-opacity=".1" stroke="#f0abfc" stroke-width="3" stroke-dasharray="7 5"/>
      <circle cx="${labelX}" cy="${labelY}" r="10" fill="#581c87" stroke="#f5d0fe" stroke-width="2"/>
      <text x="${labelX}" y="${labelY + 4}" text-anchor="middle" fill="#fff" font-family="Arial" font-size="10" font-weight="700">${index + 1}</text></g>`;
  }).join("");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`);
  return sharp(data, { raw: { width, height, channels: 3 } }).composite([{ input: overlay }]).jpeg({ quality: 91 }).toBuffer();
}

async function residualHeatmapToPng(data: Uint8Array, width: number, height: number) {
  const output = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    const value = data[pixel] / 255;
    const offset = pixel * 3;
    output[offset] = Math.round(255 * Math.min(1, value * 2));
    output[offset + 1] = Math.round(255 * Math.max(0, 1 - Math.abs(value * 2 - 1)));
    output[offset + 2] = Math.round(180 * Math.max(0, 1 - value * 2));
  }
  return rgbToPng(output, width, height);
}

async function drawRegistrationKeypoints(data: Buffer, width: number, height: number, points: Array<{ x: number; y: number }>) {
  const circles = points.map((point) => `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="4" fill="#22d3ee" fill-opacity=".4" stroke="#ecfeff" stroke-width="1"/>`).join("");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g>${circles}</g></svg>`);
  return sharp(data, { raw: { width, height, channels: 3 } }).composite([{ input: overlay }]).jpeg({ quality: 89 }).toBuffer();
}

async function drawCandidateOverlay(data: Buffer, width: number, height: number, candidates: Candidate[]) {
  const shapes = candidates.map((candidate) => `<g>
    <rect x="${candidate.box.left}" y="${candidate.box.top}" width="${candidate.box.width}" height="${candidate.box.height}" fill="none" stroke="#ffdd38" stroke-width="4"/>
    <rect x="${candidate.box.left}" y="${Math.max(0, candidate.box.top - 24)}" width="42" height="24" fill="#111813"/>
    <text x="${candidate.box.left + 21}" y="${Math.max(17, candidate.box.top - 7)}" text-anchor="middle" fill="#ffdd38" font-family="Arial" font-size="15" font-weight="700">${candidate.id}</text>
  </g>`).join("");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`);
  return sharp(data, { raw: { width, height, channels: 3 } }).composite([{ input: overlay }]).jpeg({ quality: 91 }).toBuffer();
}

async function addCoordinateGrid(source: Buffer) {
  const normalized = await sharp(source).removeAlpha().toBuffer({ resolveWithObject: true });
  const { width, height } = normalized.info;
  const strokeWidth = Math.max(1, Math.round(Math.min(width, height) / 700));
  const fontSize = Math.max(10, Math.round(Math.min(width, height) / 65));
  const lines: string[] = [];
  const labels: string[] = [];
  for (let index = 1; index < 10; index += 1) {
    lines.push(`<line x1="${width * index / 10}" y1="0" x2="${width * index / 10}" y2="${height}"/>`);
    lines.push(`<line x1="0" y1="${height * index / 10}" x2="${width}" y2="${height * index / 10}"/>`);
  }
  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      labels.push(`<text x="${width * column / 10 + fontSize * 0.3}" y="${height * row / 10 + fontSize * 1.1}">${String.fromCharCode(65 + column)}${row}</text>`);
    }
  }
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g fill="none" stroke="#00ffff" stroke-width="${strokeWidth}" stroke-opacity="0.72">${lines.join("")}</g>
    <g fill="#00ffff" stroke="#081312" stroke-width="${strokeWidth}" paint-order="stroke" font-family="Arial" font-size="${fontSize}" font-weight="700">${labels.join("")}</g>
  </svg>`);
  return sharp(normalized.data).composite([{ input: overlay }]).jpeg({ quality: 88 }).toBuffer();
}

async function rgbToJpeg(data: Buffer, width: number, height: number) {
  return sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

async function grayToPng(data: Buffer, width: number, height: number) {
  return sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function rgbToPng(data: Buffer, width: number, height: number) {
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function loadImage(source: string) {
  const dataUrlMatch = source.match(/^data:image\/(?:png|jpe?g|webp|gif);base64,(.+)$/i);
  if (dataUrlMatch) return Buffer.from(dataUrlMatch[1], "base64");
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Could not load source image (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function createDebugRun(): Promise<DebugRun> {
  const configured = process.env.AI_DEBUG_OUTPUT_DIR?.trim();
  const enabled = process.env.NODE_ENV !== "production" && (Boolean(configured) || process.env.AI_DEBUG === "true");
  if (!enabled) {
    return { enabled: false, json: async () => {}, file: async () => {} };
  }
  const root = path.resolve(configured || path.join(process.cwd(), "ai-debug"));
  const directory = path.join(root, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true });
  return {
    enabled: true,
    directory,
    json: async (name, value) => {
      const destination = path.join(directory, name);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
    },
    file: async (name, value) => {
      const destination = path.join(directory, name);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, value);
    }
  };
}

function dataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function imageExtension(format?: string) {
  if (format === "jpeg") return "jpg";
  if (format === "png" || format === "webp" || format === "gif") return format;
  return "bin";
}

function safeProviderError(value: string) {
  try {
    const parsed = JSON.parse(value) as { error?: { message?: string } };
    return parsed.error?.message || "The vision service rejected the request.";
  } catch {
    return "The vision service returned an unreadable error.";
  }
}

function clampPercent(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function clampToPercentEdge(value: number, start: number) {
  return Math.min(100 - clampPercent(start), clampPercent(value));
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function multiply3x3(a: number[], b: number[]) {
  const result = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        result[row * 3 + column] += a[row * 3 + inner] * b[inner * 3 + column];
      }
    }
  }
  return result;
}

function polygonArea(points: Array<{ x: number; y: number }>) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
