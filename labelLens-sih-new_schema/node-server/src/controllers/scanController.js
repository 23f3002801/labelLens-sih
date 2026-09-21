import prisma from "../config/db.js";
import { createHash } from "crypto";
import { uploadBuffer } from "../services/cloudinaryService.js";
import {
  runOcr,
  evaluateOcrCompliance,
  evaluateProductCompliance,
  getCitations,
  searchCitations,
  getRules,
  unwrapVideo,
} from "../services/fastapiService.js";
import { isMaskScanEnabled } from "../utils/scanFlags.js";
import * as scanCache from "../utils/scanCache.js";
import { resolveOrCreateProduct } from "../services/productService.js";
import { generateAndUploadReport } from "../services/reportService.js";
import {
  getInspectionScope,
  mergeScope,
  assertInspectionAccess,
  SecurityScopingError,
} from "../services/dataScopingService.js";
import { ROLES } from "../constants/rbac.js";

function getScanAttributionData(user) {
  if (!user) return {};
  const role = (user.role || "").toUpperCase();
  if (role === ROLES.INSPECTOR || role === ROLES.MANUFACTURER) {
    return { inspectorId: user.id };
  }
  if (role === ROLES.REVIEWER) {
    return { reviewerId: user.id };
  }
  if (role === ROLES.CONSUMER) {
    return { consumerId: user.id };
  }
  return { inspectorId: user.id };
}

/**
 * Split the multi-megabyte annotated-image base64 out of the FastAPI OCR
 * payload. The base64 is uploaded to Cloudinary separately and only the URL
 * is persisted — keeping it inside rawOcrOutput made the inspections table
 * balloon (~40 MB for 55 scans) and every list query drag all of it over
 * the network.
 */
function extractAnnotatedImage(ocrResult) {
  if (!ocrResult || typeof ocrResult !== "object") {
    return { annotatedBase64: null, ocrSlim: ocrResult };
  }
  const value =
    ocrResult.annotated_image_base64 || ocrResult.annotated_image || null;
  if (typeof value !== "string" || value.length === 0) {
    return { annotatedBase64: null, ocrSlim: ocrResult };
  }
  const annotatedBase64 = value.includes(",")
    ? value.slice(value.indexOf(",") + 1)
    : value;
  const ocrSlim = { ...ocrResult };
  delete ocrSlim.annotated_image_base64;
  delete ocrSlim.annotated_image;
  return { annotatedBase64, ocrSlim };
}

/**
 * Automatically creates/links the Product record in NeonDB and generates/uploads
 * the statutory compliance report to Cloudinary, persisting it to the reports table.
 */
async function finalizeInspectionArtifacts({
  inspectionId,
  category = "general",
  declarations = [],
  rawOcr = {},
  violations = [],
  log,
}) {
  try {
    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { product: true },
    });
    if (!inspection) return;

    let product = inspection.product;
    if (!product) {
      product = await resolveOrCreateProduct({
        declarations: declarations && declarations.length ? declarations : (inspection.extractedDeclarations || []),
        rawOcr: rawOcr && Object.keys(rawOcr).length ? rawOcr : (inspection.rawOcrOutput || {}),
        category,
      });
      if (product?.id) {
        await prisma.inspection.update({
          where: { id: inspectionId },
          data: { productId: product.id },
        });
      }
    }

    await generateAndUploadReport({
      inspection,
      product,
      violations: violations || [],
      declarations: declarations && declarations.length ? declarations : (inspection.extractedDeclarations || []),
      category,
    });
  } catch (err) {
    log?.warn?.(`Artifact finalization warning for ${inspectionId}: ${err.message}`);
  }
}

/** Upload the annotated image to Cloudinary and return its URL (null on failure). */
async function hostAnnotatedImage(annotatedBase64, filename, log) {
  if (!annotatedBase64) return null;
  try {
    const result = await uploadBuffer(Buffer.from(annotatedBase64, "base64"), {
      filename: `annotated_${filename}`,
    });
    return result.secure_url;
  } catch (err) {
    log.warn(`Annotated image upload failed: ${err.message}`);
    return null;
  }
}

