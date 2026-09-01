import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import {
  applyVerificationLimitForTest,
  comparePrediction,
  componentScoreForTest,
  cropRelativeToFull,
  detectChanges,
  hysteresisMasksForTest,
  normalizeImageBufferForTest,
  normalizePercentBox,
  pixelBoxToPercent,
  projectPoint,
  scaleHomography,
  scheduleVerificationCandidatesForTest,
  severeAdjacentGridCellsForTest,
  splitLargeWeakComponentForTest,
  type Candidate
} from "./change-detection.js";
import {
  createOpenAIFrontierClient,
  deduplicateFrontierProposals,
  mapNormalizedBoxToNative,
  normalizeFrontierBox,
  validateFrontierChanges,
  type FrontierClient,
  type FrontierModelChange,
  type FrontierProposal
} from "./vision/frontier.js";

test("calculates segmentation benchmark metrics", () => {
  const result = comparePrediction(
    Uint8Array.from([0, 255, 255, 0, 255]),
    Uint8Array.from([0, 255, 0, 0, 255])
  );
  assert.deepEqual(result, { precision: 0.667, recall: 1, f1: 0.8, iou: 0.667 });
});

test("coherent low-threshold evidence survives without a high-threshold seed", () => {
  const width = 32;
  const height = 32;
  const score = Buffer.alloc(width * height);
  const structural = Buffer.alloc(width * height);
  const color = Buffer.alloc(width * height);
  const valid = Buffer.alloc(width * height, 255);
  for (let y = 8; y < 24; y += 1) {
    for (let x = 8; x < 24; x += 1) {
      const pixel = y * width + x;
      score[pixel] = 110;
      structural[pixel] = 160;
      color[pixel] = 80;
    }
  }
  const masks = hysteresisMasksForTest({
    score, structuralResidual: structural, colorResidual: color, validMask: valid,
    width, height, lowThreshold: 80, highThreshold: 200
  });
  assert.equal(countMask(masks.high), 0);
  assert.ok(countMask(masks.globalMask) >= 200);
});

test("frontier boxes clamp safely and map tile coordinates to native pixels", () => {
  assert.deepEqual(normalizeFrontierBox({ x: -20, y: 990, width: 200, height: 100 }),
    { x: 0, y: 990, width: 200, height: 10 });
  assert.equal(normalizeFrontierBox({ x: 1, y: 2, width: -5, height: 4 }), null);
  assert.equal(normalizeFrontierBox({ x: "bad", y: 2, width: 5, height: 4 }), null);
  assert.deepEqual(mapNormalizedBoxToNative(
    { x: 250, y: 200, width: 500, height: 400 },
    { left: 100, top: 300, width: 800, height: 500 }
  ), { left: 300, top: 400, width: 400, height: 200 });
});

test("overlapping semantically similar tile proposals are deduplicated", () => {
  const proposals = [
    frontierProposal("first", { left: 100, top: 100, width: 80, height: 80 }, "frontier_tile", 0.8),
    frontierProposal("second", { left: 108, top: 105, width: 80, height: 80 }, "frontier_tile", 0.9)
  ];
  const result = deduplicateFrontierProposals(proposals, 0.4, 0.2);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.removedCount, 1);
  assert.deepEqual(new Set(result.proposals[0].sourceIds), new Set(["first", "second"]));
  assert.equal(result.clusters[0].reasonCode, "merged_as_duplicate");
  assert.deepEqual(new Set(result.clusters[0].proposalIds), new Set(["first", "second"]));
});

test("adjacent distinct frontier proposals remain separate", () => {
  const result = deduplicateFrontierProposals([
    frontierProposal("left", { left: 100, top: 100, width: 50, height: 50 }, "frontier_tile", 0.9),
    frontierProposal("right", { left: 152, top: 100, width: 50, height: 50 }, "frontier_tile", 0.9)
  ], 0.42, 0.2);
  assert.equal(result.proposals.length, 2);
  assert.equal(result.removedCount, 0);
});

test("Responses scout uses strict stored-off output and falls back from original to high detail", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  let calls = 0;
  const client = createOpenAIFrontierClient({
    apiKey: "test-key",
    model: "configured-model",
    timeoutMs: 1000,
    maximumRetries: 0,
    detail: "original",
    fallbackToHigh: true,
    fetchImplementation: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: "original detail unsupported" } }), { status: 400 });
      return new Response(JSON.stringify({
        id: "response-1",
        model: "configured-model",
        output: [{ content: [{ type: "output_text", text: JSON.stringify({ changes: [] }) }] }],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 }
      }), { status: 200 });
    }
  });
  const response = await client.scout({
    stage: "global_scout",
    oldImage: "data:image/png;base64,AA==",
    currentImage: "data:image/png;base64,AA==",
    imageWidth: 10,
    imageHeight: 10,
    promptVersion: "test-prompt"
  });
  assert.equal(response.changes.length, 0);
  assert.equal(bodies[0].store, false);
  assert.equal(bodies[0].max_output_tokens, 5000);
  assert.equal(((bodies[0].text as { format: { strict: boolean } }).format.strict), true);
  const firstContent = ((bodies[0].input as Array<{ content: Array<Record<string, unknown>> }>)[0].content);
  const secondContent = ((bodies[1].input as Array<{ content: Array<Record<string, unknown>> }>)[0].content);
  assert.equal(firstContent.filter((item) => item.type === "input_image").length, 2);
  assert.ok(firstContent.some((item) => item.text === "OLD REGISTERED IMAGE"));
  assert.ok(firstContent.some((item) => item.text === "CURRENT REGISTERED IMAGE"));
  assert.equal(firstContent.find((item) => item.type === "input_image")?.detail, "original");
  assert.equal(secondContent.find((item) => item.type === "input_image")?.detail, "high");
  assert.ok(response.audit.warnings.includes("DETAIL_ORIGINAL_REJECTED_FELL_BACK_TO_HIGH"));
});

