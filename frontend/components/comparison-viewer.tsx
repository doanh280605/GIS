"use client";

import { PointerEvent, WheelEvent, useEffect, useRef, useState } from "react";
import { AiRegion, ComponentDiagnostic, TraceRoi } from "@/lib/api";

type Mode = "side" | "swipe" | "overlay" | "blink";

export function ComparisonViewer({
  oldSrc,
  currentSrc,
  width,
  height,
  regions,
  reviewRegions = [],
  selectedId,
  highlightedId,
  onSelect,
  rejectedRegions = [],
  selectedRejectedId,
  onSelectRejected,
  cleanedMask,
  reviewMask,
  registrationKeypoints,
  registrationResidualHeatmap,
  localAlignmentUnreliableMask,
  probabilityScore,
  highThresholdMask,
  lowThresholdMask,
  traceRoi,
  onTraceRoi
}: {
  oldSrc: string;
  currentSrc: string;
  width: number;
  height: number;
  regions: AiRegion[];
  reviewRegions?: AiRegion[];
  selectedId?: string;
  highlightedId?: string;
  onSelect: (id: string) => void;
  rejectedRegions?: ComponentDiagnostic[];
  selectedRejectedId?: string;
  onSelectRejected?: (id: string) => void;
  cleanedMask?: string;
  reviewMask?: string;
  registrationKeypoints?: string;
  registrationResidualHeatmap?: string;
  localAlignmentUnreliableMask?: string;
  probabilityScore?: string;
  highThresholdMask?: string;
  lowThresholdMask?: string;
  traceRoi?: TraceRoi;
  onTraceRoi?: (roi: TraceRoi) => void;
}) {
  const [mode, setMode] = useState<Mode>("side");
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [swipe, setSwipe] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const [blinkCurrent, setBlinkCurrent] = useState(true);
  const [traceMode, setTraceMode] = useState(false);
  const [traceRadius, setTraceRadius] = useState(48);
  const [layers, setLayers] = useState({
    accepted: true,
    review: true,
    polygons: true,
    boxes: false,
    mask: false,
    reviewMask: false,
    rejected: false,
    keypoints: false,
    residual: false,
    localAlignment: false,
    probability: false,
    highMask: false,
    lowMask: false
  });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const traceDrag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (mode !== "blink") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setBlinkCurrent(true);
      return;
    }
    const timer = window.setInterval(() => setBlinkCurrent((value) => !value), 700);
    return () => window.clearInterval(timer);
  }, [mode]);

  function zoom(next: number) {
    const value = Math.min(5, Math.max(1, next));
    setScale(value);
    if (value === 1) setPan({ x: 0, y: 0 });
  }

  function wheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoom(scale + (event.deltaY < 0 ? 0.2 : -0.2));
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (traceMode && onTraceRoi) {
      const point = imagePoint(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      traceDrag.current = { ...point, moved: false };
      onTraceRoi({ x: point.x, y: point.y, width: 1, height: 1 });
      return;
    }
    if (scale <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (traceDrag.current && onTraceRoi) {
      const point = imagePoint(event);
      const start = traceDrag.current;
      const x = Math.min(start.x, point.x);
      const y = Math.min(start.y, point.y);
      const next = {
        x,
        y,
        width: Math.max(1, Math.abs(point.x - start.x)),
        height: Math.max(1, Math.abs(point.y - start.y))
      };
      traceDrag.current.moved = next.width > 4 || next.height > 4;
      onTraceRoi(next);
      return;
    }
    if (!drag.current) return;
    setPan({
      x: drag.current.panX + event.clientX - drag.current.x,
      y: drag.current.panY + event.clientY - drag.current.y
    });
  }

  function pointerUp() {
    if (traceDrag.current && onTraceRoi && !traceDrag.current.moved) {
      const x = Math.max(0, traceDrag.current.x - traceRadius);
      const y = Math.max(0, traceDrag.current.y - traceRadius);
      onTraceRoi({
        x,
        y,
        width: Math.min(width - x, traceRadius * 2),
        height: Math.min(height - y, traceRadius * 2)
      });
    }
    traceDrag.current = null;
    drag.current = null;
  }

  function imagePoint(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const imageAspect = width / height;
    const paneAspect = rect.width / rect.height;
    const drawWidth = paneAspect > imageAspect ? rect.height * imageAspect : rect.width;
    const drawHeight = paneAspect > imageAspect ? rect.height : rect.width / imageAspect;
    const left = (rect.width - drawWidth) / 2;
    const top = (rect.height - drawHeight) / 2;
    return {
      x: Math.round(Math.max(0, Math.min(width - 1, ((event.clientX - rect.left - left) / drawWidth) * width))),
      y: Math.round(Math.max(0, Math.min(height - 1, ((event.clientY - rect.top - top) / drawHeight) * height)))
    };
  }

  const shared = {
    width,
    height,
    regions,
    reviewRegions,
    selectedId,
    highlightedId,
    onSelect,
    rejectedRegions,
    selectedRejectedId,
    onSelectRejected,
    transform: { scale, ...pan },
    layers,
    cleanedMask,
    reviewMask,
    registrationKeypoints,
    registrationResidualHeatmap,
    localAlignmentUnreliableMask,
    probabilityScore,
    highThresholdMask,
    lowThresholdMask,
    traceRoi,
    traceMode,
    onWheel: wheel,
    onPointerDown: pointerDown,
    onPointerMove: pointerMove,
    onPointerUp: pointerUp
  };

  return (
    <section className="comparison-viewer" aria-label="Registered old and current image comparison">
      <header className="viewer-toolbar">
        <div className="viewer-mode" aria-label="Comparison mode">
          {(["side", "swipe", "overlay", "blink"] as Mode[]).map((value) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>
              {value === "side" ? "Side by side" : value === "swipe" ? "Swipe" : value === "overlay" ? "Overlay" : "Blink"}
            </button>
          ))}
        </div>
        <div className="viewer-zoom">
          <button type="button" onClick={() => zoom(scale - 0.25)} aria-label="Zoom out">−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => zoom(scale + 0.25)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
          {onTraceRoi && <button type="button" aria-pressed={traceMode} onClick={() => { setTraceMode((value) => !value); setScale(1); setPan({ x: 0, y: 0 }); }}>Trace ROI</button>}
        </div>
      </header>

      <div className={`viewer-stage mode-${mode}`}>
        {mode === "side" && (
          <>
            <CanvasPane src={oldSrc} label="Old registered image" showRegions={false} {...shared} />
            <CanvasPane src={currentSrc} label="Current registered image" showRegions {...shared} />
          </>
        )}
        {mode === "swipe" && (
          <div className="swipe-stack">
            <CanvasPane src={oldSrc} label="Old registered image" showRegions={false} {...shared} />
            <div className="swipe-current" style={{ clipPath: `inset(0 ${100 - swipe}% 0 0)` }}>
              <CanvasPane src={currentSrc} label="Current registered image" showRegions {...shared} />
            </div>
            <div className="swipe-rule" style={{ left: `${swipe}%` }} aria-hidden="true" />
            <input aria-label="Reveal current image" type="range" min="0" max="100" value={swipe} onChange={(event) => setSwipe(Number(event.target.value))} />
          </div>
        )}
        {mode === "overlay" && (
          <div className="overlay-stack">
            <CanvasPane src={oldSrc} label="Old registered image" showRegions={false} {...shared} />
            <div className="overlay-current" style={{ opacity: opacity / 100 }}>
              <CanvasPane src={currentSrc} label="Current registered image" showRegions {...shared} />
            </div>
          </div>
        )}
        {mode === "blink" && (
          <div className="blink-stack" aria-live="off">
            <CanvasPane src={oldSrc} label="Old registered image" showRegions={false} {...shared} />
            <div className={`blink-current ${blinkCurrent ? "visible" : ""}`}>
              <CanvasPane src={currentSrc} label="Current registered image" showRegions {...shared} />
            </div>
          </div>
        )}
      </div>

      <footer className="viewer-footer">
        {mode === "overlay" && <label>Current opacity <input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /><b>{opacity}%</b></label>}
        <details className="debug-layers">
          <summary>Debug layers</summary>
          <div>
            <LayerToggle label="Show segmentation polygons" checked={layers.polygons} onChange={(checked) => setLayers((value) => ({ ...value, polygons: checked }))} />
            <LayerToggle label="Accepted changes" checked={layers.accepted} disabled={!regions.length} onChange={(checked) => setLayers((value) => ({ ...value, accepted: checked }))} />
            <LayerToggle label="Needs-review changes" checked={layers.review} disabled={!reviewRegions.length} onChange={(checked) => setLayers((value) => ({ ...value, review: checked }))} />
            <LayerToggle label="Show bounding boxes" checked={layers.boxes} onChange={(checked) => setLayers((value) => ({ ...value, boxes: checked }))} />
            <LayerToggle label="Show cleaned binary mask" checked={layers.mask} disabled={!cleanedMask} onChange={(checked) => setLayers((value) => ({ ...value, mask: checked }))} />
            <LayerToggle label="Show review mask" checked={layers.reviewMask} disabled={!reviewMask} onChange={(checked) => setLayers((value) => ({ ...value, reviewMask: checked }))} />
            <LayerToggle label="Show rejected polygons" checked={layers.rejected} disabled={!rejectedRegions.length} onChange={(checked) => setLayers((value) => ({ ...value, rejected: checked }))} />
            <LayerToggle label="Show registration residual" checked={layers.residual} disabled={!registrationResidualHeatmap} onChange={(checked) => setLayers((value) => ({ ...value, residual: checked }))} />
            <LayerToggle label="Show locally unreliable pixels" checked={layers.localAlignment} disabled={!localAlignmentUnreliableMask} onChange={(checked) => setLayers((value) => ({ ...value, localAlignment: checked }))} />
            <LayerToggle label="Show change-evidence score" checked={layers.probability} disabled={!probabilityScore} onChange={(checked) => setLayers((value) => ({ ...value, probability: checked }))} />
            <LayerToggle label="Show high-threshold mask" checked={layers.highMask} disabled={!highThresholdMask} onChange={(checked) => setLayers((value) => ({ ...value, highMask: checked }))} />
            <LayerToggle label="Show low-threshold mask" checked={layers.lowMask} disabled={!lowThresholdMask} onChange={(checked) => setLayers((value) => ({ ...value, lowMask: checked }))} />
            <LayerToggle label="Show registration keypoints" checked={layers.keypoints} disabled={!registrationKeypoints} onChange={(checked) => setLayers((value) => ({ ...value, keypoints: checked }))} />
          </div>
        </details>
        {traceMode && <label className="trace-radius">Click radius <input type="number" min="8" max="512" value={traceRadius} onChange={(event) => setTraceRadius(Math.max(8, Math.min(512, Number(event.target.value) || 48)))} /> px</label>}
        <span>{traceMode ? "Click or drag an ROI on either registered image." : "Scroll to zoom. Drag to pan. Both views stay synchronized."}</span>
      </footer>
    </section>
  );
}