function aggregateProductFaceResults(faceResults, productResult) {
  const declarations = productResult.summary?.what_was_found || [];
  const violations = productResult.summary?.whats_wrong || [];
  const faceImages = faceResults.map((face, index) => {
    const faceIndex = face.faceIndex ?? index;
    return {
      face_index: faceIndex,
      filename: face.filename,
      image_url: face.cloudinaryResult.secure_url || null,
      annotated_image_path: face.annotatedUrl || null,
      ocr: face.ocrResult,
      compliance_score: Number(productResult.compliance_score) || 0,
      overall_result: productResult.overall_result || "FAIL",
      extracted_declarations: declarations
        .filter((declaration) => (declaration.face_index ?? 0) === faceIndex),
      violations: violations
        .filter((violation) => violation.face_index == null || violation.face_index === faceIndex),
    };
  });

  return {
    faceImages,
    declarations,
    violations,
    complianceScore: Number(productResult.compliance_score) || 0,
    overallStatus: productResult.overall_result === "PASS" ? "COMPLIANT" : "NON_COMPLIANT",
  };
}

function violationRows(inspectionId, violations) {
  return violations.map((violation) => ({
    inspectionId,
    ruleCode: violation.rule_id || "RULE_VIOLATION",
    severity: violation.severity || "MAJOR",
    title: `${violation.face_index != null ? `Face ${violation.face_index + 1}: ` : ""}${violation.field_name || "Declaration"} - ${(violation.violation_type || "VIOLATION").toUpperCase()}`,
    description: violation.description || "",
    evidenceBbox: violation.evidence_bbox || null,
    citation: violation.citation || null,
    detectedOnPackage: violation.detected_on_package || null,
    expectedOnPackage: violation.expected_on_package || null,
    packageElement: violation.package_element || null,
  }));
}

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
async function processPhotoScan({ inspectionId, imageBuffer, filename, category = "general", log }) {
  try {

    // Identical images previously scanned (within the cache TTL) skip the
    // expensive Cloudinary + OCR + compliance round-trips entirely.
    const imageHash = createHash("sha256").update(imageBuffer).digest("hex");
    const cachedPipeline = scanCache.get(imageHash);

    let cloudinaryResult;
    let ocrResult;
    let complianceResult;
    let annotatedUrl;

    if (cachedPipeline) {
      log.info(`Scan cache hit for image ${imageHash.slice(0, 12)}…`);
      ({ cloudinaryResult, ocrResult, complianceResult, annotatedUrl } = cachedPipeline);
      if (!complianceResult) {
        complianceResult = await evaluateOcrCompliance(ocrResult, category);
      }
    } else {
      // Concurrent: Upload to Cloudinary & run OCR on FastAPI
      const [upload, ocr] = await Promise.all([
        uploadBuffer(imageBuffer, { filename }).catch((err) => {
          log.warn(`Cloudinary upload warning: ${err.message}`);
          return { secure_url: null, public_id: null };
        }),
        runOcr(imageBuffer, filename),
      ]);

      if (!ocr || !ocr.success) {
        throw new Error(`OCR extraction failed: ${ocr?.error || "Unknown error"}`);
      }

      cloudinaryResult = upload;
      complianceResult = await evaluateOcrCompliance(ocr, category);
      const { annotatedBase64, ocrSlim } = extractAnnotatedImage(ocr);
      annotatedUrl = await hostAnnotatedImage(annotatedBase64, filename, log);
      ocrResult = ocrSlim;

      scanCache.set(imageHash, { cloudinaryResult, ocrResult, complianceResult, annotatedUrl });
    }
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

    const inspection = await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        imagePath: cloudinaryResult.secure_url,
        annotatedImagePath: annotatedUrl,
        rawOcrOutput: {
          ...ocrResult,
          category,
        },
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

    // Resolve or create Product & generate Cloudinary report
    await finalizeInspectionArtifacts({
      inspectionId,
      category,
      declarations: extractedDeclarations,
      rawOcr: ocrResult,
      violations: violationsData,
      log,
    });

  } catch (error) {
    log.error(error);
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: { status: "FAILED", rawOcrOutput: { source: "image", error: error.message || "Image processing failed" } },
    }).catch((updateError) => log.error(updateError));
  }
}

