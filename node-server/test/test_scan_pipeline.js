const fs = require("fs");
const path = require("path");

async function runTest() {
  console.log("=== Testing End-to-End Stitched Architecture ===");

  // 1. Health check
  console.log("\n1. Testing Fastify -> FastAPI health & citations proxy...");
  const citRes = await fetch("http://localhost:3000/api/v1/compliance/citations");
  if (!citRes.ok) {
    throw new Error(`Citations failed: ${citRes.status}`);
  }
  const citations = await citRes.json();
  const citationCount = Object.keys(citations).length;
  console.log(`   ✓ Successfully fetched ${citationCount} statutory citations from FastAPI through Fastify!`);

  // 2. Rules check
  console.log("\n2. Testing Rules proxy for category 'food'...");
  const rulesRes = await fetch("http://localhost:3000/api/v1/compliance/rules?category=food");
  if (!rulesRes.ok) {
    throw new Error(`Rules failed: ${rulesRes.status}`);
  }
  const rules = await rulesRes.json();
  const ruleCount = rules.mandatory_declarations?.length || rules.rules?.length || 0;
  console.log(`   ✓ Successfully retrieved ${ruleCount} active rules (Category: ${rules.category || 'food'})`);

  // 3. Scan Image upload
  console.log("\n3. Testing End-to-End Scan Pipeline (Fastify -> Cloudinary -> FastAPI OCR -> Compliance -> PostgreSQL)...");
  const testImagePath = path.join(__dirname, "../../web/src/assets/logo.png");
  if (!fs.existsSync(testImagePath)) {
    console.log("   ⚠️ Test image not found at " + testImagePath);
    return;
  }
  const fileBuffer = fs.readFileSync(testImagePath);
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer], { type: "image/png" }), "logo.png");
  formData.append("category", "food");

  const startTime = Date.now();
  const scanRes = await fetch("http://localhost:3000/api/v1/uploads/image?category=food", {
    method: "POST",
    body: formData,
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  if (!scanRes.ok) {
    const err = await scanRes.text();
    throw new Error(`Scan failed (${scanRes.status}): ${err}`);
  }

  const scanData = await scanRes.json();
  console.log(`   ✓ Scan pipeline completed in ${duration}s!`);
  console.log(`   - Scan ID: ${scanData.scan_id}`);
  console.log(`   - Status: ${scanData.status}`);
  console.log(`   - Compliance Score: ${scanData.compliance_score}%`);
  console.log(`   - Category: ${scanData.category || 'food'}`);
  console.log(`   - Declarations Extracted: ${scanData.extracted_declarations?.length || 0}`);
  if (scanData.image_path) {
    console.log(`   - Cloudinary Evidence URL: ${scanData.image_path.substring(0, 50)}...`);
  }
  if (scanData.violations?.length > 0) {
    const v0 = scanData.violations[0];
    console.log(`   - Sample Violation Detail:`);
    console.log(`     * Title: ${v0.title}`);
    console.log(`     * Package Area: ${v0.package_element}`);
    console.log(`     * Detected on Package: ${v0.detected_on_package}`);
    console.log(`     * Mandated by Law: ${v0.expected_on_package}`);
  }

  // 4. Verify DB persistence
  console.log("\n4. Verifying inspection retrieval from PostgreSQL via Prisma...");
  const getRes = await fetch(`http://localhost:3000/api/v1/uploads/${scanData.scan_id}`);
  if (!getRes.ok) {
    throw new Error(`Get scan failed: ${getRes.status}`);
  }
  const retrieved = await getRes.json();
  console.log(`   ✓ Retrieved persisted inspection from DB (ID: ${retrieved.scan_id}, Score: ${retrieved.compliance_score}%)`);

  console.log("\n🎉 ALL 3 SERVICES ARE FULLY STITCHED AND OPERATING FLAWLESSLY! 🎉\n");
}

runTest().catch((err) => {
  console.error("\n❌ Pipeline test error:", err.message);
  process.exit(1);
});
