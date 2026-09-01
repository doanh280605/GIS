# Change-detection false negatives, hybrid review, and implementation safeguards

## Root cause

The exact screenshot pair produced a valid connected component around the lower-left clearing/construction area, but the binary accepted/rejected design removed it from every user-facing result. The old candidate was X37 at analysis bbox `x=372, y=797, width=80, height=52`, area `2,726` pixels, evidence score `0.618`, color support `0.772`, structural support `0.506`, local registration residual `0.073`, and edge-only fraction `0.062`. Its only rejection was `COMPONENT_SCORE_LOW` against `0.82`.

The score cutoff duplicated earlier evidence checks and treated a ranking score as a hard validity decision. A separate OpenAI path only received already accepted components, so it could not recover X37. The previous `MAX_CHANGE_REGIONS` behavior could also hide otherwise valid components from clients.

Threshold estimation had a second problem. Stable-background median/MAD estimated a raw high threshold of `16`, but a static high floor forced `190`. The floor controlled the result almost completely and obscured whether the threshold was data-derived. Missing ground resolution also silently created a `563`-analysis-pixel minimum based on image area rather than physical size.

## Implemented correction

The detector now has three states:

- `accepted`: hard-valid coherent evidence strong enough for primary display.
- `needs_review`: hard-valid coherent evidence below the accepted ranking threshold, or semantically uncertain evidence.
- `rejected`: physical/scale area failure, invalid geometry/overlap/viewport, known UI or text artifact, incoherent support, extreme local registration failure, pair incompatibility, or visible semantic-artifact decision.

`MIN_COMPONENT_SCORE` only assigns accepted versus review. It is not a rejection gate and is not described as a probability. The large-component score discontinuity was removed. Every accepted and review candidate is returned; `MAX_CHANGE_REGIONS` now raises a workload warning without truncation.

X37 is now a native-canvas `needs_review` candidate. The previously reviewed X3 construction ROI also remains in accepted-plus-review output. Neither relies on hardcoded production coordinates.

## Native coarse-to-fine processing

Registration still uses a bounded downscaled pyramid. The homography is then scaled from analysis coordinates to the full native old-image canvas. The current native image and valid mask are warped with that transform. Radiometric normalization and final multiscale color/structure/edge evidence run at native resolution in overlapping tiles. Only tile interiors are stitched, and connected components run once on the stitched mask, preventing seams and duplicate objects.

Resource limits remain explicit: maximum native pixels, maximum dimension, tile size, overlap, and candidate-component count are configurable. Oversized inputs return `RESOURCE_LIMIT_EXCEEDED` with compatibility and audit data instead of attempting unsafe processing.

## Scale handling

`metersPerPixel` flows from the comparison UI through the API and detector. When known, physical minimum area, morphology, displacement tolerance, hole filling, crop padding, reported area, and object dimensions use physical units. Tests cover approximately `20 m²` structures at `0.25`, `0.5`, and `1.0` meter per pixel.

When scale is missing, the response includes `GROUND_RESOLUTION_MISSING`, disables physical claims, uses an explicit conservative native-pixel fallback, and marks the result scale-uncertain. Screenshot pixels are never converted to geographic coordinates.

## Thresholding and false-positive controls

Stable-background median/MAD remains the noise estimator. High-gradient, invalid/UI, registration-residual, provisional-change, structural-change, color-change, and extreme-tail pixels are excluded and counted. A data-derived quantile guard bounds the strong-seed fraction. Local grid estimates can raise thresholds in noisy cells but do not lower the global high threshold by default.

Multiscale structure preserves both small objects and larger clearings. Hysteresis no longer deletes every component without a high-threshold seed. A coherent low-only component can survive as `needs_review` when generic area, structure, color, local contrast, multiscale, and shape checks support it. Scale-aware closing/opening and hole filling occur before connected components. Generic hard-negative gates remain for dense line-like text, edge-only displacement, missing coherent support, invalid borders, and incompatible pairs.

## Hybrid frontier analysis

The hybrid detector sends the complete registered OLD and CURRENT images to an independent frontier scout. It also sends matching native-resolution tiles with overlap. This happens independently of deterministic candidate acceptance, so the frontier scout can propose an area the pixel pipeline missed.

The frontier model returns coarse normalized boxes and semantic descriptions, not final polygons. Repository-owned deterministic logic creates probability maps, low/high masks, connected components, refined pixel masks, and final polygons. A frontier proposal with no reliable local mask remains a dashed coarse `needs_review` box. The model must never be trusted as an exact segmentation engine.

After proposal merging and local refinement, crop verification receives native registered-before and current crops, mask or evidence overlay, source, stable candidate ID, and deterministic diagnostics. Structured output records `physical_change`, `likely_artifact`, or `uncertain`, a cautious label, confidence, before-versus-after evidence, and artifact reason.

AI cannot override hard-invalid geometry. `uncertain` stays `needs_review`. `likely_artifact` remains visible in rejected diagnostics and audit transitions. Missing API credentials preserve deterministic review output.

## Newly observed blue-roof false negative

The current live hybrid result still missed a visually distinct blue-roof structure that is visible in OLD and absent or materially changed in CURRENT. A human can see the removal clearly, but no accepted or review mark appeared over it. Treat this as a real recall failure, even though most other marked regions look reasonable.

Do not assume the frontier model found every change merely because it received the complete images and tiles. Sending imagery to the model does not guarantee a proposal. A proposal can also disappear during coordinate mapping, confidence/candidate limits, semantic deduplication, artifact filtering, deterministic refinement, rejection, or verification scheduling.