async function processPhotoBatch({ inspectionId, images, category = "general", log }) {
  try {
    const faceResults = await Promise.all(images.map(async ({ imageBuffer, filename }, faceIndex) => {
      const imageHash = createHash("sha256").update(imageBuffer).digest("hex");
      const cachedPipeline = scanCache.get(imageHash);
      let cloudinaryResult;
      let ocrResult;
      let complianceResult;
      let annotatedUrl;

      if (cachedPipeline) {
        ({ cloudinaryResult, ocrResult, complianceResult, annotatedUrl } = cachedPipeline);
        if (!complianceResult) {
          complianceResult = await evaluateOcrCompliance(ocrResult, category);
        }
      } else {
        const [upload, ocr] = await Promise.all([
          uploadBuffer(imageBuffer, { filename }).catch((error) => {
            log.warn(`Face ${faceIndex + 1} upload warning: ${error.message}`);
            return { secure_url: null, public_id: null };
          }),
          runOcr(imageBuffer, filename),
        ]);
        if (!ocr?.success) throw new Error(`OCR extraction failed for face ${faceIndex + 1}`);
        cloudinaryResult = upload;
        const { annotatedBase64, ocrSlim } = extractAnnotatedImage(ocr);
        ocrResult = ocrSlim;
        annotatedUrl = await hostAnnotatedImage(annotatedBase64, filename, log);
        scanCache.set(imageHash, { cloudinaryResult, ocrResult, annotatedUrl });
      }

      return { faceIndex, filename, cloudinaryResult, ocrResult, annotatedUrl };
    }));
    const productResult = await evaluateProductCompliance(faceResults, category);
    const aggregated = aggregateProductFaceResults(faceResults, productResult);
    const primary = faceResults[0];

    await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        imagePath: primary.cloudinaryResult.secure_url || null,
        annotatedImagePath: primary.annotatedUrl || null,
        rawOcrOutput: { source: "image-batch", category, face_count: aggregated.faceImages.length, face_images: aggregated.faceImages },
        extractedDeclarations: aggregated.declarations.map((declaration) => ({
          id: declaration.id,
          field_name: declaration.field_name,
          extracted_text: declaration.extracted_text,
          parsed_value: declaration.parsed_value,
          confidence: declaration.confidence,
          font_size_mm_est: declaration.font_size_mm_est,
          status: declaration.status,
          face_index: declaration.face_index,
        })),
        complianceScore: aggregated.complianceScore,
        status: aggregated.overallStatus,
      },
    });

    const rows = violationRows(inspectionId, aggregated.violations);
    if (rows.length) {
      await prisma.violation.createMany({
        data: rows,
      });
    }
    // Resolve or create Product & generate Cloudinary report
    await finalizeInspectionArtifacts({
      inspectionId,
      category,
      declarations: aggregated.declarations,
      rawOcr: {},
      violations: aggregated.violations,
      log,
    });
  } catch (error) {
    log.error(error);
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: { status: "FAILED", rawOcrOutput: { source: "image-batch", error: error.message || "Image batch processing failed" } },
    }).catch((updateError) => log.error(updateError));
  }
}

