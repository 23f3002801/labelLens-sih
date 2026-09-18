const FASTAPI_BASE_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";

// Timeouts (ms) so a hung FastAPI process fails fast instead of leaving the
// client request open indefinitely.
const OCR_TIMEOUT_MS = parseInt(process.env.FASTAPI_OCR_TIMEOUT_MS, 10) || 60_000;
const EVAL_TIMEOUT_MS = parseInt(process.env.FASTAPI_EVAL_TIMEOUT_MS, 10) || 30_000;
const VIDEO_TIMEOUT_MS = parseInt(process.env.FASTAPI_VIDEO_TIMEOUT_MS, 10) || 180_000;

function timeoutError(operation, status) {
  return new Error(
    `FastAPI ${operation} timed out after ${Math.round(status / 1000)}s`
  );
}

/**
 * Call FastAPI stateless /api/v1/ocr/scan
 */
async function runOcr(imageBuffer, filename = "label.jpg") {
  const url = `${FASTAPI_BASE_URL}/api/v1/ocr/scan?enhance=true&include_annotated_image=true`;
  const formData = new FormData();
  formData.append("file", new Blob([imageBuffer], { type: "image/jpeg" }), filename);

  const response = await fetch(url, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
  }).catch((err) => {
    if (err.name === "TimeoutError") throw timeoutError("OCR", OCR_TIMEOUT_MS);
    throw err;
  });

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
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: base64Image,
      enhance: true,
      include_annotated_image: true,
    }),
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
  }).catch((err) => {
    if (err.name === "TimeoutError") throw timeoutError("base64 OCR", OCR_TIMEOUT_MS);
    throw err;
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI OCR Base64 failed with status ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Call FastAPI stateless /api/v1/compliance/evaluate-ocr
 */
async function evaluateOcrCompliance(ocrResult) {
  const url = `${FASTAPI_BASE_URL}/api/v1/compliance/evaluate-ocr`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ocrResult),
    signal: AbortSignal.timeout(EVAL_TIMEOUT_MS),
  }).catch((err) => {
    if (err.name === "TimeoutError") throw timeoutError("evaluate-ocr", EVAL_TIMEOUT_MS);
    throw err;
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI evaluate-ocr failed with status ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Call FastAPI stateless /api/v1/compliance/evaluate-image
 */
async function evaluateImageCompliance(imageBuffer, filename = "label.jpg") {
  const url = `${FASTAPI_BASE_URL}/api/v1/compliance/evaluate-image?enhance=true`;
  const formData = new FormData();
  formData.append("file", new Blob([imageBuffer], { type: "image/jpeg" }), filename);

  const response = await fetch(url, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(EVAL_TIMEOUT_MS),
  }).catch((err) => {
    if (err.name === "TimeoutError") throw timeoutError("evaluate-image", EVAL_TIMEOUT_MS);
    throw err;
  });

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

  const response = await fetch(url, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(VIDEO_TIMEOUT_MS),
  }).catch((err) => {
    if (err.name === "TimeoutError") throw timeoutError("video unwrap", VIDEO_TIMEOUT_MS);
    throw err;
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI video unwrap failed with status ${response.status}: ${errorText}`);
  }

  return await response.json();
}

export {
  runOcr,
  runOcrBase64,
  evaluateOcrCompliance,
  evaluateImageCompliance,
  unwrapVideo,
};
