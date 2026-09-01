# Agent tooling audit

Audit dates: 2026-08-30 to 2026-08-31

This document covers development tooling. Codex skills and MCP servers do not enter the production change-detection pipeline and do not improve detection accuracy by themselves. Accuracy comes from registration, raster inputs, deterministic segmentation, vision prompts and inputs, reviewed annotations, benchmarks, and model training only when evidence justifies it.

## Repository and runtime inventory

| Area | Available capability | Verified status |
|---|---|---|
| Runtime | Node.js, npm, TypeScript, tsx, Python | Node 22.21.1; npm 10.9.4; TypeScript 5.9.3; tsx 4.23.0; Python 3.13.0 |
| Backend | Express, Prisma, Zod, Multer, Helmet | Express 4.22.2; Prisma 5.22.0; Zod 3.25.76; Multer 2.2.0; Helmet 8.2.0 |
| Image processing | Sharp/libvips and OpenCV.js | Sharp 0.35.4; `@techstark/opencv-js` 5.0.0-release.1 |
| Geospatial | PostGIS Docker image and MapLibre GL | `postgis/postgis:16-3.4`; MapLibre GL 4.7.1 |
| Frontend | Next.js, React, Tailwind | Next 15.5.24; React 19.2.7; Tailwind 3.4.19 |
| Testing | TypeScript build, Node test runner, custom benchmark | 64 backend tests pass; exact-pair benchmark runs |
| Browser QA | OpenAI bundled Browser runtime and installed Google Chrome | Plugin build 26.818.21641; Chrome headless smoke test passed; no separate Playwright package |
| CLI | `rg`, Git, Docker, Compose, `jq`, `curl`, Chrome | ripgrep 15.2.0; Git 2.52.0; Docker 27.3.1; Compose 2.29.7; jq 1.7.1; curl 8.7.1; Chrome 151.0.7922.174; Git metadata is absent |
| Native raster CLI | GDAL/OGR/PROJ CLI | `gdalinfo`, `ogr2ogr`, `projinfo`, and `rio` absent |
| Python geospatial | OpenCV, GDAL, Rasterio, GeoPandas, PyProj, Shapely | Absent; NumPy is present |

`npm ls --depth=0 --workspaces` was used for the package inventory. No Python, npm, or system package was installed globally.

## Codex skills inventory

Exact session-exposed skills before this audit were `imagegen`, `openai-docs`, `plugin-creator`, `skill-creator`, `skill-installer`, `ui-ux-pro-max`, `browser:control-in-app-browser`, `deep-research-work:deep-research`, `documents:documents`, `frontend-design`, `google-drive:google-docs`, `google-drive:google-drive`, `google-drive:google-drive-comments`, `google-drive:google-sheets`, `google-drive:google-slides`, `pdf:pdf`, `plugin-management:plugin-management`, `presentations:Presentations`, `sites:sites-building`, `sites:sites-hosting`, `spreadsheets:Spreadsheets`, `spreadsheets:excel-live-control`, `stripe-projects`, `template-creator:template-creator`, and `visualize:visualize`. The user skill directory also contains `review-agent`, but it was not exposed in this session.

The pre-existing repository skill is `.codex/skills/ui-ux-pro-max`. Four official skills were added project-locally during this audit:

- `cli-creator`
- `jupyter-notebook`
- `security-best-practices`
- `security-threat-model`

These four additions are development instructions only. After Codex restarted, `security-best-practices` was used to produce `docs/security-best-practices-report.md`; the other three were smoke-tested but not used for implementation.

## Direct package inventory

| Workspace | Runtime packages | Development packages |
|---|---|---|
| Backend | `@prisma/client` 5.22.0; `@techstark/opencv-js` 5.0.0-release.1; `cors` 2.8.6; `dotenv` 16.6.1; `express` 4.22.2; `helmet` 8.2.0; `morgan` 1.11.0; `multer` 2.2.0; `sharp` 0.35.4; `zod` 3.25.76 | Prisma 5.22.0; tsx 4.23.0; TypeScript 5.9.3; Node/CORS/Express/Morgan/Multer type packages |
| Frontend | MapLibre geocoder 1.9.4; `clsx` 2.1.1; Framer Motion 12.43.0; MapLibre GL 4.7.1; Next.js 15.5.24; React/React DOM 19.2.7; `tailwind-merge` 2.6.1 | Autoprefixer 10.5.2; PostCSS 8.5.26; Tailwind 3.4.19; TypeScript 5.9.3; React/Node type packages |

