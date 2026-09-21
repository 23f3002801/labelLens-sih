/**
 * Standalone verification of api.js cache behaviour — reproduces the exact
 * user flow: load inspections, make a new scan, switch tabs, come back.
 * Run with: node scripts/verify-cache.mjs
 */
import assert from "node:assert/strict";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- browser stubs ---------------------------------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { location: { pathname: "/dashboard" }, assign: () => {} };

const mkScan = (id, status) => ({
  scan_id: id,
  status,
  image_path: `http://img/${id}`,
  created_at: new Date().toISOString(),
  compliance_score: status === "COMPLIANT" ? 100 : 40,
  violations: status === "COMPLIANT" ? [] : [{ title: "Missing MRP", description: "d", severity: "MAJOR", rule_code: "R6" }],
});

// What the backend returns for GET /inspections (mutated during the test).
let serverList = {
  page: 1,
  limit: 100,
  total: 1,
  total_pages: 1,
  items: [mkScan("scan-1", "COMPLIANT")],
};
let listCalls = 0;

globalThis.fetch = async () => {
  listCalls++;
  await sleep(30); // simulate network latency
  return { ok: true, status: 200, text: async () => JSON.stringify(serverList) };
};

// Minimal XHR mock: uploadImage always succeeds and returns a scan result.
const scanResponse = mkScan("scan-2", "NON_COMPLIANT");
globalThis.XMLHttpRequest = class {
  constructor() {
    this.upload = {};
  }
  open() {}
  setRequestHeader() {}
  send() {
    this.status = 200;
    this.responseText = JSON.stringify(scanResponse);
    setTimeout(() => this.onload(), 5);
  }
};

// ---- the test --------------------------------------------------------------
const api = (await import("../src/services/api.js")).default;

// 1. First load of /dashboard/inspections → network call.
const first = await api.getInspections(1, 100);
assert.equal(listCalls, 1, "first load must hit the network once");
assert.equal(first.items.length, 1);

// 2. Fresh cache hit → no network.
await api.getInspections(1, 100);
assert.equal(listCalls, 1, "revisit inside TTL must not refetch");

// 3. Mounted page subscribes (as Inspections.jsx does).
const updates = [];
const unsubscribe = api.subscribeInspections(1, 100, (d) => updates.push(d));

// 4. User makes a new scan (uploadImage → cacheScanResult).
await api.uploadImage(new Blob(["img"]));

const seeded = api.peekInspections(1, 100)?.data;
assert.ok(seeded, "list cache must exist right after the scan");
assert.equal(
  seeded.items[0].id,
  "scan-2",
  "NEW SCAN MUST BE IN THE CACHED LIST IMMEDIATELY AFTER THE SCAN"
);
assert.equal(seeded.items[0].status, "non_compliant");
assert.ok(
  api.peekInspection("scan-2"),
  "detail cache must be seeded with the new scan"
);
assert.ok(updates.length >= 1, "mounted pages must be notified of the new scan");

// The scan is now persisted server-side; the backend list includes it.
serverList = {
  ...serverList,
  total: 2,
  total_pages: 1,
  items: [mkScan("scan-2", "NON_COMPLIANT"), mkScan("scan-1", "COMPLIANT")],
};

// 5. User switches tabs and comes back to /dashboard/inspections.
const revisited = await api.getInspections(1, 100);
assert.ok(
  revisited.items.some((i) => i.id === "scan-2"),
  "coming back to the inspections tab must show the new scan"
);

// 6. Background revalidation converges to server truth without duplicates.
await sleep(80);
const converged = api.peekInspections(1, 100)?.data;
assert.equal(
  converged.items.filter((i) => i.id === "scan-2").length,
  1,
  "no duplicate entries after revalidation"
);
assert.equal(converged.items.length, 2, "list converged to server truth");
assert.ok(updates.length >= 2, "subscribers received the revalidated data");

// 7. Detail page resolves the new scan from cache without a network call.
const detail = await api.getInspection("scan-2");
assert.equal(detail.id, "scan-2");
assert.equal(detail.violations.length, 1);
assert.equal(detail.violations[0].title, "Missing MRP");

unsubscribe();
console.log("✓ all cache-flow checks passed");
