const NODE_API_BASE = "http://localhost:3000/api/v1";
const FASTAPI_BASE = "http://127.0.0.1:8000/api/v1";

const api = {
  // Get stored token
  getToken: () => localStorage.getItem("almac_token"),

  // Store token
  setToken: (token) => localStorage.setItem("almac_token", token),

  // Remove token (logout)
  removeToken: () => localStorage.removeItem("almac_token"),

  // Check if user is logged in
  isAuthenticated: () => !!localStorage.getItem("almac_token"),

  // Get stored user data
  getUser: () => {
    const user = localStorage.getItem("almac_user");
    return user ? JSON.parse(user) : null;
  },

  // Store user data
  setUser: (user) => localStorage.setItem("almac_user", JSON.stringify(user)),

  // Remove user data
  removeUser: () => localStorage.removeItem("almac_user"),

  // Login
  login: async (email, password) => {
    const response = await fetch(`${NODE_API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Login failed");
    }
    return data;
  },

  // Register
  register: async (userData) => {
    const response = await fetch(`${NODE_API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Registration failed");
    }
    return data;
  },

  // Get current user profile
  getMe: async () => {
    const token = api.getToken();
    const response = await fetch(`${NODE_API_BASE}/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch profile");
    }
    return data;
  },

  /**
   * End-to-End Label Scan & Compliance Evaluation:
   * First attempts Fastify orchestration on http://localhost:3000 (saves to NeonDB & Cloudinary).
   * Gracefully falls back to direct FastAPI compute on http://127.0.0.1:8000 if Node server is down.
   */
  uploadAndScan: async (file, category = "general") => {
    const token = api.getToken();
    const formData = new FormData();
    formData.append("file", file);
    // Note: category is passed as a URL query param below — no need to duplicate in form body

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
        return {
          source: "node-server",
          ...data,
        };
      }
    } catch (nodeErr) {
      console.warn("Node server unavailable, falling back to direct FastAPI compute:", nodeErr);
    }

    // 2. Fallback: Direct FastAPI compute engine
    const directForm = new FormData();
    directForm.append("file", file);
    const directRes = await fetch(
      `${FASTAPI_BASE}/compliance/evaluate-image?enhance=true&category=${encodeURIComponent(category)}`,
      {
        method: "POST",
        body: directForm,
      }
    );

    if (!directRes.ok) {
      const errText = await directRes.text();
      throw new Error(`Compliance scan failed: ${errText || directRes.statusText}`);
    }

    const fastApiData = await directRes.json();
    return {
      source: "fastapi-direct",
      scan_id: `direct_${Date.now()}`,
      status: fastApiData.overall_result === "PASS" ? "COMPLIANT" : "NON_COMPLIANT",
      image_path: null,
      created_at: new Date().toISOString(),
      compliance_score: fastApiData.compliance_score,
      overall_result: fastApiData.overall_result,
      category,
      annotated_image_base64: fastApiData.annotated_image_base64,
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
  },

  // Get past inspections list
  getInspections: async ({ page = 1, limit = 20, status = "" } = {}) => {
    let url = `${NODE_API_BASE}/inspections?page=${page}&limit=${limit}`;
    if (status && status !== "ALL") {
      url += `&status=${encodeURIComponent(status)}`;
    }
    const token = api.getToken();
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`Failed to load inspections: ${response.statusText} (${response.status})`);
      }
      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new Error("Connection to Node.js backend timed out (server might be offline on port 3000)");
      }
      throw err;
    }
  },

  // Get specific inspection details
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

  // Get statutory legal citations dictionary
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

  // Search statutory corpus
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

  // Get active rules by category
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