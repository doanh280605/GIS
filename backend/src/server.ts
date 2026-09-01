import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { z } from "zod";
import { analyzeWithOpenAI, isSupportedVisionImage } from "./change-detection.js";
import { prisma } from "./db.js";
import changeDetectionRouter from "./routes/change-detection.js";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL?.split(",") || "*" }));
app.use(express.json({ limit: "25mb" }));
app.use(morgan("tiny"));
app.use("/api/change-detection", changeDetectionRouter);

const parcelSchema = z.object({
  parcelId: z.string().min(1),
  houseNumber: z.string().min(1),
  streetName: z.string().min(1),
  hamlet: z.string().min(1),
  landLotNumber: z.string().min(1),
  mapSheetNumber: z.string().min(1),
  ownerName: z.string().min(1),
  areaM2: z.coerce.number().positive(),
  landUseType: z.string().min(1),
  gpsLat: z.coerce.number(),
  gpsLng: z.coerce.number(),
  polygonGeojson: z.any().optional()
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "Commune GIS Monitor API" }));

app.get("/api/dashboard/stats", async (_req, res) => {
  const [totalParcels, detectedChanges, pendingInspections, resolvedCases, monthly] = await Promise.all([
    prisma.parcel.count(),
    prisma.changeAlert.count(),
    prisma.changeAlert.count({ where: { status: { in: ["NEW", "UNDER_REVIEW", "FIELD_INSPECTION"] } } }),
    prisma.changeAlert.count({ where: { status: "RESOLVED" } }),
    prisma.changeAlert.findMany({ select: { detectedAt: true }, orderBy: { detectedAt: "asc" } })
  ]);
  const monthlyTrend = monthly.reduce<Record<string, number>>((acc, row) => {
    const key = row.detectedAt.toISOString().slice(0, 7);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  res.json({ totalParcels, detectedChanges, pendingInspections, resolvedCases, monthlyTrend });
});

app.get("/api/parcels", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const parcels = await prisma.parcel.findMany({
    where: q ? {
      OR: [
        { parcelId: { contains: q, mode: "insensitive" } },
        { ownerName: { contains: q, mode: "insensitive" } },
        { streetName: { contains: q, mode: "insensitive" } },
        { houseNumber: { contains: q, mode: "insensitive" } }
      ]
    } : undefined,
    orderBy: { parcelId: "asc" },
    include: { buildings: true }
  });
  res.json(parcels);
});

app.post("/api/parcels", async (req, res) => {
  const data = parcelSchema.parse(req.body);
  const parcel = await prisma.parcel.create({
    data: { ...data, polygonGeojson: data.polygonGeojson || square(data.gpsLat, data.gpsLng, 0.00035) }
  });
  res.status(201).json(parcel);
});

app.patch("/api/parcels/:id", async (req, res) => {
  const data = parcelSchema.partial().parse(req.body);
  const parcel = await prisma.parcel.update({ where: { id: req.params.id }, data });
  res.json(parcel);
});

app.get("/api/alerts", async (req, res) => {
  const type = String(req.query.type || "");
  const alerts = await prisma.changeAlert.findMany({
    where: type ? { type: type as never } : undefined,
    orderBy: { detectedAt: "desc" },
    include: { parcel: true, department: true, notes: true, images: true }
  });
  res.json(alerts);
});

app.get("/api/alerts/:id", async (req, res) => {
  const alert = await prisma.changeAlert.findUnique({
    where: { id: req.params.id },
    include: { parcel: true, department: true, notes: { orderBy: { createdAt: "desc" } }, images: true }
  });
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  res.json(alert);
});

app.patch("/api/alerts/:id/status", async (req, res) => {
  const body = z.object({ status: z.enum(["NEW", "UNDER_REVIEW", "FIELD_INSPECTION", "RESOLVED"]) }).parse(req.body);
  const alert = await prisma.changeAlert.update({ where: { id: req.params.id }, data: { status: body.status } });
  res.json(alert);
});

app.post("/api/alerts/:id/notes", async (req, res) => {
  const body = z.object({ author: z.string().default("UBND Bình Lợi"), content: z.string().min(1) }).parse(req.body);
  const note = await prisma.inspectionNote.create({ data: { alertId: req.params.id, ...body } });
  res.status(201).json(note);
});

app.post("/api/alerts/:id/images", async (req, res) => {
  const body = z.object({
    before: z.string().refine(isSupportedVisionImage, "Before image must be PNG, JPEG, WebP, or GIF."),
    after: z.string().refine(isSupportedVisionImage, "After image must be PNG, JPEG, WebP, or GIF."),
    beforeDate: z.coerce.date(),
    afterDate: z.coerce.date()
  }).refine((value) => value.afterDate > value.beforeDate, { message: "After date must be later than before date." }).parse(req.body);
  const alert = await prisma.changeAlert.findUnique({ where: { id: req.params.id } });
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  await prisma.$transaction([
    prisma.satelliteImage.deleteMany({ where: { alertId: alert.id, kind: { in: ["before", "after"] } } }),
    prisma.satelliteImage.create({ data: { alertId: alert.id, kind: "before", imageUrl: body.before, capturedAt: body.beforeDate } }),
    prisma.satelliteImage.create({ data: { alertId: alert.id, kind: "after", imageUrl: body.after, capturedAt: body.afterDate } })
  ]);
  const refreshed = await prisma.changeAlert.findUnique({
    where: { id: alert.id },
    include: { parcel: true, department: true, notes: { orderBy: { createdAt: "desc" } }, images: true }
  });
  res.json(refreshed);
});

app.post("/api/alerts/:id/analyze", async (req, res) => {
  try {
    const alert = await prisma.changeAlert.findUnique({
      where: { id: req.params.id },
      include: { parcel: true, department: true, images: true }
    });
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    const before = alert.images.find((img) => img.kind === "before")?.imageUrl;
    const after = alert.images.find((img) => img.kind === "after")?.imageUrl;
    if (!before || !after) return res.status(400).json({ error: "Missing before/after images" });

    // Seed SVGs are UI placeholders, not evidence. Never submit them to vision or
    // present generated results as if they came from real satellite captures.
    const canUseVision = isSupportedVisionImage(before) && isSupportedVisionImage(after);
    if (!canUseVision) {
      return res.status(422).json({ error: "Real before/after PNG, JPEG, WebP, or GIF satellite images are required before analysis." });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "OPENAI_API_KEY is required for image analysis." });
    }
    const analysis = await analyzeWithOpenAI({
      before,
      after,
      title: alert.title,
      type: alert.type,
      location: alert.location,
      beforeDate: alert.images.find((img) => img.kind === "before")?.capturedAt,
      afterDate: alert.images.find((img) => img.kind === "after")?.capturedAt
    });

    await prisma.changeAlert.update({
      where: { id: alert.id },
      data: { status: "UNDER_REVIEW", confidence: analysis.confidence }
    });
    await prisma.inspectionNote.create({
      data: {
        alertId: alert.id,
        author: analysis.provider === "openai" ? "AI phân tích ảnh" : "AI demo",
        content: analysis.regions.length
          ? `${analysis.summary} Vùng nghi vấn: ${analysis.regions.map((region) => region.label).join(", ")}. Mức độ: ${analysis.severity}.`
          : `${analysis.summary} Mức độ: ${analysis.severity}.`
      }
    });

    res.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image analysis failed";
    console.error(message);
    res.status(502).json({ error: message });
  }
});

