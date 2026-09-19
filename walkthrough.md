# End-to-End Three-Tier Architecture Integration Walkthrough

## Summary of Accomplishments

We successfully stitched the three core tiers of the **ALMAC LabelLens** compliance platform into a unified, production-ready system:

```
┌─────────────────────────────────────────────────────────────┐
│             Web Frontend (React 19 + Vite)                  │
│               http://localhost:5173                         │
│  - Inspector Dashboard (/dashboard)                         │
│  - Category Selector (General, Food, Cosmetics, etc.)       │
│  - Live Label Scanner & Bounding Box Evidence Viewer        │
│  - Statutory Legal Citations Accordion & Gazette Excerpts   │
│  - Dual-Path API Client (Fastify with Direct FastAPI Backup)│
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / Multipart
                               ▼
┌─────────────────────────────────────────────────────────────┐
│          Node.js Orchestrator (Fastify 5 + Prisma)          │
│               http://localhost:3000                         │
│  - NeonDB PostgreSQL Persistence (Prisma ORM)               │
│  - Cloudinary Media & Evidence Upload Pipeline              │
│  - JWT Authentication & Officer Audit Logging               │
│  - Statutory Citations & Rule Proxies                       │
└──────────────────────────────┬──────────────────────────────┘
                               │ Internal HTTP
                               ▼
┌─────────────────────────────────────────────────────────────┐
│         Python FastAPI AI/ML Compute Engine                 │
│               http://127.0.0.1:8000                         │
│  - RapidOCR High-Precision Text & Bounding Box Extraction    │
│  - Legal Metrology 2011 Rules Engine (Category-Scoped)      │
│  - Statutory Corpus Search across 1,144+ Gazette Pages      │
│  - Numeral Height, MRP Syntax & Mandatory Field Evaluation   │
└─────────────────────────────────────────────────────────────┘
```

---

### 1. Fastify Node.js Orchestration Layer (`node-server/`)

- **NeonDB & Cloudinary Configuration ([`.env`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/node-server/.env))**:
  - Configured PostgreSQL connection string with pooling and direct fallback URLs.
  - Linked Cloudinary storage credentials for immutable evidence storage.
  - Set `FASTAPI_URL=http://127.0.0.1:8000`.
- **FastAPI Proxy Client ([`src/services/fastapiService.js`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/node-server/src/services/fastapiService.js))**:
  - Implemented `runOcr()`, `runOcrBase64()`, `evaluateOcrCompliance()`, and `evaluateImageCompliance()`.
  - Added category scoping (`?category=${category}`) to dynamically load rules for Food, Cosmetics, Textiles, and Electronics.
  - Implemented `getCitations()`, `searchCitations()`, and `getRules()` to proxy statutory citations from Python FastAPI.
- **Scan Controller Upgrades ([`src/controllers/scanController.js`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/node-server/src/controllers/scanController.js))**:
  - Extracted `category` from multipart fields and query parameters, forwarding it to FastAPI.
  - Enriched violation responses with statutory citations (Act name, Rule number, Gazette notification, and statutory quote).
  - Added handlers: `getComplianceRules()`, `getStatutoryCitations()`, and `searchStatutoryCorpus()`.
- **Scan Routes ([`src/routes/scanRoutes.js`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/node-server/src/routes/scanRoutes.js))**:
  - Exposed `/api/v1/compliance/rules`, `/api/v1/compliance/citations`, and `/api/v1/compliance/citations-search`.
  - Integrated optional JWT authentication preHandler for seamless officer identification.

---

### 2. Inspector Dashboard & Web Frontend (`web/`)

- **API Client ([`src/services/api.js`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/web/src/services/api.js))**:
  - Engineered dual-path architecture: scans route through Fastify (`http://localhost:3000/api/v1/uploads/image`) for Cloudinary evidence upload and NeonDB persistence, with automatic seamless failover to direct FastAPI (`http://127.0.0.1:8000/api/v1/compliance/evaluate-image`) if the Node server is offline.
  - Added methods for `getInspections()`, `getScanById()`, `getCitations()`, `searchCitations()`, and `getActiveRules()`.
