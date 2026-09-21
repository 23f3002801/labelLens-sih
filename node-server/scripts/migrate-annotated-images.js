/**
 * One-time data migration.
 *
 * The scan pipeline used to persist the annotated image as multi-megabyte
 * base64 inside raw_ocr_output (~40 MB across 55 rows), which made every
 * inspections query drag the whole blob over the network (limit=100 took
 * 40+ seconds). This script:
 *   1. finds rows whose raw_ocr_output still contains annotated_image_base64
 *      (or the legacy annotated_image key),
 *   2. uploads each image to Cloudinary,
 *   3. saves its URL in annotated_image_path, and
 *   4. strips the base64 keys from raw_ocr_output.
 *
 * Lossless (images are relocated, not deleted) and idempotent — rows without
 * the base64 keys are skipped, so it is safe to re-run after an interruption.
 *
 * Run: node scripts/migrate-annotated-images.js
 */
import "dotenv/config";
import prisma from "../src/config/db.js";
import { uploadBuffer } from "../src/services/cloudinaryService.js";
import { extractAnnotatedImage } from "../src/controllers/scanController.js";

async function main() {
  console.log("Loading inspections…");
  const rows = await prisma.inspection.findMany({
    select: { id: true, rawOcrOutput: true },
  });

  const pending = rows.filter(
    (r) =>
      r.rawOcrOutput &&
      (r.rawOcrOutput.annotated_image_base64 || r.rawOcrOutput.annotated_image)
  );
  console.log(`${pending.length} of ${rows.length} rows need migration`);

  let migrated = 0;
  let failed = 0;
  for (const [i, row] of pending.entries()) {
    const { annotatedBase64, ocrSlim } = extractAnnotatedImage(row.rawOcrOutput);
    try {
      const result = await uploadBuffer(Buffer.from(annotatedBase64, "base64"), {
        filename: `annotated_${row.id}`,
      });
      await prisma.inspection.update({
        where: { id: row.id },
        data: {
          annotatedImagePath: result.secure_url,
          rawOcrOutput: ocrSlim,
        },
      });
      migrated++;
      console.log(
        `[${i + 1}/${pending.length}] ${row.id.slice(0, 8)}… → ${result.secure_url}`
      );
    } catch (err) {
      failed++;
      console.error(
        `[${i + 1}/${pending.length}] ${row.id.slice(0, 8)}… FAILED: ${err.message} (row left untouched)`
      );
    }
  }

  console.log(`Done. migrated=${migrated} failed=${failed}`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Migration aborted:", err);
  process.exit(1);
});
