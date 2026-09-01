import { readFile } from "node:fs/promises";
import { detectChanges, type TraceRoiInput } from "../backend/src/change-detection.js";

async function main() {
  const values = process.argv.slice(2);
  if (values.length < 4) throw new Error(
    "Usage: npm run trace:roi -- <x> <y> <width> <height> [old] [current] OR <x> <y> --radius <radius> [old] [current]"
  );

  const x = Number(values[0]);
  const y = Number(values[1]);
  let traceRoi: TraceRoiInput;
  if (values[2] === "--radius") {
    const radius = Number(values[3]);
    if (![x, y, radius].every(Number.isFinite) || radius <= 0) throw new Error("Point and radius must be finite and radius must be positive.");
    traceRoi = { x, y, radius };
  } else {
    const width = Number(values[2]);
    const height = Number(values[3]);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new Error("ROI coordinates must be finite and width/height must be positive.");
    }
    traceRoi = { x, y, width, height };
  }

  const oldPath = values[4] || "/Users/Doanh/Desktop/Screenshot 2026-08-25 at 21.49.29.png";
  const currentPath = values[5] || "/Users/Doanh/Desktop/Screenshot 2026-08-25 at 21.49.02.png";
  const liveFrontier = process.env.RUN_LIVE_FRONTIER === "true";
  const result = await detectChanges(await readFile(oldPath), await readFile(currentPath), {
    analysisMode: liveFrontier ? "hybrid" : "deterministic",
    debugTrace: true,
    traceRoi
  });

  console.log(JSON.stringify({
    state: result.state,
    roiTrace: result.roiTrace,
    funnel: result.frontier.funnel,
    frontierCalls: {
      scouts: result.frontier.scoutCallCount,
      verifications: result.frontier.verificationCallCount,
      usage: result.frontier.usage
    }
  }, null, 2));
}

void main();
