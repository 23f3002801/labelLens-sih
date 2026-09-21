// Real backend implementation.
//
// Photo flow: submitPhotoScan uploads the photo and gets back a scan_id immediately (the server
// processes OCR + compliance in the background). getScanResult then polls the scan until it
// leaves PROCESSING and adapts the backend's response shape into the ScanResult shape the
// Result screen already renders (see MOBILE_PLAN.txt section 5).
//
// Video flow: submitVideoScan uploads the clip once and gets back one scan_id per extracted
// label face; getMultiScanResult polls them all in parallel with that same per-scan logic and
// merges the faces into a single product-level result.
import { File } from "expo-file-system";
import { API_BASE_URL } from "../config";

const UPLOAD_URL = `${API_BASE_URL}/api/v1/uploads/image`;
const VIDEO_FRAMES_URL = `${API_BASE_URL}/api/v1/video/frames`;
const scanUrl = (scanId) => `${API_BASE_URL}/api/v1/uploads/${scanId}`;
const DEMO_SCANS_URL = `${API_BASE_URL}/api/v1/demo/scans`;
const demoScanUrl = (demoId) => `${DEMO_SCANS_URL}/${demoId}`;

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 1200000;

const DECLARATION_LABELS = {
  manufacturer: "Manufacturer Name & Address",
  net_quantity: "Net Quantity",
  mrp: "Maximum Retail Price",
  mfg_date: "Month & Year of Manufacture",
  consumer_care: "Consumer Care Details",
  country_of_origin: "Country of Origin",
};

// Backend rule ids (server/rules.json) -> frontend declaration types.
const RULE_ID_TO_TYPE = {
  manufacturer_details: "manufacturer",
  net_quantity: "net_quantity",
  mrp: "mrp",
  manufacture_date: "mfg_date",
  consumer_care: "consumer_care",
  country_of_origin: "country_of_origin",
};

const FOUND_STATUS_TO_DECLARATION_STATUS = {
  COMPLIANT: "ok",
  FORMAT_ERROR: "wrong_format",
  TOO_SMALL: "too_small",
};

const SEVERITY_RANK = { CRITICAL: 3, MAJOR: 2, MINOR: 1 };

// A product is one physical package, so a declaration only has to be right on ONE of its faces:
// an MRP printed correctly on the back is declared, even if the front pane has no trace of it.
// When merging faces we therefore keep the *best* status per declaration type - a clean read
// beats a malformed one, and anything found at all beats "missing".
const DECLARATION_STATUS_RANK = {
  ok: 3,
  wrong_format: 2,
  too_small: 2,
  not_grouped: 2,
  missing: 1,
};

