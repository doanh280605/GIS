# Change-detection false negative

## Confirmed root cause

The deterministic pipeline failed for the reviewed pair because two suppressors were coupled:

1. Noise was estimated from every valid score pixel. Seasonal texture, labels, rendering differences, and local alignment residuals raised the median/MAD to `41/33`, producing a raw high threshold of `239` and the capped threshold `230`. Only 52 high seeds remained.
2. Components that passed every evidence gate were rejected again by an uncalibrated weakest-factor score. X3 passed its hard gates but received `0.630`, below the duplicate `0.68` cutoff.

Registration also hid two adjacent severe cells (`0,0 = 0.901`, `0,1 = 0.821`) because the old rule required at least three cells. ECC was attempted but its non-application was unexplained.

## Fix implemented

- Noise estimation now uses stable background only. It excludes invalid/UI pixels, strong gradients, high registration residuals, coherent provisional changes, structural/color outliers, and robust extreme tails. It never selects a fixed foreground percentage.
- Threshold diagnostics now report sample size, exclusions by reason, score percentiles, raw thresholds, floor/ceiling application, seed counts, low-mask pixels, and global-mask pixels. Insufficient stable background has an explicit diagnostic/warning.
- Color evidence is symmetric old-to-current/current-to-old and requires local neighborhood consistency.
- Structural evidence combines displacement-tolerant SSIM, patch-mean residual, and local texture residual. One- or two-pixel displacement no longer contributes full same-coordinate SSIM evidence.
- Adjacent severe registration cells are detected. Stable edges outside provisional change are evaluated separately, unreliable background pixels are discounted, and the pair may remain usable with a local warning.
- ECC is applied only after a sane transform improves post-warp edge validation by the configured minimum. Diagnostics include its candidate residual, improvement, and rejection reason.
- Component acceptance now has hard gates only for scale-aware area, invalid borders, viewport/UI exclusion, and extreme local misregistration. The final deterministic score is monotonic and excludes global registration confidence.
- Score factors and contributions are returned for strength, symmetric color, neighborhood structure, local contrast, robust z-score, stability, local alignment, edge integrity, and shape. The exact limiting factor and required cutoff are returned for every rejection.
- Area thresholds use meters per pixel when provided. Otherwise they use analysis area plus a resize-adjusted safety floor. The effective value and method are reported per request.
- Hysteresis remains. Closing, one-pixel opening, hole filling, high-seed connectivity, and narrow-structure regression coverage prevent isolated noise without deleting coherent thin structures.
- Known search/header, zoom, toolbar, attribution, and scale zones are masked before registration scoring, normalization, threshold estimation, and change scoring. Label-like components have a deterministic text/UI artifact gate.
- Widespread change and candidate saturation are review states. `MAX_CHANGE_REGIONS` truncates an already-valid ranking instead of invalidating every region.
- The API/UI now distinguish no evidence, below-threshold evidence, rejected components, registration failure, compatibility failure, saturation, widespread review, and accepted changes.
- The UI reports raw evidence pixels, global candidate pixels, candidate/accepted/rejected component counts, final accepted pixels, and rejection reason counts.

## Why the old logic failed

The old MAD calculation treated broad non-physical disagreement as the background distribution, so the high threshold erased almost every seed. The surviving X3 component then passed contrast, z-score, structure, stability, geometry, and local alignment gates but was rejected by recombining the same metrics through a weakest-factor formula. Global registration confidence further penalized every component regardless of local alignment quality.

## Exact-pair before/after

| Metric | Before | After |
|---|---:|---:|
| Analysis dimensions | 1400×1006 | 1400×1006 |
| Matches / inliers | 211 / 187 | 198 / 172 |
| Registration confidence | 0.782 | 0.779 |
| Valid overlap | 87.8% | 76.4% |
| Median / p95 reprojection | 0.609 / 2.438 px | 0.610 / 2.335 px |
| Post-warp edge residual | 0.308 | 0.315 |
| Noise sample pixels | full valid distribution | 622,935 stable pixels |
| Noise median / MAD | 41 / 33 | 4 / 1 |
| Raw high threshold | 239 | 16 |
| Applied low / high | 140 / 230 | 85.5 / 190 |
| High seeds | 52 (0.004%) | 4,078 (0.379%) |
| Low-mask pixels | 53,200 | 109,868 |
| Global candidate pixels | 18,851 | 71,573 |
| Candidate components | 16 | 40 |
| Accepted / rejected | 0 / 16 | 2 / 38 |
| Final accepted pixels | 0 | 17,777 |
| Result state | components rejected | changes detected |

The repaired X3-equivalent component has bbox `x=359, y=106, width=257, height=199`, centroid `(505.758, 196.899)`, area `15,632`, and deterministic score `0.717` against the calibrated large-component cutoff `0.600`. It overlaps the reviewed ROI `x=377..600, y=155..294`. Only two regions are accepted, avoiding the prior 18-polygon flood.

## New safeguards

- Stable-background sample sufficiency and every threshold clamp are observable.
- Score contributions are monotonic and inspectable; the result is explicitly not called a probability.
- Local alignment warnings identify exact cells and expose an unreliable-pixel mask.
- UI/label zones cannot provide physical-change evidence.
- Saturation preserves the pre-truncation valid count and returns the ranked cap.
- Final accepted pixels are never used as a substitute for raw/global evidence reporting.

## Regression tests added

- Exact local pair runner with ROI-overlap, non-zero, and anti-flood assertions.
- Synthetic localized additions, removals, clearing, and road expansion.
- Identical, translated, rotated, scaled, brightness, gamma, tint, JPEG, shadow, seasonal tint/texture, moving-vehicle, label-only, UI-only, crop/zoom, and image-wide hard negatives.
- Narrow coherent structure preservation.
- Multiple separated physical changes.
- Widespread-change review without deleting valid regions.
- Candidate saturation with ranked truncation.
- Two adjacent severe residual cells.
- Monotonic factor scoring and contribution diagnostics.

The screenshots and debug outputs remain outside version control. The gitignored runner is `fixtures/run-exact-change-detection.ts`.

## Debug artifacts

- Before: `/private/tmp/gis-change-before/2026-08-28T04-25-58-562Z-3de5a185`
- After: `/private/tmp/gis-change-after/2026-08-28T04-50-59-062Z-0dfdaeeb`

## Cleanup

Removed `CandidateWorkspace`, `REFINEMENT`, `findChangeCandidates()`, `refineChangeCandidates()` and helpers, `composeCandidateMask()`, `candidateHomography`, duplicate accepted-overlay rendering, `GlobalChangeWorkspace.normalizedCurrent`, and legacy config fields/comments.

`rawDifference` remains as a compatibility alias of `rawColorResidual` because the response is public and external consumers cannot be proven absent. `probabilityScore` also remains as an API field name for compatibility, but the UI labels it “change-evidence score” and documentation states it is not a probability.

## Remaining limitations

- Known UI zones are deterministic geometry masks; unknown provider layouts may still require label-free captures.
- Dense genuine change can resemble rendering incompatibility. The detector returns review warnings instead of semantic certainty.
- The score cutoff is fixture-calibrated, not statistically calibrated. New providers and ground resolutions need additional reviewed positive and hard-negative fixtures.
