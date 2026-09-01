import sharp from "sharp";
import type { ChangeDetectionResult, PixelPoint, Region } from "./change-detection.js";

export type ChangeClass = string;

export type ReviewedObject = {
  id: string;
  changeClass: ChangeClass;
  polygon?: PixelPoint[];
  maskPath?: string;
  geometryQuality: "pixel_mask" | "polygon" | "roi";
  reviewer: string;
  annotationVersion: string;
  uncertain?: boolean;
};

export type BenchmarkPairAnnotation = {
  schemaVersion: "1.0";
  annotationVersion: string;
  id: string;
  images: {
    oldPath?: string;
    currentPath?: string;
    oldFixtureId?: string;
    currentFixtureId?: string;
  };
  capture: {
    provider: string;
    sensor: string;
    oldDate: string | null;
    currentDate: string | null;
    metersPerPixel: number | null;
    crs: string | null;
    provenance: string;
  };
  split: {
    partition: "train" | "calibration" | "evaluation";
    geographyGroup: string;
    dateGroup: string;
    providerGroup: string;
  };
  positives: ReviewedObject[];
  ignoredOrUncertain: Array<{
    id: string;
    polygon?: PixelPoint[];
    maskPath?: string;
    reason: string;
  }>;
  reviewedNegativeRegions?: Array<{ id: string; polygon: PixelPoint[] }>;
  unreviewedPolicy: "ignore";
};

export type BenchmarkMetricSet = {
  pixelPrecision: number | null;
  pixelRecall: number;
  pixelF1: number | null;
  pixelIoU: number;
  objectPrecision: number | null;
  objectRecall: number;
  missedObjectCount: number;
  falseAlarmsPerImage: number | null;
  falseAlarmsPerKm2: number | null;
  matchedObjectIds: string[];
  missedObjectIds: string[];
  predictionCountInReviewedArea: number;
  precisionStatus: "available" | "unavailable_no_reviewed_negative_regions";
};

export type BenchmarkReport = {
  schemaVersion: "1.0";
  generatedAt: string;
  annotationVersion: string;
  pairId: string;
  split: BenchmarkPairAnnotation["split"];
  evaluationCoverage: {
    unreviewedAreasIgnored: true;
    reviewedPositiveObjectCount: number;
    reviewedNegativeRegionCount: number;
    exactPixelTruthAvailable: boolean;
    reviewedPixelCount: number;
    ignoredOrUnreviewedPixelCount: number;
    precisionStatus: "available" | "unavailable_no_reviewed_negative_regions";
    warning: string | null;
  };
  acceptedOnly: BenchmarkMetricSet;
  acceptedPlusReview: BenchmarkMetricSet;
  byObjectSize: Record<string, { objectCount: number; acceptedOnlyRecall: number; acceptedPlusReviewRecall: number }>;
  byChangeClass: Record<string, { objectCount: number; acceptedOnlyRecall: number; acceptedPlusReviewRecall: number }>;
  detector: {
    version: string;
    state: string;
    acceptedCount: number;
    reviewCount: number;
    rejectedCount: number;
    acceptedPixels: number;
    reviewPixels: number;
  };
};

