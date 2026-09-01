# Bình Lợi GIS Monitor

GIS dashboard for monitoring parcels, land changes, inspections, satellite evidence, and monthly reports in Bình Lợi.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Docker Desktop with Docker Compose

## Start locally

Run all commands from the repository root.

### First-time setup

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
docker compose up -d
npm run prisma:generate --workspace backend
npm run db:push --workspace backend
npm run db:seed
npm run dev
```

The database may need a few seconds to become ready. Check it with:

```bash
docker compose ps
docker compose logs -f postgres
```

Press `Ctrl+C` to stop following the logs. If `db:push` initially cannot connect, wait until PostgreSQL is ready, then run it again.

### Everyday startup

Docker Desktop must be running. Then:

```bash
docker compose up -d
npm run dev
```

Open:

- Web app: http://localhost:3000
- API health check: http://localhost:4000/health

`npm run dev` starts the frontend and backend together.

### Stop the project

Press `Ctrl+C` in the terminal running `npm run dev`, then stop PostgreSQL:

```bash
docker compose down
```

Database data is retained in the `postgres_data` Docker volume.

### Restart after pulling changes

Use the commands relevant to the changes you pulled:

```bash
npm install
docker compose up -d
npm run prisma:generate --workspace backend
npm run db:push --workspace backend
npm run dev
```

Run `npm run db:seed` only when you need to create or restore the demo data.

### Reset the local database

This deletes all local database data and recreates the demo data:

```bash
docker compose down -v
docker compose up -d
npm run db:push --workspace backend
npm run db:seed
```

### Docker troubleshooting

```bash
# Show container status
docker compose ps

# Show PostgreSQL logs
docker compose logs postgres

# Restart PostgreSQL
docker compose restart postgres

# Stop PostgreSQL without deleting its data
docker compose down
```

If port `5432` is already in use, stop the other local PostgreSQL instance or container before running `docker compose up -d`.

## Environment variables

### Backend

`backend/.env`:

```env
DATABASE_URL="postgresql://gis:gis@localhost:5432/commune_gis?schema=public"
PORT=4000
FRONTEND_URL="http://localhost:3000"
OPENAI_API_KEY=""
OPENAI_MODEL="your-vision-capable-model"
AI_DEBUG=false
# AI_DEBUG_OUTPUT_DIR="./ai-debug"
```

`NODE_ENV=production` always disables debug-image writing. `OPENAI_API_KEY` is optional. When both the key and `OPENAI_MODEL` exist, the API defaults to hybrid analysis; otherwise it safely uses deterministic analysis.

Frontier limits and reproducibility settings:

```env
OPENAI_IMAGE_DETAIL=original
OPENAI_DETAIL_FALLBACK=true
OPENAI_TIMEOUT_MS=45000
OPENAI_MAX_RETRIES=2
OPENAI_MAX_OUTPUT_TOKENS=5000
OPENAI_CONCURRENCY=2
FRONTIER_TILE_SIZE=1024
FRONTIER_TILE_OVERLAP=0.18
FRONTIER_MAX_TILES=12
FRONTIER_MAX_CANDIDATES=24
FRONTIER_MAX_CALLS=40
FRONTIER_MAX_PAIRED_MEGAPIXELS=48
FRONTIER_SCOUT_PROMPT_VERSION=frontier-scout-1.1.0
FRONTIER_VERIFY_PROMPT_VERSION=frontier-verify-1.0.0
FRONTIER_DEDUPE_IOU=0.42
FRONTIER_DEDUPE_CONTAINMENT=0.72
FRONTIER_DEDUPE_CENTER_DISTANCE=0.35
FRONTIER_DEDUPE_SIZE_RATIO=0.45
FRONTIER_DEDUPE_SEMANTIC=0.2
FRONTIER_VERIFY_RESERVE_FRONTIER_ONLY=2
FRONTIER_VERIFY_RESERVE_SMALL_OBJECT=1
FRONTIER_VERIFY_RESERVE_REMOVAL=1
```

Detector tuning variables and defaults:

```env
# Processing and scale
REGISTRATION_MAX_DIMENSION=1400
CHANGE_MAX_NATIVE_PIXELS=24000000
CHANGE_MAX_NATIVE_DIMENSION=10000
CHANGE_TILE_SIZE=768
CHANGE_TILE_OVERLAP=32
CHANGE_MAX_CANDIDATE_COMPONENTS=500
COMPONENT_SCALE_UNCERTAIN_MIN_PIXELS=512
COMPONENT_KNOWN_SCALE_SAFETY_MIN_PIXELS=4
CHANGE_CLOSING_RADIUS_METERS=0.45
CHANGE_OPENING_RADIUS_METERS=0.25
CHANGE_MAX_MORPH_RADIUS_PIXELS=4
CHANGE_DISPLACEMENT_TOLERANCE_METERS=0.6
CHANGE_MAX_DISPLACEMENT_PIXELS=4
CHANGE_CROP_PADDING_METERS=15
CHANGE_MIN_CROP_PADDING_PIXELS=24
CHANGE_HOLE_FILL_AREA_M2=4

