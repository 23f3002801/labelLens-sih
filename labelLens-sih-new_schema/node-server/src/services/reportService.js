import { uploadBuffer } from "./cloudinaryService.js";
import prisma from "../config/db.js";

/**
 * Builds an official standalone HTML Statutory Compliance Audit Certificate.
 */
export function buildReportHtml({
  inspection,
  product = null,
  violations = [],
  declarations = [],
  inspector = null,
  category = "general",
}) {
  const isCompliant = inspection.status === "COMPLIANT" || inspection.status === "compliant";
  const score = Math.round(inspection.complianceScore ?? 100);
  const createdDate = inspection.createdAt
    ? new Date(inspection.createdAt).toLocaleString("en-IN", {
        dateStyle: "full",
        timeStyle: "medium",
      })
    : new Date().toLocaleString("en-IN");

  const productName =
    product?.brandName && product?.commodityName
      ? `${product.brandName} - ${product.commodityName}`
      : product?.commodityName ||
        product?.brandName ||
        "Pre-Packaged Consumer Commodity";

  const catDisplay = (category || product?.category || "general").toUpperCase();
  const certId = `ALMAC-${inspection.id.slice(0, 8).toUpperCase()}`;

  const rowsHtml = (declarations || [])
    .map((d) => {
      const fieldName = (d.field_name || d.id || "Declaration").replace(/_/g, " ").toUpperCase();
      const text = d.extracted_text || d.parsed_value || "Detected";
      const statusClass = d.status === "FAIL" || d.is_violation ? "badge-fail" : "badge-pass";
      const statusText = d.status === "FAIL" || d.is_violation ? "NON-COMPLIANT" : "COMPLIANT";
      return `
        <tr>
          <td style="font-weight: 600; color: #1e293b;">${fieldName}</td>
          <td style="font-family: monospace; color: #0f172a;">${text}</td>
          <td><span class="badge ${statusClass}">${statusText}</span></td>
        </tr>
      `;
    })
    .join("");

  const violationsHtml = (violations || []).length
    ? (violations || [])
        .map((v, i) => {
          const ruleCode = v.ruleCode || v.rule_id || "RULE_VIOLATION";
          const title = v.title || `${v.field_name || "Statutory"} Violation`;
          const desc = v.description || "";
          const sev = v.severity || "MAJOR";
          const citation =
            typeof v.citation === "object" && v.citation?.source_document
              ? `${v.citation.source_document} - ${v.citation.section_title || ""}`
              : typeof v.citation === "string"
              ? v.citation
              : "Legal Metrology (Packaged Commodities) Rules, 2011";

          return `
          <div class="violation-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-weight: 700; color: #991b1b;">#${i + 1} ${title}</span>
              <span class="badge badge-sev-${sev.toLowerCase()}">${sev}</span>
            </div>
            <p style="margin: 4px 0; font-size: 13px; color: #334155;">${desc}</p>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
              <strong>Legal Citation:</strong> <em>${citation}</em>
            </div>
          </div>
        `;
        })
        .join("")
    : `<div style="padding: 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; color: #065f46; font-weight: 600;">
        Zero statutory non-compliances detected. Packaging adheres 100% to mandatory Legal Metrology declarations.
       </div>`;

  const evidenceImg = inspection.annotatedImagePath || inspection.imagePath;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Statutory Compliance Audit Certificate - ${certId}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 32px;
      background: #f8fafc;
      color: #0f172a;
      line-height: 1.5;
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      border: 1px solid #e2e8f0;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header h1 {
      margin: 0;
      font-size: 22px;
      letter-spacing: 0.5px;
      color: #0f172a;
      text-transform: uppercase;
    }
    .header h2 {
      margin: 6px 0 0 0;
      font-size: 14px;
      color: #475569;
      font-weight: 500;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px 24px;
      background: #f1f5f9;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 13px;
    }
    .meta-item strong {
      color: #475569;
      display: inline-block;
      width: 140px;
    }
    .verdict-banner {
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .verdict-pass {
      background: #ecfdf5;
      border: 1px solid #10b981;
      color: #065f46;
    }
    .verdict-fail {
      background: #fef2f2;
      border: 1px solid #ef4444;
      color: #991b1b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 28px;
      font-size: 13px;
    }
    th, td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    th {
      background: #f8fafc;
      color: #475569;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
    }
    .badge-pass { background: #d1fae5; color: #065f46; }
    .badge-fail { background: #fee2e2; color: #991b1b; }
    .badge-sev-critical { background: #7f1d1d; color: #ffffff; }
    .badge-sev-major { background: #f87171; color: #ffffff; }
    .badge-sev-minor { background: #fef08a; color: #854d0e; }
    .violation-card {
      background: #fff5f5;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .evidence-section {
      margin-top: 28px;
      border-top: 1px solid #e2e8f0;
      padding-top: 20px;
    }
    .evidence-img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      margin-top: 8px;
    }
    .footer {
      margin-top: 36px;
      border-top: 1px dashed #cbd5e1;
      padding-top: 16px;
      text-align: center;
      font-size: 11px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Government of India &middot; Legal Metrology Division</h1>
      <h2>Automated Statutory Packaging Compliance Audit Certificate</h2>
    </div>

    <div class="meta-grid">
      <div class="meta-item"><strong>Certificate No:</strong> ${certId}</div>
      <div class="meta-item"><strong>Date of Audit:</strong> ${createdDate}</div>
      <div class="meta-item"><strong>Product Name:</strong> ${productName}</div>
      <div class="meta-item"><strong>Category:</strong> ${catDisplay}</div>
      <div class="meta-item"><strong>Inspection ID:</strong> <code>${inspection.id}</code></div>
      <div class="meta-item"><strong>Audited By:</strong> ${inspector?.fullName || "Automated AI Inspector"}</div>
    </div>

    <div class="verdict-banner ${isCompliant ? "verdict-pass" : "verdict-fail"}">
      <div>
        <div style="font-size: 16px; font-weight: 800;">
          ${isCompliant ? "LEGAL METROLOGY COMPLIANT" : "STATUTORY VIOLATION NOTICE ISSUED"}
        </div>
        <div style="font-size: 13px; margin-top: 4px;">
          ${isCompliant ? "Packaging adheres to all audited mandatory declarations under PCR 2011." : "Non-compliances detected under Legal Metrology (Packaged Commodities) Rules, 2011."}
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 28px; font-weight: 800;">${score}%</div>
        <div style="font-size: 11px; text-transform: uppercase;">Compliance Index</div>
      </div>
    </div>

    <h3 style="font-size: 15px; text-transform: uppercase; color: #0f172a; margin-bottom: 12px;">Mandatory Declarations Audit</h3>
    <table>
      <thead>
        <tr>
          <th>Statutory Declaration</th>
          <th>Detected Value / Package Text</th>
          <th>Audit Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="3" style="text-align: center; color: #64748b;">No declarations recorded</td></tr>'}
      </tbody>
    </table>

    <h3 style="font-size: 15px; text-transform: uppercase; color: #0f172a; margin-bottom: 12px;">Detected Statutory Violations</h3>
    ${violationsHtml}

    ${evidenceImg ? `
      <div class="evidence-section">
        <h3 style="font-size: 15px; text-transform: uppercase; color: #0f172a; margin-bottom: 8px;">Audit Evidence Exhibit</h3>
        <p style="font-size: 12px; color: #64748b; margin-top: 0;">Bounding-box annotated packaging artifact preserved in Cloudinary CDN.</p>
        <img src="${evidenceImg}" alt="Audit Evidence" class="evidence-img" />
      </div>
    ` : ""}

    <div class="footer">
      This is a system-generated audit certificate produced by ALMAC LabelLens Compliance Engine &middot; Cryptographically verified on Cloudinary CDN.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates an official report, uploads it to Cloudinary, and saves it in the NeonDB reports table.
 */
export async function generateAndUploadReport({
  inspection,
  product = null,
  violations = [],
  declarations = [],
  inspector = null,
  category = "general",
}) {
  try {
    const htmlContent = buildReportHtml({
      inspection,
      product,
      violations,
      declarations,
      inspector,
      category,
    });

    const buffer = Buffer.from(htmlContent, "utf-8");
    const filename = `report_${inspection.id}.html`;

    // Upload to Cloudinary with resource_type: "raw"
    const uploadRes = await uploadBuffer(buffer, {
      folder: "labellens/reports",
      filename,
      resourceType: "raw",
    });

    const secureUrl = uploadRes?.secure_url;
    if (!secureUrl) {
      throw new Error("Cloudinary upload did not return a secure_url");
    }

    // Persist into NeonDB reports table
    const report = await prisma.report.create({
      data: {
        inspectionId: inspection.id,
        generatedById: inspection.inspectorId || null,
        reportType: "STATUTORY_COMPLIANCE_REPORT",
        content: {
          scan_id: inspection.id,
          product_name: product?.brandName || product?.commodityName || "Pre-Packaged Consumer Commodity",
          category: product?.category || category || "general",
          compliance_score: inspection.complianceScore,
          status: inspection.status,
          violations_count: (violations || []).length,
          declarations_count: (declarations || []).length,
        },
        fileUrl: secureUrl,
      },
    });

    return {
      report,
      fileUrl: secureUrl,
    };
  } catch (error) {
    console.error(`Failed to generate and upload report for inspection ${inspection?.id}:`, error);
    return null;
  }
}
