# Security best-practices report

Review date: 2026-08-31

## Executive summary

The repository is a functional demo, not production-safe. The main blockers are missing authentication/authorization, an unauthenticated SSRF path, and unmetered CPU/model-cost exposure. Government imagery, parcel-owner data, and detector results must not be deployed publicly until those controls are implemented. No committed API key or private key was found. Existing strengths include Helmet, Prisma parameterization, Zod on many request/model boundaries, bounded detector image dimensions, bounded OpenAI calls, `store:false`, and production-disabled debug imagery.

## High severity

### SEC-001 — No server-side authentication or authorization

- Rule: `NEXT-AUTH-001`, `REACT-AUTHZ-001`, Express input/access-control baseline
- Location: `backend/src/server.ts:37`, `backend/src/server.ts:70`, `backend/src/server.ts:103`, `backend/src/server.ts:115`, `backend/src/server.ts:136`, `backend/src/server.ts:196`, `backend/src/routes/change-detection.ts:17`, `frontend/components/auth-form.tsx:15`, `frontend/components/root-shell.tsx:6`
- Evidence: every data, mutation, export, image-analysis, and detector route is public. The login/signup form accepts any values and only redirects to `/dashboard`; `RootShell` changes presentation but performs no authorization.
- Impact: any network client can read parcel-owner and imagery data, alter records, add notes/images, trigger paid model calls, and export records.
- Fix: add a real identity provider or server-managed session, enforce authorization on every backend route, scope access by tenant/resource, and add audit logs. Keep frontend checks as UX only.
- Mitigation: keep the backend private/local until server-side controls and negative authorization tests exist.
- False-positive note: README explicitly calls this a demo with no authentication gate. That confirms the finding; it does not make public deployment safe.

### SEC-002 — Unauthenticated SSRF and unbounded remote image download

- Rule: `EXPRESS-SSRF-001`, `NEXT-SSRF-001`
- Location: `backend/src/server.ts:115`, `backend/src/server.ts:136`, `backend/src/change-detection.ts:648`, `backend/src/change-detection.ts:5375`
- Evidence: image records accept any `http://` or `https://` URL. Analysis later calls `fetch(source)`, follows redirects, buffers the full response, and applies no destination allowlist, private/link-local IP rejection, timeout, or byte limit.
- Impact: an attacker can make the server request internal services or cloud metadata and can exhaust memory with a large response.
- Fix: prefer direct bounded uploads/object IDs. If remote fetch is required, allowlist trusted imagery hosts, resolve and reject private/link-local/loopback addresses on every redirect, restrict protocols, set an abort timeout, cap redirects and streamed bytes, and verify decoded image content.
- Mitigation: deny private-network egress and metadata endpoints at the deployment network layer.
- False-positive note: exploitability depends on deployment egress, but the application-level path is confirmed.

### SEC-003 — Detector and model-cost denial of service

- Rule: `EXPRESS-DOS-001`, `NEXT-DOS-001`
- Location: `backend/src/server.ts:16`, `backend/src/routes/change-detection.ts:8`, `backend/src/routes/change-detection.ts:17`, `backend/src/vision/config.ts:129`, `backend/src/vision/config.ts:136`
- Evidence: public requests may allocate two 20 MB in-memory uploads and execute CPU-heavy registration/segmentation plus up to 40 frontier calls. There is no authentication, request rate limit, global concurrency limit, queue, per-user quota, or cancellation tied to client disconnect.
- Impact: a small number of requests can exhaust memory/CPU or create significant OpenAI cost.
- Fix: authenticate first; add edge and application rate limits, a global detector semaphore/job queue, per-tenant quotas, request cancellation, stricter upload limits, and cost/usage alerts.
- Mitigation: disable frontier mode on public endpoints and limit replicas/egress until controls exist.
- False-positive note: OpenAI calls themselves have per-call timeout/retry/call-count limits, but those do not bound the number of incoming jobs.

## Medium severity

### SEC-004 — Sensitive imagery has no retention or response-minimization policy

- Rule: privacy/data minimization; `NEXT-CACHE-001`, `NEXT-LOG-001`
- Location: `backend/prisma/schema.prisma:108`, `backend/src/server.ts:84`, `backend/src/server.ts:94`, `backend/src/server.ts:115`, `backend/src/server.ts:17`
- Evidence: full image data/URLs are stored in `SatelliteImage`, returned through alert APIs, and have no expiry/deletion field or tenant authorization. Morgan's `tiny` format logs request URLs, including parcel-search terms and record IDs. OpenAI calls use `store:false`, but provider abuse-monitoring retention is a separate control.
- Impact: imagery and owner-related metadata can persist or appear in responses/logs longer and more broadly than intended.
- Fix: define classification, purpose, retention, deletion, backup, and provider-processing policies; return image metadata or short-lived authorized URLs instead of full data; redact/query-strip access logs; record user consent/legal basis where required.
- Mitigation: restrict database/log access and retention immediately.
- False-positive note: infrastructure retention controls are not visible in this repository and must be verified separately.

### SEC-005 — CSV formula injection

- Rule: untrusted output validation
- Location: `backend/src/server.ts:20`, `backend/src/server.ts:196`, `backend/src/server.ts:219`
- Evidence: unauthenticated parcel fields can begin with `=`, `+`, `-`, `@`, tab, or carriage return. `csvCell` only quotes values; spreadsheet applications can still interpret these prefixes as formulas.
- Impact: opening the exported CSV can execute spreadsheet formulas that exfiltrate data or mislead an operator.
- Fix: neutralize formula-leading characters before CSV quoting, or use a vetted CSV exporter configured for spreadsheet safety. Add regression tests for every dangerous prefix.
- Mitigation: treat exports as untrusted and import with formula execution disabled.
- False-positive note: exact formula behavior depends on the spreadsheet client, but the dangerous input-to-export path is confirmed.