# Registration
MIN_REGISTRATION_CONFIDENCE=0.5
REG_MIN_MATCHES=12
REG_MIN_INLIERS=18
REG_MIN_INLIER_RATIO=0.23
REG_MIN_SPATIAL_COVERAGE=0.08
REG_MIN_VALID_OVERLAP=0.62
REG_MAX_MEDIAN_REPROJECTION_ERROR=3
REG_MAX_P95_REPROJECTION_ERROR=7
REG_MAX_EDGE_RESIDUAL=0.42
REG_MAX_CHANGE_TOLERANT_EDGE_RESIDUAL=0.5
REG_MAX_LOCAL_EDGE_RESIDUAL=0.62
REG_MIN_SCALE_RATIO=0.7
REG_MAX_SCALE_RATIO=1.45
REG_RESIDUAL_GRID_COLUMNS=4
REG_RESIDUAL_GRID_ROWS=4
REG_DISPLACEMENT_TOLERANCE=2
REG_ECC_REFINEMENT=true
REG_ECC_MIN_RELATIVE_IMPROVEMENT=0.03
REG_LOCAL_STABLE_EDGE_GRADIENT=42
REG_LOCAL_MIN_STABLE_EDGES=120

# Radiometry and evidence thresholds
RADIOMETRIC_NORMALIZATION=robust-rgb-median-mad
RADIOMETRIC_PERCENTILE_CLIP=0.02
RADIOMETRIC_MAX_SAMPLES=100000
RADIOMETRIC_MAX_GRADIENT=42
RADIOMETRIC_PROVISIONAL_CHANGE_PERCENTILE=0.8
RADIOMETRIC_MIN_SCALE=0.65
RADIOMETRIC_MAX_SCALE=1.55
CHANGE_SSIM_RADIUS=5
CHANGE_DISPLACEMENT_TOLERANCE=2
CHANGE_COLOR_WEIGHT=0.45
CHANGE_STRUCTURAL_WEIGHT=0.4
CHANGE_TEXTURE_WEIGHT=0.15
CHANGE_HIGH_THRESHOLD_FLOOR=24
CHANGE_LOW_THRESHOLD_FLOOR=10
CHANGE_HIGH_THRESHOLD_CEILING=220
CHANGE_HIGH_MAD_MULTIPLIER=6
CHANGE_LOW_MAD_MULTIPLIER=3
CHANGE_LOW_HIGH_RATIO=0.45
CHANGE_NOISE_MAX_GRADIENT=38
CHANGE_NOISE_MAX_REGISTRATION_RESIDUAL=88
CHANGE_NOISE_MAX_STRUCTURAL_RESIDUAL=150
CHANGE_NOISE_MAX_COLOR_RESIDUAL=54
CHANGE_NOISE_MIN_STABLE_FRACTION=0.06
CHANGE_NOISE_MIN_STABLE_PIXELS=5000
CHANGE_NOISE_TAIL_MAD_MULTIPLIER=4.5
CHANGE_MAX_HIGH_SEED_FRACTION=0.012
CHANGE_LOCAL_THRESHOLD_COLUMNS=4
CHANGE_LOCAL_THRESHOLD_ROWS=4
CHANGE_LOCAL_HIGH_MIN_RATIO=1
CHANGE_LOCAL_HIGH_MAX_RATIO=1.35
CHANGE_MULTISCALE_RADIUS_PIXELS=9

# Component validity and workload
COMPONENT_ANNULUS_RADIUS=8
COMPONENT_MIN_AREA_M2=6
COMPONENT_MIN_BACKGROUND_CONTRAST=0.12
COMPONENT_MIN_ROBUST_Z=3
COMPONENT_MAX_EDGE_ONLY_FRACTION=0.39
COMPONENT_MAX_REGISTRATION_RESIDUAL=0.46
COMPONENT_HARD_MAX_REGISTRATION_RESIDUAL=0.72
COMPONENT_MIN_THRESHOLD_STABILITY=0.5
COMPONENT_MIN_STRUCTURAL_SUPPORT=0.2
COMPONENT_MAX_INVALID_BORDER_CONTACT=0.2
MIN_COMPONENT_SCORE=0.82
POLYGON_SIMPLIFICATION=0.012
MAX_CHANGE_REGIONS=18
MAX_RELIABLE_CHANGED_PERCENT=0.1
MAX_EDGE_ONLY_PERCENT=0.12
MAX_RAW_RADIOMETRIC_MEDIAN=58
MAX_VIEWPORT_UI_PERCENT=0.12
BORDER_OVERLAY_MIN_COVERAGE=0.35
BORDER_OVERLAY_MAX_THICKNESS=0.30
BORDER_OVERLAY_MIN_COLOR_RESIDUAL=20
BORDER_OVERLAY_MAX_GRADIENT=32
```

`MIN_COMPONENT_SCORE` assigns hard-valid evidence to `accepted` versus `needs_review`; it never rejects a component by itself. `MAX_CHANGE_REGIONS` is a workload/saturation warning threshold, not a response truncation limit.

### Frontend

`frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

