// Base URL: relative by default so the Vite dev proxy (and any reverse proxy in
// production) handles the host. Override with VITE_API_URL when needed.
const API_BASE_URL = import.meta.env?.VITE_API_URL || "http://localhost:3000/api/v1";
const NODE_API_BASE = API_BASE_URL;
const FASTAPI_BASE = import.meta.env?.VITE_FASTAPI_URL || "http://127.0.0.1:8000/api/v1";

// Cap every request so a hung server/proxy can never leave a background
// revalidation pending forever (which would freeze the cache on stale data).
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// In-memory cache for GET responses with stale-while-revalidate semantics.
// ---------------------------------------------------------------------------
const CACHE_TTL = {
  me: 60_000, // /auth/me — user profile rarely changes
  inspections: 15_000, // inspection list
  inspection: 60_000, // single inspection detail (immutable once scanned)
};

const PENDING_SCANS_KEY = "almac_pending_scans";

const cache = new Map(); // key -> { expires, data, inflight }
const listeners = new Map(); // key -> Set<callback>
let pendingScanPoll = null;

function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);
  return () => listeners.get(key)?.delete(callback);
}

function notify(key, data) {
  for (const cb of listeners.get(key) || []) {
    try {
      cb(data);
    } catch {
      // a broken listener must not break the cache or other listeners
    }
  }
}

function cacheSet(key, data, ttl) {
  cache.set(key, { ...cache.get(key), expires: Date.now() + ttl, data, inflight: null });
  notify(key, data);
}

// Synchronous read for initial component state; never deletes anything.
function cachePeek(key) {
  const entry = cache.get(key);
  return entry ? { data: entry.data, stale: Date.now() > entry.expires } : undefined;
}

// Instead of deleting entries on mutation, force-expire them: the next visit
// serves the previous data instantly and revalidates in the background.
function cacheMarkStale(prefixes) {
  for (const [key, entry] of cache) {
    if (prefixes.some((p) => key.startsWith(p))) entry.expires = 0;
  }
}

// Stale-while-revalidate core: fresh -> return; stale -> return + one
// background refresh (deduplicated via inflight); empty -> await fetcher.
async function swrGet(key, ttl, fetcher) {
  const entry = cache.get(key);
  if (entry && Date.now() <= entry.expires) return entry.data;

  if (entry) {
    if (!entry.inflight) {
      entry.inflight = fetcher()
        .then((data) => cacheSet(key, data, ttl))
        .catch(() => {
          // refresh failed — keep serving the stale data
        })
        .finally(() => {
          const e = cache.get(key);
          if (e) e.inflight = null;
        });
    }
    return entry.data;
  }

  const data = await fetcher();
  cacheSet(key, data, ttl);
  return data;
}

function markInspectionsStale() {
  cacheMarkStale(["/inspections", "/uploads/"]);
}

// After a successful scan, seed the caches with the result so the new scan is
// visible immediately in every cached list and the detail page — without
// waiting for (or depending on) a background revalidation.
function cacheScanResult(scan) {
  const scanId = scan?.scan_id ?? scan?.scanId ?? scan?.id;
  if (!scanId) return;

  cacheSet(`/uploads/${scanId}`, normalizeInspectionDetail(scan), CACHE_TTL.inspection);

  const summary = normalizeInspectionSummary(scan);
  for (const key of [...cache.keys()]) {
    if (!key.startsWith("/inspections")) continue;
    const entry = cache.get(key);
    if (!entry?.data || !Array.isArray(entry.data.items)) continue;
    if (entry.data.items.some((it) => it.id === summary.id)) continue;
    cacheSet(
      key,
      {
        ...entry.data,
        items: [summary, ...entry.data.items],
        total: (entry.data.total ?? entry.data.items.length) + 1,
      },
      CACHE_TTL.inspections
    );
  }

  // Lists that were not cached still need a refresh on next visit.
  markInspectionsStale();
}

// ---------------------------------------------------------------------------
// Core request helper: never crashes on empty / non-JSON responses, surfaces
// the server's error message, and handles expired sessions globally.
// ---------------------------------------------------------------------------
async function request(path, { method = "GET", body, formData, auth = true } = {}) {
  const headers = {};
  if (auth) {
    const token = api.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Cannot reach the server. Make sure the backend is running.");
  }

  let data = null;
  const raw = await response.text();
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && auth) {
      api.clearSession();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }
    const message =
      data?.message ||
      (typeof data?.error === "string" ? data.error : null) ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Field normalization
