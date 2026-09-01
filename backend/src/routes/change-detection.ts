import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { detectChanges } from "../change-detection.js";

const router = Router();
const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 2 },
  fileFilter: (_request, file, callback) => {
    if (!acceptedTypes.has(file.mimetype)) return callback(new Error("Use PNG, JPEG, WebP, or GIF images."));
    callback(null, true);
  }
});

router.post("/", upload.fields([
  { name: "oldImage", maxCount: 1 },
  { name: "currentImage", maxCount: 1 }
]), async (request, response, next) => {
  try {
    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    const oldImage = files?.oldImage?.[0];
    const currentImage = files?.currentImage?.[0];
    if (!oldImage || !currentImage) {
      return response.status(400).json({ error: "Both oldImage and currentImage are required." });
    }
    const metersPerPixel = z.coerce.number().positive().optional().parse(request.body.metersPerPixel || undefined);
    const semanticValidation = request.body.semanticValidation === "true";
    const analysisMode = z.enum(["deterministic", "frontier_baseline", "hybrid"])
      .optional().parse(request.body.analysisMode || undefined);
    const annotationVersion = z.string().max(120).optional().parse(request.body.annotationVersion || undefined);
    const debugTrace = process.env.NODE_ENV !== "production" && request.body.debugTrace === "true";
    const traceNumber = z.coerce.number().finite().nonnegative();
    const traceX = request.body.traceX == null ? undefined : traceNumber.parse(request.body.traceX);
    const traceY = request.body.traceY == null ? undefined : traceNumber.parse(request.body.traceY);
    const traceRadius = request.body.traceRadius == null ? undefined : z.coerce.number().finite().positive().parse(request.body.traceRadius);
    const traceWidth = request.body.traceWidth == null ? undefined : z.coerce.number().finite().positive().parse(request.body.traceWidth);
    const traceHeight = request.body.traceHeight == null ? undefined : z.coerce.number().finite().positive().parse(request.body.traceHeight);
    const traceRoi = debugTrace && traceX != null && traceY != null
      ? traceRadius != null
        ? { x: traceX, y: traceY, radius: traceRadius }
        : traceWidth != null && traceHeight != null
          ? { x: traceX, y: traceY, width: traceWidth, height: traceHeight }
          : undefined
      : undefined;
    const result = await detectChanges(oldImage.buffer, currentImage.buffer, {
      metersPerPixel,
      semanticValidation,
      analysisMode,
      annotationVersion,
      debugTrace,
      traceRoi
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
