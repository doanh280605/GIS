export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type Alert = {
  id: string;
  title: string;
  type: string;
  status: string;
  confidence: number;
  location: string;
  gpsLat: number;
  gpsLng: number;
  parcel: Parcel;
  department: { id: string; name: string; color: string };
  notes: { id: string; author: string; content: string; createdAt: string }[];
  images: { id: string; kind: string; imageUrl: string; capturedAt: string }[];
};

export type AiRegion = {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence?: number;
  evidence?: string;
  sourceCandidateId?: string;
  changeType?: string;
  classificationConfidence?: number;
  pixelArea?: number;
  areaM2?: number | null;
  centroid?: [number, number];
  perimeter?: number;
  bbox?: { x: number; y: number; width: number; height: number };
  polygon?: [number, number][];
  state?: "accepted" | "needs_review" | "rejected";
  reviewReason?: string | null;
  scoreFactors?: Record<string, { normalized: number; weight: number; contribution: number }>;
  semantic?: SemanticValidation | null;
  physicalDimensions?: { widthM: number; heightM: number } | null;
  crops?: { old: string; current: string; mask?: string; evidence?: string };
  proposalSource?: "deterministic" | "frontier_global" | "frontier_tile" | "deterministic_and_frontier";
  deterministicScore?: number | null;
  frontierDecision?: "physical_change" | "likely_artifact" | "uncertain" | null;
  frontierConfidence?: number | null;
  frontierScout?: FrontierDecisionSnapshot;
  frontierVerification?: FrontierDecisionSnapshot;
  verificationQueuePosition?: number | null;
  stateReason?: string;
  geometryType?: "pixel_mask" | "frontier_bbox";
};