/**
 * Mask-pipeline scan (ENABLE_MASK_SCAN / --mask-scan):
 * 1. For every input (video or image) call FastAPI's stateless
 *    /api/v1/video/unwrap — SAM2 segments the label and returns rectified
 *    2D label faces ready for OCR.
 * 2. Each masked face runs the regular per-face pipeline: Cloudinary →
 *    OCR → compliance → annotated evidence upload.
 * 3. Aggregates into the same face_images shape as processPhotoBatch so
 *    InspectionDetail.jsx and the PDF report render without changes.
 *
 * Resilience: if the masker finds no label on an image input, the original
 * upload is OCR-ed directly instead of failing the whole inspection.
 * Video inputs have no such fallback — no faces means a failed scan.
 */
async function processMaskedScan({ inspectionId, inputs, source, category = "general", log }) {
  try {
    const fallbackToOriginal = source !== "video-masked";
    const faceResults = [];

    // SAM2 unwrap is the bottleneck — unwrap inputs one at a time, then fan
    // the per-face Cloudinary/OCR/compliance work out in parallel.
    for (const [inputIndex, { imageBuffer, filename }] of inputs.entries()) {
      let frames = [];
      try {
        const unwrapResponse = await unwrapVideo(imageBuffer, filename);
        frames = unwrapResponse?.frames || [];
      } catch (error) {
        log.warn(`Mask extraction failed for ${filename}: ${error.message}`);
      }

      if (!frames.length && fallbackToOriginal) {
        frames = [{ frame_index: 0, filename, image_base64: imageBuffer.toString("base64") }];
      }
      if (!frames.length) {
        throw new Error(`No label faces detected in ${filename}`);
      }

      const baseIndex = faceResults.length;
      const inputFaces = await Promise.all(frames.map(async (frame, frameIndex) => {
        const faceBuffer = Buffer.from(frame.image_base64, "base64");
        const faceFilename = `${inputIndex + 1}_${frame.filename || `face_${frameIndex + 1}.png`}`;

        // Identical masked faces previously scanned (within the cache TTL)
        // skip the Cloudinary + OCR + compliance round-trips entirely.
        const faceHash = createHash("sha256").update(faceBuffer).digest("hex");
        const cachedPipeline = scanCache.get(faceHash);
        let cloudinaryResult;
        let ocrResult;
        let complianceResult;
        let annotatedUrl;

        if (cachedPipeline) {
          ({ cloudinaryResult, ocrResult, complianceResult, annotatedUrl } = cachedPipeline);
          if (!complianceResult) {
            complianceResult = await evaluateOcrCompliance(ocrResult, category);
          }
        } else {
          const [upload, ocr] = await Promise.all([
            uploadBuffer(faceBuffer, { filename: faceFilename }).catch((error) => {
              log.warn(`Face ${baseIndex + frameIndex + 1} upload warning: ${error.message}`);
              return { secure_url: null, public_id: null };
            }),
            runOcr(faceBuffer, faceFilename),
          ]);
          if (!ocr?.success) throw new Error(`OCR extraction failed for face ${baseIndex + frameIndex + 1}`);
          cloudinaryResult = upload;
          const { annotatedBase64, ocrSlim } = extractAnnotatedImage(ocr);
          annotatedUrl = await hostAnnotatedImage(annotatedBase64, faceFilename, log);
          ocrResult = ocrSlim;
          scanCache.set(faceHash, { cloudinaryResult, ocrResult, annotatedUrl });
        }

        return { faceIndex: baseIndex + frameIndex, filename: faceFilename, cloudinaryResult, ocrResult, annotatedUrl };
      }));
      faceResults.push(...inputFaces);
    }

    const productResult = await evaluateProductCompliance(faceResults, category);
    const aggregated = aggregateProductFaceResults(faceResults, productResult);
    const primary = faceResults[0];

    await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        imagePath: primary.cloudinaryResult.secure_url || null,
        annotatedImagePath: primary.annotatedUrl || null,
        rawOcrOutput: { source, category, face_count: aggregated.faceImages.length, face_images: aggregated.faceImages },
        extractedDeclarations: aggregated.declarations.map((declaration) => ({
          id: declaration.id,
          field_name: declaration.field_name,
          extracted_text: declaration.extracted_text,
          parsed_value: declaration.parsed_value,
          confidence: declaration.confidence,
          font_size_mm_est: declaration.font_size_mm_est,
          status: declaration.status,
          face_index: declaration.face_index,
        })),
        complianceScore: aggregated.complianceScore,
        status: aggregated.overallStatus,
      },
    });

    const rows = violationRows(inspectionId, aggregated.violations);
    if (rows.length) {
      await prisma.violation.createMany({
        data: rows,
      });
    }
    // Resolve or create Product & generate Cloudinary report
    await finalizeInspectionArtifacts({
      inspectionId,
      category,
      declarations: aggregated.declarations,
      rawOcr: { source, category, face_count: aggregated.faceImages.length },
      violations: aggregated.violations,
      log,
    });
  } catch (error) {
    log.error(error);
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: { status: "FAILED", rawOcrOutput: { source, error: error.message || "Masked scan processing failed" } },
    }).catch((updateError) => log.error(updateError));
  }
}