function declarationStatusRank(status) {
  return DECLARATION_STATUS_RANK[status] ?? 2;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Uploads the captured file to an endpoint that answers with a scan record and returns the
// parsed JSON body. The FormData part must be a real expo-file-system File - NOT React Native's
// classic {uri, name, type} descriptor object - because Expo SDK 57's global fetch is
// expo/fetch (WinterCG-compliant) and its FormData only accepts real Blob/File-like values,
// throwing "Unsupported FormDataPart implementation" on that old shape.
async function postCapture(url, fileUri, failureLabel) {
  const file = new File(fileUri);
  const form = new FormData();
  form.append("file", file, file.name);

  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${failureLabel} (${response.status}): ${body}`);
  }

  return response.json();
}

export async function submitPhotoScan(fileUri) {
  const data = await postCapture(UPLOAD_URL, fileUri, "Upload failed");
  return { scanId: data.scan_id };
}

// The video pipeline (server/routers/video.py POST /video/frames) unwraps a 360 capture into a
// handful of flat label-face crops (front/back/side) and creates its own Inspection - plus its
// own background OCR + compliance job - for every one of them. Each is pollable through exactly
// the same GET /uploads/{scan_id} a photo scan uses, so we keep the whole set of scan ids here
// and let getMultiScanResult merge the faces; nothing has to be downloaded and re-uploaded.
export async function submitVideoScan(fileUri) {
  const data = await postCapture(
    VIDEO_FRAMES_URL,
    fileUri,
    "Video frame extraction failed",
  );

  const frames = (data.images || [])
    .filter((frame) => frame?.scan_id)
    .map((frame) => ({
      scanId: frame.scan_id,
      // Cloudinary secure_url - the same value the scan record's image_path ends up holding,
      // kept as a fallback for frames whose poll never reports one.
      imageUrl: frame.image_url || null,
      filename: frame.filename || null,
    }));

  if (!frames.length) {
    throw new Error("No label faces were detected in the video.");
  }

  return { scanIds: frames.map((frame) => frame.scanId), frames };
}

// Backend bbox is in source-image pixels (x_min/y_min/x_max/y_max); the evidence overlay
// needs 0-1 normalized {x, y, width, height} relative to the same photo.
function normalizedBox(bbox, imageWidth, imageHeight) {
  if (!bbox || !imageWidth || !imageHeight) return null;
  return {
    x: bbox.x_min / imageWidth,
    y: bbox.y_min / imageHeight,
    width: (bbox.x_max - bbox.x_min) / imageWidth,
    height: (bbox.y_max - bbox.y_min) / imageHeight,
  };
}

// Violation records don't carry violation_type directly - it's baked into the title as
// "{field_name} - {VIOLATION_TYPE}" (see server/routers/uploads.py _process_scan).
function violationTypeFromTitle(title) {
  const parts = title.split(" - ");
  return parts[parts.length - 1].toLowerCase();
}

function pickWorstViolation(violations) {
  return violations
    .slice()
    .sort(
      (a, b) =>
        (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0),
    )[0];
}

function buildDeclarations(scan) {
  const imageWidth = scan.ocr_result?.image_metadata?.width;
  const imageHeight = scan.ocr_result?.image_metadata?.height;

  const foundById = new Map(
    (scan.extracted_declarations || []).map((d) => [d.id, d]),
  );
  const violationsByRuleCode = new Map();
  for (const v of scan.violations || []) {
    if (!violationsByRuleCode.has(v.rule_code))
      violationsByRuleCode.set(v.rule_code, []);
    violationsByRuleCode.get(v.rule_code).push(v);
  }

  const allRuleIds = new Set([
    ...Object.keys(RULE_ID_TO_TYPE),
    ...foundById.keys(),
    ...violationsByRuleCode.keys(),
  ]);

  return Array.from(allRuleIds).map((ruleId) => {
    const type = RULE_ID_TO_TYPE[ruleId] || ruleId;
    const found = foundById.get(ruleId);
    const violations = violationsByRuleCode.get(ruleId) || [];
    const label =
      DECLARATION_LABELS[type] ||
      found?.field_name ||
      ruleId.replace(/_/g, " ").toUpperCase();

    if (!found) {
      const missing = violations.find(
        (v) => violationTypeFromTitle(v.title) === "missing",
      );
      return {
        type,
        label,
        status: "missing",
        message: missing?.description || "Declaration not found on the label.",
        boundingBox: null,
      };
    }

    const worstViolation = pickWorstViolation(violations);
    const status = worstViolation
      ? violationTypeFromTitle(worstViolation.title)
      : FOUND_STATUS_TO_DECLARATION_STATUS[found.status] || "ok";

    return {
      type,
      label,
      status,
      message: status === "ok" ? "" : worstViolation?.description || "",
      boundingBox: normalizedBox(found.bbox, imageWidth, imageHeight),
    };
  });
}

// One finished scan record -> the per-frame shape the Result screen renders. Shared by
// live polling and by replay, so a replayed frame is indistinguishable from a fresh one.
function adaptScan(scan, fallbackScanId) {
  return {
    scanId: scan.scan_id || fallbackScanId,
    status: scan.status === "COMPLIANT" ? "pass" : "fail",
    evidenceImageUri: scan.image_path || null,
    declarations: buildDeclarations(scan),
  };
}

export async function getScanResult(scanId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (true) {
    const response = await fetch(scanUrl(scanId), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Fetching scan result failed (${response.status})`);
    }
    const scan = await response.json();

    if (scan.status === "FAILED") {
      throw new Error("Label processing failed on the server.");
    }

    if (scan.status !== "PROCESSING") {
      return adaptScan(scan, scanId);
    }

    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the scan result.");
    }

    await delay(POLL_INTERVAL_MS);
  }
}