`npm ls` also reports `@img/sharp-wasm32` 0.35.4 and `@emnapi/runtime` 1.11.3 as extraneous optional artifacts. `npm prune` did not remove them; they are not declared dependencies or used by the macOS native Sharp runtime.

## MCP inventory

User-level Codex configuration contains:

| Server | Transport/scope | Relevance and decision |
|---|---|---|
| `openaiDeveloperDocs` | Official remote documentation service | Relevant, read-only documentation lookup; keep |
| `node_repl` | Local stdio | Supports the bundled browser runtime; keep |
| `computer-use` | Local stdio | Existing browser/computer interaction; keep |
| `robinhood-trading` | Remote account integration | Unrelated; not used or modified |

No project-local MCP configuration exists. Product-provided `codex_apps` tools are session integrations, not repository configuration.

## Capability-gap assessment

| Capability | Repository state | Gap/decision |
|---|---|---|
| OpenAI Responses vision | Native `fetch`, paired Base64 images, global scout, paired tiles, native crops | Implemented; no SDK required |
| Structured outputs | Strict provider JSON Schema plus local Zod validation | Implemented and hardened in this audit |
| Satellite-image registration | ORB/RANSAC, homography validation, residual grid, optional ECC | Implemented with OpenCV.js |
| Segmentation | Native tiled color/structure/texture evidence, hysteresis, morphology, components | Implemented with Sharp/OpenCV.js |
| GeoTIFF/COG raster input | No decoder, CRS reader, overview/window reader, or COG validation | Genuine production gap; separate ingestion feature required |
| Coordinate conversion | PostGIS exists, but screenshot inputs have no CRS or affine transform | Do not fabricate coordinates; add only with georeferenced raster ingestion |
| Benchmark/evaluation | Versioned annotation schema and reviewed-object benchmark | Present but dataset is too small; add pixel masks, reviewed negatives, multiple locations/dates/providers |
| Frontend browser testing | Bundled Browser runtime, installed Google Chrome, and production build | Browser plugin had no attached session; headless Chrome rendered localhost successfully, so no extra MCP/package is required |
| Security/privacy | Bounded images/calls, `store:false`, disabled production debug writes | Authentication, authorization, rate limiting, and formal imagery retention policy remain production blockers |