async function handlePhotoScan(req, reply) {
  try {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: "Bad Request", message: "Image file is required" });
    }
    if (!ALLOWED_IMAGE_MIMES.includes(data.mimetype)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: `Invalid file type '${data.mimetype}'. Supported: JPG, PNG, WEBP, GIF, BMP`,
      });
    }
    const imageBuffer = await data.toBuffer();
    if (imageBuffer.length === 0) {
      return reply.code(400).send({ error: "Bad Request", message: "Uploaded image file is empty" });
    }

    const filename = data.filename || "label.jpg";
    const category = req.query?.category || data.fields?.category?.value || "general";
    const maskEnabled = isMaskScanEnabled();
    const inspection = await prisma.inspection.create({
      data: {
        ...getScanAttributionData(req.user),
        status: "PROCESSING",
        rawOcrOutput: { source: maskEnabled ? "image-masked" : "image", filename, category },
      },
    });

    // Deliberately do not await: the client can move to Inspections as soon as
    // its upload has finished, while OCR and compliance run in the background.
    if (maskEnabled) {
      void processMaskedScan({ inspectionId: inspection.id, inputs: [{ imageBuffer, filename }], source: "image-masked", category, log: req.log });
    } else {
      void processPhotoScan({ inspectionId: inspection.id, imageBuffer, filename, category, log: req.log });
    }
    return reply.code(202).send({
      scan_id: inspection.id,
      status: inspection.status,
      created_at: inspection.createdAt,
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({ error: "Internal Server Error", message: error.message || "Failed to queue photo scan" });
  }
}

