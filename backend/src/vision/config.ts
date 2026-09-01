function integer(name: string, fallback: number, minimum = 0) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, Math.round(value)) : fallback;
}

function decimal(name: string, fallback: number, minimum = 0, maximum = 1) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function numeric(name: string, fallback: number, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

/** Centralized, deployment-tunable settings for deterministic segmentation. */
export const DETECTOR_VERSION = "hybrid-change-review-4.0.0";

export const visionConfig = {
  polygonSimplification: decimal("POLYGON_SIMPLIFICATION", 0.012, 0.001, 0.08),
  minimumRegistrationConfidence: decimal("MIN_REGISTRATION_CONFIDENCE", 0.5),
  maximumRegions: integer("MAX_CHANGE_REGIONS", 18, 1),

  processing: {
    registrationMaxDimension: integer("REGISTRATION_MAX_DIMENSION", 1400, 512),
    maximumNativePixels: integer("CHANGE_MAX_NATIVE_PIXELS", 24_000_000, 1_000_000),
    maximumNativeDimension: integer("CHANGE_MAX_NATIVE_DIMENSION", 10_000, 1000),
    tileSize: integer("CHANGE_TILE_SIZE", 768, 256),
    tileOverlap: integer("CHANGE_TILE_OVERLAP", 32, 8),
    maximumCandidateComponents: integer("CHANGE_MAX_CANDIDATE_COMPONENTS", 500, 20)
  },

  scale: {
    fallbackMinimumPixels: integer("COMPONENT_SCALE_UNCERTAIN_MIN_PIXELS", 512, 8),
    knownScaleSafetyMinimumPixels: integer("COMPONENT_KNOWN_SCALE_SAFETY_MIN_PIXELS", 4, 1),
    morphologyClosingMeters: numeric("CHANGE_CLOSING_RADIUS_METERS", 0.45, 0, 10),
    morphologyOpeningMeters: numeric("CHANGE_OPENING_RADIUS_METERS", 0.25, 0, 10),
    maximumMorphologyRadiusPixels: integer("CHANGE_MAX_MORPH_RADIUS_PIXELS", 4, 1),
    displacementToleranceMeters: numeric("CHANGE_DISPLACEMENT_TOLERANCE_METERS", 0.6, 0, 10),
    maximumDisplacementPixels: integer("CHANGE_MAX_DISPLACEMENT_PIXELS", 4, 0),
    cropPaddingMeters: numeric("CHANGE_CROP_PADDING_METERS", 15, 0, 1000),
    minimumCropPaddingPixels: integer("CHANGE_MIN_CROP_PADDING_PIXELS", 24, 0),
    holeFillAreaM2: numeric("CHANGE_HOLE_FILL_AREA_M2", 4, 0, 1000)
  },

  registration: {
    minimumMatches: integer("REG_MIN_MATCHES", 12, 4),
    minimumInliers: integer("REG_MIN_INLIERS", 18, 4),
    minimumInlierRatio: decimal("REG_MIN_INLIER_RATIO", 0.23),
    minimumSpatialCoverage: decimal("REG_MIN_SPATIAL_COVERAGE", 0.08),
    minimumValidOverlap: decimal("REG_MIN_VALID_OVERLAP", 0.62),
    maximumMedianReprojectionError: integer("REG_MAX_MEDIAN_REPROJECTION_ERROR", 3, 1),
    maximumP95ReprojectionError: integer("REG_MAX_P95_REPROJECTION_ERROR", 7, 1),
    maximumEdgeAlignmentResidual: decimal("REG_MAX_EDGE_RESIDUAL", 0.42),
    maximumChangeTolerantEdgeResidual: decimal("REG_MAX_CHANGE_TOLERANT_EDGE_RESIDUAL", 0.5),
    maximumLocalEdgeResidual: decimal("REG_MAX_LOCAL_EDGE_RESIDUAL", 0.62),
    minimumScaleRatio: decimal("REG_MIN_SCALE_RATIO", 0.7),
    maximumScaleRatio: decimal("REG_MAX_SCALE_RATIO", 1.45, 1, 3),
    gridColumns: integer("REG_RESIDUAL_GRID_COLUMNS", 4, 2),
    gridRows: integer("REG_RESIDUAL_GRID_ROWS", 4, 2),
    displacementTolerancePixels: integer("REG_DISPLACEMENT_TOLERANCE", 2, 0),
    eccRefinement: process.env.REG_ECC_REFINEMENT !== "false",
    minimumEccRelativeImprovement: decimal("REG_ECC_MIN_RELATIVE_IMPROVEMENT", 0.03),
    localStableEdgeGradient: integer("REG_LOCAL_STABLE_EDGE_GRADIENT", 42, 1),
    minimumStableEdgesPerCell: integer("REG_LOCAL_MIN_STABLE_EDGES", 120, 1)
  },

  normalization: {
    method: process.env.RADIOMETRIC_NORMALIZATION || "robust-rgb-median-mad",
    percentileClip: decimal("RADIOMETRIC_PERCENTILE_CLIP", 0.02, 0, 0.2),
    maximumSamples: integer("RADIOMETRIC_MAX_SAMPLES", 100000, 1000),
    gradientExclusionThreshold: integer("RADIOMETRIC_MAX_GRADIENT", 42, 1),
    provisionalChangePercentile: decimal("RADIOMETRIC_PROVISIONAL_CHANGE_PERCENTILE", 0.8, 0.5, 0.98),
    minimumScale: decimal("RADIOMETRIC_MIN_SCALE", 0.65, 0.1, 1),
    maximumScale: decimal("RADIOMETRIC_MAX_SCALE", 1.55, 1, 3)
  },

  scoring: {
    ssimRadius: integer("CHANGE_SSIM_RADIUS", 5, 1),
    displacementTolerancePixels: integer("CHANGE_DISPLACEMENT_TOLERANCE", 2, 0),
    colorWeight: decimal("CHANGE_COLOR_WEIGHT", 0.45),
    structuralWeight: decimal("CHANGE_STRUCTURAL_WEIGHT", 0.4),
    textureWeight: decimal("CHANGE_TEXTURE_WEIGHT", 0.15),
    removedStructureWeight: decimal("CHANGE_REMOVED_STRUCTURE_WEIGHT", 0.28, 0, 0.6),
    absoluteHighFloor: integer("CHANGE_HIGH_THRESHOLD_FLOOR", 24, 1),
    absoluteLowFloor: integer("CHANGE_LOW_THRESHOLD_FLOOR", 10, 1),
    absoluteHighCeiling: integer("CHANGE_HIGH_THRESHOLD_CEILING", 220, 1),
    highNoiseMadMultiplier: integer("CHANGE_HIGH_MAD_MULTIPLIER", 6, 1),
    lowNoiseMadMultiplier: integer("CHANGE_LOW_MAD_MULTIPLIER", 3, 1),
    lowToHighRatio: decimal("CHANGE_LOW_HIGH_RATIO", 0.45, 0.2, 0.95),
    noiseGradientExclusionThreshold: integer("CHANGE_NOISE_MAX_GRADIENT", 38, 1),
    noiseRegistrationResidualMaximum: integer("CHANGE_NOISE_MAX_REGISTRATION_RESIDUAL", 88, 1),
    noiseStructuralResidualMaximum: integer("CHANGE_NOISE_MAX_STRUCTURAL_RESIDUAL", 150, 1),
    noiseColorResidualMaximum: integer("CHANGE_NOISE_MAX_COLOR_RESIDUAL", 54, 1),
    minimumStableNoiseFraction: decimal("CHANGE_NOISE_MIN_STABLE_FRACTION", 0.06, 0.01, 0.5),
    minimumStableNoisePixels: integer("CHANGE_NOISE_MIN_STABLE_PIXELS", 5000, 100),
    extremeTailMadMultiplier: numeric("CHANGE_NOISE_TAIL_MAD_MULTIPLIER", 4.5, 2, 10),
    maximumHighSeedFraction: decimal("CHANGE_MAX_HIGH_SEED_FRACTION", 0.012, 0.001, 0.1),
    localThresholdColumns: integer("CHANGE_LOCAL_THRESHOLD_COLUMNS", 4, 2),
    localThresholdRows: integer("CHANGE_LOCAL_THRESHOLD_ROWS", 4, 2),
    localHighMinimumRatio: decimal("CHANGE_LOCAL_HIGH_MIN_RATIO", 1, 0.3, 1),
    localHighMaximumRatio: numeric("CHANGE_LOCAL_HIGH_MAX_RATIO", 1.35, 1, 3),
    multiscaleRadiusPixels: integer("CHANGE_MULTISCALE_RADIUS_PIXELS", 9, 2)
  },

  components: {
    annulusRadius: integer("COMPONENT_ANNULUS_RADIUS", 8, 2),
    minimumPhysicalAreaM2: numeric("COMPONENT_MIN_AREA_M2", 6, 0.1, 10000),
    minimumBackgroundContrast: decimal("COMPONENT_MIN_BACKGROUND_CONTRAST", 0.12),
    minimumRobustZScore: integer("COMPONENT_MIN_ROBUST_Z", 3, 0),
    maximumEdgeOnlyFraction: decimal("COMPONENT_MAX_EDGE_ONLY_FRACTION", 0.39),
    maximumLocalRegistrationResidual: decimal("COMPONENT_MAX_REGISTRATION_RESIDUAL", 0.46),
    hardMaximumLocalRegistrationResidual: decimal("COMPONENT_HARD_MAX_REGISTRATION_RESIDUAL", 0.72),
    minimumThresholdStability: decimal("COMPONENT_MIN_THRESHOLD_STABILITY", 0.5),
    minimumStructuralSupport: decimal("COMPONENT_MIN_STRUCTURAL_SUPPORT", 0.2),
    minimumComponentScore: decimal("MIN_COMPONENT_SCORE", 0.82),
    maximumInvalidBorderContact: decimal("COMPONENT_MAX_INVALID_BORDER_CONTACT", 0.2),
    lowOnlyMinimumPixels: integer("COMPONENT_LOW_ONLY_MIN_PIXELS", 72, 8),
    lowOnlyMinimumEvidenceChecks: integer("COMPONENT_LOW_ONLY_MIN_EVIDENCE_CHECKS", 4, 2),
    splitMinimumAreaPixels: integer("COMPONENT_SPLIT_MIN_AREA_PIXELS", 1200, 64),
    splitStrongCoreMinimumPixels: integer("COMPONENT_SPLIT_STRONG_CORE_MIN_PIXELS", 24, 4),
    splitStrongThresholdRatio: decimal("COMPONENT_SPLIT_STRONG_THRESHOLD_RATIO", 0.82, 0.5, 1)
  },

  frontier: {
    scoutPromptVersion: process.env.FRONTIER_SCOUT_PROMPT_VERSION || "frontier-scout-1.1.0",
    verificationPromptVersion: process.env.FRONTIER_VERIFY_PROMPT_VERSION || "frontier-verify-1.0.0",
    timeoutMs: integer("OPENAI_TIMEOUT_MS", 45_000, 1_000),
    maximumRetries: integer("OPENAI_MAX_RETRIES", 2, 0),
    maximumOutputTokens: integer("OPENAI_MAX_OUTPUT_TOKENS", 5_000, 256),
    concurrency: integer("OPENAI_CONCURRENCY", 2, 1),
    preferredTileSize: integer("FRONTIER_TILE_SIZE", 1024, 256),
    tileOverlapFraction: decimal("FRONTIER_TILE_OVERLAP", 0.18, 0.15, 0.2),
    maximumTiles: integer("FRONTIER_MAX_TILES", 12, 1),
    maximumCandidates: integer("FRONTIER_MAX_CANDIDATES", 24, 1),
    maximumCalls: integer("FRONTIER_MAX_CALLS", 40, 2),
    maximumPairedMegapixels: numeric("FRONTIER_MAX_PAIRED_MEGAPIXELS", 48, 1, 500),
    deduplicationIou: decimal("FRONTIER_DEDUPE_IOU", 0.42, 0.05, 0.95),
    deduplicationContainment: decimal("FRONTIER_DEDUPE_CONTAINMENT", 0.72, 0.05, 1),
    deduplicationCenterDistance: numeric("FRONTIER_DEDUPE_CENTER_DISTANCE", 0.35, 0.05, 2),
    deduplicationSizeRatio: decimal("FRONTIER_DEDUPE_SIZE_RATIO", 0.45, 0.05, 1),
    deduplicationSemanticSimilarity: decimal("FRONTIER_DEDUPE_SEMANTIC", 0.2, 0, 1),
    mergeIou: decimal("FRONTIER_MERGE_IOU", 0.12, 0.01, 0.9),
    mergeContainment: decimal("FRONTIER_MERGE_CONTAINMENT", 0.5, 0.05, 1),
    proposalPaddingPixels: integer("FRONTIER_PROPOSAL_PADDING", 24, 0),
    minimumLocalMaskPixels: integer("FRONTIER_MIN_LOCAL_MASK_PIXELS", 24, 1),
    verificationReserveFrontierOnly: integer("FRONTIER_VERIFY_RESERVE_FRONTIER_ONLY", 2, 0),
    verificationReserveSmallObject: integer("FRONTIER_VERIFY_RESERVE_SMALL_OBJECT", 1, 0),
    verificationReserveRemoval: integer("FRONTIER_VERIFY_RESERVE_REMOVAL", 1, 0),
    defaultDetail: process.env.OPENAI_IMAGE_DETAIL === "high" ? "high" : "original",
    fallbackToHigh: process.env.OPENAI_DETAIL_FALLBACK !== "false"
  },

  compatibility: {
    maximumChangedPercent: decimal("MAX_RELIABLE_CHANGED_PERCENT", 0.1),
    maximumEdgeOnlyPercent: decimal("MAX_EDGE_ONLY_PERCENT", 0.12),
    maximumRawRadiometricMedian: integer("MAX_RAW_RADIOMETRIC_MEDIAN", 58, 1),
    maximumViewportUiPercent: decimal("MAX_VIEWPORT_UI_PERCENT", 0.12),
    borderOverlayMinimumCoverage: decimal("BORDER_OVERLAY_MIN_COVERAGE", 0.35, 0.2, 0.95),
    borderOverlayMaximumThickness: decimal("BORDER_OVERLAY_MAX_THICKNESS", 0.3, 0.05, 0.45),
    borderOverlayMinimumColorResidual: integer("BORDER_OVERLAY_MIN_COLOR_RESIDUAL", 20, 1),
    borderOverlayMaximumGradient: integer("BORDER_OVERLAY_MAX_GRADIENT", 32, 1)
  }
} as const;
