import "dotenv/config";
import prisma from "../src/config/db.js";
import { resolveOrCreateProduct } from "../src/services/productService.js";
import { generateAndUploadReport } from "../src/services/reportService.js";

async function main() {
  console.log("=========================================================");
  console.log("   BACKFILL PRODUCTS & REPORTS FOR EXISTING INSPECTIONS   ");
  console.log("=========================================================\n");

  const inspections = await prisma.inspection.findMany({
    include: {
      product: true,
      violations: true,
      reports: true,
      inspector: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Found ${inspections.length} total inspections in NeonDB.\n`);

  let productsCreated = 0;
  let productsLinked = 0;
  let reportsCreated = 0;

  for (let i = 0; i < inspections.length; i++) {
    const inspection = inspections[i];
    const category = inspection.rawOcrOutput?.category || "general";
    const declarations = Array.isArray(inspection.extractedDeclarations)
      ? inspection.extractedDeclarations
      : [];
    const violations = inspection.violations || [];

    console.log(`[${i + 1}/${inspections.length}] Processing inspection ${inspection.id}...`);

    // 1. Resolve or create Product
    let product = inspection.product;
    if (!product) {
      product = await resolveOrCreateProduct({
        declarations,
        rawOcr: inspection.rawOcrOutput || {},
        category,
      });

      if (product?.id) {
        await prisma.inspection.update({
          where: { id: inspection.id },
          data: { productId: product.id },
        });
        productsCreated++;
        productsLinked++;
        console.log(`   + Linked Product: ${product.brandName || "Unknown"} - ${product.commodityName || "Commodity"} (${product.category})`);
      }
    } else {
      console.log(`   - Product already linked: ${product.brandName || ""} ${product.commodityName || ""}`);
    }

    // 2. Generate and upload Report if missing
    if (!inspection.reports || inspection.reports.length === 0) {
      console.log("   - Generating statutory report and uploading to Cloudinary...");
      const reportResult = await generateAndUploadReport({
        inspection,
        product,
        violations,
        declarations,
        inspector: inspection.inspector,
        category,
      });

      if (reportResult?.fileUrl) {
        reportsCreated++;
        console.log(`   + Report uploaded to Cloudinary: ${reportResult.fileUrl}`);
      } else {
        console.log("   ! Warning: Report generation failed");
      }
    } else {
      console.log(`   - Report already exists: ${inspection.reports[0].fileUrl}`);
    }
  }

  const finalProductCount = await prisma.product.count();
  const finalReportCount = await prisma.report.count();

  console.log("\n=========================================================");
  console.log("                   BACKFILL SUMMARY                      ");
  console.log("=========================================================");
  console.log(`Total Inspections Processed: ${inspections.length}`);
  console.log(`Products Created & Linked:   ${productsLinked}`);
  console.log(`Reports Created & Uploaded:  ${reportsCreated}`);
  console.log(`Total Products in DB Now:    ${finalProductCount}`);
  console.log(`Total Reports in DB Now:     ${finalReportCount}`);
  console.log("=========================================================\n");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
