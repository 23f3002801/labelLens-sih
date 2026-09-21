import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prisma from "../src/config/db.js";

async function main() {
  console.log("Seeding compliance rules into PostgreSQL...");
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const rulesPath = path.resolve(currentDir, "../../server/rules.json");

  let rules = [];
  if (fs.existsSync(rulesPath)) {
    const rawData = fs.readFileSync(rulesPath, "utf-8");
    const json = JSON.parse(rawData);
    const baseRules = (json.base_declarations || json.mandatory_declarations || []).map((rule) => ({ ...rule, category: "base" }));
    const categoryRules = Object.entries(json.categories || {}).flatMap(([category, data]) =>
      (data.declarations || []).map((rule) => ({ ...rule, category }))
    );
    rules = [...baseRules, ...categoryRules];
  }

  for (const rule of rules) {
    await prisma.complianceRule.upsert({
      where: { id: rule.id },
      update: {
        category: rule.category,
        fieldName: rule.field_name,
        description: rule.description || "",
        required: rule.required !== false,
        expectedFormat: rule.expected_format || "",
        minFontSizeMm: rule.min_font_size_mm || 1.0,
        regexPattern: rule.regex_pattern || null,
        detectionType: rule.detection_type || "text",
      },
      create: {
        id: rule.id,
        category: rule.category,
        fieldName: rule.field_name,
        description: rule.description || "",
        required: rule.required !== false,
        expectedFormat: rule.expected_format || "",
        minFontSizeMm: rule.min_font_size_mm || 1.0,
        regexPattern: rule.regex_pattern || null,
        detectionType: rule.detection_type || "text",
      },
    });
    console.log(`- Seeded rule: ${rule.id}`);
  }

  const count = await prisma.complianceRule.count();
  console.log(`Successfully synced ${count} compliance rules.`);
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