Restart the development server after changing environment variables.

## Demo data

Seed or reset the demo records:

```bash
npm run db:seed
```

The seed creates parcels, buildings, departments, inspectors, alerts, notes, and placeholder before/after images. There is currently no authentication gate.

## Hybrid change detection

`POST /api/change-detection` accepts `oldImage`, `currentImage`, optional `metersPerPixel`, optional `annotationVersion`, and `analysisMode=deterministic|frontier_baseline|hybrid`. Hybrid is preferred when OpenAI configuration exists. Existing clients can continue reading `regions`, `reviewRegions`, `cleanedMask`, `binaryMask`, `probabilityScore`, `regionCount`, and `totalChangedPixels`.

Hybrid registration is deterministic. Immediately afterward, full registered OLD and CURRENT images are sent together to an independent frontier scout while native, overlapping paired tiles preserve small-object detail. These proposals are deduplicated, merged with deterministic accepted/review candidates, locally refined against probability, low-mask, structural, edge, and color evidence, then verified from padded native crops. Coarse model boxes are never copied into accepted polygons. A frontier-only or uncertain proposal remains `needs_review`; acceptance requires strong deterministic evidence plus crop-level physical-change confirmation.

The response has three auditable candidate states:

- `accepted`: hard-valid evidence at or above the primary-display ranking threshold. Returned in `regions`.
- `needs_review`: hard-valid, coherent evidence below that ranking threshold or semantically uncertain evidence. Returned in `reviewRegions` and visible by default.
- `rejected`: insufficient physical area, invalid overlap/viewport geometry, UI or label artifacts, incoherent support, extreme local registration failure, pair incompatibility, or a visible semantic-artifact decision. Returned in diagnostics.

Component evidence scores rank candidates; they are not probabilities. A score below `MIN_COMPONENT_SCORE` alone cannot delete coherent evidence. Accepted, review, rejected, and all-candidate masks are disjoint and returned separately. `cleanedMask` remains an alias for the accepted mask. Workload saturation is explicit, and accepted/review candidates are never truncated by the display threshold.

Registration uses an EXIF-normalized pyramid capped by `REGISTRATION_MAX_DIMENSION`, ORB/RANSAC, reprojection checks, valid overlap, edge residuals, a local residual grid, and optional ECC refinement. The resulting homography is scaled back to native coordinates. Radiometric normalization and final multiscale evidence run on the native registered canvas in overlapping bounded-memory tiles. Tile interiors are stitched before global connected components, so output coordinates and masks use the full native canvas.

Thresholds use stable-background median/MAD estimates plus a data-driven high-seed quantile guard. Coherent low-only components can survive as review candidates using generic area, contrast, structure loss, edge loss, local histogram change, multiscale support, and shape checks. Broad weak components are split around spatially separate strong cores so local evidence is not diluted. Changed low-texture border overlay bands are audited and excluded without discarding compact border objects. No production rule uses benchmark-object coordinates or appearance-specific roof logic.

When `metersPerPixel` is known, minimum area, morphology, displacement tolerance, crop padding, area, and object dimensions use physical units. Without it, the response contains `GROUND_RESOLUTION_MISSING`, uses an explicit conservative pixel fallback, and marks scale-dependent conclusions uncertain.

Frontier requests use the Responses API with strict JSON Schema output, `store: false`, bounded timeouts/retries/concurrency, labeled paired images, `detail: original`, and a configurable fallback to `high`. Coordinates are validated and clamped locally. API-key absence and scout failures preserve deterministic output with an explicit fallback reason.

Every result includes SHA-256 input hashes, processing time, detector/config version, threshold configuration, native registration transform, dimensions, scale status, state transitions, warnings, raw/mapped frontier proposals, deduplication clusters, limit/merge/refinement decisions, separate `frontierScout` and `frontierVerification` records, verification queue decisions, and funnel counts. Debug artifacts are written only when explicitly enabled outside production.