async function handlePhotoBatch(req, reply) {
  try {
    const images = [];
    let category = req.query?.category || "general";
    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (!ALLOWED_IMAGE_MIMES.includes(part.mimetype)) {
          return reply.code(400).send({ error: "Bad Request", message: `Invalid image type '${part.mimetype}'` });
        }
        const imageBuffer = await part.toBuffer();
        if (!imageBuffer.length) {
          return reply.code(400).send({ error: "Bad Request", message: "An uploaded image is empty" });
        }
        images.push({ imageBuffer, filename: part.filename || `face_${images.length + 1}.jpg` });
      } else if (part.fieldname === "category" && part.value) {
        category = part.value;
      }
    }
    if (!images.length) {
      return reply.code(400).send({ error: "Bad Request", message: "At least one image file is required" });
    }

    const maskEnabled = isMaskScanEnabled();
    const inspection = await prisma.inspection.create({
      data: {
        ...getScanAttributionData(req.user),
        status: "PROCESSING",
        rawOcrOutput: { source: maskEnabled ? "image-masked" : "image-batch", face_count: images.length, category },
      },
    });
    if (maskEnabled) {
      void processMaskedScan({ inspectionId: inspection.id, inputs: images, source: "image-masked", category, log: req.log });
    } else {
      void processPhotoBatch({ inspectionId: inspection.id, images, category, log: req.log });
    }
    return reply.code(202).send({
      scan_id: inspection.id,
      status: inspection.status,
      face_count: images.length,
      created_at: inspection.createdAt,
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({ error: "Internal Server Error", message: error.message || "Failed to queue image batch" });
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
async function processVideoScanLegacy(req, reply) {
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
    const fullOcrResult = await runOcr(primaryFrame.buffer, primaryFrame.filename);
    const complianceResult = await evaluateOcrCompliance(fullOcrResult, category);
    const { annotatedBase64, ocrSlim } = extractAnnotatedImage(fullOcrResult);
    const annotatedUrl = await hostAnnotatedImage(
      annotatedBase64,
      primaryFrame.filename || "video_frame.jpg",
      req.log
    );
    const ocrResult = ocrSlim;

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
        ...getScanAttributionData(req.user),
        imagePath: primaryFrame.image_url,
        annotatedImagePath: annotatedUrl,
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

    // Resolve or create Product & generate Cloudinary report
    await finalizeInspectionArtifacts({
      inspectionId: inspection.id,
      category,
      declarations: extractedDeclarations,
      rawOcr: inspection.rawOcrOutput || {},
      violations: violationsData,
      log: req.log,
    });

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
      annotated_image_path: annotatedUrl,
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
async function processVideoScan({ inspectionId, videoBuffer, filename, log }) {
  try {
    const unwrapResponse = await unwrapVideo(videoBuffer, filename);
    if (!unwrapResponse.success || !unwrapResponse.frames?.length) {
      throw new Error("No label faces detected in the video");
    }

    const uploadedFrames = await Promise.all(
      unwrapResponse.frames.map(async (frame, index) => {
        const buffer = Buffer.from(frame.image_base64, "base64");
        const cloudRes = await uploadBuffer(buffer, {
          filename: `video_frame_${index}_${frame.filename || "label.jpg"}`,
        }).catch((error) => {
          log.warn(`Video frame upload warning: ${error.message}`);
          return { secure_url: null, public_id: null };
        });
        return {
          frame_index: frame.frame_index ?? index,
          filename: frame.filename || "video_frame.jpg",
          image_url: cloudRes.secure_url,
          cloudinary_public_id: cloudRes.public_id,
          buffer,
        };
      })
    );

    const primaryFrame = uploadedFrames[0];
    const category = "general";
    const fullOcrResult = await runOcr(primaryFrame.buffer, primaryFrame.filename);
    if (!fullOcrResult?.success) throw new Error("OCR extraction failed for video frame");
    const complianceResult = await evaluateOcrCompliance(fullOcrResult, category);
    const { annotatedBase64, ocrSlim } = extractAnnotatedImage(fullOcrResult);
    const annotatedUrl = await hostAnnotatedImage(annotatedBase64, primaryFrame.filename, log);
    const extractedDeclarations = (complianceResult.summary?.what_was_found || []).map((d) => ({
      id: d.id,
      field_name: d.field_name,
      extracted_text: d.extracted_text,
      parsed_value: d.parsed_value,
      confidence: d.confidence,
      font_size_mm_est: d.font_size_mm_est,
      status: d.status,
    }));
    const overallStatus = complianceResult.overall_result === "PASS" ? "COMPLIANT" : "NON_COMPLIANT";

    await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        imagePath: primaryFrame.image_url,
        annotatedImagePath: annotatedUrl,
        rawOcrOutput: {
          ...ocrSlim,
          video_frames: uploadedFrames.map((frame) => ({
            frame_index: frame.frame_index,
            image_url: frame.image_url,
            cloudinary_public_id: frame.cloudinary_public_id,
          })),
        },
        extractedDeclarations,
        complianceScore: complianceResult.compliance_score || 0,
        status: overallStatus,
      },
    });

    const violationsData = (complianceResult.summary?.whats_wrong || []).map((v) => ({
      inspectionId,
      ruleCode: v.rule_id || "RULE_VIOLATION",
      severity: v.severity || "MAJOR",
      title: `${v.field_name || "Declaration"} - ${(v.violation_type || "VIOLATION").toUpperCase()}`,
      description: v.description || "",
      evidenceBbox: v.evidence_bbox || null,
    }));
    if (violationsData.length) await prisma.violation.createMany({ data: violationsData });

    // Resolve or create Product & generate Cloudinary report
    await finalizeInspectionArtifacts({
      inspectionId,
      category,
      declarations: extractedDeclarations,
      rawOcr: ocrSlim || {},
      violations: violationsData,
      log,
    });
  } catch (error) {
    log.error(error);
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: { status: "FAILED", rawOcrOutput: { source: "video", error: error.message || "Video processing failed" } },
    })
      .catch((updateError) => log.error(updateError));
  }
}

