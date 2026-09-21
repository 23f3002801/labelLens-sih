import * as inspectionService from "../services/inspectionService.js";
import { SecurityScopingError } from "../services/dataScopingService.js";

/**
 * List inspections scoped to caller role and jurisdiction
 */
export async function listInspections(req, reply) {
  try {
    const result = await inspectionService.listScopedInspections(req.user, req.query);
    return reply.code(200).send(result);
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
      message: "Failed to list inspections",
    });
  }
}

/**
 * Get inspection by ID with row-level security validation
 */
export async function getInspectionById(req, reply) {
  try {
    const { id } = req.params;
    const inspection = await inspectionService.getScopedInspectionById(req.user, id);

    if (!inspection) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Inspection '${id}' not found`,
      });
    }

    return reply.code(200).send({ inspection });
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
      message: "Failed to retrieve inspection",
    });
  }
}

/**
 * Create inspection scoped to caller
 */
export async function createInspection(req, reply) {
  try {
    const inspection = await inspectionService.createScopedInspection(req.user, req.body || {});
    return reply.code(201).send({
      message: "Inspection created successfully",
      inspection,
    });
  } catch (error) {
    if (error instanceof SecurityScopingError) {
      return reply.code(403).send({
        error: "Forbidden",
        message: error.message,
      });
    }
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to create inspection",
    });
  }
}

/**
 * Confirm or update a violation on an inspection (Reviewer)
 */
export async function confirmViolation(req, reply) {
  try {
    const { inspectionId, violationId } = req.params;
    const violation = await inspectionService.confirmViolation(
      req.user,
      inspectionId,
      violationId,
      req.body || {}
    );
    return reply.code(200).send({
      message: "Violation confirmed and updated",
      violation,
    });
  } catch (error) {
    if (error instanceof SecurityScopingError) {
      return reply.code(403).send({
        error: "Forbidden",
        message: error.message,
      });
    }
    req.log.error(error);
    return reply.code(400).send({
      error: "Bad Request",
      message: error.message || "Failed to confirm violation",
    });
  }
}

/**
 * Assign a reviewer to an inspection (Controller/Director)
 */
export async function assignReviewer(req, reply) {
  try {
    const { inspectionId } = req.params;
    const { reviewerId } = req.body || {};

    if (!reviewerId) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "reviewerId is required in request body",
      });
    }

    const updated = await inspectionService.assignReviewer(req.user, inspectionId, reviewerId);
    return reply.code(200).send({
      message: "Reviewer assigned successfully",
      inspection: updated,
    });
  } catch (error) {
    if (error instanceof SecurityScopingError) {
      return reply.code(403).send({
        error: "Forbidden",
        message: error.message,
      });
    }
    req.log.error(error);
    return reply.code(400).send({
      error: "Bad Request",
      message: error.message || "Failed to assign reviewer",
    });
  }
}