test("frontier output is rejected when local structured validation fails", () => {
  assert.throws(() => validateFrontierChanges([{
    id: "bad-change",
    decision: "physical_change",
    changeType: "surface_change",
    confidence: "high",
    bbox: { x: 0, y: 0, width: 100, height: 100 },
    beforeDescription: "before",
    afterDescription: "after",
    evidence: "evidence",
    artifactRisk: "none",
    smallObject: false
  }]), /Malformed frontier scout changes/);
});

test("large weakly connected evidence splits into strong local subcomponents", () => {
  const width = 240;
  const height = 120;
  const mask = Buffer.alloc(width * height);
  const score = Buffer.alloc(width * height);
  for (const left of [10, 180]) {
    for (let y = 25; y < 75; y += 1) for (let x = left; x < left + 30; x += 1) {
      mask[y * width + x] = 255;
      score[y * width + x] = 230;
    }
  }
  for (let x = 40; x < 180; x += 1) {
    mask[50 * width + x] = 255;
    score[50 * width + x] = 90;
  }
  const components = splitLargeWeakComponentForTest({ mask, score, width, height, highThreshold: 184 });
  assert.ok(components.length >= 2);
  assert.ok(components.some((component) => component.box.left < 50 && component.area >= 800));
  assert.ok(components.some((component) => component.box.left > 150 && component.area >= 800));
});

test("mocked full-image scout recovers a deterministic miss as a review-only coarse box", async () => {
  const base = await syntheticMap(false);
  const result = await detectChanges(base, base, {
    analysisMode: "hybrid",
    frontierClient: mockFrontierClient({ globalChanges: [mockFrontierChange()] }),
    openAIModel: "mock-frontier"
  });
  assert.equal(result.regions.length, 0);
  assert.equal(result.reviewRegions.length, 1);
  assert.equal(result.reviewRegions[0].proposalSource, "frontier_global");
  assert.equal(result.reviewRegions[0].geometryType, "frontier_bbox");
  assert.equal(result.reviewRegions[0].polygon, undefined);
  assert.equal(result.frontier.frontierOnlyCount, 1);
  assert.equal(result.frontier.globalScoutCount, 1);
  assert.equal(result.reviewRegions[0].frontierScout?.status, "completed");
  assert.equal(result.reviewRegions[0].frontierVerification?.status, "completed");
  assert.equal(result.frontier.verificationCallCount, 1);
  assert.equal(result.frontier.rawProposals.length, 1);
  assert.equal(result.frontier.funnel.candidatesWithCoarseBoxesOnly, 1);
});

test("raw frontier proposals survive mapping and deduplication", async () => {
  const base = await syntheticMap(false);
  const change = mockFrontierChange();
  const result = await detectChanges(base, base, {
    analysisMode: "hybrid",
    frontierClient: mockFrontierClient({ globalChanges: [change], tileChanges: [change] }),
    openAIModel: "mock-frontier"
  });
  assert.equal(result.frontier.rawProposals.length, 2);
  assert.equal(result.frontier.mappedProposals.length, 2);
  assert.equal(result.frontier.deduplicationCount, 1);
  assert.equal(result.frontier.deduplicationClusters[0].proposalIds.length, 2);
  assert.equal(result.frontier.funnel.rawGlobalScoutProposals + result.frontier.funnel.rawTileScoutProposals, 2);
});

test("verification scheduling reserves capacity for frontier-only candidates and preserves skipped candidates", () => {
  const deterministic = testCandidate("deterministic", "deterministic", "accepted");
  const frontierOnly = testCandidate("frontier", "frontier_tile", "needs_review");
  const scheduled = scheduleVerificationCandidatesForTest([deterministic, frontierOnly], 1);
  assert.deepEqual(scheduled.map((item) => item.candidateId), ["frontier"]);
  const limited = applyVerificationLimitForTest([deterministic, frontierOnly], 1);
  assert.equal(limited.scheduled[0].id, "frontier");
  assert.equal(deterministic.state, "needs_review");
  assert.equal(deterministic.frontierVerification?.status, "skipped_call_limit");
  assert.ok(deterministic.reviewReasons?.includes("not_verified_due_to_call_limit"));
  assert.equal(limited.skipped[0].reasonCode, "not_verified_due_to_call_limit");
});

test("identical images remain empty when frontier scouts return no changes", async () => {
  const base = await syntheticMap(false);
  const result = await detectChanges(base, base, {
    analysisMode: "hybrid",
    frontierClient: mockFrontierClient({ globalChanges: [] }),
    openAIModel: "mock-frontier"
  });
  assert.equal(result.regions.length + result.reviewRegions.length, 0);
  assert.equal(result.frontier.ran, true);
});