// ---------------------------------------------------------------------------
function normalizeStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "processing" ? "pending" : normalized;
}

function normalizeInspectionSummary(item = {}) {
  const annotatedImageUrl =
    item.annotated_image_path ||
    item.annotatedImagePath ||
    (item.annotated_image_base64
      ? (item.annotated_image_base64.startsWith("data:")
          ? item.annotated_image_base64
          : `data:image/jpeg;base64,${item.annotated_image_base64}`)
      : null);

  return {
    id: item.scan_id ?? item.id ?? null,
    productName:
      item.product_name ||
      item.productName ||
      item.product?.brandName ||
      item.product?.commodityName ||
      "Packaged Consumer Commodity",
    category:
      item.category ||
      item.product?.category ||
      "General Pre-Packaged Commodity",
    status: normalizeStatus(item.status),
    imageUrl: item.image_path || item.image_url || item.imageUrl || null,
    annotatedImagePath: item.annotated_image_path || item.annotatedImagePath || null,
    annotatedImageUrl,
    complianceScore: item.compliance_score ?? item.complianceScore ?? 0,
    violationsCount:
      item.violations_count ??
      (Array.isArray(item.violations) ? item.violations.length : item.violations ?? 0),
    createdAt: item.created_at || item.scannedAt || item.createdAt || null,
  };
}

function normalizeInspectionDetail(detail = {}) {
  const violations = Array.isArray(detail.violations)
    ? detail.violations.map((v) =>
        typeof v === "string"
          ? { title: v, description: "", severity: null }
          : {
              id: v.id ?? null,
              ruleCode: v.rule_code ?? v.ruleCode ?? null,
              severity: v.severity ?? null,
              title: v.title ?? v.message ?? "Violation",
              description: v.description ?? "",
              evidenceBbox: v.evidence_bbox ?? v.evidenceBbox ?? null,
              citation: v.citation ?? null,
              detectedOnPackage: v.detected_on_package ?? v.detectedOnPackage ?? null,
              expectedOnPackage: v.expected_on_package ?? v.expectedOnPackage ?? null,
              packageElement: v.package_element ?? v.packageElement ?? null,
            }
      )
    : [];

  const annotatedImageUrl =
    detail.annotated_image_path ||
    detail.annotatedImagePath ||
    (detail.annotated_image_base64
      ? (detail.annotated_image_base64.startsWith("data:")
          ? detail.annotated_image_base64
          : `data:image/jpeg;base64,${detail.annotated_image_base64}`)
      : null);

  const decls = Array.isArray(detail.extracted_declarations)
    ? detail.extracted_declarations
    : Array.isArray(detail.extractedDeclarations)
      ? detail.extractedDeclarations
      : [];

  const productName =
    detail.product_name ||
    detail.productName ||
    detail.product?.brandName ||
    detail.product?.commodityName ||
    decls.find((d) => d.field_name === "commodity_name" || d.field_name === "product_name")?.extracted_text ||
    decls.find((d) => d.field_name === "brand_name" || d.field_name === "manufacturer" || d.field_name === "manufacturer_name")?.extracted_text ||
    "Packaged Consumer Commodity";

  const category =
    detail.category ||
    detail.product?.category ||
    "General Pre-Packaged Commodity";

  const faceImages = Array.isArray(detail.face_images)
    ? detail.face_images
    : Array.isArray(detail.faceImages)
      ? detail.faceImages
      : Array.isArray(detail.ocr_result?.face_images)
        ? detail.ocr_result.face_images
        : Array.isArray(detail.ocrResult?.face_images)
          ? detail.ocrResult.face_images
          : [];

  return {
    ...normalizeInspectionSummary(detail),
    productName,
    category,
    overallResult: detail.overall_result ?? detail.overallResult ?? null,
    ocrResult: detail.ocr_result ?? detail.ocrResult ?? null,
    extractedDeclarations: decls,
    annotatedImageBase64: detail.annotated_image_base64 ?? detail.annotatedImageBase64 ?? null,
    annotatedImagePath: detail.annotated_image_path ?? detail.annotatedImagePath ?? null,
    annotatedImageUrl,
    faceImages,
    inspector: detail.inspector ?? null,
    violations,
  };
}

