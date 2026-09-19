import prisma from "../config/db.js";
import { createHash } from "crypto";
import { uploadBuffer } from "../services/cloudinaryService.js";
import {
  runOcr,
  evaluateOcrCompliance,
  unwrapVideo,
} from "../services/fastapiService.js";
import * as scanCache from "../utils/scanCache.js";

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
async function processPhotoScan({ inspectionId, imageBuffer, filename, log }) {
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
      complianceResult = await evaluateOcrCompliance(ocr);
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
        rawOcrOutput: ocrResult,
        extractedDeclarations,
        complianceScore: complianceResult.compliance_score || 0.0,
        status: overallStatus,
      },
    });

    // Create Violation records
    const violationsData = (complianceResult.summary?.whats_wrong || []).map(
      (v) => ({
        inspectionId: inspection.id,
        ruleCode: v.rule_id || "RULE_VIOLATION",
        severity: v.severity || "MAJOR",
        title: `${v.field_name || "Declaration"} - ${(v.violation_type || "VIOLATION").toUpperCase()}`,
        description: v.description || "",
        evidenceBbox: v.evidence_bbox || null,
      })
    );

    if (violationsData.length > 0) {
      await prisma.violation.createMany({
        data: violationsData,
      });
    }

  } catch (error) {
    log.error(error);
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: { status: "FAILED", rawOcrOutput: { source: "image", error: error.message || "Image processing failed" } },
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
    const inspection = await prisma.inspection.create({
      data: {
        inspectorId: req.user?.id || null,
        status: "PROCESSING",
        rawOcrOutput: { source: "image", filename },
      },
    });

    // Deliberately do not await: the client can move to Inspections as soon as
    // its upload has finished, while OCR and compliance run in the background.
    void processPhotoScan({ inspectionId: inspection.id, imageBuffer, filename, log: req.log });
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
    const complianceResult = await evaluateOcrCompliance(fullOcrResult);
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
        inspectorId,
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

    return reply.code(200).send({
      scan_id: inspection.id,
      status: inspection.status,
      image_path: inspection.imagePath,
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
      violations: violations.map((v) => ({
        id: v.id,
        rule_code: v.ruleCode,
        severity: v.severity,
        title: v.title,
        description: v.description,
        evidence_bbox: v.evidenceBbox,
      })),
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
    const fullOcrResult = await runOcr(primaryFrame.buffer, primaryFrame.filename);
    if (!fullOcrResult?.success) throw new Error("OCR extraction failed for video frame");
    const complianceResult = await evaluateOcrCompliance(fullOcrResult);
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
        inspectorId: req.user?.id || null,
        status: "PROCESSING",
        rawOcrOutput: { source: "video", filename },
      },
    });
    void processVideoScan({ inspectionId: inspection.id, videoBuffer, filename, log: req.log });
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

    return reply.code(200).send({
      scan_id: inspection.id,
      status: inspection.status,
      image_path: inspection.imagePath,
      annotated_image_path: inspection.annotatedImagePath || null,
      created_at: inspection.createdAt,
      compliance_score: inspection.complianceScore,
      ocr_result: ocrOutput,
      extracted_declarations: inspection.extractedDeclarations,
      inspector: inspection.inspector,
      violations: inspection.violations.map((v) => ({
        id: v.id,
        rule_code: v.ruleCode,
        severity: v.severity,
        title: v.title,
        description: v.description,
        evidence_bbox: v.evidenceBbox,
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

export {
  handlePhotoScan,
  handleVideoScan,
  getScanById,
  listScans,
  extractAnnotatedImage,
};