test("missing credentials and frontier failures safely fall back to deterministic mode", async (context) => {
  const base = await syntheticMap(false);
  await context.test("missing API key", async () => {
    const oldKey = process.env.OPENAI_API_KEY;
    const oldModel = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    try {
      const result = await detectChanges(base, base, { analysisMode: "hybrid" });
      assert.equal(result.frontier.effectiveMode, "deterministic");
      assert.equal(result.frontier.fallbackReason, "OPENAI_API_KEY_MISSING");
    } finally {
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
      if (oldModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModel;
    }
  });
  for (const failure of [new Error("provider failure"), new Error("timeout"), new SyntaxError("invalid JSON")]) {
    await context.test(failure.message, async () => {
      const result = await detectChanges(base, base, {
        analysisMode: "hybrid",
        frontierClient: mockFrontierClient({ scoutError: failure }),
        openAIModel: "mock-frontier"
      });
      assert.equal(result.frontier.effectiveMode, "deterministic");
      assert.match(result.frontier.fallbackReason || "", /^FRONTIER_SCOUT_FAILED:/);
    });
  }
});

test("exact benchmark annotation contains four reviewed coarse objects", async () => {
  const annotation = JSON.parse(await readFile(
    new URL("../../fixtures/benchmarks/exact-pair.annotation.json", import.meta.url), "utf8"
  )) as { positives: Array<{ id: string; geometryQuality: string; polygon: number[][] }> };
  assert.deepEqual(annotation.positives.map((positive) => positive.id), [
    "reviewed-x3-construction-roi",
    "reviewed-x37-lower-left-roi",
    "reviewed-center-field-fountain-roi",
    "reviewed-removed-compact-structure-roi"
  ]);
  assert.equal(annotation.positives[2].geometryQuality, "roi");
  assert.equal(annotation.positives[3].geometryQuality, "roi");
});

test("derives polygons from a real pixel mask", async () => {
  const oldImage = await syntheticMap(false);
  const currentImage = await syntheticMap(true);
  const result = await detectChanges(oldImage, currentImage, { metersPerPixel: 0.3 });
  assert.equal(result.registration.reliable, true);
  assert.ok(result.regions.length > 0);
  assert.ok((result.regions[0].polygon?.length || 0) >= 3);
  assert.ok((result.regions[0].pixelArea || 0) > 0);
  assert.ok((result.regions[0].areaM2 || 0) > 0);
  const mask = Buffer.from(result.artifacts.cleanedMask.split(",")[1], "base64");
  const metadata = await sharp(mask).metadata();
  assert.equal(metadata.width, result.image.width);
  assert.equal(metadata.height, result.image.height);
});

test("hard-negative imagery produces zero accepted regions or an explicit reliability warning", async (context) => {
  const base = await syntheticMap(false);
  const negatives: Array<{ name: string; image: () => Promise<Buffer>; warningAllowed?: boolean }> = [
    { name: "identical images", image: async () => Buffer.from(base) },
    { name: "global brightness change", image: () => sharp(base).modulate({ brightness: 1.18 }).png().toBuffer() },
    { name: "gamma change", image: () => sharp(base).gamma(1.35).png().toBuffer() },
    { name: "color tint change", image: () => sharp(base).tint({ r: 150, g: 171, b: 132 }).png().toBuffer() },
    { name: "JPEG recompression", image: () => sharp(base).jpeg({ quality: 58, chromaSubsampling: "4:2:0" }).toBuffer() },
    { name: "one-pixel translation", image: () => translateImage(base, 1, 0) },
    { name: "two-pixel translation", image: () => translateImage(base, 2, 2) },
    { name: "slight rotation", image: () => sharp(base).rotate(0.65, { background: "#8d977e" }).png().toBuffer() },
    { name: "slight scale difference", image: () => sharp(base).resize(694, 510).extract({ left: 7, top: 5, width: 680, height: 500 }).png().toBuffer() },
    { name: "added map label", image: () => compositeSvg(base, `<text x="390" y="275" font-family="Arial" font-size="24" font-weight="700" fill="#f7f3df" stroke="#27352d" stroke-width="4" paint-order="stroke">MAP LABEL</text>`) },
    { name: "shadow overlay", image: () => compositeSvg(base, `<polygon points="190,80 470,110 440,350 160,320" fill="#17231c" opacity=".28"/>`) },
    { name: "seasonal vegetation tint", image: () => compositeSvg(base, `<rect width="680" height="500" fill="#769f66" opacity=".22"/>`) },
    { name: "seasonal vegetation texture", image: () => compositeSvg(base, `<defs><pattern id="season" width="19" height="17" patternUnits="userSpaceOnUse"><circle cx="4" cy="6" r="2" fill="#547d43" opacity=".22"/><circle cx="14" cy="12" r="1.5" fill="#b6a76d" opacity=".18"/></pattern></defs><rect width="680" height="500" fill="url(#season)"/>`) },
    { name: "small moving vehicles", image: () => compositeSvg(base, `<g fill="#f4eee0" stroke="#26322b" stroke-width="2"><rect x="92" y="118" width="11" height="6"/><rect x="384" y="331" width="10" height="6"/><rect x="510" y="149" width="12" height="6"/></g>`) },
    { name: "map UI controls", image: () => compositeSvg(base, `<g><rect x="600" width="80" height="500" fill="#171b19"/><rect y="468" width="600" height="32" fill="#171b19"/><rect x="616" y="28" width="48" height="48" rx="8" fill="#303733" stroke="#d8dfda"/></g>`) },
    { name: "incompatible crop and zoom", image: () => sharp(base).resize(884, 650).extract({ left: 102, top: 75, width: 680, height: 500 }).png().toBuffer(), warningAllowed: true },
    { name: "image-wide rendering change", image: () => sharp(base).negate().png().toBuffer(), warningAllowed: true }
  ];

  for (const negative of negatives) {
    await context.test(negative.name, async () => {
      const result = await detectChanges(base, await negative.image());
      if (negative.warningAllowed) {
        assert.ok(result.regions.length === 0 || !result.compatibility.reliable);
      } else {
        assert.equal(result.regions.length, 0);
      }
      assert.equal(result.reviewRegions.length, 0, `${negative.name} produced needs-review candidates: ${JSON.stringify(result.diagnostics.reviewComponents)}`);
      assert.equal(result.metrics.finalChangedPixels, result.metrics.totalChangedPixels);
      assert.notEqual(result.metrics.regionCount === 18 && !result.metrics.saturationStatus, true);
      assert.ok(result.diagnostics.rejectedComponents.every((component) =>
        component.rejectionReasons.every((reason) => /^[A-Z0-9_]+$/.test(reason))
      ));
    });
  }
});

test("localized physical changes overlap synthetic ground truth", async (context) => {
  const base = await syntheticMap(false);
  const positives = [
    {
      name: "new rectangular building",
      markup: `<rect x="270" y="190" width="74" height="54" fill="#7f3328" stroke="#efe2c6" stroke-width="4"/>`
    },
    {
      name: "irregular building addition",
      markup: `<polygon points="268,188 326,184 342,203 336,242 282,247 260,221" fill="#7f3328" stroke="#efe2c6" stroke-width="4"/>`
    },
    {
      name: "localized road expansion",
      markup: `<path d="M78 258 C145 245 218 270 292 252" fill="none" stroke="#d6cdb7" stroke-width="18"/><path d="M78 258 C145 245 218 270 292 252" fill="none" stroke="#596057" stroke-width="2"/>`
    },
    {
      name: "localized clearing",
      markup: `<polygon points="410,205 510,192 546,238 526,307 432,318 392,266" fill="#b89162" stroke="#6e553c" stroke-width="4"/>`,
      relaxedMaskOverlap: true
    }
  ];

  for (const positive of positives) {
    await context.test(positive.name, async () => {
      const current = await syntheticMapWithMarkup(positive.markup);
      const truth = await syntheticMask(positive.markup);
      await assertPositiveMask(base, current, truth, positive.relaxedMaskOverlap);
    });
  }

  await context.test("removed structure", async () => {
    const markup = `<rect x="270" y="190" width="74" height="54" fill="#7f3328" stroke="#efe2c6" stroke-width="4"/>`;
    const old = await syntheticMapWithMarkup(markup);
    const truth = await syntheticMask(markup);
    await assertPositiveMask(old, base, truth);
  });
});

test("candidate saturation is explicit and never truncates accepted or review output", async () => {
  const base = await syntheticMap(false);
  const shapes: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      shapes.push(`<rect x="${42 + column * 104}" y="${62 + row * 82}" width="58" height="48" fill="#7f3328" stroke="#efe2c6" stroke-width="3"/>`);
    }
  }
  const result = await detectChanges(base, await syntheticMapWithMarkup(`${shapes.join("")}${syntheticLandmarks()}`));
  assert.equal(result.metrics.saturationStatus, true, JSON.stringify(result.metrics));
  assert.ok(result.metrics.preTruncationCandidateCount > 18);
  assert.equal(result.metrics.preTruncationCandidateCount, result.regions.length + result.reviewRegions.length);
  assert.ok(result.compatibility.warnings.some((warning) => warning.code === "CANDIDATE_SATURATION"));
});

