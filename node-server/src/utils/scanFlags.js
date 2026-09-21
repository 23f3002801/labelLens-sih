/**
 * Single-knob feature flag for the SAM2 label-mask scan pipeline
 * (FastAPI POST /api/v1/video/unwrap → per-face OCR → compliance).
 *
 * Two ways to toggle, CLI wins over env:
 *   Terminal: npm start -- --mask-scan   (enable)
 *             npm start -- --no-mask-scan (disable, overrides env)
 *   Env:      ENABLE_MASK_SCAN=true|false in .env
 *
 * Default is OFF: photo scans run the direct-OCR pipeline and video
 * uploads are rejected with 503 until the mask pipeline is enabled.
 */
const TRUTHY = new Set(["true", "1", "on", "yes"]);

export function isMaskScanEnabled() {
  if (process.argv.includes("--no-mask-scan")) return false;
  if (process.argv.includes("--mask-scan")) return true;
  return TRUTHY.has(String(process.env.ENABLE_MASK_SCAN || "").trim().toLowerCase());
}