export async function benchmarkDetection(
  annotation: BenchmarkPairAnnotation,
  detection: ChangeDetectionResult
): Promise<BenchmarkReport> {
  validateAnnotation(annotation);
  const width = detection.image.width;
  const height = detection.image.height;
  const truthMask = Buffer.alloc(width * height);
  const evaluationMask = Buffer.alloc(width * height);
  const positiveMasks = new Map<string, Buffer>();
  for (const object of annotation.positives.filter((positive) => !positive.uncertain)) {
    const mask = object.maskPath
      ? await loadMask(object.maskPath, width, height)
      : rasterizePolygon(object.polygon || [], width, height);
    positiveMasks.set(object.id, mask);
    unionMask(truthMask, mask);
    unionMask(evaluationMask, mask);
  }
  for (const negative of annotation.reviewedNegativeRegions || []) {
    unionMask(evaluationMask, rasterizePolygon(negative.polygon, width, height));
  }
  const acceptedMask = await decodeMask(detection.artifacts.acceptedMask, width, height);
  const reviewMask = await decodeMask(detection.artifacts.reviewMask, width, height);
  const acceptedPlusReviewMask = unionCopy(acceptedMask, reviewMask);
  const acceptedOnly = metricSet({
    predictionMask: acceptedMask,
    predictionRegions: detection.regions,
    annotation,
    truthMask,
    evaluationMask,
    positiveMasks,
    width,
    height
  });
  const acceptedPlusReview = metricSet({
    predictionMask: acceptedPlusReviewMask,
    predictionRegions: [...detection.regions, ...detection.reviewRegions],
    annotation,
    truthMask,
    evaluationMask,
    positiveMasks,
    width,
    height
  });
  const byObjectSize: BenchmarkReport["byObjectSize"] = {};
  const byChangeClass: BenchmarkReport["byChangeClass"] = {};
  for (const object of annotation.positives.filter((positive) => !positive.uncertain)) {
    const mask = positiveMasks.get(object.id) as Buffer;
    const pixels = countMask(mask);
    const areaM2 = annotation.capture.metersPerPixel
      ? pixels * annotation.capture.metersPerPixel ** 2
      : null;
    const bucket = areaM2 == null ? "unknown_scale" : areaM2 < 20 ? "under_20_m2" :
      areaM2 <= 50 ? "20_to_50_m2" : areaM2 <= 200 ? "50_to_200_m2" : "over_200_m2";
    const size = byObjectSize[bucket] ||= { objectCount: 0, acceptedOnlyRecall: 0, acceptedPlusReviewRecall: 0 };
    size.objectCount += 1;
    size.acceptedOnlyRecall += acceptedOnly.matchedObjectIds.includes(object.id) ? 1 : 0;
    size.acceptedPlusReviewRecall += acceptedPlusReview.matchedObjectIds.includes(object.id) ? 1 : 0;
    const changeClass = byChangeClass[object.changeClass] ||= {
      objectCount: 0,
      acceptedOnlyRecall: 0,
      acceptedPlusReviewRecall: 0
    };
    changeClass.objectCount += 1;
    changeClass.acceptedOnlyRecall += acceptedOnly.matchedObjectIds.includes(object.id) ? 1 : 0;
    changeClass.acceptedPlusReviewRecall += acceptedPlusReview.matchedObjectIds.includes(object.id) ? 1 : 0;
  }
  for (const group of [...Object.values(byObjectSize), ...Object.values(byChangeClass)]) {
    group.acceptedOnlyRecall = round(group.acceptedOnlyRecall / Math.max(1, group.objectCount));
    group.acceptedPlusReviewRecall = round(group.acceptedPlusReviewRecall / Math.max(1, group.objectCount));
  }
  const exactPixelTruthAvailable = annotation.positives.every((positive) => positive.geometryQuality === "pixel_mask");
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    annotationVersion: annotation.annotationVersion,
    pairId: annotation.id,
    split: annotation.split,
    evaluationCoverage: {
      unreviewedAreasIgnored: true,
      reviewedPositiveObjectCount: annotation.positives.filter((positive) => !positive.uncertain).length,
      reviewedNegativeRegionCount: annotation.reviewedNegativeRegions?.length || 0,
      exactPixelTruthAvailable,
      reviewedPixelCount: countMask(evaluationMask),
      ignoredOrUnreviewedPixelCount: width * height - countMask(evaluationMask),
      precisionStatus: (annotation.reviewedNegativeRegions?.length || 0) > 0
        ? "available"
        : "unavailable_no_reviewed_negative_regions",
      warning: exactPixelTruthAvailable
        ? null
        : "Pixel metrics use reviewed polygons/ROIs, not an exact boundary mask; interpret them as provisional overlap metrics."
    },
    acceptedOnly,
    acceptedPlusReview,
    byObjectSize,
    byChangeClass,
    detector: {
      version: detection.audit.detectorVersion,
      state: detection.state,
      acceptedCount: detection.metrics.acceptedRegionCount,
      reviewCount: detection.metrics.reviewRegionCount,
      rejectedCount: detection.metrics.rejectedRegionCount,
      acceptedPixels: detection.metrics.acceptedPixels,
      reviewPixels: detection.metrics.reviewPixels
    }
  };
}

