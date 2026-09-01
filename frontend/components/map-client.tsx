"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { ComparisonViewer } from "@/components/comparison-viewer";
import { AiRegion, Alert, ChangeDetectionResult, TraceRoi, api, uploadChangeDetection } from "@/lib/api";

const stages = [
  { at: 10, label: "Validating both images" },
  { at: 28, label: "Registering shared landmarks" },
  { at: 50, label: "Scouting full images and native tiles" },
  { at: 72, label: "Merging and refining candidate evidence" },
  { at: 90, label: "Verifying native candidate crops" }
];

export function MapClient() {
  const [record, setRecord] = useState<Alert | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [currentDate, setCurrentDate] = useState("2026-07-01");
  const [oldDate, setOldDate] = useState("2026-06-01");
  const [metersPerPixel, setMetersPerPixel] = useState("");
  const [analysisMode, setAnalysisMode] = useState<"deterministic" | "frontier_baseline" | "hybrid">("hybrid");
  const [result, setResult] = useState<ChangeDetectionResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedRejectedId, setSelectedRejectedId] = useState<string>();
  const [highlightedId, setHighlightedId] = useState<string>();
  const [traceRoi, setTraceRoi] = useState<TraceRoi>();
  const [error, setError] = useState("");

  useEffect(() => {
    api<Alert[]>("/api/alerts").then((rows) => setRecord(rows[0] || null)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!analyzing) return;
    const timer = window.setInterval(
      () => setProgress((value) => value >= 92 ? value : Math.min(92, value + Math.max(1, Math.round((94 - value) / 17)))),
      420
    );
    return () => window.clearInterval(timer);
  }, [analyzing]);

  const savedCurrent = record?.images.find((image) => image.kind === "after")?.imageUrl;
  const savedOld = record?.images.find((image) => image.kind === "before")?.imageUrl;
  const currentSrc = useImageSource(currentFile, isEvidence(savedCurrent) ? savedCurrent : undefined);
  const oldSrc = useImageSource(oldFile, isEvidence(savedOld) ? savedOld : undefined);
  const ready = Boolean(currentSrc && oldSrc);
  const selectedRegion = [...(result?.regions || []), ...(result?.reviewRegions || [])]
    .find((region) => region.id === selectedId);
  const selectedDiagnostic = [...(result?.diagnostics.acceptedComponents || []), ...(result?.diagnostics.reviewComponents || [])]
    .find((component) => component.id === selectedRegion?.sourceCandidateId);
  const selectedRejected = result?.diagnostics.rejectedComponents.find((region) => region.id === selectedRejectedId);
  const stage = [...stages].reverse().find((item) => progress >= item.at) || stages[0];
  const resultCopy = result ? detectionStateCopy(result) : null;
  const viewerImages = useMemo(() => ({
    old: result?.artifacts.registeredOld || oldSrc,
    current: result?.artifacts.registeredCurrent || currentSrc
  }), [result, oldSrc, currentSrc]);

  async function analyze(requestedTrace?: TraceRoi) {
    if (!ready || !oldSrc || !currentSrc) return;
    setAnalyzing(true);
    setProgress(5);
    setError("");
    setResult(null);
    setSelectedId(undefined);
    setSelectedRejectedId(undefined);
    try {
      const [oldUpload, currentUpload] = await Promise.all([
        oldFile || sourceToFile(oldSrc, "old-image"),
        currentFile || sourceToFile(currentSrc, "current-image")
      ]);
      const form = new FormData();
      form.append("oldImage", oldUpload);
      form.append("currentImage", currentUpload);
      if (metersPerPixel) form.append("metersPerPixel", metersPerPixel);
      form.append("analysisMode", analysisMode);
      if (requestedTrace) {
        form.append("debugTrace", "true");
        form.append("traceX", String(requestedTrace.x));
        form.append("traceY", String(requestedTrace.y));
        form.append("traceWidth", String(requestedTrace.width));
        form.append("traceHeight", String(requestedTrace.height));
      }
      const detection = await uploadChangeDetection(form);
      setResult(detection);
      setSelectedId(detection.regions[0]?.id || detection.reviewRegions[0]?.id);
      setProgress(100);

      if (record && (oldFile || currentFile)) {
        const [oldData, currentData] = await Promise.all([fileToDataUrl(oldUpload), fileToDataUrl(currentUpload)]);
        api<Alert>(`/api/alerts/${record.id}/images`, {
          method: "POST",
          body: JSON.stringify({ before: oldData, after: currentData, beforeDate: oldDate, afterDate: currentDate })
        }).then(setRecord).catch(() => undefined);
      }
      window.setTimeout(() => setAnalyzing(false), 350);
    } catch (caught) {
      setError(readError(caught));
      setProgress(0);
      setAnalyzing(false);
    }
  }

  function replaceImages() {
    setResult(null);
    setSelectedId(undefined);
    setSelectedRejectedId(undefined);
    setCurrentFile(null);
    setOldFile(null);
    setRecord((value) => value ? { ...value, images: [] } : value);
  }

  return (
    <div className="comparison-workspace segmentation-workspace">
      <main className="current-image-panel">
        <div className="comparison-toolbar">
          <div><p>REGISTERED COMPARISON</p><h1>Pixel-level change review</h1></div>
          <div className="toolbar-state"><span className={result?.compatibility.reliable ? "ready" : ""} />{result ? `${result.image.width} × ${result.image.height}px` : "Awaiting registration"}</div>
        </div>

        {viewerImages.old && viewerImages.current ? (
          <ComparisonViewer
            oldSrc={viewerImages.old}
            currentSrc={viewerImages.current}
            width={result?.image.width || 1000}
            height={result?.image.height || 1000}
            regions={result?.regions || []}
            reviewRegions={result?.reviewRegions || []}
            selectedId={selectedId}
            highlightedId={highlightedId}
            onSelect={(id) => { setSelectedId(id); setSelectedRejectedId(undefined); }}
            rejectedRegions={result?.diagnostics.rejectedComponents}
            selectedRejectedId={selectedRejectedId}
            onSelectRejected={(id) => { setSelectedRejectedId(id); setSelectedId(undefined); }}
            cleanedMask={result?.artifacts.cleanedMask}
            reviewMask={result?.artifacts.reviewMask}
            registrationKeypoints={result?.artifacts.registrationKeypoints}
            registrationResidualHeatmap={result?.artifacts.registrationResidualHeatmap}
            localAlignmentUnreliableMask={result?.artifacts.localAlignmentUnreliableMask}
            probabilityScore={result?.artifacts.probabilityScore}
            highThresholdMask={result?.artifacts.highThresholdMask}
            lowThresholdMask={result?.artifacts.lowThresholdMask}
            traceRoi={traceRoi}
            onTraceRoi={setTraceRoi}
          />
        ) : (
          <section className="empty-comparison">
            <Target />
            <p>CHANGE SEGMENTATION WORKSPACE</p>
            <h2>Upload two views of the same place</h2>
            <span>The images will be registered into one shared pixel coordinate system before any changes are reported.</span>
          </section>
        )}

        <div className="canvas-status">
          <span className={result?.compatibility.reliable ? "confirmed" : ""} />
          {result ? resultCopy?.title
            : ready ? "Both images ready for registration" : "Waiting for current and old images"}
        </div>
      </main>

      <aside className="comparison-sidebar">
        <header className="comparison-head">
          <p>EVIDENCE REVIEW</p>
          <h2>Compare old and current imagery</h2>
          <span>Potential changes are decision-support signals until independently validated.</span>
        </header>

        <section className="segmentation-uploads">
          <div className="upload-grid refined">
            <UploadSlot label="OLD IMAGE" file={oldFile} source={oldSrc} onFile={(file) => { setOldFile(file); setResult(null); }} />
            <UploadSlot label="CURRENT IMAGE" file={currentFile} source={currentSrc} onFile={(file) => { setCurrentFile(file); setResult(null); }} />
          </div>
          <div className="date-row">
            <label>Old capture<input type="date" value={oldDate} onChange={(event) => setOldDate(event.target.value)} /></label>
            <label>Current capture<input type="date" value={currentDate} onChange={(event) => setCurrentDate(event.target.value)} /></label>
          </div>
          <label className="resolution-field">Ground resolution <span>optional</span><div><input type="number" min="0" step="0.01" value={metersPerPixel} onChange={(event) => setMetersPerPixel(event.target.value)} placeholder="e.g. 0.30" /><b>m / pixel</b></div></label>
          <label className="analysis-mode-field">
            <span>Analysis mode</span>
            <select value={analysisMode} onChange={(event) => setAnalysisMode(event.target.value as typeof analysisMode)}>
              <option value="hybrid">Hybrid</option>
              <option value="deterministic">Deterministic</option>
              <option value="frontier_baseline">Frontier baseline</option>
            </select>
            <small>Hybrid falls back safely when frontier analysis is unavailable.</small>
          </label>
        </section>

        {analyzing ? (
          <section className="compare-progress" aria-live="polite">
            <div><strong>{progress}%</strong><span>{stage.label}</span></div>
            <div className="compare-track"><i style={{ width: `${progress}%` }} /></div>
            <p>Registration must pass before segmentation is allowed to report regions.</p>
          </section>
        ) : result ? (
          <>
            <section className="registration-summary">
              <div className="result-heading"><span>REGISTRATION</span><b>{Math.round(result.registration.registrationConfidence * 100)}%</b></div>
              <div className="metric-row"><span><b>{result.registration.matchedFeatures}</b> matches</span><span><b>{result.registration.inliers}</b> inliers</span><span><b>{Math.round(result.registration.validOverlapPercent * 100)}%</b> valid overlap</span><span><b>{result.registration.p95ReprojectionError}px</b> p95 reprojection</span></div>
              {result.registration.warning && <p className="registration-warning">{result.registration.warning}</p>}
            </section>

            {result.compatibility.warnings.length > 0 && (
              <section className={`compatibility-warning ${result.compatibility.reliable ? "advisory" : "blocked"}`} role={result.compatibility.reliable ? "status" : "alert"}>
                <b>{result.compatibility.reliable ? "Pair quality advisory" : "Comparison rejected"}</b>
                {result.compatibility.warnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}
                <small>Prefer label-free imagery from the same provider, map style, scale, and capture geometry.</small>
              </section>
            )}

            {result.scale.uncertain && (
              <section className="scale-warning" role="alert">
                <b>Ground scale is unknown</b>
                <p>Pixel evidence is shown, but physical areas and minimum object size cannot be validated. Supply meters per pixel for evaluation use.</p>
              </section>
            )}

            <section className="compare-result">
              <div className="result-heading"><span>DETECTION</span><b>{result.metrics.acceptedRegionCount} accepted · {result.metrics.reviewRegionCount} review</b></div>
              <h3>{resultCopy?.title}</h3>
              <p className="no-region-evidence">{resultCopy?.detail}</p>
              <div className="detection-metrics">
                <span><b>{result.metrics.rawEvidencePixels.toLocaleString()}</b> raw evidence pixels</span>
                <span><b>{result.metrics.globalCandidatePixels.toLocaleString()}</b> global candidate pixels</span>
                <span><b>{result.metrics.candidateComponentCount}</b> candidate components</span>
                <span><b>{result.metrics.acceptedRegionCount}</b> accepted</span>
                <span><b>{result.metrics.reviewRegionCount}</b> needs review</span>
                <span><b>{result.metrics.rejectedRegionCount}</b> rejected</span>
                <span><b>{result.metrics.acceptedPixels.toLocaleString()}</b> accepted pixels</span>
                <span><b>{result.metrics.reviewPixels.toLocaleString()}</b> review pixels</span>
                <span><b>{result.metrics.rejectedCandidatePixels.toLocaleString()}</b> rejected pixels</span>
              </div>

              <section className="frontier-summary">
                <div className="result-heading"><span>FRONTIER</span><b>{result.frontier.ran ? result.frontier.model : "Not run"}</b></div>
                <p>{result.frontier.ran
                  ? `${result.frontier.globalScoutCount} global proposals, ${result.frontier.tileScoutCount} tile proposals, ${result.frontier.matchedCount} matched.`
                  : `Effective mode: deterministic${result.frontier.fallbackReason ? ` · ${humanizeReason(result.frontier.fallbackReason)}` : ""}.`}</p>
                {result.frontier.ran && <small>{result.frontier.scoutCallCount} scout calls · {result.frontier.verificationCallCount} verification calls · {result.frontier.usage?.totalTokens?.toLocaleString() || "usage unavailable"} tokens · {result.frontier.latencyMs.toLocaleString()} ms</small>}
                <details className="funnel-metrics"><summary>Pipeline funnel</summary><dl>{Object.entries(result.frontier.funnel).map(([name, value]) => <div key={name}><dt>{humanizeReason(name)}</dt><dd>{value}</dd></div>)}</dl></details>
              </section>

              <CandidateList
                title="Accepted changes"
                state="accepted"
                regions={result.regions}
                selectedId={selectedId}
                onSelect={(id) => { setSelectedId(id); setSelectedRejectedId(undefined); }}
                onHighlight={setHighlightedId}
              />
              <CandidateList
                title="Needs review"
                state="needs_review"
                regions={result.reviewRegions}
                selectedId={selectedId}
                onSelect={(id) => { setSelectedId(id); setSelectedRejectedId(undefined); }}
                onHighlight={setHighlightedId}
              />

              {result.diagnostics.rejectedComponents.length > 0 && (
                <details className="rejected-candidate-list">
                  <summary>Rejected/debug candidates ({result.diagnostics.rejectedComponents.length})</summary>
                  <div>{result.diagnostics.rejectedComponents.map((component) => (
                    <button key={component.id} type="button" onClick={() => { setSelectedRejectedId(component.id); setSelectedId(undefined); }}>
                      <b>{component.id}</b><span>{component.rejectionReasons.map(humanizeReason).join("; ")}</span>
                    </button>
                  ))}</div>
                </details>
              )}

              {Object.keys(result.metrics.rejectionReasonCounts).length > 0 && (
                <dl className="rejection-counts">
                  {Object.entries(result.metrics.rejectionReasonCounts).map(([reason, count]) => (
                    <div key={reason}><dt>{humanizeReason(reason)}</dt><dd>{count}</dd></div>
                  ))}
                </dl>
              )}

              {selectedRegion?.crops && (
                <div className={`region-inspector ${selectedRegion.state === "needs_review" ? "review" : "accepted"}`}>
                  <div><span>{selectedRegion.state === "needs_review" ? "NEEDS REVIEW" : "ACCEPTED"} · {selectedRegion.sourceCandidateId}</span><b>Inspect native crops</b></div>
                  <div className="crop-grid">
                    <figure><img src={selectedRegion.crops.old} alt="Old crop for selected region" /><figcaption>OLD</figcaption></figure>
                    <figure><img src={selectedRegion.crops.current} alt="Current crop for selected region" /><figcaption>CURRENT</figcaption></figure>
                    {selectedRegion.crops.mask && <figure><img src={selectedRegion.crops.mask} alt="Candidate mask for selected region" /><figcaption>MASK</figcaption></figure>}
                    {selectedRegion.crops.evidence && <figure><img src={selectedRegion.crops.evidence} alt="Local difference evidence for selected region" /><figcaption>EVIDENCE</figcaption></figure>}
                  </div>
                  <p>{selectedRegion.evidence}</p>
                  <dl>
                    <div><dt>Deterministic score</dt><dd>{selectedRegion.deterministicScore == null ? "N/A" : Math.round(selectedRegion.deterministicScore * 100)}</dd></div>
                    <div><dt>Proposal source</dt><dd>{humanizeReason(selectedRegion.proposalSource || "deterministic")}</dd></div>
                    <div><dt>Geometry</dt><dd>{humanizeReason(selectedRegion.geometryType || "pixel_mask")}</dd></div>
                    <div><dt>Scout decision</dt><dd>{frontierDecisionText(selectedRegion.frontierScout)}</dd></div>
                    <div><dt>Crop verification</dt><dd>{frontierDecisionText(selectedRegion.frontierVerification, true)}</dd></div>
                    <div><dt>Verification queue</dt><dd>{selectedRegion.verificationQueuePosition == null ? "Not queued" : `#${selectedRegion.verificationQueuePosition}`}</dd></div>
                    <div><dt>Structural support</dt><dd>{percent(selectedDiagnostic?.metrics.structuralSupport)}</dd></div>
                    <div><dt>Color support</dt><dd>{percent(selectedDiagnostic?.metrics.colorSupport)}</dd></div>
                    <div><dt>Removal support</dt><dd>{percent(selectedDiagnostic?.metrics.removalSupport)}</dd></div>
                    <div><dt>Local registration residual</dt><dd>{percent(selectedDiagnostic?.metrics.localRegistrationResidual)}</dd></div>
                    <div><dt>Perimeter</dt><dd>{selectedRegion.perimeter?.toLocaleString()} px</dd></div>
                    <div><dt>Centroid</dt><dd>{selectedRegion.centroid?.join(", ")}</dd></div>
                  </dl>
                  <p className="candidate-reason">State reason: {selectedRegion.stateReason}</p>
                  {selectedDiagnostic?.reviewReasons.length ? <p className="candidate-reason">Review reason: {selectedDiagnostic.reviewReasons.map(humanizeReason).join("; ")}</p> : null}
                  {selectedRegion.frontierVerification?.status === "completed" && <p className="semantic-decision">Crop verification completed: {humanizeReason(selectedRegion.frontierVerification.decision || "uncertain")} ({percent(selectedRegion.frontierVerification.confidence)}). {selectedRegion.frontierVerification.explanation}</p>}
                </div>
              )}

              {selectedRejected && (
                <div className="rejected-inspector" role="status">
                  <div><span>REJECTED COMPONENT</span><b>{selectedRejected.id}</b></div>
                  <p>{selectedRejected.rejectionReasons.map(humanizeReason).join("; ")}</p>
                  <p>Limiting factor: {humanizeReason(selectedRejected.limitingFactor || "unknown")}</p>
                  <dl>
                    <div><dt>Local contrast</dt><dd>{Math.round(selectedRejected.metrics.backgroundContrast * 100)}%</dd></div>
                    <div><dt>Robust z-score</dt><dd>{selectedRejected.metrics.robustZScore}</dd></div>
                    <div><dt>Edge-only</dt><dd>{Math.round(selectedRejected.metrics.edgeOnlyFraction * 100)}%</dd></div>
                    <div><dt>Deterministic score</dt><dd>{Math.round(selectedRejected.metrics.componentScore * 100)} / {Math.round(selectedRejected.metrics.requiredScore * 100)}</dd></div>
                  </dl>
                </div>
              )}

              <DebugPipeline result={result} oldSrc={oldSrc} currentSrc={currentSrc} traceRoi={traceRoi} onRunTrace={() => traceRoi && void analyze(traceRoi)} />
              <div className="result-actions">
                <button onClick={() => void analyze()}><Scan /> Run detection again</button>
                <button onClick={replaceImages}>Start a new comparison</button>
              </div>
            </section>
          </>
        ) : (
          <section className="compare-cta">
            <p>PIXEL CHANGE DETECTION</p>
            <h3>{ready ? "Ready to register" : "Upload both images first"}</h3>
            <span>The detector will create a true binary mask, clean its noise, and trace contours around connected pixels.</span>
            <button disabled={!ready} onClick={() => void analyze()}><Scan /> Detect pixel changes</button>
          </section>
        )}

        {error && <div className="comparison-error" role="alert"><b>Detection failed</b><span>{error}</span></div>}
      </aside>
    </div>
  );
}