### SEC-006 — Production error responses expose internal messages

- Rule: `EXPRESS-ERROR-001`, `NEXT-ERROR-001`
- Location: `backend/src/server.ts:182`, `backend/src/server.ts:205`
- Evidence: the analysis route and global handler return raw `error.message` values to clients. Prisma, Sharp, and provider errors may include operational details.
- Impact: attackers can learn internal service behavior, validation details, provider status, or deployment information.
- Fix: map known validation errors to stable public codes; return a generic 500/502 body for unexpected failures; log structured details server-side with redaction and a request ID.
- Mitigation: ensure production logs are access-controlled and provider bodies remain redacted.

### SEC-007 — Frontend security headers and CSP are not configured

- Rule: `NEXT-HEADERS-001`, `NEXT-CSP-001`, `REACT-HEADERS-001`
- Location: `frontend/next.config.mjs:1`, `frontend/components/reports-client.tsx:17`
- Evidence: Next configuration only sets `distDir`; no CSP, frame restriction, `nosniff`, referrer policy, or permissions policy is visible. The print flow uses `document.write` and an inline script, which conflicts with a strict CSP.
- Impact: future XSS or third-party script defects have a larger blast radius, and clickjacking is not explicitly blocked at the application layer.
- Fix: remove the HTML-string print flow, then add tested response headers centrally. Start CSP in report-only mode and move to nonce/hash-based enforcement.
- Mitigation: verify equivalent headers at the deployment edge.
- False-positive note: headers may exist at a CDN, but no such configuration is present here.

### SEC-008 — Request validation is incomplete on several public data routes

- Rule: `EXPRESS-INPUT-001`, `EXPRESS-INPUT-002`
- Location: `backend/src/server.ts:20`, `backend/src/server.ts:53`, `backend/src/server.ts:84`, `backend/src/server.ts:109`
- Evidence: `polygonGeojson` is `z.any()`, coordinates have no geographic bounds, query strings and note fields have no useful maximum length, and alert type is cast to `never` instead of validated against the enum.
- Impact: malformed or oversized records can cause data-integrity errors, expensive queries, large logs/responses, and downstream rendering/export problems.
- Fix: use strict schemas with coordinate bounds, valid GeoJSON structure/size, enum validation, scalar query parsing, and conservative string limits.
- Mitigation: apply gateway request-size and query-length limits.

## Low severity

### SEC-009 — CORS fails open when configuration is absent

- Rule: `EXPRESS-CORS-001`
- Location: `backend/src/server.ts:15`, `render.yaml:12`
- Evidence: missing `FRONTEND_URL` changes the policy to `*`; production configuration declares the value but does not fail startup when absent.
- Impact: any website can read public API responses in a user's browser. This becomes more serious if browser credentials are later added incorrectly.
- Fix: fail startup in production when the exact origin allowlist is missing; restrict methods/headers; never combine wildcard origin with credentials.

### SEC-010 — Dependency advisories require framework migration planning

- Rule: `NEXT-SUPPLY-001`, `REACT-SUPPLY-001`
- Location: `frontend/package.json:16`, `package-lock.json`
- Evidence: `npm audit` reports one high and one moderate advisory through Next.js's bundled PostCSS. npm currently offers only the semver-major Next.js 16.3.3 remediation.
- Impact: the cited PostCSS issues matter if attacker-controlled CSS/source maps are processed. Normal repository-owned production CSS lowers immediate exploitability.
- Fix: do not process attacker-controlled CSS; regression-test and schedule the Next.js major upgrade; keep automated dependency review.

### SEC-011 — Deployment installs are not fully reproducible

- Rule: `REACT-SUPPLY-001`, `EXPRESS-DEPS-001`
- Location: `render.yaml:7`, `docker-compose.yml:3`, `backend/package.json:17`, `frontend/package.json:12`
- Evidence: Render uses `npm install` rather than `npm ci`; manifest ranges use caret specifiers; the PostGIS image is tag-pinned but not digest-pinned.
- Impact: production builds can resolve different dependency artifacts over time, increasing drift and supply-chain risk.
- Fix: use `npm ci`, retain/review the lockfile, and pin production container images by digest after testing.

## Verified controls

- `.gitignore` excludes `.env`, logs, debug imagery, build output, and dependencies.
- No hard-coded OpenAI key, database credential, client secret, or private key was found outside the ignored local environment file.
- Express uses Helmet and Prisma query APIs.
- Multipart upload count and per-file bytes are limited; native decoded dimensions/pixels are bounded.
- Frontier and legacy OpenAI paths use timeouts, bounded retries, output-token/call limits, strict provider schemas, local Zod validation, and `store:false`.
- Debug imagery cannot be written when `NODE_ENV=production`.

## Recommended remediation order

1. SEC-001 authentication/authorization.
2. SEC-002 SSRF-safe imagery ingestion.
3. SEC-003 rate limits, concurrency queue, and cost quotas.
4. SEC-004 retention/data minimization.
5. SEC-005 through SEC-008 application hardening.
6. SEC-009 through SEC-011 defense-in-depth and supply-chain work.
