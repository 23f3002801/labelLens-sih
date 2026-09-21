import * as dashboardService from "../services/dashboardService.js";
import { SecurityScopingError } from "../services/dataScopingService.js";

/**
 * Controller Jurisdiction Dashboard handler
 */
export async function getJurisdictionDashboard(req, reply) {
  try {
    const stats = await dashboardService.getJurisdictionDashboard(req.user);
    return reply.code(200).send(stats);
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
      message: "Failed to retrieve jurisdiction dashboard",
    });
  }
}

/**
 * Director Global Dashboard handler
 */
export async function getGlobalDashboard(req, reply) {
  try {
    const stats = await dashboardService.getGlobalDashboard(req.user);
    return reply.code(200).send(stats);
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to retrieve global dashboard",
    });
  }
}
