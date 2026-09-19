/**
 * Standalone check for the label-mask scan pipeline (ENABLE_MASK_SCAN).
 *
 *   node test/video_mask_check.js <image-or-video-file>           # full pipeline via Node
 *   node test/video_mask_check.js <file> --direct                 # FastAPI /unwrap only
 *
 * Full mode:   POST /api/v1/video/frames (or /api/v1/uploads/image for images)
 *              -> poll GET /api/v1/uploads/:id until terminal status.
 * Direct mode: POST {FastAPI}/api/v1/video/unwrap, save masked faces to
 *              test/.mask_output/ so the masks can be inspected visually.
 *
 * Endpoints are resolved from NODE_URL / FASTAPI_URL when set.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NODE_BASE = (process.env.NODE_URL || "http://localhost:3000").replace(/\/$/, "") + "/api/v1";
const FASTAPI_BASE = (process.env.FASTAPI_URL || "http://127.0.0.1:8000").replace(/\/$/, "") + "/api/v1";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const MIME_BY_EXT = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".bmp": "image/bmp",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska", ".webm": "video/webm",
};

function parseArgs() {
  const args = process.argv.slice(2);
  const direct = args.includes("--direct");
  const file = args.find((arg) => !arg.startsWith("--"));
  if (!file) {
    console.error("Usage: node test/video_mask_check.js <image-or-video-file> [--direct]");
    process.exit(1);
  }
  return { file: path.resolve(file), direct };
}

async function directUnwrap(filePath) {
  const bytes = await readFile(filePath);
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: MIME_BY_EXT[path.extname(filePath)] || "application/octet-stream" }), path.basename(filePath));

  console.log(`POST ${FASTAPI_BASE}/video/unwrap (${(bytes.length / 1024 / 1024).toFixed(1)} MB) — first call may load the SAM2 model for a while…`);
  const response = await fetch(`${FASTAPI_BASE}/video/unwrap`, { method: "POST", body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`FastAPI unwrap failed with status ${response.status}:`, payload.detail || JSON.stringify(payload));
    process.exit(1);
  }

  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".mask_output");
  await mkdir(outDir, { recursive: true });
  console.log(`success=${payload.success} faces=${payload.count}`);
  for (const frame of payload.frames || []) {
    const outFile = path.join(outDir, `${path.parse(filePath).name}_${frame.filename}`);
    await writeFile(outFile, Buffer.from(frame.image_base64, "base64"));
    console.log(`  face ${frame.frame_index}: ${frame.filename} (${(frame.size_bytes / 1024).toFixed(0)} KB) -> ${outFile}`);
  }
}

async function pollScan(scanId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`${NODE_BASE}/uploads/${scanId}`);
    if (!response.ok) {
      throw new Error(`GET /uploads/${scanId} failed with status ${response.status}`);
    }
    const scan = await response.json();
    if (!["PROCESSING", "processing", "pending"].includes(scan.status)) {
      return scan;
    }
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for scan ${scanId}`);
}

function printScan(scan) {
  console.log(`\nstatus:           ${scan.status}`);
  console.log(`compliance_score: ${scan.compliance_score}`);
  console.log(`faces:            ${(scan.face_images || []).length}`);
  for (const face of scan.face_images || []) {
    console.log(`  face ${face.face_index}: ${face.filename} score=${face.compliance_score} result=${face.overall_result} declarations=${(face.extracted_declarations || []).length} violations=${(face.violations || []).length}`);
    console.log(`    image:     ${face.image_url}`);
    console.log(`    annotated: ${face.annotated_image_path}`);
  }
  console.log(`violations:       ${(scan.violations || []).length}`);
  for (const violation of (scan.violations || []).slice(0, 10)) {
    console.log(`  [${violation.severity}] ${violation.title}`);
  }
}

async function main() {
  const { file, direct } = parseArgs();
  const bytes = await readFile(file).catch(() => {
    console.error(`File not found: ${file}`);
    process.exit(1);
  });
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()];
  if (!mime) {
    console.error(`Unsupported extension: ${path.extname(file)}`);
    process.exit(1);
  }
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: mime }), path.basename(file));

  if (direct) {
    await directUnwrap(file);
    return;
  }

  const isVideo = mime.startsWith("video/");
  const endpoint = isVideo ? `${NODE_BASE}/video/frames` : `${NODE_BASE}/uploads/image`;
  console.log(`POST ${endpoint} (${(bytes.length / 1024 / 1024).toFixed(1)} MB, mask pipeline must be enabled: npm start -- --mask-scan)`);
  const response = await fetch(endpoint, { method: "POST", body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Upload failed with status ${response.status}:`, payload.message || payload.error || JSON.stringify(payload));
    process.exit(1);
  }

  console.log(`queued scan_id=${payload.scan_id} status=${payload.status}, polling every ${POLL_INTERVAL_MS / 1000}s…`);
  const scan = await pollScan(payload.scan_id);
  printScan(scan);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