function metricSet(input: {
  predictionMask: Buffer;
  predictionRegions: Region[];
  annotation: BenchmarkPairAnnotation;
  truthMask: Buffer;
  evaluationMask: Buffer;
  positiveMasks: Map<string, Buffer>;
  width: number;
  height: number;
}): BenchmarkMetricSet {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (let pixel = 0; pixel < input.truthMask.length; pixel += 1) {
    if (!input.evaluationMask[pixel]) continue;
    const predicted = input.predictionMask[pixel] > 0;
    const expected = input.truthMask[pixel] > 0;
    if (predicted && expected) truePositive += 1;
    else if (predicted) falsePositive += 1;
    else if (expected) falseNegative += 1;
  }
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  const matched = new Set<string>();
  const predictionMatched = new Set<number>();
  for (const [id, truth] of input.positiveMasks) {
    let bestIndex = -1;
    let bestOverlap = 0;
    for (let index = 0; index < input.predictionRegions.length; index += 1) {
      if (predictionMatched.has(index)) continue;
      const regionMask = rasterizeRegion(input.predictionRegions[index], input.width, input.height);
      const overlap = intersectionCount(regionMask, truth) / Math.max(1, countMask(truth));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && bestOverlap >= 0.01) {
      matched.add(id);
      predictionMatched.add(bestIndex);
    }
  }
  const predictionsInReviewedArea = input.predictionRegions.filter((region) => {
    const mask = rasterizeRegion(region, input.width, input.height);
    return intersectionCount(mask, input.evaluationMask) > 0;
  });
  const falseAlarms = Math.max(0, predictionsInReviewedArea.length - predictionMatched.size);
  const reviewedKm2 = input.annotation.capture.metersPerPixel
    ? countMask(input.evaluationMask) * input.annotation.capture.metersPerPixel ** 2 / 1_000_000
    : null;
  const positiveIds = [...input.positiveMasks.keys()];
  const precisionAvailable = (input.annotation.reviewedNegativeRegions?.length || 0) > 0;
  return {
    pixelPrecision: precisionAvailable ? round(precision) : null,
    pixelRecall: round(recall),
    pixelF1: precisionAvailable ? round(2 * precision * recall / Math.max(Number.EPSILON, precision + recall)) : null,
    pixelIoU: round(truePositive / Math.max(1, truePositive + falsePositive + falseNegative)),
    objectPrecision: precisionAvailable ? round(matched.size / Math.max(1, matched.size + falseAlarms)) : null,
    objectRecall: round(matched.size / Math.max(1, positiveIds.length)),
    missedObjectCount: Math.max(0, positiveIds.length - matched.size),
    falseAlarmsPerImage: precisionAvailable ? falseAlarms : null,
    falseAlarmsPerKm2: precisionAvailable && reviewedKm2 && reviewedKm2 > 0
      ? round(falseAlarms / reviewedKm2)
      : null,
    matchedObjectIds: [...matched],
    missedObjectIds: positiveIds.filter((id) => !matched.has(id)),
    predictionCountInReviewedArea: predictionsInReviewedArea.length,
    precisionStatus: precisionAvailable ? "available" : "unavailable_no_reviewed_negative_regions"
  };
}

function validateAnnotation(annotation: BenchmarkPairAnnotation) {
  if (annotation.schemaVersion !== "1.0") throw new Error(`Unsupported annotation schema ${annotation.schemaVersion}.`);
  if (annotation.unreviewedPolicy !== "ignore") throw new Error("Unreviewed imagery must be ignored until annotated.");
  if (!annotation.split.geographyGroup || !annotation.split.dateGroup || !annotation.split.providerGroup) {
    throw new Error("Geography, date, and provider split groups are required to prevent leakage.");
  }
}

async function decodeMask(dataUrl: string, width: number, height: number) {
  const encoded = dataUrl.split(",")[1] || "";
  const result = await sharp(Buffer.from(encoded, "base64")).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  if (result.info.width !== width || result.info.height !== height) throw new Error("Detection mask dimensions do not match the registered canvas.");
  const mask = Buffer.from(result.data);
  for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = mask[pixel] ? 255 : 0;
  return mask;
}

async function loadMask(path: string, width: number, height: number) {
  const result = await sharp(path).resize(width, height, { fit: "fill", kernel: "nearest" }).removeAlpha().greyscale().threshold(1).raw().toBuffer();
  return Buffer.from(result);
}

function rasterizeRegion(region: Region, width: number, height: number) {
  if (region.polygon?.length) return rasterizePolygon(region.polygon, width, height);
  if (!region.bbox) return Buffer.alloc(width * height);
  return rasterizePolygon([
    [region.bbox.x, region.bbox.y],
    [region.bbox.x + region.bbox.width, region.bbox.y],
    [region.bbox.x + region.bbox.width, region.bbox.y + region.bbox.height],
    [region.bbox.x, region.bbox.y + region.bbox.height]
  ], width, height);
}

function rasterizePolygon(points: PixelPoint[], width: number, height: number) {
  const mask = Buffer.alloc(width * height);
  if (points.length < 3) return mask;
  const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point[0]))));
  const right = Math.min(width - 1, Math.ceil(Math.max(...points.map((point) => point[0]))));
  const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(...points.map((point) => point[1]))));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, points)) mask[y * width + x] = 255;
    }
  }
  return mask;
}

function pointInPolygon(x: number, y: number, polygon: PixelPoint[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    const denominator = previousY - currentY || Number.EPSILON;
    const intersects = (currentY > y) !== (previousY > y) &&
      x < (previousX - currentX) * (y - currentY) / denominator + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
}

function unionMask(target: Buffer, source: Uint8Array) {
  for (let pixel = 0; pixel < target.length; pixel += 1) if (source[pixel]) target[pixel] = 255;
}

function unionCopy(first: Uint8Array, second: Uint8Array) {
  const output = Buffer.alloc(first.length);
  for (let pixel = 0; pixel < output.length; pixel += 1) output[pixel] = first[pixel] || second[pixel] ? 255 : 0;
  return output;
}

function intersectionCount(first: Uint8Array, second: Uint8Array) {
  let count = 0;
  for (let pixel = 0; pixel < first.length; pixel += 1) if (first[pixel] && second[pixel]) count += 1;
  return count;
}

function countMask(mask: Uint8Array) {
  let count = 0;
  for (const value of mask) if (value) count += 1;
  return count;
}

function round(value: number) {
  return Number(value.toFixed(3));
}