test("narrow coherent physical structure survives hysteresis and morphology", async () => {
  const base = await syntheticMap(false);
  const markup = `<path d="M205 285 C275 267 345 292 430 270" fill="none" stroke="#843c2f" stroke-width="8"/>`;
  const result = await detectChanges(base, await syntheticMapWithMarkup(markup));
  const regions = [...result.regions, ...result.reviewRegions];
  assert.ok(regions.length > 0);
  assert.ok(regions.some((region) => region.bbox && region.bbox.width > region.bbox.height * 3));
});

test("multiple separated physical changes remain separate", async () => {
  const base = await syntheticMap(false);
  const markup = `<rect x="245" y="175" width="72" height="52" fill="#7f3328"/><rect x="455" y="300" width="76" height="58" fill="#b89162"/>`;
  const result = await detectChanges(base, await syntheticMapWithMarkup(markup));
  assert.ok(result.regions.length + result.reviewRegions.length >= 2);
});

test("widespread physical change returns a review state without deleting valid regions", async () => {
  const base = await syntheticMap(false);
  const markup = `<path d="M55 75H260V205H55ZM380 72H625V220H380ZM70 300H290V430H70ZM390 295H630V430H390Z" fill="#9a6547" opacity=".96"/>${syntheticLandmarks()}`;
  const result = await detectChanges(base, await syntheticMapWithMarkup(markup));
  assert.equal(result.state, "WIDESPREAD_CHANGE_REVIEW", JSON.stringify({ registration: result.registration, metrics: result.metrics, warnings: result.compatibility.warnings }));
  assert.ok(result.regions.length + result.reviewRegions.length > 0);
  assert.ok(result.compatibility.warnings.some((warning) => warning.code === "WIDESPREAD_CHANGE_REVIEW"));
});

test("two adjacent severe residual cells are detected", () => {
  assert.equal(severeAdjacentGridCellsForTest([
    { row: 0, column: 0, edgeAlignmentResidual: 0.901 },
    { row: 0, column: 1, edgeAlignmentResidual: 0.821 },
    { row: 2, column: 2, edgeAlignmentResidual: 0.1 }
  ]), true);
});

test("component score is monotonic and exposes every contribution", () => {
  const baseline = {
    strength: 0.5, color: 0.5, structure: 0.5, contrast: 0.5, robustZ: 0.5,
    stability: 0.5, alignment: 0.5, edgeIntegrity: 0.5, shape: 0.5
  };
  const initial = componentScoreForTest(baseline);
  for (const factor of Object.keys(baseline) as Array<keyof typeof baseline>) {
    const improved = componentScoreForTest({ ...baseline, [factor]: 0.75 });
    assert.ok(improved.score >= initial.score, factor);
  }
  assert.equal(Object.keys(initial.factors).length, 9);
});

