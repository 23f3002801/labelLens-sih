const prisma = require("../config/db");
const { uploadBuffer } = require("../services/cloudinaryService");
const {
  runOcr,
  evaluateOcrCompliance,
  unwrapVideo,
  getCitations,
  searchCitations,
  getRules,
} = require("../services/fastapiService");

const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
];

const ALLOWED_VIDEO_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/webm",
];

/**
 * End-to-End Photo Scan Pipeline:
 * 1. Receive image file from client.
 * 2. Upload image to Cloudinary.
 * 3. Send image to FastAPI's stateless OCR engine.
 * 4. Send OCR result to FastAPI's stateless compliance evaluator.
 * 5. Persist Inspection and Violation records in PostgreSQL via Prisma.
 * 6. Return comprehensive response.
 */
async function handlePhotoScan(req, reply) {
  try {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Image file is required",
      });
    }

    if (!ALLOWED_IMAGE_MIMES.includes(data.mimetype)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: `Invalid file type '${data.mimetype}'. Supported: JPG, PNG, WEBP, GIF, BMP`,
      });
    }

    const imageBuffer = await data.toBuffer();
    if (imageBuffer.length === 0) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Uploaded image file is empty",
      });
    }

    const filename = data.filename || "label.jpg";
    const inspectorId = req.user?.id || null;
    const category = req.query?.category || data.fields?.category?.value || "general";

    // Concurrent: Upload to Cloudinary & run OCR on FastAPI
    const [cloudinaryResult, ocrResult] = await Promise.all([
      uploadBuffer(imageBuffer, { filename }).catch((err) => {
        req.log.warn(`Cloudinary upload warning: ${err.message}`);
        return { secure_url: null, public_id: null };
      }),
      runOcr(imageBuffer, filename),
    ]);

    if (!ocrResult || !ocrResult.success) {
      return reply.code(502).send({
        error: "Bad Gateway",
        message: `OCR extraction failed: ${ocrResult?.error || "Unknown error"}`,
      });
    }

    // Run Compliance Evaluation on OCR payload with category scoping
    const complianceResult = await evaluateOcrCompliance(ocrResult, category);

    const overallStatus =
      complianceResult.overall_result === "PASS"
        ? "COMPLIANT"
        : "NON_COMPLIANT";

    const extractedDeclarations = (
      complianceResult.summary?.what_was_found || []
    ).map((d) => ({
      id: d.id,
      field_name: d.field_name,
      extracted_text: d.extracted_text,
      parsed_value: d.parsed_value,
      confidence: d.confidence,
      font_size_mm_est: d.font_size_mm_est,
      status: d.status,
    }));

    // Upload annotated bounding-box image to Cloudinary CDN
    let annotatedCloudinaryUrl = null;
    const annotatedB64 = ocrResult.annotated_image_base64 || complianceResult.annotated_image_base64;
    if (annotatedB64) {
      try {
        const cleanB64 = annotatedB64.replace(/^data:image\/[a-z]+;base64,/, "");
        const annBuffer = Buffer.from(cleanB64, "base64");
        const annRes = await uploadBuffer(annBuffer, {
          filename: `annotated_${filename}`,
          folder: "labellens/annotated",
        });
        annotatedCloudinaryUrl = annRes.secure_url;
      } catch (annErr) {
        req.log.warn(`Cloudinary annotated upload warning: ${annErr.message}`);
      }
    }

    // Create Inspection record in NeonDB via Prisma
    const inspection = await prisma.inspection.create({
      data: {
        inspectorId,
        imagePath: cloudinaryResult.secure_url || null,
        annotatedImagePath: annotatedCloudinaryUrl || null,
        rawOcrOutput: ocrResult,
        extractedDeclarations,
        complianceScore: complianceResult.compliance_score || 0.0,
        status: overallStatus,
      },
    });

    // Create Violation records — include enriched citation & package discrepancy
    // fields so they are persisted and available when fetching scans by ID later.
    const violationsData = (complianceResult.summary?.whats_wrong || []).map(
      (v) => ({
        inspectionId: inspection.id,
        ruleCode: v.rule_id || "RULE_VIOLATION",
        severity: v.severity || "MAJOR",
        title: `${v.field_name || "Declaration"} - ${(v.violation_type || "VIOLATION").toUpperCase()}`,
        description: v.description || "",
        evidenceBbox: v.evidence_bbox || null,
        citation: v.citation || null,
        detectedOnPackage: v.detected_on_package || null,
        expectedOnPackage: v.expected_on_package || null,
        packageElement: v.package_element || null,
      })
    );

    if (violationsData.length > 0) {
      await prisma.violation.createMany({
        data: violationsData,
      });
    }

    const violations = await prisma.violation.findMany({
      where: { inspectionId: inspection.id },
    });

    // Map violations with statutory citation and package element discrepancy details.
    // Keyed by rule_id (primary) AND field_name (fallback) so the lookup is robust
    // even when ruleCode was stored as a fallback value like "RULE_VIOLATION".
    const extraMap = {};
    (complianceResult.summary?.whats_wrong || []).forEach((w) => {
      const payload = {
        citation: w.citation || null,
        detected_on_package: w.detected_on_package || null,
        expected_on_package: w.expected_on_package || null,
        package_element: w.package_element || null,
      };
      if (w.rule_id) extraMap[w.rule_id] = payload;
      // Secondary fallback: key by field_name so lookup works if rule_id was missing
      if (w.field_name && !extraMap[w.field_name]) extraMap[w.field_name] = payload;
    });

    return reply.code(200).send({
      scan_id: inspection.id,
      status: inspection.status,
      image_path: inspection.imagePath,
      annotated_image_path: inspection.annotatedImagePath,
      annotated_image_base64: ocrResult.annotated_image_base64 || complianceResult.annotated_image_base64 || null,
      cloudinary_public_id: cloudinaryResult.public_id,
      created_at: inspection.createdAt,
      compliance_score: inspection.complianceScore,
      overall_result: complianceResult.overall_result,
      category: category,
      ocr_result: inspection.rawOcrOutput,
      extracted_declarations: inspection.extractedDeclarations,
      missing_declarations: complianceResult.summary?.whats_missing || [],
      violations: violations.map((v) => {
        // Try ruleCode first, then parse field name from stored title as last resort
        const titleField = v.title?.split(" - ")[0];
        const extra = extraMap[v.ruleCode] || extraMap[titleField] || {};
        return {
          id: v.id,
          rule_code: v.ruleCode,
          severity: v.severity,
          title: v.title,
          description: v.description,
          evidence_bbox: v.evidenceBbox,
          citation: extra.citation || null,
          detected_on_package: extra.detected_on_package || null,
          expected_on_package: extra.expected_on_package || null,
          package_element: extra.package_element || null,
        };
      }),
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: error.message || "An error occurred while processing photo scan",
    });
  }
}

