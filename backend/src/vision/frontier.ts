import { z } from "zod";

export type AnalysisMode = "deterministic" | "frontier_baseline" | "hybrid";
export type ProposalSource = "deterministic" | "frontier_global" | "frontier_tile" | "deterministic_and_frontier";
export type GeometryType = "pixel_mask" | "frontier_bbox";
export type FrontierDecision = "physical_change" | "likely_artifact" | "uncertain";

export type NormalizedFrontierBox = { x: number; y: number; width: number; height: number };
export type NativeFrontierBox = { left: number; top: number; width: number; height: number };

export type FrontierModelChange = {
  id: string;
  decision: FrontierDecision;
  changeType: string;
  confidence: number;
  bbox: NormalizedFrontierBox;
  beforeDescription: string;
  afterDescription: string;
  evidence: string;
  artifactRisk: string;
  smallObject: boolean;
};

export type FrontierProposal = Omit<FrontierModelChange, "bbox"> & {
  bbox: NativeFrontierBox;
  source: "frontier_global" | "frontier_tile";
  sourceIds: string[];
  tileIds: string[];
};

export type FrontierDeduplicationOptions = {
  iou: number;
  containment: number;
  centerDistanceRatio: number;
  sizeRatio: number;
  semanticSimilarity: number;
};

export type FrontierDeduplicationCluster = {
  id: string;
  retainedProposalId: string;
  proposalIds: string[];
  sourceIds: string[];
  comparisons: Array<{
    retainedProposalId: string;
    comparedProposalId: string;
    iou: number;
    containment: number;
    centerDistanceRatio: number;
    sizeRatio: number;
    semanticSimilarity: number;
    duplicate: boolean;
    reason: string;
  }>;
  reasonCode: "merged_as_duplicate" | "unique_proposal";
  explanation: string;
};

export type FrontierUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type FrontierCallAudit = {
  stage: "global_scout" | "tile_scout" | "candidate_verification";
  requestId: string | null;
  model: string;
  promptVersion: string;
  detail: "original" | "high";
  latencyMs: number;
  usage: FrontierUsage | null;
  tileId?: string;
  candidateId?: string;
  warnings: string[];
};

export type FrontierScoutRequest = {
  stage: "global_scout" | "tile_scout";
  oldImage: string;
  currentImage: string;
  imageWidth: number;
  imageHeight: number;
  promptVersion: string;
  tile?: TileDefinition;
};

export type FrontierScoutResponse = {
  changes: FrontierModelChange[];
  audit: FrontierCallAudit;
};

export type FrontierVerificationRequest = {
  candidateId: string;
  oldCrop: string;
  currentCrop: string;
  maskOrEvidenceOverlay: string;
  bbox: NativeFrontierBox;
  source: ProposalSource;
  geometryType: GeometryType;
  deterministicMetrics: Record<string, number>;
  promptVersion: string;
};

export type FrontierVerificationResponse = {
  candidateId: string;
  decision: FrontierDecision;
  changeType: string;
  confidence: number;
  beforeDescription: string;
  afterDescription: string;
  evidence: string;
  artifactRisk: string;
  audit: FrontierCallAudit;
};

export interface FrontierClient {
  scout(request: FrontierScoutRequest): Promise<FrontierScoutResponse>;
  verify(request: FrontierVerificationRequest): Promise<FrontierVerificationResponse>;
}

export type TileDefinition = {
  id: string;
  column: number;
  row: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

type ClientConfiguration = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maximumRetries: number;
  maximumOutputTokens?: number;
  detail: "original" | "high";
  fallbackToHigh: boolean;
  fetchImplementation?: typeof fetch;
};

const SCOUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          decision: { type: "string", enum: ["physical_change", "likely_artifact", "uncertain"] },
          changeType: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          bbox: {
            type: "object",
            additionalProperties: false,
            properties: {
              x: { type: "integer", minimum: 0, maximum: 1000 },
              y: { type: "integer", minimum: 0, maximum: 1000 },
              width: { type: "integer", minimum: 1, maximum: 1000 },
              height: { type: "integer", minimum: 1, maximum: 1000 }
            },
            required: ["x", "y", "width", "height"]
          },
          beforeDescription: { type: "string" },
          afterDescription: { type: "string" },
          evidence: { type: "string" },
          artifactRisk: { type: "string" },
          smallObject: { type: "boolean" }
        },
        required: [
          "id", "decision", "changeType", "confidence", "bbox", "beforeDescription",
          "afterDescription", "evidence", "artifactRisk", "smallObject"
        ]
      }
    }
  },
  required: ["changes"]
} as const;

const VERIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidateId: { type: "string" },
    decision: { type: "string", enum: ["physical_change", "likely_artifact", "uncertain"] },
    changeType: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    beforeDescription: { type: "string" },
    afterDescription: { type: "string" },
    evidence: { type: "string" },
    artifactRisk: { type: "string" }
  },
  required: [
    "candidateId", "decision", "changeType", "confidence", "beforeDescription",
    "afterDescription", "evidence", "artifactRisk"
  ]
} as const;

const frontierBoxSchema = z.object({
  x: z.number().int().min(0).max(1000),
  y: z.number().int().min(0).max(1000),
  width: z.number().int().min(1).max(1000),
  height: z.number().int().min(1).max(1000)
}).strict();

const frontierChangeSchema = z.object({
  id: z.string().min(1).max(120),
  decision: z.enum(["physical_change", "likely_artifact", "uncertain"]),
  changeType: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
  bbox: frontierBoxSchema,
  beforeDescription: z.string().max(600),
  afterDescription: z.string().max(600),
  evidence: z.string().max(1200),
  artifactRisk: z.string().max(600),
  smallObject: z.boolean()
}).strict();

const scoutResponseSchema = z.object({
  changes: z.array(frontierChangeSchema).max(200)
}).strict();

const verificationResponseSchema = z.object({
  candidateId: z.string().min(1).max(120),
  decision: z.enum(["physical_change", "likely_artifact", "uncertain"]),
  changeType: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
  beforeDescription: z.string().max(600),
  afterDescription: z.string().max(600),
  evidence: z.string().max(1200),
  artifactRisk: z.string().max(600)
}).strict();

export function createOpenAIFrontierClient(configuration: ClientConfiguration): FrontierClient {
  const request = createStructuredRequester(configuration);
  return {
    async scout(input) {
      const tileContext = input.tile
        ? `This is paired native-resolution tile ${input.tile.id}. Native coordinates: left=${input.tile.left}, top=${input.tile.top}, width=${input.tile.width}, height=${input.tile.height}. Return boxes relative to this tile.`
        : `This is the complete registered image pair at ${input.imageWidth} by ${input.imageHeight} pixels. Return boxes relative to the complete images.`;
      const prompt = `Compare OLD and CURRENT registered satellite/map imagery. ${tileContext}

Inspect the entire image or tile systematically from top-left to bottom-right. Do not stop after the first or most obvious change. Report every independent plausible change, including multiple separate changes in one tile. Return coarse normalized bounding boxes from 0 to 1000, not exact polygons.

Look specifically for new, removed, or materially changed compact structures; construction; land clearing; roads; excavations; water features; fountains; and major surface changes. Pay attention to small structures that existed in OLD but are replaced in CURRENT by vegetation, soil, water, or open ground. Preserve separate nearby objects as separate proposals.

Distinguish physical change from map labels, attribution text, UI controls, image borders, shadows, seasonal vegetation, lighting differences, compression, registration error, and moving vehicles. Use likely_artifact only when artifact evidence is clear; otherwise use uncertain. Do not infer legality, ownership, or intent.`;
      const result = await request<unknown>({
        stage: input.stage,
        promptVersion: input.promptVersion,
        prompt,
        schemaName: "satellite_change_scout",
        schema: SCOUT_SCHEMA,
        images: [
          { label: "OLD REGISTERED IMAGE", data: input.oldImage },
          { label: "CURRENT REGISTERED IMAGE", data: input.currentImage }
        ],
        tileId: input.tile?.id
      });
      const parsed = scoutResponseSchema.safeParse(result.parsed);
      if (!parsed.success) throw new Error("Malformed frontier scout response.");
      return {
        changes: validateFrontierChanges(parsed.data.changes),
        audit: result.audit
      };
    },
    async verify(input) {
      const prompt = `Verify candidate ${input.candidateId} using the registered OLD crop, CURRENT crop, and deterministic mask/evidence overlay. The crop includes padded location context.

Candidate source: ${input.source}. Geometry: ${input.geometryType}. Native bbox: ${JSON.stringify(input.bbox)}. Deterministic metrics: ${JSON.stringify(input.deterministicMetrics)}.

Return physical_change only when the before-versus-after crop supports a real surface or object change. Return likely_artifact for labels, UI, borders, shadows, seasonal vegetation, lighting/compression differences, registration ghosts, or moving vehicles. Otherwise return uncertain. A frontier bounding box is only a semantic location hint and is not an exact polygon.`;
      const result = await request<unknown>({
        stage: "candidate_verification",
        promptVersion: input.promptVersion,
        prompt,
        schemaName: "satellite_change_verification",
        schema: VERIFICATION_SCHEMA,
        images: [
          { label: `${input.candidateId} OLD NATIVE CROP`, data: input.oldCrop },
          { label: `${input.candidateId} CURRENT NATIVE CROP`, data: input.currentCrop },
          { label: `${input.candidateId} DETERMINISTIC MASK OR EVIDENCE OVERLAY`, data: input.maskOrEvidenceOverlay }
        ],
        candidateId: input.candidateId
      });
      return validateVerification(result.parsed, input.candidateId, result.audit);
    }
  };
}