async function handleVideoScan(req, reply) {
  try {
    if (!isMaskScanEnabled()) {
      return reply.code(503).send({
        error: "Service Unavailable",
        message: "Video scanning is disabled. Set ENABLE_MASK_SCAN=true in node-server/.env (or start with --mask-scan) to enable the label-mask pipeline.",
      });
    }
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "Bad Request", message: "Video file is required" });
    if (!ALLOWED_VIDEO_MIMES.includes(data.mimetype)) {
      return reply.code(400).send({ error: "Bad Request", message: "Unsupported video type. Use MP4, MOV, AVI, MKV or WEBM." });
    }
    const videoBuffer = await data.toBuffer();
    if (!videoBuffer.length) return reply.code(400).send({ error: "Bad Request", message: "Uploaded video file is empty" });

    const filename = data.filename || "video.mp4";
    const inspection = await prisma.inspection.create({
      data: {
        ...getScanAttributionData(req.user),
        status: "PROCESSING",
        rawOcrOutput: { source: "video-masked", filename },
      },
    });
    void processMaskedScan({ inspectionId: inspection.id, inputs: [{ imageBuffer: videoBuffer, filename }], source: "video-masked", category: "general", log: req.log });
    return reply.code(202).send({ scan_id: inspection.id, status: inspection.status, created_at: inspection.createdAt });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({ error: "Internal Server Error", message: error.message || "Failed to queue video scan" });
  }
}