/**
 * End-to-End Video Scan Pipeline:
 * 1. Receive video file from client.
 * 2. Send video to FastAPI's stateless /api/v1/video/unwrap.
 * 3. Receive extracted face image frames.
 * 4. Asynchronously map over frames, uploading each to Cloudinary.
 * 5. Run OCR & compliance evaluation on key extracted frame(s).
 * 6. Save consolidated scan record with violations to NeonDB via Prisma.
 */
async function handleVideoScan(req, reply) {
  try {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Video file is required",
      });
    }

    const videoBuffer = await data.toBuffer();
    if (videoBuffer.length === 0) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Uploaded video file is empty",
      });
    }

    const filename = data.filename || "video.mp4";
    const inspectorId = req.user?.id || null;
    const category = req.query?.category || data.fields?.category?.value || "general";

    // Step 1: Forward video to FastAPI stateless unwrap
    const unwrapResponse = await unwrapVideo(videoBuffer, filename);
    if (!unwrapResponse.success || !unwrapResponse.frames?.length) {
      return reply.code(422).send({
        error: "Unprocessable Entity",
        message: "No label faces detected in the video",
      });
    }

    const frames = unwrapResponse.frames;

    // Step 2: Upload extracted frames to Cloudinary in parallel
    const uploadedFrames = await Promise.all(
      frames.map(async (frame, index) => {
        const frameBuffer = Buffer.from(frame.image_base64, "base64");
        const cloudRes = await uploadBuffer(frameBuffer, {
          filename: `video_frame_${index}_${frame.filename || "label.jpg"}`,
        }).catch(() => ({ secure_url: null, public_id: null }));

        return {
          frame_index: frame.frame_index ?? index,
          filename: frame.filename,
          image_url: cloudRes.secure_url,
          cloudinary_public_id: cloudRes.public_id,
          buffer: frameBuffer,
        };
      })
    );

    // Step 3: Run OCR and compliance evaluation on best frame (first unwrapped face)
    const primaryFrame = uploadedFrames[0];
    const ocrResult = await runOcr(primaryFrame.buffer, primaryFrame.filename);
    const complianceResult = await evaluateOcrCompliance(ocrResult, category);

    const overallStatus =
      complianceResult.overall_result === "PASS"
        ? "COMPLIANT"
        : "NON_COMPLIANT";

    const extractedDeclarations = (
      complianceResult.summary?.what_was_found || []
    ).map((d) => ({
      id: d.id,
      field_name: d.field_name,
      extracted_text: d.extracted_text,
      parsed_value: d.parsed_value,
      confidence: d.confidence,
      font_size_mm_est: d.font_size_mm_est,
      status: d.status,
    }));

    // Step 4: Persist consolidated scan in DB
    const inspection = await prisma.inspection.create({
      data: {
        inspectorId,
        imagePath: primaryFrame.image_url,
        annotatedImagePath: ocrResult.annotated_image || null,
        rawOcrOutput: {
          ...ocrResult,
          video_frames: uploadedFrames.map((f) => ({
            frame_index: f.frame_index,
            image_url: f.image_url,
            cloudinary_public_id: f.cloudinary_public_id,
          })),
        },
        extractedDeclarations,
        complianceScore: complianceResult.compliance_score || 0.0,
        status: overallStatus,
      },
    });

    const violationsData = (complianceResult.summary?.whats_wrong || []).map(
      (v) => ({
        inspectionId: inspection.id,
        ruleCode: v.rule_id || "RULE_VIOLATION",
        severity: v.severity || "MAJOR",
        title: `${v.field_name || "Declaration"} - ${(v.violation_type || "VIOLATION").toUpperCase()}`,
        description: v.description || "",
        evidenceBbox: v.evidence_bbox || null,
        citation: v.citation || null,
        detectedOnPackage: v.detected_on_package || null,
        expectedOnPackage: v.expected_on_package || null,
        packageElement: v.package_element || null,
      })
    );

    if (violationsData.length > 0) {
      await prisma.violation.createMany({
        data: violationsData,
      });
    }

    const violations = await prisma.violation.findMany({
      where: { inspectionId: inspection.id },
    });

    // Bug #3 fix: build extraMap for video scan just like photo scan does
    const videoExtraMap = {};
    (complianceResult.summary?.whats_wrong || []).forEach((w) => {
      const payload = {
        citation: w.citation || null,
        detected_on_package: w.detected_on_package || null,
        expected_on_package: w.expected_on_package || null,
        package_element: w.package_element || null,
      };
      if (w.rule_id) videoExtraMap[w.rule_id] = payload;
      if (w.field_name && !videoExtraMap[w.field_name]) videoExtraMap[w.field_name] = payload;
    });

    return reply.code(200).send({
      scan_id: inspection.id,
      status: inspection.status,
      image_path: inspection.imagePath,
      annotated_image_base64: ocrResult.annotated_image_base64 || complianceResult.annotated_image_base64 || null,
      frames_count: uploadedFrames.length,
      frames: uploadedFrames.map((f) => ({
        frame_index: f.frame_index,
        image_url: f.image_url,
        cloudinary_public_id: f.cloudinary_public_id,
      })),
      compliance_score: inspection.complianceScore,
      overall_result: complianceResult.overall_result,
      created_at: inspection.createdAt,
      extracted_declarations: inspection.extractedDeclarations,
      violations: violations.map((v) => {
        const titleField = v.title?.split(" - ")[0];
        const extra = videoExtraMap[v.ruleCode] || videoExtraMap[titleField] || {};
        return {
          id: v.id,
          rule_code: v.ruleCode,
          severity: v.severity,
          title: v.title,
          description: v.description,
          evidence_bbox: v.evidenceBbox,
          citation: extra.citation || null,
          detected_on_package: extra.detected_on_package || null,
          expected_on_package: extra.expected_on_package || null,
          package_element: extra.package_element || null,
        };
      }),
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: error.message || "An error occurred while processing video scan",
    });
  }
}