// Collapses the per-face declaration lists into the one product-level list the Declarations
// section and the verdict banner read, keeping the best-ranked entry per declaration type (see
// DECLARATION_STATUS_RANK). Ties keep the earlier face, so the list stays in capture order.
// Per-face boundingBoxes are deliberately NOT carried over - a box is only meaningful against
// the image it was measured on, and each carousel page draws from its own frame's list instead.
function mergeDeclarations(declarationLists) {
  const bestByType = new Map();

  for (const declarations of declarationLists) {
    for (const declaration of declarations) {
      const current = bestByType.get(declaration.type);
      if (
        !current ||
        declarationStatusRank(declaration.status) >
          declarationStatusRank(current.status)
      ) {
        bestByType.set(declaration.type, {
          type: declaration.type,
          label: declaration.label,
          status: declaration.status,
          message: declaration.message,
          boundingBox: null,
        });
      }
    }
  }

  return Array.from(bestByType.values());
}

// Awaits every face of a 360 capture at once. `frames` accepts either bare scan ids or the
// {scanId, imageUrl} entries submitVideoScan returns. One face timing out or failing on the
// server is survivable - a 360 clip routinely yields a crop that OCRs badly - so those are
// dropped and the rest are still reported; only a total wipeout is an error.
export async function getMultiScanResult(frames) {
  const entries = frames.map((frame) =>
    typeof frame === "string" ? { scanId: frame, imageUrl: null } : frame,
  );

  const settled = await Promise.allSettled(
    entries.map((entry) => getScanResult(entry.scanId)),
  );

  const results = [];
  for (let i = 0; i < settled.length; i += 1) {
    const outcome = settled[i];
    if (outcome.status === "rejected") {
      console.warn(
        `[scanService] dropping frame ${entries[i].scanId}:`,
        outcome.reason?.message || outcome.reason,
      );
      continue;
    }
    results.push({
      ...outcome.value,
      evidenceImageUri: outcome.value.evidenceImageUri || entries[i].imageUrl,
    });
  }

  if (!results.length) {
    const firstFailure = settled.find((outcome) => outcome.status === "rejected");
    throw firstFailure?.reason instanceof Error
      ? firstFailure.reason
      : new Error("None of the label faces could be analyzed.");
  }

  return buildProductResult(results);
}

// Collapses the faces of one capture into the product-level result the Result screen takes.
function buildProductResult(frames) {
  const declarations = mergeDeclarations(frames.map((f) => f.declarations));

  return {
    // The per-face verdicts can't just be OR-ed together: a face that is missing declarations
    // printed elsewhere on the package fails on its own, yet the product still passes.
    status: declarations.every((d) => d.status === "ok") ? "pass" : "fail",
    declarations,
    frames,
    // Keeps the single-image shape usable by anything that only wants one evidence image.
    evidenceImageUri: frames[0].evidenceImageUri || null,
  };
}

// --- Replay (demo) mode ---------------------------------------------------------------
//
// Every scan the pipeline has finished is stored complete, so a demo can render a real
// past result instantly instead of re-running the capture. That matters because unwrapping
// a 360 video costs minutes of CPU (SAM 2) - far more than OCR or the compliance check.
// The frames come back in exactly the shape a live poll returns, so they go through the
// same adaptScan/mergeDeclarations path and land on the Result screen unchanged.

export async function listDemoScans() {
  const response = await fetch(DEMO_SCANS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Could not load demo scans (${response.status}).`);
  }
  const data = await response.json();
  return data.scans || [];
}

export async function getDemoScanResult(demoId) {
  const response = await fetch(demoScanUrl(demoId), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Could not load demo scan (${response.status}).`);
  }
  const data = await response.json();

  const frames = (data.frames || []).map((scan) => adaptScan(scan));
  if (!frames.length) {
    throw new Error("This demo scan has no frames to show.");
  }

  return buildProductResult(frames);
}