Do not fix this with blue-color rules, roof-specific thresholds, or hardcoded coordinates. The production fix must generalize to any small structure that appears, disappears, or changes into background.

### Required trace before changing thresholds

For any missed area, first capture its native-image ROI and produce a stage-by-stage trace containing:

1. Valid-overlap coverage inside the ROI.
2. Probability-score statistics and low/high-mask pixel counts.
3. Structural, color, edge, and local-registration evidence.
4. Every overlapping deterministic accepted, review, and rejected component, including rejection reasons.
5. Raw global and tile frontier proposals before coordinate mapping and deduplication.
6. Mapped proposals after validation and clamping.
7. Deduplication matches and the exact proposal retained or removed.
8. Proposal-limit rank and exclusion reason.
9. Merge/refinement result and geometry type.
10. Verification priority, whether it was called, and the final decision.

The trace is diagnostic tooling only. User-supplied ROI coordinates must never become production detection rules.

### Implemented audit and recall corrections

| Improvement | Plain-English meaning |
|---|---|
| Click-to-inspect ROI tracing | A reviewer can draw a box on either registered image and inspect every processing stage. |
| Preserve raw proposals in audit data | Keep a record of everything the frontier scout suggested, including proposals later removed. |
| Record every removal reason | Never make a proposal disappear without saying whether deduplication, limits, artifact filtering, invalid overlap, or another rule removed it. |
| Prioritize frontier-only and small-object verification | Spend limited model calls on uncertain or newly discovered objects before rechecking obvious high-scoring deterministic changes. |
| Reserve verification capacity by source | Guarantee some verification slots for global proposals, tile proposals, matched proposals, and deterministic-only candidates instead of letting one group consume the entire budget. |
| Preserve plausible unverified proposals | If the call budget is exhausted, keep the proposal as a dashed review box instead of hiding it. |
| Improve generic disappearance evidence | Detect when a coherent object exists in OLD but becomes background in CURRENT, regardless of its color or object type. |
| Make deduplication conservative | Merge only proposals that clearly describe the same place and change; nearby separate structures must remain separate. |
| Recheck `likely_artifact` proposals with strong pixel evidence | A scout-level artifact guess should not erase a proposal when local structural or color evidence supports a physical change. |
| Report pre- and post-merge counts separately | Make it clear why 59 deterministic candidates can become 71 displayed hybrid candidates. |
| Normalize displayed metrics | Do not show confusing values such as `161% color support`; label raw values correctly or clamp normalized percentages. |
| Improve prompts only after tracing | Prompt changes help only when the scout truly missed the object. They do not fix deterministic rejection, deduplication, or scheduling bugs. |

### Verification scheduling mistake

The live result used 31 frontier calls: approximately seven scouting calls and 24 crop-verification calls. Verification processed strong deterministic candidates first. Most frontier-only candidates appeared late in the review list and were never verified. This wastes limited verification capacity on objects the deterministic pipeline already considered strong.

Future scheduling should rank or reserve capacity for:

1. Frontier-only proposals.
2. Unmatched small-object proposals.
3. Removed-object proposals.
4. Deterministic review candidates matched by frontier.
5. Strong deterministic accepted candidates.

Candidates that exceed the bounded call limit must remain visible with an explicit `not_verified_due_to_call_limit` reason.

## Benchmark and audit

`fixtures/benchmarks/exact-pair.annotation.json` is the versioned annotation example. It contains reviewed coarse positive ROIs for X3, X37, the center-field fountain, and the separate removed compact structure at native ROI `x=2145, y=610, width=95, height=85`. These ROIs are not exact pixel masks, and the coordinates are benchmark/diagnostic data only. All other imagery is ignored until reviewed; no labels were invented. Split metadata separates geography, date, provider, and train/calibration/evaluation partition.

`fixtures/run-change-benchmark.ts` writes a machine-readable report containing pixel recall, object recall, missed objects, size and class breakdowns, accepted-only metrics, accepted-plus-review metrics, reviewed-area coverage, and ignored area. Precision is reported only when reviewed-negative regions exist.

Each API result records input SHA-256 hashes, processing timestamp, detector/config version, thresholds and clamps, native transform, dimensions and scale, candidate transitions, semantic model/decision, warnings, and optional annotation version. Debug image output remains disabled in production and opt-in elsewhere.

## Current exact-pair result and limits

The original removed-structure miss occurred before candidate generation: automatic viewport masking ended near native `x=2169`, leaving most of the reviewed ROI outside valid deterministic evidence. The old run did not preserve raw frontier proposals, so whether its global or tile scout saw the object cannot be reconstructed. The corrected pipeline keeps the native overlap, excludes only detected low-texture border overlay bands, and adds generic directional edge/texture-loss evidence. The object now creates a deterministic pixel component and remains visible as `needs_review`.

The deterministic exact-pair benchmark surfaces all four reviewed objects in accepted-plus-review output: X3 is `accepted`; X37, the fountain, and the removed compact structure are `needs_review`. Accepted-only object recall is `1/4` (`0.25`). Accepted-plus-review object recall is `4/4` (`1.0`). Coarse-ROI accepted-plus-review pixel recall is `0.413`.

These are not deployment accuracy claims. The pair has no meters-per-pixel value, no CRS, no exact boundary masks, no reviewed negative area, and all unreviewed pixels are ignored. Precision is therefore unavailable, not `1.0`.

Government evaluation still requires independent pixel-accurate labels, reviewed negatives, multiple geographies, dates, providers/sensors, realistic ground resolutions, and held-out evaluation. Labeled screenshots remain a demo input; production requires georeferenced, orthorectified, label-free imagery with CRS, resolution, capture date, sensor/provider, and provenance.
