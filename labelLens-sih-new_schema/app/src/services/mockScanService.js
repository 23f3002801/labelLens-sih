// Fake backend. Same shape the real API is expected to return (see MOBILE_PLAN.txt section 5) so
// swapping scanService.js over to real fetch calls later doesn't touch any screen code.

const DECLARATION_LABELS = {
  manufacturer: 'Manufacturer Name & Address',
  net_quantity: 'Net Quantity',
  mrp: 'Maximum Retail Price',
  mfg_date: 'Month & Year of Manufacture',
  consumer_care: 'Consumer Care Details',
  country_of_origin: 'Country of Origin',
};

// Normalized (0-1) boxes, roughly scattered across a portrait label photo so the evidence
// overlay looks plausible on top of whatever the user actually captured.
const SAMPLE_BOXES = [
  { x: 0.08, y: 0.06, width: 0.62, height: 0.09 },
  { x: 0.08, y: 0.2, width: 0.4, height: 0.07 },
  { x: 0.55, y: 0.2, width: 0.37, height: 0.07 },
  { x: 0.08, y: 0.34, width: 0.5, height: 0.06 },
  { x: 0.08, y: 0.48, width: 0.75, height: 0.14 },
  { x: 0.08, y: 0.68, width: 0.45, height: 0.06 },
];

function declaration(type, status, message, boxIndex) {
  return {
    type,
    label: DECLARATION_LABELS[type],
    status,
    message,
    boundingBox: status === 'missing' ? null : SAMPLE_BOXES[boxIndex],
  };
}

const RESULT_VARIANTS = [
  {
    status: 'pass',
    declarations: [
      declaration('manufacturer', 'ok', '', 0),
      declaration('net_quantity', 'ok', '', 1),
      declaration('mrp', 'ok', '', 2),
      declaration('mfg_date', 'ok', '', 3),
      declaration('consumer_care', 'ok', '', 4),
      declaration('country_of_origin', 'ok', '', 5),
    ],
  },
  {
    status: 'fail',
    declarations: [
      declaration('manufacturer', 'ok', '', 0),
      declaration('net_quantity', 'wrong_format', 'Should be expressed in standard units (g/kg/ml/l), found "250 grms".', 1),
      declaration('mrp', 'too_small', 'Text height is 0.9mm, below the 4mm minimum required by law.', 2),
      declaration('mfg_date', 'ok', '', 3),
      declaration('consumer_care', 'missing', 'No consumer care phone number, email, or address found on the label.', null),
      declaration('country_of_origin', 'not_grouped', 'Found, but not grouped with the other mandatory declarations in the same field of vision.', 5),
    ],
  },
  {
    status: 'fail',
    declarations: [
      declaration('manufacturer', 'missing', 'No manufacturer/packer/importer name or address found on the label.', null),
      declaration('net_quantity', 'ok', '', 1),
      declaration('mrp', 'missing', 'No MRP declaration found on the label.', null),
      declaration('mfg_date', 'wrong_format', 'Date format unrecognized, expected MM/YYYY.', 3),
      declaration('consumer_care', 'missing', 'No consumer care phone number, email, or address found on the label.', null),
      declaration('country_of_origin', 'missing', 'Required for imported goods; no country of origin found.', null),
    ],
  },
];

let scanCounter = 0;
const scans = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitScan(fileUri, kind) {
  await delay(900 + Math.random() * 600);
  scanCounter += 1;
  const scanId = `mock-${kind}-${scanCounter}`;
  scans.set(scanId, {
    // Photo scans echo the captured photo back as evidence. Video scans have no real frame
    // yet (that's backend issue #8's job - flattening the 360 capture into a usable image) so
    // the mock falls back to a placeholder image instead of pointing an <Image> at a video file.
    evidenceImageUri: kind === 'photo' ? fileUri : null,
    variant: RESULT_VARIANTS[scanCounter % RESULT_VARIANTS.length],
  });
  return { scanId };
}

export function submitPhotoScan(fileUri) {
  return submitScan(fileUri, 'photo');
}

export function submitVideoScan(fileUri) {
  return submitScan(fileUri, 'video');
}

export async function getScanResult(scanId) {
  await delay(1400 + Math.random() * 800);
  const scan = scans.get(scanId);
  if (!scan) {
    throw new Error(`Unknown scanId: ${scanId}`);
  }
  return {
    scanId,
    status: scan.variant.status,
    evidenceImageUri: scan.evidenceImageUri,
    declarations: scan.variant.declarations,
  };
}