Debug ROI tracing is disabled in production. In development, select **Trace ROI** in the registered-image viewer, click or drag either image, then run the trace from processing diagnostics. The API accepts `debugTrace=true` with `traceX`, `traceY`, plus either `traceWidth`/`traceHeight` or `traceRadius`. The CLI equivalent is:

```bash
npm run trace:roi -- 2145 610 95 85
```

Trace payloads contain bounded numeric and audit data only, never image or base64 payloads. Displayed support percentages are normalized ratios clamped to `[0,1]` before conversion to `0–100%`; component scores remain unitless ranking values rather than probabilities.

### Benchmarking

The reusable annotation format is demonstrated by `fixtures/benchmarks/exact-pair.annotation.json`. It records image identifiers/paths, provenance, provider/sensor, dates, scale, CRS, split groups, reviewed positive polygons or masks, ignored/uncertain areas, class, reviewer, and annotation version. Geography, date, and provider split groups are mandatory to reduce leakage.

Run the exact pair:

```bash
npx tsx fixtures/run-exact-change-detection.ts
npx tsx fixtures/run-change-benchmark.ts
```

Add only reviewed objects to `positives`; leave unreviewed imagery ignored instead of inventing labels. The exact annotation includes coarse ROIs for X3, X37, the center-field fountain, and a separately reviewed removed compact structure. These are not exact pixel masks. Reports separate accepted-only and accepted-plus-review object recall, provisional ROI pixel recall, reviewed-area coverage, and ignored area. Precision is unavailable until reviewed-negative regions exist.

Live frontier calls are opt-in only:

```bash
RUN_LIVE_FRONTIER=true npx tsx fixtures/run-exact-change-detection.ts
```

The included screenshot annotation has coarse ROIs, no ground resolution, no CRS, and no reviewed negative area. Its pixel precision and false-alarm metrics therefore do not establish deployment accuracy. No government-use accuracy claim is supported until independent, pixel-accurate, geographically/provider/date-separated labeled evaluation is completed.

### Input limitations

Labeled screenshots and map UI remain supported for the demo but are unsuitable as a final government source. Production evaluation requires georeferenced, orthorectified, label-free imagery such as GeoTIFF/COG or equivalent data with CRS, pixel resolution, capture date, sensor/provider, and provenance. This application never converts screenshot pixels into fabricated geographic coordinates. Native GeoTIFF/COG metadata ingestion and geospatial reprojection remain deployment work; supplying `metersPerPixel` alone does not make a screenshot georeferenced.

## Useful commands

```bash
# Start frontend and backend
npm run dev

# Production build
npm run build

# Coordinate, clamping, homography, and EXIF-orientation tests
npm test --workspace backend

# Regenerate Prisma Client
npm run prisma:generate --workspace backend

# Synchronize the local database schema
npm run db:push --workspace backend

# Seed demo data
npm run db:seed

# Start only one service
npm run dev --workspace backend
npm run dev --workspace frontend
```

## Stack

- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS
- Maps: MapLibre GL with Esri World Imagery
- Backend: Express, TypeScript, Prisma
- Database: PostgreSQL 16 with PostGIS
- Deployment: Vercel frontend, Render backend, external PostgreSQL

## Production deployment

### Backend on Render

Use `backend` as the root directory.

Build command:

```bash
npm install && npm run prisma:generate && npm run build
```

Start command:

```bash
npm run start
```

Set:

```env
DATABASE_URL=your_postgresql_connection_string
FRONTEND_URL=https://your-frontend-domain
NODE_ENV=production
OPENAI_API_KEY=optional
OPENAI_MODEL=your-vision-capable-model
```

Enable PostGIS in the production database:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Then apply the schema and seed data from a trusted environment:

```bash
DATABASE_URL="your_postgresql_connection_string" npm run db:push --workspace backend
DATABASE_URL="your_postgresql_connection_string" npm run db:seed
```

### Frontend on Vercel

Use `frontend` as the root directory and set:

```env
NEXT_PUBLIC_API_URL=https://your-backend-domain
```

After deploying the frontend, update the backend `FRONTEND_URL` to the exact frontend origin.

## API endpoints

- `GET /health`
- `GET /api/dashboard/stats`
- `GET|POST /api/parcels`
- `PATCH /api/parcels/:id`
- `GET /api/alerts`
- `GET /api/alerts/:id`
- `PATCH /api/alerts/:id/status`
- `POST /api/alerts/:id/notes`
- `POST /api/alerts/:id/analyze`
- `POST /api/change-detection`
- `GET /api/reports/monthly`
- `GET /api/export/alerts.csv`
