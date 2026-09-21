import * as complaintService from "../services/complaintService.js";
import { SecurityScopingError } from "../services/dataScopingService.js";

/**
 * File a complaint (Consumer)
 */
export async function fileComplaint(req, reply) {
  try {
    const complaint = await complaintService.fileComplaint(req.user, req.body || {});
    return reply.code(201).send({
      message: "Complaint filed successfully",
      complaint,
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
      message: error.message || "Failed to file complaint",
    });
  }
}

/**
 * List complaints scoped to user role & jurisdiction
 */
export async function listComplaints(req, reply) {
  try {
    const result = await complaintService.listComplaints(req.user, req.query);
    return reply.code(200).send(result);
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
      message: "Failed to list complaints",
    });
  }
}

/**
 * Triage complaint (Controller / Consumer)
 */
export async function triageComplaint(req, reply) {
  try {
    const { id } = req.params;
    const updated = await complaintService.triageComplaint(req.user, id, req.body || {});
    return reply.code(200).send({
      message: "Complaint triaged successfully",
      complaint: updated,
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
      message: error.message || "Failed to triage complaint",
    });
  }
}