const api = {
  // --- session -------------------------------------------------------------
  getToken: () => localStorage.getItem("almac_token"),
  setToken: (token) => localStorage.setItem("almac_token", token),
  removeToken: () => {
    localStorage.removeItem("almac_token");
    cache.clear();
  },
  isAuthenticated: () => !!localStorage.getItem("almac_token"),
  getUser: () => {
    const user = localStorage.getItem("almac_user");
    return user ? JSON.parse(user) : null;
  },
  setUser: (user) => localStorage.setItem("almac_user", JSON.stringify(user)),
  removeUser: () => localStorage.removeItem("almac_user"),
  clearSession: () => {
    api.removeToken();
    api.removeUser();
  },

  // --- auth ----------------------------------------------------------------
  login: async (email, password) => {
    const data = await request("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    if (data?.token) {
      api.setToken(data.token);
      if (data.user) api.setUser(data.user);
    }
    return data;
  },

  register: async (userData) => {
    const data = await request("/auth/register", {
      method: "POST",
      body: userData,
      auth: false,
    });
    if (data?.token) {
      api.setToken(data.token);
      if (data.user) api.setUser(data.user);
    }
    return data;
  },

  getMe: () => swrGet("/auth/me", CACHE_TTL.me, () => request("/auth/me")),
  peekMe: () => cachePeek("/auth/me"),
  subscribeMe: (cb) => subscribe("/auth/me", cb),

  updateProfile: async (updates) => {
    const data = await request("/auth/me", { method: "PUT", body: updates });
    cacheMarkStale(["/auth/me"]);
    return data;
  },

  // --- scans ---------------------------------------------------------------
  // Upload + scan a packaging image with progress
  // Upload + scan a packaging image with progress
  uploadImage: (file, onProgress, category = "general") =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", category);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL}/uploads/image?category=${encodeURIComponent(category)}`);
      const token = api.getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          cacheScanResult(data);
          resolve(data);
        } else {
          if (xhr.status === 401) api.clearSession();
          reject(
            new Error(
              data?.message || `Scan failed with status ${xhr.status}`
            )
          );
        }
      };
      xhr.onerror = () =>
        reject(new Error("Cannot reach the server. Make sure the backend is running."));
      xhr.send(formData);
    }),

  uploadImages: (files, onProgress, category = "general") =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("category", category);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL}/uploads/images?category=${encodeURIComponent(category)}`);
      const token = api.getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) {
          cacheScanResult(data);
          resolve(data);
        } else {
          reject(new Error(data?.message || `Image batch scan failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Cannot reach the server. Make sure the backend is running."));
      xhr.send(formData);
    }),

  // Dual-path category-scoped upload & scan with async polling & FastAPI fallback
  uploadAndScan: async (file, category = "general", onProgress) => {
    const token = api.getToken();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);

    // Helper to poll until scan status is ready
    const pollUntilReady = async (scanId) => {
      const maxAttempts = 30; // 30 * 1.5s = 45s max
      const delay = 1500;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((res) => setTimeout(res, delay));
        if (onProgress) {
          if (attempt === 1) onProgress("Running RapidOCR typography & text extraction...");
          else if (attempt === 3) onProgress(`Evaluating ${category.toUpperCase()} Legal Metrology 2011 compliance...`);
          else if (attempt === 5) onProgress("Annotating bounding boxes & mapping statutory penalties...");
        }

        try {
          const detail = await api.getScanById(scanId);
          const normalized = normalizeStatus(detail?.status);
          if (normalized === "compliant" || normalized === "non_compliant" || detail?.status === "COMPLIANT" || detail?.status === "NON_COMPLIANT") {
            const result = {
              source: "node-server",
              scan_id: detail.scan_id || scanId,
              status: detail.status,
              overall_result: (detail.status === "COMPLIANT" || detail.status === "compliant") ? "PASS" : "FAIL",
              compliance_score: detail.compliance_score ?? detail.complianceScore ?? 0,
              product_name: detail.product_name,
              category: detail.category || category,
              image_path: detail.image_path,
              annotated_image_path: detail.annotated_image_path || null,
              annotated_image_base64: detail.annotated_image_base64 || detail.ocr_result?.annotated_image_base64 || null,
              created_at: detail.created_at,
              extracted_declarations: detail.extracted_declarations || detail.extractedDeclarations || [],
              violations: (detail.violations || []).map((v) => ({
                id: v.id,
                rule_code: v.rule_code || v.ruleCode,
                severity: v.severity,
                title: v.title || `${v.rule_code || "Rule"} Violation`,
                description: v.description || "",
                evidence_bbox: v.evidence_bbox || v.evidenceBbox,
                citation: v.citation,
                detected_on_package: v.detected_on_package || v.detectedOnPackage,
                expected_on_package: v.expected_on_package || v.expectedOnPackage,
                package_element: v.package_element || v.packageElement,
              })),
              ocr_result: detail.ocr_result,
            };
            cacheScanResult(result);
            return result;
          }

          if (normalized === "failed" || detail?.status === "FAILED") {
            throw new Error(detail?.raw_ocr_output?.error || detail?.rawOcrOutput?.error || "Inspection scan failed processing");
          }
        } catch (pollErr) {
          if (pollErr.message && !pollErr.message.includes("404")) {
            throw pollErr;
          }
        }
      }
      throw new Error("Scan processing timed out. Please check your Inspections log.");
    };

    // 1. Primary: Fastify server orchestration
    try {
      const headers = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(
        `${NODE_API_BASE}/uploads/image?category=${encodeURIComponent(category)}`,
        {
          method: "POST",
          headers,
          body: formData,
        }
      );

      if (response.ok) {
        const data = await response.json();
        const scanId = data?.scan_id || data?.id;
        if (scanId && (data.status === "PROCESSING" || data.status === "pending" || !data.violations)) {
          return await pollUntilReady(scanId);
        }
        cacheScanResult(data);
        return {
          source: "node-server",
          ...data,
          overall_result: (data.status === "COMPLIANT" || data.status === "compliant") ? "PASS" : "FAIL",
        };
      }
    } catch (nodeErr) {
      console.warn("Node server unavailable or scan error, falling back to direct FastAPI compute:", nodeErr);
    }

    // 2. Fallback: Direct FastAPI stateless compute engine (OCR + Evaluate OCR)
    try {
      if (onProgress) onProgress("Running direct RapidOCR compute engine...");
      const directForm = new FormData();
      directForm.append("file", file);

      const ocrRes = await fetch(
        `${FASTAPI_BASE}/ocr/scan?enhance=true&include_annotated_image=true`,
        {
          method: "POST",
          body: directForm,
        }
      );

      if (!ocrRes.ok) {
        const ocrErr = await ocrRes.text();
        throw new Error(`Direct OCR extraction failed: ${ocrErr || ocrRes.statusText}`);
      }

      const ocrData = await ocrRes.json();
      if (onProgress) onProgress(`Evaluating ${category.toUpperCase()} Legal Metrology compliance directly...`);

      const evalRes = await fetch(
        `${FASTAPI_BASE}/compliance/evaluate-ocr?category=${encodeURIComponent(category)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ocr_result: ocrData, ruleset: null }),
        }
      );

      if (!evalRes.ok) {
        const evalErr = await evalRes.text();
        throw new Error(`Direct compliance evaluation failed: ${evalErr || evalRes.statusText}`);
      }

      const fastApiData = await evalRes.json();
      const directResult = {
        source: "fastapi-direct",
        scan_id: `direct_${Date.now()}`,
        status: fastApiData.overall_result === "PASS" ? "COMPLIANT" : "NON_COMPLIANT",
        image_path: null,
        created_at: new Date().toISOString(),
        compliance_score: fastApiData.compliance_score,
        overall_result: fastApiData.overall_result,
        category,
        annotated_image_base64: fastApiData.annotated_image_base64 || ocrData.annotated_image_base64 || null,
        annotated_image_path: null,
        ocr_result: ocrData,
        extracted_declarations: fastApiData.summary?.what_was_found || [],
        missing_declarations: fastApiData.summary?.whats_missing || [],
        violations: (fastApiData.summary?.whats_wrong || []).map((v) => ({
          id: v.id,
          rule_code: v.rule_id,
          severity: v.severity,
          title: `${v.field_name} - ${(v.violation_type || "Violation").toUpperCase()}`,
          description: v.description,
          evidence_bbox: v.evidence_bbox,
          citation: v.citation,
          detected_on_package: v.detected_on_package,
          expected_on_package: v.expected_on_package,
          package_element: v.package_element,
        })),
      };
      cacheScanResult(directResult);
      return directResult;
    } catch (fallbackErr) {
      throw new Error(`Compliance scan failed: ${fallbackErr.message}`);
    }
  },

  uploadVideo: (file, onProgress) =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL}/video/frames`);
      const token = api.getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) {
          cacheScanResult(data);
          resolve(data);
        } else {
          reject(new Error(data?.message || `Video scan failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Cannot reach the server. Make sure the backend is running."));
      xhr.send(formData);
    }),

  trackPendingScans: (scans) => {
    const ids = scans.map((scan) => scan?.scan_id ?? scan?.scanId ?? scan?.id).filter(Boolean);
    const previous = api.getPendingScans();
    localStorage.setItem(PENDING_SCANS_KEY, JSON.stringify([...new Set([...previous, ...ids])]));
    markInspectionsStale();
  },

  getPendingScans: () => {
    try {
      const value = JSON.parse(localStorage.getItem(PENDING_SCANS_KEY) || "[]");
      return Array.isArray(value) ? value.filter(Boolean) : [];
    } catch {
      return [];
    }
  },

  pollPendingScans: async () => {
    if (pendingScanPoll) return pendingScanPoll;
    pendingScanPoll = (async () => {
    const ids = api.getPendingScans();
    if (!ids.length) return [];
    const ready = [];
    const stillPending = [];
    await Promise.all(ids.map(async (id) => {
      try {
        const scan = normalizeInspectionDetail(await request(`/uploads/${id}`));
        if (scan.status === "pending") stillPending.push(id);
        else {
          ready.push(scan);
          cacheSet(`/uploads/${id}`, scan, CACHE_TTL.inspection);
        }
      } catch {
        stillPending.push(id);
      }
    }));
    localStorage.setItem(PENDING_SCANS_KEY, JSON.stringify(stillPending));
    if (ready.length) {
      markInspectionsStale();
      window.dispatchEvent(new CustomEvent("almac:scan-results-ready", { detail: ready }));
    }
    return ready;
    })();
    try {
      return await pendingScanPoll;
    } finally {
      pendingScanPoll = null;
    }
  },

  getInspections: (page = 1, limit = 20) => {
    const key = `/inspections?page=${page}&limit=${limit}`;
    return swrGet(key, CACHE_TTL.inspections, async () => {
      const data = await request(`/inspections?page=${page}&limit=${limit}`);
      const rawItems = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
          ? data.items
          : [];
      return {
        page: data?.page ?? page,
        limit: data?.limit ?? limit,
        total: data?.total ?? rawItems.length,
        total_pages: data?.total_pages ?? Math.ceil(rawItems.length / limit),
        items: rawItems.map(normalizeInspectionSummary),
      };
    });
  },

  peekInspections: (page = 1, limit = 20) =>
    cachePeek(`/inspections?page=${page}&limit=${limit}`),

  subscribeInspections: (page, limit, cb) =>
    subscribe(`/inspections?page=${page}&limit=${limit}`, cb),

  getInspection: (scanId) =>
    swrGet(`/uploads/${scanId}`, CACHE_TTL.inspection, async () => {
      const data = await request(`/uploads/${scanId}`);
      return normalizeInspectionDetail(data);
    }),

  peekInspection: (scanId) => cachePeek(`/uploads/${scanId}`),

  subscribeInspection: (scanId, cb) => subscribe(`/uploads/${scanId}`, cb),

  getScanById: async (scanId) => {
    const token = api.getToken();
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${NODE_API_BASE}/uploads/${scanId}`, { headers });
    if (!response.ok) {
      throw new Error(`Failed to retrieve inspection ${scanId}`);
    }
    return await response.json();
  },

  // Statutory citations
  getCitations: async () => {
    try {
      const response = await fetch(`${NODE_API_BASE}/compliance/citations`);
      if (response.ok) return await response.json();
    } catch {
      // Fallback direct
    }
    const directRes = await fetch(`${FASTAPI_BASE}/compliance/citations`);
    if (!directRes.ok) throw new Error("Failed to fetch statutory citations");
    return await directRes.json();
  },

  searchCitations: async (query, topK = 3) => {
    const q = encodeURIComponent(query);
    try {
      const response = await fetch(`${NODE_API_BASE}/compliance/citations-search?q=${q}&top_k=${topK}`);
      if (response.ok) return await response.json();
    } catch {
      // Fallback direct
    }
    const directRes = await fetch(`${FASTAPI_BASE}/compliance/citations-search?q=${q}&top_k=${topK}`);
    if (!directRes.ok) throw new Error("Failed to search statutory corpus");
    return await directRes.json();
  },

  getActiveRules: async (category = "general") => {
    const cat = encodeURIComponent(category);
    try {
      const response = await fetch(`${NODE_API_BASE}/compliance/rules?category=${cat}`);
      if (response.ok) return await response.json();
    } catch {
      // Fallback direct
    }
    const directRes = await fetch(`${FASTAPI_BASE}/compliance/rules?category=${cat}`);
    if (!directRes.ok) throw new Error("Failed to fetch active compliance rules");
    return await directRes.json();
  },
};

export default api;
