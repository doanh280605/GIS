import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { benchmarkDetection, type BenchmarkPairAnnotation } from "../backend/src/change-benchmark.js";
import { detectChanges } from "../backend/src/change-detection.js";

const annotationPath = process.argv[2] || path.resolve("fixtures/benchmarks/exact-pair.annotation.json");
const reportPath = process.argv[3] || "/private/tmp/gis-exact-pair-benchmark.json";

async function main() {
  const annotation = JSON.parse(await readFile(annotationPath, "utf8")) as BenchmarkPairAnnotation;
  const oldPath = process.env.EXACT_OLD_IMAGE || annotation.images.oldPath;
  const currentPath = process.env.EXACT_CURRENT_IMAGE || annotation.images.currentPath;
  if (!oldPath || !currentPath) throw new Error("Benchmark image paths or fixture resolvers are required.");
  const detection = await detectChanges(await readFile(oldPath), await readFile(currentPath), {
    metersPerPixel: annotation.capture.metersPerPixel || undefined,
    annotationVersion: annotation.annotationVersion
  });
  const report = await benchmarkDetection(annotation, detection);
  assert.deepEqual(
    report.acceptedPlusReview.matchedObjectIds.sort(),
    annotation.positives.map((positive) => positive.id).sort(),
    "Every reviewed positive must overlap accepted or needs-review output."
  );
  assert.equal(report.acceptedPlusReview.missedObjectCount, 0);
  assert.equal(
    report.acceptedPlusReview.falseAlarmsPerImage,
    annotation.reviewedNegativeAreas?.length ? report.acceptedPlusReview.falseAlarms : null,
    "False alarms per image must remain unavailable without reviewed negative areas."
  );
  assert.equal(detection.metrics.preTruncationCandidateCount,
    detection.regions.length + detection.reviewRegions.length,
    "No accepted or review candidate may be removed by a display cap."
  );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, report }, null, 2));
}

void main();