test("converts crop-relative percentages to the full image", () => {
  assert.deepEqual(
    cropRelativeToFull(
      { x: 20, y: 30, width: 40, height: 20 },
      { x: 25, y: 50, width: 25, height: 25 }
    ),
    { x: 30, y: 40, width: 10, height: 5 }
  );
});

test("clamps percentage boxes at every image edge", () => {
  assert.deepEqual(
    normalizePercentBox({ x: -5, y: 95, width: 120, height: 20 }),
    { x: 0, y: 95, width: 100, height: 5 }
  );
  assert.deepEqual(
    cropRelativeToFull(
      { x: 90, y: 94, width: 10, height: 6 },
      { x: 80, y: 70, width: 50, height: 80 }
    ),
    { x: 98, y: 98.2, width: 2, height: 1.7999999999999972 }
  );
});

test("maps analysis pixels to the same full-canvas percentages", () => {
  assert.deepEqual(
    pixelBoxToPercent({ left: 300, top: 400, width: 100, height: 50 }, 1000, 1000),
    { x: 30, y: 40, width: 10, height: 5 }
  );
});

test("rescales and projects a homography between analysis and full pixels", () => {
  const analysisHomography = [1, 0, 5, 0, 1, 8, 0, 0, 1];
  const full = scaleHomography(
    analysisHomography,
    { x: 0.5, y: 0.5 },
    { x: 0.25, y: 0.25 }
  );
  assert.deepEqual(projectPoint(full, 100, 200), { x: 220, y: 432 });
});