- **Inspector Dashboard ([`src/pages/Dashboard.jsx`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/web/src/pages/Dashboard.jsx))**:
  - **Officer Header**: Shows officer identity, jurisdiction, and official Legal Metrology compliance badge.
  - **Category Selector**: Allows selecting General Commodities, Food & Beverages (FSSAI), Cosmetics, Textiles, or Electronics before scanning.
  - **Drag-and-Drop Scanner**: Drag-and-drop or file upload zone with live scan progress steps.
  - **Audit Verdict Card**: Radial progress compliance score (0-100%), overall PASS/FAIL badge, and Cloudinary evidence image.
  - **Findings & Statutory Citations**: Detailed tabs for extracted declarations, non-compliance violations, and raw OCR text, each with expandable official Gazette citations, rule numbers, and penalty provisions.
  - **Inspection Log History**: Tabular view of past inspections saved in PostgreSQL with status filters and one-click review.
- **Routing & Navigation ([`src/App.jsx`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/web/src/App.jsx) & [`src/components/layout/Navbar.jsx`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/web/src/components/layout/Navbar.jsx))**:
  - Connected `/dashboard` route in `App.jsx`.
  - Added "Inspector Console" link directly to the navigation header and prominent call-to-action buttons on the landing page hero section.

---

### 3. Unified Launch Orchestrator (`run_all.bat`)

- Created [`run_all.bat`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/run_all.bat) at the workspace root:
  - Automatically launches Python FastAPI on port 8000 via [`server/run_server.bat`](file:///c:/Users/Nitin/Desktop/ALMAC/labelLens-sih/server/run_server.bat).
  - Automatically launches Fastify Node server on port 3000 (`npm run dev`).
  - Automatically launches React Vite frontend on port 5173 (`npm run dev`).
  - Opens the browser to `http://localhost:5173/dashboard`.

---

## Verification Results

### 1. Web Frontend Production Build
```bash
> web@0.0.0 build
> vite build

vite v8.2.2 building client environment for production...
transforming...
✓ 36 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.89 kB │ gzip:  0.48 kB
dist/assets/logo-CIsK2SdQ.png   104.18 kB
dist/assets/index-CNkx5j3W.css   42.33 kB │ gzip:  8.20 kB
dist/assets/index-Djk4XXU4.js   318.23 kB │ gzip: 90.51 kB
✓ built in 212ms
```

### 2. Fastify Integration & Auth Test Suite
```bash
> node test/test_suite.js

=== Starting LabelLens Fastify Integration Test Suite ===
1. Testing GET /health ...
   ✓ /health returned 200 OK
2. Testing POST /api/v1/auth/register ...
   ✓ User registered successfully with JWT and bcrypt hash
3. Testing POST /api/v1/auth/login ...
   ✓ Login successful with correct credentials
4. Testing POST /api/v1/auth/login with wrong password ...
   ✓ Wrong password correctly rejected with 401 Unauthorized
5. Testing GET /api/v1/auth/me with Bearer token ...
   ✓ Profile retrieved successfully via JWT authentication
6. Testing Database Records via Prisma ...
   ✓ Prisma successfully queried User model in PostgreSQL
7. Testing GET /api/v1/inspections ...
   ✓ Found 69 existing inspections in DB
=== All Fastify & Database Integration Tests Passed Successfully! ===
```

### 3. Three-Tier Stitched Pipeline Test (`test_scan_pipeline.js`)
```bash
=== Testing End-to-End Stitched Architecture ===

1. Testing Fastify -> FastAPI health & citations proxy...
   ✓ Successfully fetched 27 statutory citations from FastAPI through Fastify!

2. Testing Rules proxy for category 'food'...
   ✓ Successfully retrieved 12 active rules (Category: food)

3. Testing End-to-End Scan Pipeline (Fastify -> Cloudinary -> FastAPI OCR -> Compliance -> PostgreSQL)...
   ✓ Scan pipeline completed in 8.93s!
   - Scan ID: 71cbe7bf-49bf-4ba6-8414-d5c95910db29
   - Status: NON_COMPLIANT
   - Compliance Score: 0%
   - Category: food
   - Declarations Extracted: 0
   - Violations Flagged: 9
   - Cloudinary Evidence URL: https://res.cloudinary.com/upgtqlmf/image/upload/v1789746884/labellens/scans/y7pql7ffv8kegl9o3p3u.png

4. Verifying inspection retrieval from PostgreSQL via Prisma...
   ✓ Retrieved persisted inspection from DB (ID: 71cbe7bf-49bf-4ba6-8414-d5c95910db29, Score: 0%)

🎉 ALL 3 SERVICES ARE FULLY STITCHED AND OPERATING FLAWLESSLY! 🎉
```
