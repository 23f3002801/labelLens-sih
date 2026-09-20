/**
 * TEMPORARY gate check — injects requests at the Fastify layer to verify
 * ENABLE_MASK_SCAN routing in scanController.js. Deleted after running.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { buildServer } from "../src/server.js";
import prisma from "../src/config/db.js";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function multipart(files) {
  const boundary = "----gate" + randomUUID();
  const parts = [];
  for (const { field, filename, mime, data } of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
      )
    );
    parts.push(data);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function setFlag(on) {
  process.argv = process.argv.filter((a) => a !== "--mask-scan" && a !== "--no-mask-scan");
  if (on === true) process.argv.push("--mask-scan");
  if (on === false) process.argv.push("--no-mask-scan");
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

const app = await buildServer();
const createdIds = [];

async function waitForTerminal(scanId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.inspection.findUnique({ where: { id: scanId } });
    if (row && row.status !== "PROCESSING") return row;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return prisma.inspection.findUnique({ where: { id: scanId } });
}

try {
  // 1. Flag OFF: video upload -> 503
  setFlag(false);
  let res = await app.inject({
    method: "POST",
    url: "/api/v1/video/frames",
    ...multipart([{ field: "file", filename: "v.mp4", mime: "video/mp4", data: Buffer.from("x") }]),
  });
  check("flag OFF: video -> 503", res.statusCode === 503, `got ${res.statusCode} ${res.body.slice(0, 80)}`);

  // 2. Flag OFF: single image -> 202 via legacy path
  res = await app.inject({
    method: "POST",
    url: "/api/v1/uploads/image",
    ...multipart([{ field: "file", filename: "a.png", mime: "image/png", data: PNG_1PX }]),
  });
  const offImage = res.json();
  check("flag OFF: image -> 202", res.statusCode === 202, `got ${res.statusCode}`);
  if (offImage.scan_id) createdIds.push(offImage.scan_id);
  if (offImage.scan_id) {
    const row = await prisma.inspection.findUnique({ where: { id: offImage.scan_id } });
    check("flag OFF: image source stays 'image'", row?.rawOcrOutput?.source === "image", `source=${row?.rawOcrOutput?.source}`);
  }

  // 3. Flag ON: video -> 202 + PROCESSING, background job runs masked pipeline
  setFlag(true);
  res = await app.inject({
    method: "POST",
    url: "/api/v1/video/frames",
    ...multipart([{ field: "file", filename: "v.mp4", mime: "video/mp4", data: Buffer.from("x") }]),
  });
  const onVideo = res.json();
  check("flag ON: video -> 202", res.statusCode === 202, `got ${res.statusCode}`);
  if (onVideo.scan_id) createdIds.push(onVideo.scan_id);
  if (onVideo.scan_id) {
    const row = await waitForTerminal(onVideo.scan_id);
    check(
      "flag ON: video runs masked pipeline (source=video-masked)",
      row?.rawOcrOutput?.source === "video-masked" && row?.status !== "PROCESSING",
      `status=${row?.status} source=${row?.rawOcrOutput?.source} error=${row?.rawOcrOutput?.error}`
    );
  }

  // 4. Flag ON: image -> 202 via masked path (falls back to OCR, fails w/o FastAPI)
  res = await app.inject({
    method: "POST",
    url: "/api/v1/uploads/image",
    ...multipart([{ field: "file", filename: "a.png", mime: "image/png", data: PNG_1PX }]),
  });
  const onImage = res.json();
  check("flag ON: image -> 202", res.statusCode === 202, `got ${res.statusCode}`);
  if (onImage.scan_id) createdIds.push(onImage.scan_id);
  if (onImage.scan_id) {
    const row = await waitForTerminal(onImage.scan_id);
    check(
      "flag ON: image completes via mask source (fallback OCR when unwrap yields nothing)",
      row?.rawOcrOutput?.source === "image-masked" && ["COMPLIANT", "NON_COMPLIANT", "FAILED"].includes(row?.status),
      `status=${row?.status} source=${row?.rawOcrOutput?.source} score=${row?.complianceScore} error=${row?.rawOcrOutput?.error}`
    );
  }
} finally {
  if (createdIds.length) {
    await prisma.violation.deleteMany({ where: { inspectionId: { in: createdIds } } });
    await prisma.inspection.deleteMany({ where: { id: { in: createdIds } } });
    console.log(`cleaned up ${createdIds.length} test inspection(s)`);
  }
  await app.close();
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} gate checks passed`);
process.exit(failed.length ? 1 : 0);