test("normalizes EXIF rotation before dimension-dependent transforms", async () => {
  const oriented = await sharp({
    create: { width: 40, height: 20, channels: 3, background: "#1d6f8a" }
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const diagnostics = await normalizeImageBufferForTest(oriented, 200);
  assert.equal(diagnostics.exifOrientation, 6);
  assert.equal(diagnostics.originalWidth, 40);
  assert.equal(diagnostics.originalHeight, 20);
  assert.equal(diagnostics.normalizedWidth, 20);
  assert.equal(diagnostics.normalizedHeight, 40);
  assert.equal(diagnostics.analysisWidth, 20);
  assert.equal(diagnostics.analysisHeight, 40);
});

test("accepted, review, and rejected masks are disjoint and metrics match exactly", async () => {
  const base = await syntheticMap(false);
  const current = await syntheticMapWithMarkup(`<rect x="270" y="190" width="74" height="54" fill="#7f3328" stroke="#efe2c6" stroke-width="4"/>`);
  const result = await detectChanges(base, current, { metersPerPixel: 0.3 });
  const [accepted, review, rejected, all] = await Promise.all([
    decodeArtifactMask(result.artifacts.acceptedMask),
    decodeArtifactMask(result.artifacts.reviewMask),
    decodeArtifactMask(result.artifacts.rejectedMask),
    decodeArtifactMask(result.artifacts.allCandidateMask)
  ]);
  for (let pixel = 0; pixel < all.data.length; pixel += 1) {
    assert.ok(Number(Boolean(accepted.data[pixel])) + Number(Boolean(review.data[pixel])) + Number(Boolean(rejected.data[pixel])) <= 1);
    assert.equal(Boolean(all.data[pixel]), Boolean(accepted.data[pixel] || review.data[pixel] || rejected.data[pixel]));
  }
  assert.equal(result.metrics.acceptedPixels, countMask(accepted.data));
  assert.equal(result.metrics.reviewPixels, countMask(review.data));
  assert.equal(result.metrics.rejectedCandidatePixels, countMask(rejected.data));
  assert.equal(result.metrics.allCandidatePixels, countMask(all.data));
  assert.equal(result.metrics.regionCount, result.regions.length);
  assert.equal(result.metrics.reviewRegionCount, result.reviewRegions.length);
  assert.ok([
    ...result.diagnostics.acceptedComponents,
    ...result.diagnostics.reviewComponents,
    ...result.diagnostics.rejectedComponents
  ].every((component) => component.metrics.colorSupport >= 0 && component.metrics.colorSupport <= 1));
  assert.ok(result.diagnostics.rejectedComponents.every((component) =>
    component.rejectionReasons.length > 0 && component.stateTransitions.every((transition) => transition.reason.length > 0)
  ));
});

test("ROI tracing reports valid overlap, threshold evidence, candidates, and final state", async () => {
  const base = await syntheticMap(false);
  const current = await syntheticMapWithMarkup(`<rect x="270" y="190" width="74" height="54" fill="#7f3328" stroke="#efe2c6" stroke-width="4"/>`);
  const result = await detectChanges(base, current, {
    metersPerPixel: 0.3,
    debugTrace: true,
    traceRoi: { x: 250, y: 170, width: 120, height: 100 }
  });
  assert.ok(result.roiTrace);
  assert.equal(result.roiTrace.registration.insideValidOverlap, true);
  assert.ok(Number(result.roiTrace.registration.validOverlapPixelCount) > 0);
  assert.ok(Number(result.roiTrace.deterministicEvidence.lowThresholdPixelCount) > 0);
  assert.ok(Number(result.roiTrace.deterministicEvidence.highThresholdPixelCount) > 0);
  assert.ok(result.roiTrace.deterministicCandidates.length > 0);
  assert.ok(result.roiTrace.finalState.length > 0);
});

test("generic grayscale compact removal survives without color-specific logic", async () => {
  const structure = `<rect x="284" y="202" width="58" height="44" fill="#686868" stroke="#d5d5d5" stroke-width="4"/><path d="M289 214H337M289 228H337" stroke="#3d3d3d" stroke-width="3"/>`;
  const old = await syntheticMapWithMarkup(structure);
  const current = await syntheticMap(false);
  const result = await detectChanges(old, current, { metersPerPixel: 0.3 });
  const target = { x: 280, y: 198, width: 66, height: 52 };
  assert.ok([...result.regions, ...result.reviewRegions].some((region) => region.bbox && boxesOverlap(region.bbox, target)));
});

test("strong deterministic evidence conflicting with frontier artifact verification stays review", async () => {
  const base = await syntheticMap(false);
  const current = await syntheticMapWithMarkup(`<rect x="270" y="190" width="74" height="54" fill="#7f3328" stroke="#efe2c6" stroke-width="4"/>`);
  const proposal: FrontierModelChange = {
    ...mockFrontierChange(),
    id: "matching-change",
    bbox: { x: 390, y: 370, width: 125, height: 125 },
    smallObject: false
  };
  const result = await detectChanges(base, current, {
    metersPerPixel: 0.3,
    analysisMode: "hybrid",
    frontierClient: mockFrontierClient({ globalChanges: [proposal], verifyDecision: "likely_artifact" }),
    openAIModel: "mock-frontier"
  });
  assert.ok(result.reviewRegions.some((region) => region.stateReason?.includes("conflicts")));
  assert.ok(result.reviewRegions.some((region) => region.frontierVerification?.status === "completed" &&
    region.frontierVerification.decision === "likely_artifact"));
});

test("pipeline funnel counts remain internally consistent", async () => {
  const base = await syntheticMap(false);
  const result = await detectChanges(base, base, {
    analysisMode: "hybrid",
    frontierClient: mockFrontierClient({ globalChanges: [mockFrontierChange()] }),
    openAIModel: "mock-frontier"
  });
  const funnel = result.frontier.funnel;
  assert.equal(funnel.rawGlobalScoutProposals + funnel.rawTileScoutProposals, result.frontier.rawProposals.length);
  assert.equal(funnel.invalidProposals, result.frontier.invalidProposals.length);
  assert.equal(funnel.proposalsRemovedByDeduplication, result.frontier.deduplicationCount);
  assert.equal(funnel.accepted + funnel.needsReview + funnel.rejected,
    result.regions.length + result.reviewRegions.length + result.diagnostics.rejectedComponents.length);
  assert.equal(funnel.candidatesWithPixelMasks + funnel.candidatesWithCoarseBoxesOnly,
    funnel.accepted + funnel.needsReview + funnel.rejected);
});

test("approximately 20 m² structures survive at multiple ground resolutions", async (context) => {
  const base = await syntheticMap(false);
  const cases = [
    { metersPerPixel: 0.25, width: 20, height: 16 },
    { metersPerPixel: 0.5, width: 10, height: 8 },
    { metersPerPixel: 1, width: 5, height: 4 }
  ];
  for (const item of cases) {
    await context.test(`${item.metersPerPixel} meters per pixel`, async () => {
      const left = 330;
      const top = 260;
      const current = await syntheticMapWithMarkup(`<rect x="${left}" y="${top}" width="${item.width}" height="${item.height}" fill="#651f18"/>`);
      const result = await detectChanges(base, current, { metersPerPixel: item.metersPerPixel });
      const candidates = [...result.regions, ...result.reviewRegions];
      assert.ok(candidates.some((region) => region.bbox && boxesOverlap(region.bbox, {
        x: left, y: top, width: item.width, height: item.height
      })), JSON.stringify({ metersPerPixel: item.metersPerPixel, metrics: result.metrics }));
      assert.equal(result.scale.known, true);
      assert.match(result.metrics.minimumAreaMethod, /m²/);
    });
  }
});

test("native-resolution tiled segmentation preserves a narrow object across a tile seam", async () => {
  const small = await syntheticMap(false);
  const base = await sharp(small).resize(1800, 1324, { fit: "fill" }).png().toBuffer();
  const expected = { x: 766, y: 760, width: 5, height: 10 };
  const current = await compositeSvgSized(base, 1800, 1324,
    `<rect x="${expected.x}" y="${expected.y}" width="${expected.width}" height="${expected.height}" fill="#651f18"/>`);
  const result = await detectChanges(base, current, { metersPerPixel: 0.75 });
  assert.equal(result.image.width, 1800);
  assert.equal(result.image.height, 1324);
  const overlapping = [...result.regions, ...result.reviewRegions]
    .filter((region) => region.bbox && boxesOverlap(region.bbox, expected));
  assert.equal(overlapping.length, 1, JSON.stringify({ state: result.state, metrics: result.metrics }));
  assert.ok((overlapping[0].bbox?.x || 0) >= 760);
});

test("semantic validation can promote, retain, or demote deterministic candidates", async (context) => {
  const base = await syntheticMap(false);
  const current = await syntheticMapWithMarkup(`<polygon points="410,205 510,192 546,238 526,307 432,318 392,266" fill="#b89162" stroke="#6e553c" stroke-width="4"/>`);
  const decisions = ["physical_change", "uncertain", "likely_artifact"] as const;
  for (const decision of decisions) {
    await context.test(decision, async () => {
      const result = await detectChanges(base, current, {
        metersPerPixel: 0.3,
        semanticValidator: async (candidates) => candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          decision,
          label: decision === "physical_change" ? "visible surface change" : "uncertain surface patch",
          confidence: 0.8,
          evidence: "The current crop differs inside the supplied mask.",
          artifactReason: decision === "likely_artifact" ? "Mocked label artifact." : null,
          model: "mock-semantic-v1"
        }))
      });
      if (decision === "physical_change") assert.ok(result.regions.length > 0);
      if (decision === "uncertain") assert.ok(result.reviewRegions.length > 0);
      if (decision === "likely_artifact") {
        assert.equal(result.regions.length + result.reviewRegions.length, 0);
        assert.ok(result.diagnostics.rejectedComponents.some((component) =>
          component.rejectionReasons.includes("SEMANTIC_LIKELY_ARTIFACT")));
      }
      assert.equal(result.audit.semanticModel, "mock-semantic-v1");
    });
  }
});