/**
 * Get scan details by ID matching the legacy FastAPI /api/v1/uploads/{scan_id} format
 */
async function getScanById(req, reply) {
  try {
    const { scanId } = req.params;
    const inspection = await prisma.inspection.findUnique({
      where: { id: scanId },
      include: {
        violations: true,
        inspector: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!inspection) {
      return reply.code(404).send({
        error: "Not Found",
        message: "Scan not found",
      });
    }

    return reply.code(200).send({
      scan_id: inspection.id,
      status: inspection.status,
      image_path: inspection.imagePath,
      annotated_image_path: inspection.annotatedImagePath,
      annotated_image_base64: inspection.rawOcrOutput?.annotated_image_base64 || null,
      created_at: inspection.createdAt,
      compliance_score: inspection.complianceScore,
      ocr_result: inspection.rawOcrOutput,
      extracted_declarations: inspection.extractedDeclarations,
      inspector: inspection.inspector,
      violations: inspection.violations.map((v) => ({
        id: v.id,
        rule_code: v.ruleCode,
        severity: v.severity,
        title: v.title,
        description: v.description,
        evidence_bbox: v.evidenceBbox,
        citation: v.citation || null,
        detected_on_package: v.detectedOnPackage || null,
        expected_on_package: v.expectedOnPackage || null,
        package_element: v.packageElement || null,
      })),
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to retrieve scan details",
    });
  }
}

/**
 * List inspections with pagination
 */
async function listScans(req, reply) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.status) {
      where.status = req.query.status.toUpperCase();
    }

    const [total, inspections] = await Promise.all([
      prisma.inspection.count({ where }),
      prisma.inspection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          violations: true,
        },
      }),
    ]);

    return reply.code(200).send({
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      items: inspections.map((ins) => ({
        scan_id: ins.id,
        status: ins.status,
        image_path: ins.imagePath,
        compliance_score: ins.complianceScore,
        violations_count: ins.violations.length,
        created_at: ins.createdAt,
      })),
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to list scans",
    });
  }
}

async function getComplianceRules(req, reply) {
  try {
    const category = req.query?.category || "general";
    const rules = await getRules(category);
    return reply.code(200).send(rules);
  } catch (error) {
    req.log.error(error);
    return reply.code(502).send({ error: "Failed to fetch rules from FastAPI compute engine", message: error.message });
  }
}

async function getStatutoryCitations(req, reply) {
  try {
    const citations = await getCitations();
    return reply.code(200).send(citations);
  } catch (error) {
    req.log.error(error);
    return reply.code(502).send({ error: "Failed to fetch citations from FastAPI compute engine", message: error.message });
  }
}

async function searchStatutoryCorpus(req, reply) {
  try {
    const query = req.query?.q || "";
    const topK = parseInt(req.query?.top_k) || 3;
    const results = await searchCitations(query, topK);
    return reply.code(200).send({ query, total_results: results.length, results });
  } catch (error) {
    req.log.error(error);
    return reply.code(502).send({ error: "Failed to search corpus on FastAPI compute engine", message: error.message });
  }
}

module.exports = {
  handlePhotoScan,
  handleVideoScan,
  getScanById,
  listScans,
  getComplianceRules,
  getStatutoryCitations,
  searchStatutoryCorpus,
};