function CandidateList({
  title,
  state,
  regions,
  selectedId,
  onSelect,
  onHighlight
}: {
  title: string;
  state: "accepted" | "needs_review";
  regions: AiRegion[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onHighlight: (id?: string) => void;
}) {
  if (!regions.length) return null;
  return (
    <section className={`candidate-group ${state}`}>
      <h4>{title} <span>{regions.length}</span></h4>
      <ol className="region-evidence-list">{regions.map((region, index) => {
        const id = region.id || `${state === "accepted" ? "R" : "V"}${index + 1}`;
        return (
          <li key={id} className={selectedId === id ? "selected" : ""} onMouseEnter={() => onHighlight(id)} onMouseLeave={() => onHighlight(undefined)}>
            <button type="button" onClick={() => onSelect(id)}>
              <span className="region-evidence-number">{state === "accepted" ? "A" : "V"}{index + 1}</span>
              <span>
                <b>{region.changeType === "unknown" ? "Potential surface change" : region.label}</b>
                <em>{Math.round((region.confidence || 0) * 100)} score</em>
                <small>{region.geometryType === "frontier_bbox" ? "Coarse frontier box" : `${region.pixelArea?.toLocaleString() || 0} mask pixels`}{region.areaM2 != null ? ` · ~${region.areaM2.toLocaleString()} m²` : " · physical area unknown"}</small>
                <small>{humanizeReason(region.proposalSource || "deterministic")} · deterministic {region.deterministicScore == null ? "N/A" : Math.round(region.deterministicScore * 100)}</small>
                <small>Scout: {frontierDecisionText(region.frontierScout)}</small>
                <small>Crop verification: {frontierDecisionText(region.frontierVerification, true)}{region.verificationQueuePosition == null ? "" : ` · queue #${region.verificationQueuePosition}`}</small>
                <small>{region.stateReason || (state === "needs_review" ? humanizeReason(region.reviewReason || "manual review required") : "Strong deterministic evidence")}</small>
              </span>
            </button>
          </li>
        );
      })}</ol>
    </section>
  );
}

function UploadSlot({ label, file, source, onFile }: { label: string; file: File | null; source?: string; onFile: (file: File | null) => void }) {
  function change(event: ChangeEvent<HTMLInputElement>) { onFile(event.target.files?.[0] || null); }
  return (
    <label className={`upload-slot ${source ? "has-image" : ""}`}>
      {source ? <img src={source} alt={`${label.toLowerCase()} preview`} /> : <Upload />}
      <span>{label}</span>
      <b>{file?.name || (source ? "Saved evidence" : "Choose image")}</b>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={change} />
    </label>
  );
}

function DebugPipeline({ result, oldSrc, currentSrc, traceRoi, onRunTrace }: { result: ChangeDetectionResult; oldSrc?: string; currentSrc?: string; traceRoi?: TraceRoi; onRunTrace: () => void }) {
  const frames = [
    ["Original old", oldSrc],
    ["Original current", currentSrc],
    ["Registered current", result.artifacts.registeredCurrent],
    ["Valid overlap", result.artifacts.validOverlapMask],
    ["Registration residual", result.artifacts.registrationResidualHeatmap],
    ["Raw color residual", result.artifacts.rawColorResidual],
    ["Structural residual", result.artifacts.structuralResidual],
    ["Removed-structure residual", result.artifacts.removedStructureResidual],
    ["Border-overlay artifact mask", result.artifacts.borderOverlayArtifactMask],
    ["Edge residual", result.artifacts.edgeResidual],
    ["Change-evidence score", result.artifacts.probabilityScore],
    ["Locally unreliable alignment", result.artifacts.localAlignmentUnreliableMask],
    ["High-threshold mask", result.artifacts.highThresholdMask],
    ["Low-threshold mask", result.artifacts.lowThresholdMask],
    ["Globally cleaned mask", result.artifacts.binaryMask],
    ["Final accepted mask", result.artifacts.cleanedMask],
    ["Needs-review mask", result.artifacts.reviewMask],
    ["Rejected-candidate mask", result.artifacts.rejectedMask],
    ["All-candidate mask", result.artifacts.allCandidateMask],
    ["Accepted polygons", result.artifacts.acceptedComponents],
    ["Needs-review polygons", result.artifacts.reviewComponents],
    ["Rejected polygons", result.artifacts.rejectedComponents],
    ["Final polygons", result.artifacts.annotatedResult],
    ["Registration keypoints", result.artifacts.registrationKeypoints]
  ];
  return (
    <details className="debug-pipeline">
      <summary>Open processing diagnostics</summary>
      <section className="trace-controls">
        <b>ROI pipeline trace</b>
        <span>{traceRoi ? `${traceRoi.x}, ${traceRoi.y} · ${traceRoi.width} × ${traceRoi.height}px` : "Select Trace ROI above, then click or drag on either image."}</span>
        <button type="button" disabled={!traceRoi} onClick={onRunTrace}>Run ROI trace</button>
      </section>
      {result.roiTrace && <RoiTracePanel result={result} />}
      <div className="debug-frames">{frames.map(([label, src]) => src && <figure key={label}><img src={src} alt={label} /><figcaption>{label}</figcaption></figure>)}</div>
    </details>
  );
}

function RoiTracePanel({ result }: { result: ChangeDetectionResult }) {
  const trace = result.roiTrace;
  if (!trace) return null;
  const stages: Array<[string, unknown]> = [
    ["Registration and valid overlap", trace.registration],
    ["Deterministic evidence", trace.deterministicEvidence],
    ["Deterministic candidates", trace.deterministicCandidates],
    ["Raw frontier proposals", trace.rawFrontierProposals],
    ["Coordinate validation", trace.coordinateValidation],
    ["Deduplication", trace.deduplication],
    ["Proposal limits", trace.proposalLimits],
    ["Merge and local refinement", trace.mergeAndRefinement],
    ["Verification scheduling", trace.verificationScheduling],
    ["Final state", trace.finalState]
  ];
  return <section className="roi-trace-panel"><header><b>Trace {trace.roi.x}, {trace.roi.y} · {trace.roi.width} × {trace.roi.height}px</b><span>No image payloads are included.</span></header>{stages.map(([label, value]) => <details key={label} open={label === "Registration and valid overlap" || label === "Final state"}><summary>{label}{Array.isArray(value) ? ` (${value.length})` : ""}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>)}</section>;
}

function percent(value?: number | null) {
  return `${Math.round(Math.max(0, Math.min(1, value || 0)) * 100)}%`;
}

function frontierDecisionText(snapshot?: AiRegion["frontierScout"], verification = false) {
  if (!snapshot) return "Not run";
  if (verification && snapshot.status !== "completed") return humanizeReason(snapshot.status);
  if (snapshot.status !== "completed" || !snapshot.decision) return humanizeReason(snapshot.status);
  return `${humanizeReason(snapshot.decision)} ${percent(snapshot.confidence)}`;
}

function useImageSource(file: File | null, fallback?: string) {
  const [source, setSource] = useState(fallback);
  useEffect(() => {
    if (!file) { setSource(fallback); return; }
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file, fallback]);
  return source;
}

function sourceToFile(source: string, name: string) {
  return fetch(source).then(async (response) => {
    if (!response.ok) throw new Error(`Could not read ${name}.`);
    const blob = await response.blob();
    return new File([blob], `${name}.${blob.type.includes("png") ? "png" : "jpg"}`, { type: blob.type || "image/jpeg" });
  });
}

function isEvidence(source?: string) { return Boolean(source && !source.startsWith("data:image/svg+xml")); }
function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read image.")); reader.readAsDataURL(file); }); }
function readError(error: unknown) { const raw = error instanceof Error ? error.message : String(error); try { return JSON.parse(raw).error || raw; } catch { return raw; } }
function humanizeReason(reason: string) { return reason.toLowerCase().replaceAll("_", " "); }
function detectionStateCopy(result: ChangeDetectionResult) {
  switch (result.state) {
    case "CHANGES_DETECTED": return { title: `${result.regions.length} potential change ${result.regions.length === 1 ? "region" : "regions"}`, detail: "Candidate evidence passed deterministic component validation." };
    case "CHANGES_NEED_REVIEW": return { title: `${result.reviewRegions.length} candidate ${result.reviewRegions.length === 1 ? "needs" : "need"} review`, detail: "Coherent evidence passed hard validity gates but is not strong enough for primary display alone." };
    case "CHANGES_DETECTED_WITH_REVIEW": return { title: `${result.regions.length} accepted and ${result.reviewRegions.length} review candidates`, detail: "Review candidates remain visible by default and were not removed by score ranking." };
    case "NO_DIFFERENCE_EVIDENCE": return { title: "No difference evidence found", detail: "No valid-overlap pixels reached the low evidence threshold." };
    case "EVIDENCE_BELOW_THRESHOLD": return { title: "Difference evidence below threshold", detail: "Some pixels differed, but no connected global candidate survived hysteresis." };
    case "COMPONENTS_REJECTED": return { title: "Candidate components were rejected", detail: `${result.metrics.candidateComponentCount} components were found; rejection reasons are listed below.` };
    case "REGISTRATION_UNRELIABLE": return { title: "Registration unreliable", detail: "The images could not be aligned reliably enough for physical-change reporting." };
    case "COMPATIBILITY_FAILURE": return { title: "Image compatibility failure", detail: "Rendering, labels, UI, or overlap differences prevent reliable physical-change reporting." };
    case "CANDIDATE_SATURATION": return { title: "Candidate limit reached", detail: `${result.metrics.preTruncationCandidateCount} valid candidates were found; only the highest-ranked ${result.metrics.regionCount} are displayed.` };
    case "WIDESPREAD_CHANGE_REVIEW": return { title: "Widespread change requires review", detail: "Valid regions are shown, but the changed extent is too broad for a routine localized result." };
    case "RESOURCE_LIMIT_EXCEEDED": return { title: "Image exceeds processing limits", detail: "Use a supported native tile size or increase explicitly configured server resource limits." };
  }
}
function Scan() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5M7 12h10" /></svg>; }
function Upload() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v6h14v-6" /></svg>; }
function Target() { return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor"><circle cx="32" cy="32" r="19"/><circle cx="32" cy="32" r="7"/><path d="M32 3v10m0 38v10M3 32h10m38 0h10"/></svg>; }