Official OpenAI guidance confirms Responses image inputs, `detail:"original"` for spatially sensitive images when the model supports it, strict structured output, representative eval data, and the distinction between `store:false` and abuse-monitoring retention: [vision](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [evals](https://developers.openai.com/api/docs/guides/evals), [data controls](https://developers.openai.com/api/docs/guides/your-data).

## Evaluated skills and MCP servers

| Name | Source/publisher | Pin | Capability | Permissions and credentials | Security concerns | Decision and verification |
|---|---|---|---|---|---|---|
| OpenAI Docs skill + MCP | [OpenAI documentation](https://developers.openai.com/api/docs), OpenAI | Codex-managed build | Current OpenAI API research | Official-doc network reads; no application key for docs | No repository write; narrow official domains | Keep; vision, output, eval, and privacy pages fetched |
| Skill Installer | [openai/skills](https://github.com/openai/skills), OpenAI | Codex-managed system skill | Catalog and pinned GitHub skill installation | Network and chosen destination writes | Installer can write user skills; audit used project-local destination | Keep; official catalog fetched |
| Plugin Management | OpenAI curated plugin | 0.1.0 | Plugin permissions/dependency management | Can inspect or change plugin connections | Account changes require approval | Keep; no account connected or modified |
| Browser control | OpenAI bundled Browser plugin | 26.818.21641 | Local frontend interaction and screenshots | Browser/page access; may access signed-in sessions | Browser state is sensitive; cookies/storage must not be inspected | Keep; no browser was attached in this session, so localhost QA used installed Chrome headless instead |
| `ui-ux-pro-max` | Pre-existing repository copy; publisher/source unknown | Unversioned | UI guidance and local CSV search | Reads CSV; optional writes below a caller-selected output directory | No license/owner; instructions include OS package commands; output and page slugs are not path-sanitized | Do not use or redistribute; left unchanged because it predates this audit |
| `cli-creator` | [OpenAI skill](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/cli-creator), OpenAI | `49f948faa9258a0c61caceaf225e179651397431` | Durable CLI implementation guidance | Instruction-only; future CLI tasks may request network/auth/filesystem access | No scripts/install hooks; warns against secret leakage; Apache-2.0 | Installed project-locally; source-copy comparison passed |
| `jupyter-notebook` | [OpenAI skill](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/jupyter-notebook), OpenAI | `49f948faa9258a0c61caceaf225e179651397431` | Reproducible benchmark notebooks | Standard-library helper reads bundled templates and writes a chosen `.ipynb`; no credentials/network | `--force` can overwrite only an explicit target; optional dependency install is not automatic; Apache-2.0 | Installed project-locally; helper generated and validated a notebook |
| `security-best-practices` | [OpenAI skill](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-best-practices), OpenAI | `49f948faa9258a0c61caceaf225e179651397431` | Secure coding/review guidance | Instruction/reference reads; no credentials/scripts/network execution | References contain illustrative unsafe examples but no executable hooks; Apache-2.0 | Installed project-locally; source-copy comparison passed |
| `security-threat-model` | [OpenAI skill](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-threat-model), OpenAI | `49f948faa9258a0c61caceaf225e179651397431` | Repository-grounded threat models | Repository reads and user-requested Markdown output | No scripts, credentials, network, or install hooks; Apache-2.0 | Installed project-locally; source-copy comparison passed |
| Other OpenAI catalog skills | [openai/skills](https://github.com/openai/skills), OpenAI | Catalog reviewed at `49f948faa9258a0c61caceaf225e179651397431` | GitHub, CI, Figma, Notion, deployment, media, and framework workflows | Varies; several need external accounts, OAuth, browser, or deployment writes | Repository is officially deprecated; account-specific skills need explicit connections; many duplicate installed capabilities | Rejected except the four above; no external account or global config changed |
| Microsoft Playwright MCP | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp), Microsoft | Reviewed at `d0c29a5658b93b6e62435ceaf362a7d7dfc3522d`; release 0.0.79 | Browser automation via local stdio; CLI also supports HTTP/SSE | No OAuth or credential required by default; reaches browsed network destinations; reads uploads/config/init scripts/secrets when explicitly passed; filesystem defaults to workspace roots; optional persistent profile, storage state, arbitrary permissions, CDP, unrestricted files, and output writes | Apache-2.0; Microsoft security policy; package-lock v3 with 98 entries; only optional `fsevents` has an install script; direct dependencies are exact Playwright alpha builds; actively maintained through 2026-08-27. Broad browser authority remains sensitive, and official setup examples use moving `latest` | Reject duplicate: installed Chrome completed QA and bundled Browser remains available |
| MCP reference filesystem/git servers | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers), MCP project | N/A; rejected before installation | Filesystem and Git operations | Broad repository/path access | Repository labels servers as reference implementations, not production-ready; duplicates existing terminal/filesystem tools | Reject |
| GitHub/Postgres MCP candidates | MCP registry/reference ecosystem | N/A; rejected before installation | Repository or database operations | GitHub token or database credentials; possible writes | No `.git` metadata; image detector needs no DB agent access; least privilege not demonstrable | Reject |

## Evaluated libraries and normal tools

| Name | Source/publisher | Version/commit | Decision |
|---|---|---|---|
| Sharp | [Sharp](https://sharp.pixelplumbing.com/), Lovell Fuller/community | 0.35.4 | Keep; image decoding, tiling, warping, crops, and masks |
| OpenCV.js | [OpenCV.js docs](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html), OpenCV | `@techstark/opencv-js` 5.0.0-release.1 wrapper | Keep; registration and segmentation primitives |
| Zod | [colinhacks/zod](https://github.com/colinhacks/zod), Colin McDonnell/community | 3.25.76 | Keep; external model and request validation |
| GeoTIFF.js | [geotiffjs/geotiff.js](https://github.com/geotiffjs/geotiff.js), GeoTIFF.js maintainers | Candidate 3.0.5, commit `4a29605`; not installed | Defer until GeoTIFF ingestion is explicitly implemented; it is narrower than GDAL but does not replace reprojection/COG validation |
| GDAL/COG | [GDAL COG driver](https://gdal.org/en/stable/drivers/raster/cog.html), OSGeo | N/A; not installed | Preferred full production raster/reprojection toolchain, but unnecessary for screenshot-only phase and costly as a native dependency |
| OpenAI Node SDK | [openai/openai-node](https://github.com/openai/openai-node), OpenAI | N/A; not installed | Native bounded `fetch` already covers current endpoints; avoid duplicate dependency |

Normal libraries are preferable to MCP for raster and geospatial processing because the detector needs deterministic in-process behavior, not persistent external account integration.

## Security and privacy findings

- Production has no authentication gate. Government imagery and detector results must not be exposed until authentication, authorization, audit logging, and rate limiting are implemented.
- `store:false` is set on Responses requests, but that does not by itself guarantee zero abuse-monitoring retention. Deployment must document the OpenAI project’s retention controls and imagery classification.
- No API keys are committed by this change. Installed skills need no credentials.
- Frontier calls are bounded by timeout, retries, concurrency, call count, paired megapixels, candidate count, and output tokens. Provider output is validated locally with Zod.
- Debug imagery writes are disabled in production and opt-in elsewhere.
- Screenshot inputs have no CRS. The application must not present pixel geometry as geographic truth.
- `npm audit` reports two unresolved production advisories through Next.js's bundled PostCSS: one high and one moderate. npm offers only the semver-major Next.js 16.3.3 remediation. Do not accept attacker-controlled CSS or source maps; schedule and regression-test the framework upgrade.
- The activated security skill produced an evidence-based application review at `docs/security-best-practices-report.md`. Its highest-priority findings are missing authentication/authorization, SSRF-safe image ingestion, and detector/model-cost abuse controls.

## Verification results

- Backend TypeScript build passed; 64 backend tests passed.
- Frontend Next.js production build passed; localhost returned HTTP 200 and rendered correctly in headless Chrome at 1440 by 1000.
- Deterministic exact-pair benchmark retained all three reviewed objects in accepted-plus-review output. Accepted-only recall was 0.333; accepted-plus-review recall was 1.0. Precision and false-alarm rates remain unavailable because no reviewed-negative regions exist.
- Live frontier evaluation completed with 31 Responses calls, 47,041 total tokens, and the same reviewed-object recall. It increased accepted-plus-review candidates from 59 to 71 and therefore did not demonstrate an accuracy benefit on this fixture.

## Installation and smoke-test result

Installed under `.codex/skills/` only. No user-level Codex configuration was changed. All four installed `SKILL.md` files byte-match the reviewed pinned source. The Jupyter helper produced a valid experiment notebook; instruction-only skills passed manifest/frontmatter and source-copy checks.

Codex restarted successfully and now exposes all four project-local skills. No further restart is required. The continuation prompt used for that restart was:

> Continue the GIS hybrid detector in `/Users/Doanh/Documents/Projects/GIS`. The project-local `cli-creator`, `jupyter-notebook`, `security-best-practices`, and `security-threat-model` skills are now active. Read `docs/agent-tooling-audit.md`, inspect existing changes, then run backend tests, frontend build, the exact-pair benchmark, and any explicitly authorized live frontier evaluation. Do not claim skills improve detection accuracy.

## Accuracy boundary

The reviewed screenshot benchmark is useful for regression only. It has three coarse positive ROIs, no exact masks, no reviewed negatives, no ground resolution, and no CRS. Deployment claims require independent pixel-accurate positives and negatives separated by geography, date, provider/sensor, and acquisition conditions.
