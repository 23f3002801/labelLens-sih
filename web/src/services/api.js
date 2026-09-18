// Base URL: relative by default so the Vite dev proxy (and any reverse proxy in
// production) handles the host. Override with VITE_API_URL when needed.
const API_BASE_URL = import.meta.env?.VITE_API_URL || "/api/v1";

// Cap every request so a hung server/proxy can never leave a background
// revalidation pending forever (which would freeze the cache on stale data).
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// In-memory cache for GET responses with stale-while-revalidate semantics.
// Cached data is served instantly even after its TTL passes (marked stale)
// while a single background request refreshes it — pages never flash a
// loading skeleton just because the TTL expired. Pages can also subscribe to
// a key to receive refreshed data while they are mounted.
// ---------------------------------------------------------------------------
const CACHE_TTL = {
  me: 60_000, // /auth/me — user profile rarely changes
  inspections: 15_000, // inspection list
  inspection: 60_000, // single inspection detail (immutable once scanned)
};

const cache = new Map(); // key -> { expires, data, inflight }
const listeners = new Map(); // key -> Set<callback>

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

  // Response body may be empty or non-JSON (proxies, gateways, crashes) —
  // never assume .json() succeeds.
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
// Field normalization: the backend speaks snake_case (scan_id, image_path,
// created_at, violations_count, COMPLIANT...). Normalize once here so pages
// never render `undefined` / `Invalid Date` / wrong status badges.
// ---------------------------------------------------------------------------
function normalizeStatus(status) {
  return String(status || "").toLowerCase();
}

function normalizeInspectionSummary(item = {}) {
  return {
    id: item.scan_id ?? item.id ?? null,
    productName: item.productName || item.product_name || null,
    status: normalizeStatus(item.status),
    imageUrl: item.image_path || item.image_url || null,
    complianceScore: item.compliance_score ?? 0,
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
            }
      )
    : [];

  return {
    ...normalizeInspectionSummary(detail),
    overallResult: detail.overall_result ?? null,
    ocrResult: detail.ocr_result ?? null,
    extractedDeclarations: detail.extracted_declarations ?? [],
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
  },  isAuthenticated: () => !!localStorage.getItem("almac_token"),
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
  // Upload + scan a packaging image. Uses XHR so callers get real upload
  // progress via onProgress(0-100); the response is the scan result.
  uploadImage: (file, onProgress) =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL}/uploads/image`);
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

  getInspections: (page = 1, limit = 20) => {
    const key = `/inspections?page=${page}&limit=${limit}`;
    return swrGet(key, CACHE_TTL.inspections, async () => {
      const data = await request(`/inspections?page=${page}&limit=${limit}`);
      // Backend: { page, limit, total, total_pages, items: [...] }. Stay
      // defensive in case it ever returns a bare array or a differently shaped
      // payload instead of crashing.
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
};

export default api;