app.get("/api/reports/monthly", async (_req, res) => {
  const alerts = await prisma.changeAlert.findMany({ include: { department: true, parcel: true } });
  const byType = countBy(alerts.map((a) => a.type));
  const byDepartment = countBy(alerts.map((a) => a.department.name));
  res.json({ commune: "Bình Lợi", period: new Date().toISOString().slice(0, 7), totalAlerts: alerts.length, byType, byDepartment });
});

app.get("/api/export/alerts.csv", async (_req, res) => {
  const alerts = await prisma.changeAlert.findMany({ include: { parcel: true, department: true }, orderBy: { detectedAt: "desc" } });
  const rows = [["id", "type", "status", "confidence", "parcel_id", "owner_name", "department", "location", "detected_at"]];
  alerts.forEach((a) => rows.push([a.id, a.type, a.status, String(a.confidence), a.parcel.parcelId, a.parcel.ownerName, a.department.name, a.location, a.detectedAt.toISOString()]));
  res.header("Content-Type", "text/csv; charset=utf-8");
  res.attachment("change-alerts.csv");
  res.send(rows.map((r) => r.map(csvCell).join(",")).join("\n"));
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message });
});

app.listen(port, () => console.log(`API listening on ${port}`));

function square(lat: number, lng: number, d: number) {
  return { type: "Polygon", coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] };
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }), {});
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
