import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { detectChanges } from "../backend/src/change-detection.js";
import { benchmarkDetection, type BenchmarkPairAnnotation } from "../backend/src/change-benchmark.js";

const oldPath = process.argv[2] || "/Users/Doanh/Desktop/Screenshot 2026-08-25 at 21.49.29.png";
const currentPath = process.argv[3] || "/Users/Doanh/Desktop/Screenshot 2026-08-25 at 21.49.02.png";

async function main() {
  const liveFrontier = process.env.RUN_LIVE_FRONTIER === "true";
  const result = await detectChanges(await readFile(oldPath), await readFile(currentPath), {
    analysisMode: liveFrontier ? "hybrid" : "deterministic",
    annotationVersion: "exact-pair-reviewed-rois-v3"
  });
  const annotation = JSON.parse(await readFile(
    new URL("./benchmarks/exact-pair.annotation.json", import.meta.url), "utf8"
  )) as BenchmarkPairAnnotation;
  const benchmark = await benchmarkDetection(annotation, result);
  const candidates = [...result.regions, ...result.reviewRegions];
  const reviewed = {
    x3: { left: 628, top: 258, right: 999, bottom: 490 },
    x37: { left: 619, top: 1327, right: 752, bottom: 1414 },
    fountain: { left: 608, top: 440, right: 695, bottom: 535 },
    removedCompactStructure: { left: 2145, top: 610, right: 2240, bottom: 695 }
  };
  const overlaps = (expected: typeof reviewed.x3) => candidates.some((region) => {
    const box = region.bbox;
    if (!box) return false;
    const overlapWidth = Math.max(0, Math.min(box.x + box.width, expected.right) - Math.max(box.x, expected.left));
    const overlapHeight = Math.max(0, Math.min(box.y + box.height, expected.bottom) - Math.max(box.y, expected.top));
    return overlapWidth * overlapHeight > 0;
  });
  const stateFor = (expected: typeof reviewed.x3) => candidates.find((region) => {
    const box = region.bbox;
    if (!box) return false;
    return Math.max(0, Math.min(box.x + box.width, expected.right) - Math.max(box.x, expected.left)) *
      Math.max(0, Math.min(box.y + box.height, expected.bottom) - Math.max(box.y, expected.top)) > 0;
  })?.state || "missed";

  assert.equal(result.image.width, 2330);
  assert.equal(result.image.height, 1674);
  assert.ok(candidates.length > 0, "Exact pair returned zero accepted/review regions.");
  assert.ok(overlaps(reviewed.x3), "No accepted/review component overlaps reviewed X3.");
  assert.ok(overlaps(reviewed.x37), "No accepted/review component overlaps reviewed X37.");
  assert.ok(overlaps(reviewed.fountain), "No accepted/review component overlaps reviewed fountain.");
  assert.ok(overlaps(reviewed.removedCompactStructure), "No accepted/review component overlaps reviewed removed compact structure.");
  assert.equal(benchmark.acceptedPlusReview.objectRecall, 1, "Accepted-plus-review object recall must be 4/4.");
  assert.equal(result.metrics.preTruncationCandidateCount, candidates.length, "A display cap silently removed candidates.");

  console.log(JSON.stringify({
    state: result.state,
    objects: {
      x3: stateFor(reviewed.x3),
      x37: stateFor(reviewed.x37),
      fountain: stateFor(reviewed.fountain),
      removedCompactStructure: stateFor(reviewed.removedCompactStructure)
    },
    acceptedOnlyObjectRecall: benchmark.acceptedOnly.objectRecall,
    acceptedPlusReviewObjectRecall: benchmark.acceptedPlusReview.objectRecall,
    pixelRecall: benchmark.acceptedPlusReview.pixelRecall,
    precisionStatus: benchmark.acceptedPlusReview.precisionStatus,
    ignoredOrUnreviewedPixelCount: benchmark.evaluationCoverage.ignoredOrUnreviewedPixelCount,
    frontier: result.frontier,
    counts: {
      accepted: result.metrics.acceptedRegionCount,
      review: result.metrics.reviewRegionCount,
      rejected: result.metrics.rejectedRegionCount
    }
  }, null, 2));
}

void main();
