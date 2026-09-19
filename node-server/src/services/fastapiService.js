const FASTAPI_BASE_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";

// Timeouts (ms) so a hung FastAPI process fails fast instead of leaving the
// client request open indefinitely.
const OCR_TIMEOUT_MS = parseInt(process.env.FASTAPI_OCR_TIMEOUT_MS, 10) || 60_000;
const EVAL_TIMEOUT_MS = parseInt(process.env.FASTAPI_EVAL_TIMEOUT_MS, 10) || 30_000;
const VIDEO_TIMEOUT_MS = parseInt(process.env.FASTAPI_VIDEO_TIMEOUT_MS, 10) || 180_000;
const DEFAULT_TIMEOUT_MS = parseInt(process.env.FASTAPI_TIMEOUT_MS, 10) || 30_000;

function timeoutError(operation, status) {
  return new Error(
    `FastAPI ${operation} timed out after ${Math.round(status / 1000)}s`
  );
}

/**
 * Detect MIME type from filename extension.
 * Falls back to "image/jpeg" for unknown extensions.
 */
function getMimeType(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  const mimeMap = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    bmp: "image/bmp",
    gif: "image/gif",
    tiff: "image/tiff",
    tif: "image/tiff",
    avif: "image/avif",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    avi: "video/x-msvideo",
  };
  return mimeMap[ext] || "image/jpeg";
}

/**
 * Wrapper around fetch() that aborts the request after timeout.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      throw new Error(`FastAPI request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call FastAPI stateless /api/v1/ocr/scan
 */
async function runOcr(imageBuffer, filename = "label.jpg") {
  const url = `${FASTAPI_BASE_URL}/api/v1/ocr/scan?enhance=true&include_annotated_image=true`;
  const formData = new FormData();
  formData.append("file", new Blob([imageBuffer], { type: getMimeType(filename) }), filename);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    body: formData,
  }, OCR_TIMEOUT_MS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI OCR failed with status ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Call FastAPI stateless /api/v1/ocr/scan-base64
 */
async function runOcrBase64(base64Image) {
  const url = `${FASTAPI_BASE_URL}/api/v1/ocr/scan-base64`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: base64Image,
      enhance: true,
      include_annotated_image: true,
    }),
  }, OCR_TIMEOUT_MS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI OCR Base64 failed with status ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Call FastAPI stateless /api/v1/compliance/evaluate-ocr
 */
async function evaluateOcrCompliance(ocrResult, category = "general") {
  const cat = encodeURIComponent(category || "general");
  const url = `${FASTAPI_BASE_URL}/api/v1/compliance/evaluate-ocr?category=${cat}`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ocrResult),
  }, EVAL_TIMEOUT_MS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI evaluate-ocr failed with status ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Call FastAPI stateless /api/v1/compliance/evaluate-image
 */
async function evaluateImageCompliance(imageBuffer, filename = "label.jpg", category = "general") {
  const cat = encodeURIComponent(category || "general");
  const url = `${FASTAPI_BASE_URL}/api/v1/compliance/evaluate-image?enhance=true&category=${cat}`;
  const formData = new FormData();
  formData.append("file", new Blob([imageBuffer], { type: getMimeType(filename) }), filename);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    body: formData,
  }, EVAL_TIMEOUT_MS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI evaluate-image failed with status ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Call FastAPI stateless /api/v1/video/unwrap
 */
async function unwrapVideo(videoBuffer, filename = "upload.mp4") {
  const url = `${FASTAPI_BASE_URL}/api/v1/video/unwrap`;
  const formData = new FormData();
  formData.append("file", new Blob([videoBuffer], { type: "video/mp4" }), filename);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    body: formData,
  }, VIDEO_TIMEOUT_MS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI video unwrap failed with status ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Get statutory legal citations dictionary from FastAPI
 */
async function getCitations() {
  const url = `${FASTAPI_BASE_URL}/api/v1/compliance/citations`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`FastAPI get citations failed with status ${response.status}`);
  }
  return await response.json();
}

/**
 * Search statutory legal corpus from FastAPI
 */
async function searchCitations(query, topK = 3) {
  const url = `${FASTAPI_BASE_URL}/api/v1/compliance/citations-search?q=${encodeURIComponent(query)}&top_k=${topK}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`FastAPI search citations failed with status ${response.status}`);
  }
  return await response.json();
}

/**
 * Get active Legal Metrology rules from FastAPI
 */
async function getRules(category = "general") {
  const url = `${FASTAPI_BASE_URL}/api/v1/compliance/rules?category=${encodeURIComponent(category || "general")}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`FastAPI get rules failed with status ${response.status}`);
  }
  return await response.json();
}

export {
  runOcr,
  runOcrBase64,
  evaluateOcrCompliance,
  evaluateImageCompliance,
  unwrapVideo,
  getCitations,
  searchCitations,
  getRules,
};