function createStructuredRequester(configuration: ClientConfiguration) {
  const fetchImplementation = configuration.fetchImplementation || fetch;
  return async function request<T>(input: {
    stage: FrontierCallAudit["stage"];
    promptVersion: string;
    prompt: string;
    schemaName: string;
    schema: object;
    images: Array<{ label: string; data: string }>;
    tileId?: string;
    candidateId?: string;
  }): Promise<{ parsed: T; audit: FrontierCallAudit }> {
    let detail = configuration.detail;
    const warnings: string[] = [];
    const started = Date.now();
    for (let detailAttempt = 0; detailAttempt < 2; detailAttempt += 1) {
      for (let attempt = 0; attempt <= configuration.maximumRetries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
        try {
          const response = await fetchImplementation("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${configuration.apiKey}`,
              "Content-Type": "application/json"
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: configuration.model,
              store: false,
              max_output_tokens: configuration.maximumOutputTokens || 5_000,
              input: [{
                role: "user",
                content: [
                  { type: "input_text", text: input.prompt },
                  ...input.images.flatMap((image) => [
                    { type: "input_text", text: image.label },
                    { type: "input_image", image_url: image.data, detail }
                  ])
                ]
              }],
              text: {
                format: {
                  type: "json_schema",
                  name: input.schemaName,
                  strict: true,
                  schema: input.schema
                }
              }
            })
          });
          const rawBody = await response.text();
          if (!response.ok) {
            if (detail === "original" && configuration.fallbackToHigh && response.status === 400 && /detail|original/i.test(rawBody)) {
              detail = "high";
              warnings.push("DETAIL_ORIGINAL_REJECTED_FELL_BACK_TO_HIGH");
              break;
            }
            if (attempt < configuration.maximumRetries && isRetryableStatus(response.status)) continue;
            throw new Error(`OpenAI Responses request failed (${response.status}): ${safeProviderMessage(rawBody)}`);
          }
          const raw = JSON.parse(rawBody) as {
            id?: string;
            model?: string;
            output_text?: string;
            output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
            usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
          };
          const refusal = raw.output?.flatMap((item) => item.content || []).find((item) => item.type === "refusal");
          if (refusal) throw new Error("OpenAI Responses request was refused.");
          const outputText = raw.output_text || raw.output?.flatMap((item) => item.content || [])
            .map((item) => item.text || "").join("\n") || "";
          if (!outputText) throw new Error("OpenAI Responses request returned no structured text.");
          const parsed = JSON.parse(outputText) as T;
          return {
            parsed,
            audit: {
              stage: input.stage,
              requestId: raw.id || null,
              model: raw.model || configuration.model,
              promptVersion: input.promptVersion,
              detail,
              latencyMs: Date.now() - started,
              usage: raw.usage ? {
                inputTokens: finiteNonnegative(raw.usage.input_tokens),
                outputTokens: finiteNonnegative(raw.usage.output_tokens),
                totalTokens: finiteNonnegative(raw.usage.total_tokens)
              } : null,
              tileId: input.tileId,
              candidateId: input.candidateId,
              warnings
            }
          };
        } catch (error) {
          if (attempt < configuration.maximumRetries && isRetryableError(error)) continue;
          throw error;
        } finally {
          clearTimeout(timer);
        }
      }
      if (detail !== "high") break;
    }
    throw new Error("OpenAI Responses request failed after bounded retries.");
  };
}