function CanvasPane({
  src,
  label,
  width,
  height,
  regions,
  reviewRegions,
  selectedId,
  highlightedId,
  onSelect,
  rejectedRegions,
  selectedRejectedId,
  onSelectRejected,
  showRegions,
  transform,
  layers,
  cleanedMask,
  reviewMask,
  registrationKeypoints,
  registrationResidualHeatmap,
  localAlignmentUnreliableMask,
  probabilityScore,
  highThresholdMask,
  lowThresholdMask,
  traceRoi,
  traceMode,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  src: string;
  label: string;
  width: number;
  height: number;
  regions: AiRegion[];
  reviewRegions: AiRegion[];
  selectedId?: string;
  highlightedId?: string;
  onSelect: (id: string) => void;
  rejectedRegions: ComponentDiagnostic[];
  selectedRejectedId?: string;
  onSelectRejected?: (id: string) => void;
  showRegions: boolean;
  transform: { scale: number; x: number; y: number };
  layers: {
    accepted: boolean;
    review: boolean;
    polygons: boolean;
    boxes: boolean;
    mask: boolean;
    reviewMask: boolean;
    rejected: boolean;
    keypoints: boolean;
    residual: boolean;
    localAlignment: boolean;
    probability: boolean;
    highMask: boolean;
    lowMask: boolean;
  };
  cleanedMask?: string;
  reviewMask?: string;
  registrationKeypoints?: string;
  registrationResidualHeatmap?: string;
  localAlignmentUnreliableMask?: string;
  probabilityScore?: string;
  highThresholdMask?: string;
  lowThresholdMask?: string;
  traceRoi?: TraceRoi;
  traceMode: boolean;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
}) {
  return (
    <div className={`viewer-pane ${transform.scale > 1 ? "can-pan" : ""} ${traceMode ? "trace-mode" : ""}`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div className="viewer-media" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
        <img src={src} alt={label} draggable={false} />
        {showRegions && layers.residual && registrationResidualHeatmap && <img className="viewer-debug-raster" src={registrationResidualHeatmap} alt="Registration residual heatmap" draggable={false} />}
        {showRegions && layers.localAlignment && localAlignmentUnreliableMask && <img className="viewer-debug-raster" src={localAlignmentUnreliableMask} alt="Locally unreliable alignment pixels" draggable={false} />}
        {showRegions && layers.probability && probabilityScore && <img className="viewer-debug-raster" src={probabilityScore} alt="Deterministic change-evidence score" draggable={false} />}
        {showRegions && layers.highMask && highThresholdMask && <img className="viewer-debug-raster" src={highThresholdMask} alt="High-threshold change mask" draggable={false} />}
        {showRegions && layers.lowMask && lowThresholdMask && <img className="viewer-debug-raster" src={lowThresholdMask} alt="Low-threshold change mask" draggable={false} />}
        {showRegions && layers.mask && cleanedMask && <img className="viewer-mask" src={cleanedMask} alt="Cleaned binary change mask" draggable={false} />}
        {showRegions && layers.reviewMask && reviewMask && <img className="viewer-mask viewer-review-mask" src={reviewMask} alt="Needs-review change mask" draggable={false} />}
        {showRegions && layers.keypoints && registrationKeypoints && <img className="viewer-keypoints" src={registrationKeypoints} alt="Registration keypoints" draggable={false} />}
        {showRegions && (layers.polygons || layers.boxes) && (
          <svg className="viewer-regions" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label="Potential change regions">
            {layers.accepted && regions.map((region, index) => {
              const id = region.id || `R${index + 1}`;
              const active = id === selectedId || id === highlightedId;
              return (
                <g key={id} className={active ? "active" : ""} onClick={() => onSelect(id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(id); }} aria-label={`Select potential change region ${index + 1}`}>
                  {layers.polygons && region.polygon && <polygon points={region.polygon.map((point) => point.join(",")).join(" ")} />}
                  {layers.boxes && region.bbox && <rect x={region.bbox.x} y={region.bbox.y} width={region.bbox.width} height={region.bbox.height} />}
                  {layers.polygons && region.centroid && <g className="viewer-marker"><circle cx={region.centroid[0]} cy={region.centroid[1]} r="11" /><text x={region.centroid[0]} y={region.centroid[1] + 4}>A{index + 1}</text></g>}
                </g>
              );
            })}
          </svg>
        )}
        {showRegions && layers.review && (layers.polygons || layers.boxes) && reviewRegions.length > 0 && (
          <svg className="viewer-regions viewer-review-regions" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label="Needs-review change regions">
            {reviewRegions.map((region, index) => {
              const id = region.id || `V${index + 1}`;
              const active = id === selectedId || id === highlightedId;
              return (
                <g key={id} className={`${active ? "active" : ""} ${region.geometryType === "frontier_bbox" ? "coarse-frontier" : ""}`} onClick={() => onSelect(id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(id); }} aria-label={`Select needs-review change region ${index + 1}`}>
                  {layers.polygons && region.polygon && <polygon points={region.polygon.map((point) => point.join(",")).join(" ")} />}
                  {(layers.boxes || region.geometryType === "frontier_bbox") && region.bbox && <rect x={region.bbox.x} y={region.bbox.y} width={region.bbox.width} height={region.bbox.height} />}
                  {layers.polygons && region.centroid && <g className="viewer-marker"><rect x={region.centroid[0] - 14} y={region.centroid[1] - 11} width="28" height="22" rx="2" /><text x={region.centroid[0]} y={region.centroid[1] + 4}>V{index + 1}</text></g>}
                </g>
              );
            })}
          </svg>
        )}
        {showRegions && layers.rejected && rejectedRegions.length > 0 && (
          <svg className="viewer-regions viewer-rejected-regions" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label="Rejected diagnostic regions">
            {rejectedRegions.map((region, index) => (
              <g key={region.id} className={region.id === selectedRejectedId ? "active" : ""} onClick={() => onSelectRejected?.(region.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectRejected?.(region.id); }} aria-label={`Inspect rejected region ${index + 1}`}>
                <polygon points={region.polygon.map((point) => point.join(",")).join(" ")} />
              </g>
            ))}
          </svg>
        )}
        {traceRoi && (
          <svg className="viewer-trace-roi" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label="Selected trace region">
            <rect x={traceRoi.x} y={traceRoi.y} width={traceRoi.width} height={traceRoi.height} />
          </svg>
        )}
      </div>
      <span className="viewer-label">{label.startsWith("Old") ? "OLD" : "CURRENT"}</span>
    </div>
  );
}

function LayerToggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}