test("missing API key preserves deterministic review output", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const base = await syntheticMap(false);
    const current = await syntheticMapWithMarkup(`<polygon points="410,205 510,192 546,238 526,307 432,318 392,266" fill="#b89162"/>`);
    const result = await detectChanges(base, current, { metersPerPixel: 0.3, semanticValidation: true });
    assert.ok(result.regions.length + result.reviewRegions.length > 0);
    assert.ok(result.compatibility.warnings.some((warning) => warning.code === "SEMANTIC_VALIDATION_SKIPPED_NO_API_KEY"));
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test("response keeps compatibility aliases and complete audit data", async () => {
  const base = await syntheticMap(false);
  const result = await detectChanges(base, base);
  assert.equal(result.artifacts.cleanedMask, result.artifacts.acceptedMask);
  assert.equal(result.metrics.totalChangedPixels, result.metrics.acceptedPixels);
  assert.equal(result.metrics.finalChangedPixels, result.metrics.acceptedPixels);
  assert.equal(result.regions.length, result.metrics.regionCount);
  assert.equal(result.reviewRegions.length, result.metrics.reviewRegionCount);
  assert.equal(result.audit.inputHashes.oldSha256, result.audit.inputHashes.currentSha256);
  assert.match(result.audit.inputHashes.oldSha256, /^[a-f0-9]{64}$/);
  assert.ok(result.audit.registrationTransform.length === 9);
  assert.equal(result.scale.uncertain, true);
  assert.ok(result.diagnostics.thresholds.localThresholds.length > 0);
});

test("exact reviewed X3, X37, fountain, and compact removal surface without display truncation", async (context) => {
  const oldPath = "/Users/Doanh/Desktop/Screenshot 2026-08-25 at 21.49.29.png";
  const currentPath = "/Users/Doanh/Desktop/Screenshot 2026-08-25 at 21.49.02.png";
  try {
    await Promise.all([access(oldPath), access(currentPath)]);
  } catch {
    context.skip("Exact local screenshot pair is unavailable.");
    return;
  }
  const result = await detectChanges(await readFile(oldPath), await readFile(currentPath));
  const candidates = [...result.regions, ...result.reviewRegions];
  const x3 = { x: 628, y: 258, width: 371, height: 232 };
  const x37 = { x: 619, y: 1327, width: 133, height: 87 };
  const fountain = { x: 608, y: 440, width: 87, height: 95 };
  const removedCompactStructure = { x: 2145, y: 610, width: 95, height: 85 };
  assert.ok(candidates.some((region) => region.bbox && boxesOverlap(region.bbox, x3)), "X3 missed");
  assert.ok(candidates.some((region) => region.bbox && boxesOverlap(region.bbox, x37)), "X37 missed");
  assert.ok(candidates.some((region) => region.bbox && boxesOverlap(region.bbox, fountain)), "Fountain missed");
  assert.ok(candidates.some((region) => region.bbox && boxesOverlap(region.bbox, removedCompactStructure)), "Removed compact structure missed");
  assert.equal(result.metrics.preTruncationCandidateCount, candidates.length);
});

function boxesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
) {
  return Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)) *
    Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)) > 0;
}

async function syntheticMap(changed: boolean) {
  const addition = changed
    ? `<polygon points="268,188 326,184 342,203 336,242 282,247 260,221" fill="#7f3328" stroke="#efe2c6" stroke-width="4"/>`
    : "";
  return syntheticMapWithMarkup(addition);
}

async function syntheticMapWithMarkup(markup: string) {
  const landmarks = syntheticLandmarks();
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="500">
    <rect width="680" height="500" fill="#8d977e"/>
    <path d="M0 112L680 145M0 360L680 323M138 0L170 500M520 0L488 500" stroke="#d6cdb7" stroke-width="16"/>
    <path d="M0 112L680 145M0 360L680 323M138 0L170 500M520 0L488 500" stroke="#596057" stroke-width="2" stroke-dasharray="10 8"/>
    ${landmarks}${markup}
  </svg>`)).png().toBuffer();
}

function syntheticLandmarks() {
  const landmarks: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 11; column += 1) {
      const x = 28 + column * 58;
      const y = 26 + row * 58;
      landmarks.push(`<rect x="${x}" y="${y}" width="13" height="9" fill="#4e5546" transform="rotate(${(row * 7 + column * 11) % 28 - 14} ${x + 6} ${y + 4})"/>`);
      landmarks.push(`<circle cx="${x + 19}" cy="${y + 18}" r="${3 + (row + column) % 4}" fill="#d8cfab" stroke="#626a55" stroke-width="2"/>`);
    }
  }
  return landmarks.join("");
}

async function syntheticMask(markup: string) {
  const { data } = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="500">
    <rect width="680" height="500" fill="#000"/>${markup.replace(/fill="#[0-9a-f]+"/gi, `fill="#fff"`).replace(/stroke="#[0-9a-f]+"/gi, `stroke="#fff"`)}
  </svg>`)).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  return Buffer.from(data);
}