export type FrontierDecisionSnapshot = {
  status: "not_run" | "not_found" | "not_required" | "queued" | "completed" | "failed" | "timed_out" | "skipped_call_limit";
  decision: "physical_change" | "likely_artifact" | "uncertain" | null;
  confidence: number | null;
  explanation: string | null;
  model: string | null;
  promptVersion: string;
  source: string;
  latencyMs: number | null;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
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

export type TraceRoi = { x: number; y: number; width: number; height: number };

export type RoiTrace = {
  roi: TraceRoi;
  registration: Record<string, unknown>;
  deterministicEvidence: Record<string, unknown>;
  deterministicCandidates: Array<Record<string, unknown>>;
  rawFrontierProposals: Array<Record<string, unknown>>;
  coordinateValidation: Array<Record<string, unknown>>;
  deduplication: Array<Record<string, unknown>>;
  proposalLimits: Array<Record<string, unknown>>;
  mergeAndRefinement: Array<Record<string, unknown>>;
  verificationScheduling: Array<Record<string, unknown>>;
  finalState: Array<Record<string, unknown>>;
};

export type SemanticValidation = {
  candidateId: string;
  decision: "physical_change" | "likely_artifact" | "uncertain";
  label: string;
  confidence: number;
  evidence: string;
  artifactReason: string | null;
  model: string;
};

export type AiAnalysis = {
  provider: "openai" | "mock";
  summary: string;
  evidence: string[];
  severity: "low" | "medium" | "high";
  confidence: number;
  recommendedAction: string;
  regions?: AiRegion[];
  /** Compatibility with analysis results created before multi-region support. */
  region?: AiRegion;
};

export function analysisRegions(analysis?: AiAnalysis | null): AiRegion[] {
  if (!analysis) return [];
  if (Array.isArray(analysis.regions) && analysis.regions.length) return analysis.regions;
  return analysis.region ? [analysis.region] : [];
}

export type ChangeDetectionResult = {
  state: "CHANGES_DETECTED" | "NO_DIFFERENCE_EVIDENCE" | "EVIDENCE_BELOW_THRESHOLD" |
    "COMPONENTS_REJECTED" | "REGISTRATION_UNRELIABLE" | "COMPATIBILITY_FAILURE" |
    "CANDIDATE_SATURATION" | "WIDESPREAD_CHANGE_REVIEW" | "CHANGES_NEED_REVIEW" |
    "CHANGES_DETECTED_WITH_REVIEW" | "RESOURCE_LIMIT_EXCEEDED";
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
    gridResiduals: { row: number; column: number; validPixels: number; edgeAlignmentResidual: number }[];
    localResidualIndicatesParallax: boolean;
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
    localUnreliableCells: { row: number; column: number; rawResidual: number; stableResidual: number | null; reason: string }[];
    locallyUnreliablePixelCount: number;
  };
  compatibility: {
    reliable: boolean;
    warnings: { code: string; severity: "info" | "warning" | "error"; message: string }[];
  };
  image: {
    width: number; height: number;
    oldOriginalWidth: number; oldOriginalHeight: number;
    currentOriginalWidth: number; currentOriginalHeight: number;
  };
  scale: { metersPerPixel: number | null; known: boolean; uncertain: boolean; warning: string | null };
  regions: AiRegion[];
  reviewRegions: AiRegion[];
  frontier: {
    requestedMode: "deterministic" | "frontier_baseline" | "hybrid";
    effectiveMode: "deterministic" | "frontier_baseline" | "hybrid";
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
    usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
    latencyMs: number;
    warnings: string[];
    rawProposals: Array<Record<string, unknown>>;
    mappedProposals: Array<Record<string, unknown>>;
    invalidProposals: Array<Record<string, unknown>>;
    deduplicationClusters: Array<Record<string, unknown>>;
    proposalLimitDecisions: Array<Record<string, unknown>>;
    mergeDecisions: Array<Record<string, unknown>>;
    localRefinementDecisions: Array<Record<string, unknown>>;
    candidateDecisions: Array<Record<string, unknown>>;
    verificationQueue: Array<Record<string, unknown>>;
    funnel: PipelineFunnelMetrics;
  };
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
    normalization: {
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
    thresholds: {
      estimatorState: "STABLE_BACKGROUND" | "INSUFFICIENT_STABLE_BACKGROUND";
      validPixels: number;
      noiseSamplePixels: number;
      exclusions: Record<string, number>;
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
      highSeedPixels: number;
      highSeedPercent: number;
      lowMaskPixels: number;
      globalMaskPixels: number;
    };
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
    registrationTransform: number[];
    semanticModel: string | null;
    semanticDecisions: SemanticValidation[];
    annotationVersion: string | null;
  };
};

export type ComponentDiagnostic = {
  id: string;
  accepted: boolean;
  state: "accepted" | "needs_review" | "rejected";
  rejectionReasons: string[];
  reviewReasons: string[];
  stateTransitions: { from: "candidate" | "accepted" | "needs_review" | "rejected"; to: "accepted" | "needs_review" | "rejected"; reason: string; at: string }[];
  semantic: SemanticValidation | null;
  limitingFactor: string | null;
  bbox: { x: number; y: number; width: number; height: number };
  centroid: [number, number];
  polygon: [number, number][];
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

export type Parcel = {
  id: string;
  parcelId: string;
  houseNumber: string;
  streetName: string;
  hamlet: string;
  landLotNumber: string;
  mapSheetNumber: string;
  ownerName: string;
  areaM2: number;
  landUseType: string;
  gpsLat: number;
  gpsLng: number;
  polygonGeojson: GeoJSON.Polygon;
  buildings?: { id: string; name: string; polygonGeojson: GeoJSON.Polygon }[];
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new Error(`Cannot reach backend at ${API_URL}. Make sure backend is running and restart it after env changes.`);
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadChangeDetection(form: FormData): Promise<ChangeDetectionResult> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/change-detection`, { method: "POST", body: form, cache: "no-store" });
  } catch {
    throw new Error(`Cannot reach backend at ${API_URL}. Make sure backend is running.`);
  }
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
