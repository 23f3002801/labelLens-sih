import prisma from "../config/db.js";

/**
 * Normalizes and extracts product metadata from extracted declarations and OCR output.
 * @param {Object} params
 * @param {Array} params.declarations - Extracted declarations from compliance engine
 * @param {Object} params.rawOcr - Raw OCR output / vision payload
 * @param {string} params.category - Category string ("food", "cosmetics", "general", etc.)
 * @returns {Object} Extracted product fields
 */
export function extractProductMetadata({ declarations = [], rawOcr = {}, category = "general" }) {
  const decls = Array.isArray(declarations) ? declarations : [];

  // 1. Commodity / Product Name
  const commodityDecl = decls.find(
    (d) =>
      d.field_name === "commodity_name" ||
      d.field_name === "product_name" ||
      d.id === "commodity_name" ||
      d.id === "product_name"
  )?.extracted_text;

  // 2. Brand Name
  const brandDecl = decls.find(
    (d) =>
      d.field_name === "brand_name" ||
      d.field_name === "brand" ||
      d.id === "brand_name"
  )?.extracted_text;

  // 3. Manufacturer Name
  const mfgDecl = decls.find(
    (d) =>
      d.field_name === "manufacturer_name" ||
      d.field_name === "manufacturer_details" ||
      d.field_name === "manufacturer" ||
      d.id === "manufacturer_name" ||
      d.id === "manufacturer_details"
  )?.extracted_text;

  // 4. Barcode
  const barcodeDecl =
    decls.find(
      (d) =>
        d.field_name === "barcode" ||
        d.field_name === "ean" ||
        d.id === "barcode"
    )?.extracted_text ||
    rawOcr?.barcode ||
    rawOcr?.barcode_number ||
    null;

  // Clean and fallback
  const commodityName = (
    commodityDecl ||
    rawOcr?.commodity_name ||
    rawOcr?.product_name ||
    (category && category !== "general" ? `${category.charAt(0).toUpperCase() + category.slice(1)} Pre-Packaged Commodity` : "Packaged Consumer Commodity")
  ).trim().slice(0, 150);

  const brandName = (
    brandDecl ||
    rawOcr?.brand_name ||
    rawOcr?.brand ||
    null
  )?.trim()?.slice(0, 100) || null;

  let manufacturerName = (
    mfgDecl ||
    rawOcr?.manufacturer_name ||
    rawOcr?.manufacturer ||
    null
  )?.trim()?.slice(0, 200) || null;

  const cleanCategory = (category || rawOcr?.category || "general").trim().toLowerCase().slice(0, 100);
  const cleanBarcode = barcodeDecl ? String(barcodeDecl).trim().slice(0, 50) : null;

  return {
    brandName,
    commodityName,
    manufacturerName,
    category: cleanCategory,
    barcode: cleanBarcode,
  };
}

/**
 * Creates a new Product record in Neon PostgreSQL for the inspection.
 * Always creates a fresh record for each inspection.
 * @param {Object} params
 * @returns {Promise<Object>} The newly created Prisma Product record
 */
export async function resolveOrCreateProduct({ declarations = [], rawOcr = {}, category = "general" }) {
  try {
    const meta = extractProductMetadata({ declarations, rawOcr, category });

    // Always create a new Product record for each inspection
    const created = await prisma.product.create({
      data: {
        barcode: meta.barcode,
        brandName: meta.brandName,
        commodityName: meta.commodityName,
        manufacturerName: meta.manufacturerName,
        category: meta.category,
      },
    });

    return created;
  } catch (error) {
    console.warn("Could not create Product record:", error.message);
    return null;
  }
}

export const createProduct = resolveOrCreateProduct;