async function assertPositiveMask(oldImage: Buffer, currentImage: Buffer, truth: Buffer, relaxedMaskOverlap = false) {
  const result = await detectChanges(oldImage, currentImage, { metersPerPixel: 0.3 });
  assert.equal(result.registration.reliable, true);
  assert.equal(result.compatibility.reliable, true);
  assert.ok(result.regions.length + result.reviewRegions.length > 0);
  assert.ok(result.diagnostics.acceptedComponents.every((component) =>
    component.metrics.componentScore >= component.metrics.requiredScore
  ));
  assert.ok(result.diagnostics.thresholds.noiseSamplePixels > 0);
  assert.ok(result.diagnostics.thresholds.highSeedPixels > 0);
  const accepted = await decodeArtifactMask(result.artifacts.acceptedMask);
  const review = await decodeArtifactMask(result.artifacts.reviewMask);
  const prediction = Buffer.alloc(accepted.data.length);
  for (let pixel = 0; pixel < prediction.length; pixel += 1) prediction[pixel] = accepted.data[pixel] || review.data[pixel] ? 255 : 0;
  const decoded = accepted;
  assert.equal(decoded.info.width, result.image.width);
  assert.equal(decoded.info.height, result.image.height);
  const metrics = comparePrediction(prediction, truth);
  assert.ok(metrics.precision >= 0.5, `precision ${metrics.precision}`);
  assert.ok(metrics.recall >= (relaxedMaskOverlap ? 0.2 : 0.4), `recall ${metrics.recall}`);
  assert.ok(metrics.f1 >= (relaxedMaskOverlap ? 0.3 : 0.55), `F1 ${metrics.f1}`);
  assert.ok(metrics.iou >= (relaxedMaskOverlap ? 0.18 : 0.38), `IoU ${metrics.iou}`);
  assert.equal(result.metrics.allCandidatePixels >= result.metrics.acceptedPixels + result.metrics.reviewPixels, true);
  assert.equal(result.metrics.acceptedPixels, countMask(accepted.data));
  assert.equal(result.metrics.reviewPixels, countMask(review.data));
  assert.ok(prediction.some((value, index) => value > 0 && truth[index] > 0));
}

async function decodeArtifactMask(value: string) {
  return sharp(Buffer.from(value.split(",")[1], "base64"))
    .removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
}

function countMask(mask: Uint8Array) {
  let count = 0;
  for (const value of mask) if (value) count += 1;
  return count;
}

function frontierProposal(
  id: string,
  bbox: FrontierProposal["bbox"],
  source: FrontierProposal["source"],
  confidence: number
): FrontierProposal {
  return {
    id,
    decision: "physical_change",
    changeType: "new structure",
    confidence,
    bbox,
    beforeDescription: "No structure visible.",
    afterDescription: "A structure is visible.",
    evidence: "Paired imagery differs locally.",
    artifactRisk: "Low in the mock.",
    smallObject: true,
    source,
    sourceIds: [id],
    tileIds: source === "frontier_tile" ? [id] : []
  };
}

function mockFrontierChange(): FrontierModelChange {
  return {
    id: "global-missed",
    decision: "physical_change",
    changeType: "small structure",
    confidence: 0.88,
    bbox: { x: 700, y: 700, width: 120, height: 140 },
    beforeDescription: "Open ground.",
    afterDescription: "A small object is visible.",
    evidence: "The paired patch differs.",
    artifactRisk: "No obvious label or border.",
    smallObject: true
  };
}

function mockFrontierClient(input: {
  globalChanges?: FrontierModelChange[];
  tileChanges?: FrontierModelChange[];
  scoutError?: Error;
  verifyDecision?: "physical_change" | "likely_artifact" | "uncertain";
}): FrontierClient {
  return {
    async scout(request) {
      if (input.scoutError) throw input.scoutError;
      return {
        changes: request.stage === "global_scout" ? input.globalChanges || [] : input.tileChanges || [],
        audit: {
          stage: request.stage,
          requestId: `mock-${request.stage}`,
          model: "mock-frontier",
          promptVersion: request.promptVersion,
          detail: "original",
          latencyMs: 2,
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
          tileId: request.tile?.id,
          warnings: []
        }
      };
    },
    async verify(request) {
      return {
        candidateId: request.candidateId,
        decision: input.verifyDecision || "physical_change",
        changeType: "small structure",
        confidence: 0.86,
        beforeDescription: "Open ground.",
        afterDescription: "A small object is visible.",
        evidence: "Native paired crops support a physical change.",
        artifactRisk: "No obvious artifact in the mock.",
        audit: {
          stage: "candidate_verification",
          requestId: `mock-verify-${request.candidateId}`,
          model: "mock-frontier",
          promptVersion: request.promptVersion,
          detail: "original",
          latencyMs: 2,
          usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
          candidateId: request.candidateId,
          warnings: []
        }
      };
    }
  };
}

function testCandidate(
  id: string,
  proposalSource: Candidate["proposalSource"],
  state: Candidate["state"]
): Candidate {
  return {
    id,
    box: { left: 10, top: 10, width: 20, height: 20 },
    crop: { left: 6, top: 6, width: 28, height: 28 },
    changeDensity: 0.8,
    changeStrength: 0.8,
    componentArea: 300,
    componentScore: state === "accepted" ? 0.95 : 0.65,
    requiredScore: 0.82,
    proposalSource,
    geometryType: proposalSource === "deterministic" ? "pixel_mask" : "frontier_bbox",
    state
  };
}

function translateImage(source: Buffer, x: number, y: number) {
  return sharp(source).affine([[1, 0], [0, 1]], {
    idx: x,
    idy: y,
    background: "#8d977e"
  }).png().toBuffer();
}

function compositeSvg(source: Buffer, markup: string) {
  return sharp(source).composite([{
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="500">${markup}</svg>`)
  }]).png().toBuffer();
}

function compositeSvgSized(source: Buffer, width: number, height: number, markup: string) {
  return sharp(source).composite([{
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${markup}</svg>`)
  }]).png().toBuffer();
}