export function validateFrontierChanges(value: unknown): FrontierModelChange[] {
  const parsed = z.array(frontierChangeSchema).max(200).safeParse(value);
  if (!parsed.success) throw new Error("Malformed frontier scout changes.");
  const changes: FrontierModelChange[] = [];
  for (const change of parsed.data) {
    const decision = normalizeDecision(change.decision);
    changes.push({
      id: boundedString(change.id, `frontier-${changes.length + 1}`, 120),
      decision,
      changeType: boundedString(change.changeType, "surface_change", 120),
      confidence: clamp01(Number(change.confidence)),
      bbox: { ...change.bbox },
      beforeDescription: boundedString(change.beforeDescription, "Before state not described.", 600),
      afterDescription: boundedString(change.afterDescription, "After state not described.", 600),
      evidence: boundedString(change.evidence, "Paired imagery requires review.", 1200),
      artifactRisk: boundedString(change.artifactRisk, "Unknown artifact risk.", 600),
      smallObject: change.smallObject === true
    });
  }
  return changes;
}

export function normalizeFrontierBox(value: unknown): NormalizedFrontierBox | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const numbers = [raw.x, raw.y, raw.width, raw.height].map(Number);
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  let [x, y, width, height] = numbers;
  x = clamp(x, 0, 1000);
  y = clamp(y, 0, 1000);
  width = clamp(width, 0, 1000 - x);
  height = clamp(height, 0, 1000 - y);
  if (width < 1 || height < 1) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function mapNormalizedBoxToNative(
  bbox: NormalizedFrontierBox,
  frame: { left: number; top: number; width: number; height: number }
): NativeFrontierBox | null {
  const normalized = normalizeFrontierBox(bbox);
  if (!normalized || frame.width <= 0 || frame.height <= 0) return null;
  const left = frame.left + Math.floor(normalized.x / 1000 * frame.width);
  const top = frame.top + Math.floor(normalized.y / 1000 * frame.height);
  const right = frame.left + Math.ceil((normalized.x + normalized.width) / 1000 * frame.width);
  const bottom = frame.top + Math.ceil((normalized.y + normalized.height) / 1000 * frame.height);
  const width = Math.max(0, Math.min(frame.left + frame.width, right) - left);
  const height = Math.max(0, Math.min(frame.top + frame.height, bottom) - top);
  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

export function createAdaptiveTiles(input: {
  width: number;
  height: number;
  preferredSize: number;
  overlapFraction: number;
  maximumTiles: number;
}): TileDefinition[] {
  const maximumDimension = Math.max(input.width, input.height);
  let tileSize = clamp(Math.round(input.preferredSize), 256, maximumDimension);
  let tiles = layoutTiles(input.width, input.height, tileSize, input.overlapFraction);
  while (tiles.length > input.maximumTiles && tileSize < maximumDimension) {
    tileSize = Math.min(maximumDimension, Math.ceil(tileSize * 1.2));
    tiles = layoutTiles(input.width, input.height, tileSize, input.overlapFraction);
  }
  return tiles.slice(0, Math.max(1, input.maximumTiles));
}

function layoutTiles(width: number, height: number, size: number, overlapFraction: number) {
  const overlap = clamp(overlapFraction, 0, 0.45);
  const stride = Math.max(1, Math.round(size * (1 - overlap)));
  const xs = axisPositions(width, size, stride);
  const ys = axisPositions(height, size, stride);
  const tiles: TileDefinition[] = [];
  for (let row = 0; row < ys.length; row += 1) {
    for (let column = 0; column < xs.length; column += 1) {
      const left = xs[column];
      const top = ys[row];
      tiles.push({
        id: `tile-r${row}-c${column}`,
        row,
        column,
        left,
        top,
        width: Math.min(size, width - left),
        height: Math.min(size, height - top)
      });
    }
  }
  return tiles;
}

function axisPositions(length: number, size: number, stride: number) {
  if (length <= size) return [0];
  const positions: number[] = [];
  for (let position = 0; position < length; position += stride) {
    const bounded = Math.min(position, length - size);
    if (positions[positions.length - 1] !== bounded) positions.push(bounded);
    if (bounded + size >= length) break;
  }
  return positions;
}

export function deduplicateFrontierProposals(
  proposals: FrontierProposal[],
  optionsOrIou: FrontierDeduplicationOptions | number,
  legacySemanticThreshold?: number
) {
  const options: FrontierDeduplicationOptions = typeof optionsOrIou === "number"
    ? {
      iou: optionsOrIou,
      containment: 0.72,
      centerDistanceRatio: 0.35,
      sizeRatio: 0.45,
      semanticSimilarity: legacySemanticThreshold ?? 0.2
    }
    : optionsOrIou;
  const ranked = [...proposals].sort((first, second) => second.confidence - first.confidence);
  const kept: FrontierProposal[] = [];
  const clusters: FrontierDeduplicationCluster[] = [];
  let removedCount = 0;
  for (const proposal of ranked) {
    let matchedMetrics: ReturnType<typeof duplicateMetricsFor> | undefined;
    const existing = kept.find((candidate) => {
      const metrics = duplicateMetricsFor(candidate, proposal);
      const spatialDuplicate = metrics.iou >= options.iou || (
        metrics.containment >= options.containment &&
        metrics.centerDistanceRatio <= options.centerDistanceRatio &&
        metrics.sizeRatio >= options.sizeRatio
      );
      const duplicate = spatialDuplicate && metrics.semanticSimilarity >= options.semanticSimilarity;
      if (duplicate) matchedMetrics = metrics;
      return duplicate;
    });
    if (!existing) {
      kept.push({ ...proposal, sourceIds: [...proposal.sourceIds], tileIds: [...proposal.tileIds] });
      clusters.push({
        id: `dedupe-${clusters.length + 1}`,
        retainedProposalId: proposal.id,
        proposalIds: [proposal.id],
        sourceIds: [...proposal.sourceIds],
        comparisons: [],
        reasonCode: "unique_proposal",
        explanation: "No retained proposal met every configured spatial and semantic duplicate check."
      });
      continue;
    }
    const cluster = clusters.find((value) => value.retainedProposalId === existing.id) as FrontierDeduplicationCluster;
    const metrics = matchedMetrics as ReturnType<typeof duplicateMetricsFor>;
    cluster.proposalIds.push(proposal.id);
    cluster.sourceIds = [...new Set([...cluster.sourceIds, ...proposal.sourceIds])];
    cluster.comparisons.push({
      retainedProposalId: existing.id,
      comparedProposalId: proposal.id,
      ...metrics,
      duplicate: true,
      reason: "Spatial overlap, center distance, size ratio, and semantic checks identify the same change."
    });
    cluster.reasonCode = "merged_as_duplicate";
    cluster.explanation = "Overlapping scout detections were merged only after configurable spatial and semantic checks passed.";
    existing.sourceIds = [...new Set([...existing.sourceIds, ...proposal.sourceIds])];
    existing.tileIds = [...new Set([...existing.tileIds, ...proposal.tileIds])];
    if (proposal.source === "frontier_tile") existing.source = "frontier_tile";
    removedCount += 1;
  }
  return { proposals: kept, removedCount, clusters };
}

function duplicateMetricsFor(a: FrontierProposal, b: FrontierProposal) {
  const containment = boxContainment(a.bbox, b.bbox);
  const firstCenter = { x: a.bbox.left + a.bbox.width / 2, y: a.bbox.top + a.bbox.height / 2 };
  const secondCenter = { x: b.bbox.left + b.bbox.width / 2, y: b.bbox.top + b.bbox.height / 2 };
  const scale = Math.max(1, (Math.hypot(a.bbox.width, a.bbox.height) + Math.hypot(b.bbox.width, b.bbox.height)) / 2);
  const firstArea = a.bbox.width * a.bbox.height;
  const secondArea = b.bbox.width * b.bbox.height;
  return {
    iou: roundMetric(boxIou(a.bbox, b.bbox)),
    containment: roundMetric(containment),
    centerDistanceRatio: roundMetric(Math.hypot(firstCenter.x - secondCenter.x, firstCenter.y - secondCenter.y) / scale),
    sizeRatio: roundMetric(Math.min(firstArea, secondArea) / Math.max(1, Math.max(firstArea, secondArea))),
    semanticSimilarity: roundMetric(semanticSimilarity(a, b))
  };
}

function boxContainment(a: NativeFrontierBox, b: NativeFrontierBox) {
  const width = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return width * height / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function roundMetric(value: number) {
  return Number(value.toFixed(4));
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, values.length || 1)) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await operation(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function sumFrontierUsage(audits: FrontierCallAudit[]) {
  const withUsage = audits.filter((audit) => audit.usage);
  if (!withUsage.length) return null;
  return withUsage.reduce<FrontierUsage>((total, audit) => ({
    inputTokens: total.inputTokens + (audit.usage?.inputTokens || 0),
    outputTokens: total.outputTokens + (audit.usage?.outputTokens || 0),
    totalTokens: total.totalTokens + (audit.usage?.totalTokens || 0)
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

function validateVerification(
  value: unknown,
  candidateId: string,
  audit: FrontierCallAudit
): FrontierVerificationResponse {
  const parsed = verificationResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.candidateId !== candidateId) {
    throw new Error("Malformed frontier verification response.");
  }
  const decision = parsed.data;
  return {
    candidateId,
    decision: decision.decision,
    changeType: boundedString(decision.changeType, "surface_change", 120),
    confidence: decision.confidence,
    beforeDescription: boundedString(decision.beforeDescription, "Before state not described.", 600),
    afterDescription: boundedString(decision.afterDescription, "After state not described.", 600),
    evidence: boundedString(decision.evidence, "The paired crop is inconclusive.", 1200),
    artifactRisk: boundedString(decision.artifactRisk, "Unknown artifact risk.", 600),
    audit
  };
}

function normalizeDecision(value: unknown): FrontierDecision {
  return value === "physical_change" || value === "likely_artifact" ? value : "uncertain";
}

function boundedString(value: unknown, fallback: string, maximum: number) {
  const result = typeof value === "string" ? value.trim() : "";
  return (result || fallback).slice(0, maximum);
}

function boxIou(a: NativeFrontierBox, b: NativeFrontierBox) {
  const width = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const intersection = width * height;
  return intersection / Math.max(1, a.width * a.height + b.width * b.height - intersection);
}

function semanticSimilarity(a: FrontierProposal, b: FrontierProposal) {
  const first = semanticTokens(`${a.changeType} ${a.beforeDescription} ${a.afterDescription}`);
  const second = semanticTokens(`${b.changeType} ${b.beforeDescription} ${b.afterDescription}`);
  if (!first.size || !second.size) return a.changeType === b.changeType ? 1 : 0;
  let intersection = 0;
  for (const token of first) if (second.has(token)) intersection += 1;
  return intersection / Math.max(1, new Set([...first, ...second]).size);
}

function semanticTokens(value: string) {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /fetch|network|timeout/i.test(error.message));
}

function safeProviderMessage(value: string) {
  try {
    const parsed = JSON.parse(value) as { error?: { message?: string } };
    return (parsed.error?.message || "Provider rejected the request.").slice(0, 500);
  } catch {
    return "Provider returned an unreadable error.";
  }
}

function finiteNonnegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