async function getScanById(req, reply) {
  try {
    const { scanId } = req.params;
    const inspection = await prisma.inspection.findUnique({
      where: { id: scanId },
      include: {
        violations: true,
        product: true,
        reports: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        inspector: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            district: true,
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

    // Enforce Row-Level Security Scoping if caller is authenticated
    if (req.user) {
      assertInspectionAccess(req.user, inspection);
    }

    // Old rows may still carry multi-megabyte base64 blobs in rawOcrOutput —
    // strip them from the response; the images live at the image_path /
    // annotated_image_path URLs.
    const ocrOutput = inspection.rawOcrOutput
      ? { ...inspection.rawOcrOutput }
      : null;
    if (ocrOutput) {
      delete ocrOutput.annotated_image_base64;
      delete ocrOutput.annotated_image;
    }

    // Determine product name and category
    const decls = Array.isArray(inspection.extractedDeclarations) ? inspection.extractedDeclarations : [];
    const commodityDecl = decls.find((d) => d.field_name === "commodity_name" || d.field_name === "product_name")?.extracted_text;
    const brandDecl = decls.find((d) => d.field_name === "brand_name" || d.field_name === "manufacturer" || d.field_name === "manufacturer_name")?.extracted_text;

    const productName =
      inspection.product?.brandName ||
      inspection.product?.commodityName ||
      commodityDecl ||
      brandDecl ||
      inspection.rawOcrOutput?.product_name ||
      "Packaged Consumer Commodity";

    const category =
      inspection.product?.category ||
      inspection.rawOcrOutput?.category ||
      "General Pre-Packaged Commodity";
    const faceImages = Array.isArray(inspection.rawOcrOutput?.face_images)
      ? inspection.rawOcrOutput.face_images
      : [];

    return reply.code(200).send({
      scan_id: inspection.id,
      status: inspection.status,
      product_name: productName,
      category: category,
      product: inspection.product || null,
      image_path: inspection.imagePath,
      annotated_image_path: inspection.annotatedImagePath || null,
      annotated_image_base64: null, // stripped; use annotated_image_path URL instead
      face_images: faceImages,
      created_at: inspection.createdAt,
      compliance_score: inspection.complianceScore,
      ocr_result: ocrOutput,
      extracted_declarations: inspection.extractedDeclarations,
      inspector: inspection.inspector,
      report_url: inspection.reports?.[0]?.fileUrl || null,
      report: inspection.reports?.[0] || null,
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
    if (error instanceof SecurityScopingError) {
      return reply.code(403).send({
        error: "Forbidden",
        message: error.message,
        details: error.details,
      });
    }
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

    let where = {};
    if (req.user) {
      where = getInspectionScope(req.user);
    }
    if (req.query.status) {
      where = mergeScope(where, { status: req.query.status.toUpperCase() });
    }

    const [total, inspections] = await Promise.all([
      prisma.inspection.count({ where }),
      prisma.inspection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        // Deliberately no rawOcrOutput/extractedDeclarations here: legacy rows
        // carry megabytes of base64 in those columns and the list response
        // never uses them. Fetching them made limit=100 take 40+ seconds.
        select: {
          id: true,
          status: true,
          imagePath: true,
          complianceScore: true,
          createdAt: true,
          violations: { select: { id: true } },
          product: true,
          reports: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: { id: true, fileUrl: true, reportType: true },
          },
        },
      }),
    ]);

    return reply.code(200).send({
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      items: inspections.map((ins) => {
        const latestReport = ins.reports?.[0];
        return {
          scan_id: ins.id,
          status: ins.status,
          image_path: ins.imagePath,
          compliance_score: ins.complianceScore,
          violations_count: ins.violations.length,
          created_at: ins.createdAt,
          product: ins.product || null,
          report_url: latestReport?.fileUrl || null,
          report: latestReport || null,
        };
      }),
    });
  } catch (error) {
    if (error instanceof SecurityScopingError) {
      return reply.code(403).send({
        error: "Forbidden",
        message: error.message,
        details: error.details,
      });
    }
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
    return reply.code(502).send({ error: "Failed to fetch rules from Prisma", message: error.message });
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

async function getReportByScanId(req, reply) {
  try {
    const { scanId } = req.params;
    const report = await prisma.report.findFirst({
      where: { inspectionId: scanId },
      orderBy: { createdAt: "desc" },
    });
    if (!report) {
      return reply.code(404).send({ error: "Not Found", message: "Report not found for this inspection" });
    }
    return reply.code(200).send(report);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: "Internal Server Error", message: err.message });
  }
}

async function listReports(req, reply) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [total, reports] = await Promise.all([
      prisma.report.count(),
      prisma.report.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          inspection: {
            select: {
              id: true,
              status: true,
              complianceScore: true,
              imagePath: true,
              annotatedImagePath: true,
              product: true,
            },
          },
        },
      }),
    ]);

    return reply.code(200).send({
      page,
      limit,
      total,
      items: reports,
    });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: "Internal Server Error", message: err.message });
  }
}

export {
  handlePhotoScan,
  handlePhotoBatch,
  handleVideoScan,
  getScanById,
  listScans,
  getComplianceRules,
  getStatutoryCitations,
  searchStatutoryCorpus,
  extractAnnotatedImage,
  getReportByScanId,
  listReports,
};
