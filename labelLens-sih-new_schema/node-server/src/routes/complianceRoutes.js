import * as inspectionController from "../controllers/inspectionController.js";
import * as complaintController from "../controllers/complaintController.js";
import * as dashboardController from "../controllers/dashboardController.js";
import {
  authenticateToken,
  requirePermission,
  requireAnyPermission,
} from "../middleware/auth.js";
import { PERMISSIONS } from "../constants/rbac.js";

/**
 * LMPC Legal Metrology Compliance RBAC & Scoped Routes
 */
async function complianceRoutes(fastify, options) {
  // --- Scoped Inspections Management ---

  // List inspections (scoped by role & jurisdiction)
  fastify.get(
    "/compliance/inspections",
    {
      preHandler: [
        authenticateToken,
        requireAnyPermission(
          PERMISSIONS.SCAN_VIEW_OWN,
          PERMISSIONS.SCAN_VIEW_JURISDICTION,
          PERMISSIONS.SCAN_VIEW_ORG,
          PERMISSIONS.DASHBOARD_GLOBAL
        ),
      ],
    },
    inspectionController.listInspections
  );

  // Retrieve single inspection with IDOR / jurisdiction scoping check
  fastify.get(
    "/compliance/inspections/:id",
    {
      preHandler: [
        authenticateToken,
        requireAnyPermission(
          PERMISSIONS.SCAN_VIEW_OWN,
          PERMISSIONS.SCAN_VIEW_JURISDICTION,
          PERMISSIONS.SCAN_VIEW_ORG,
          PERMISSIONS.DASHBOARD_GLOBAL
        ),
      ],
    },
    inspectionController.getInspectionById
  );

  // Create new inspection record (Inspectors)
  fastify.post(
    "/compliance/inspections",
    {
      preHandler: [
        authenticateToken,
        requirePermission(PERMISSIONS.SCAN_CREATE),
      ],
    },
    inspectionController.createInspection
  );

  // Confirm or modify violation (Reviewers)
  fastify.patch(
    "/compliance/inspections/:inspectionId/violations/:violationId",
    {
      preHandler: [
        authenticateToken,
        requirePermission(PERMISSIONS.VIOLATION_CONFIRM),
      ],
    },
    inspectionController.confirmViolation
  );

  // Assign Reviewer to inspection (Directors / Controllers)
  fastify.post(
    "/compliance/inspections/:inspectionId/reviewer",
    {
      preHandler: [
        authenticateToken,
        requireAnyPermission(PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_MANAGE),
      ],
    },
    inspectionController.assignReviewer
  );

  // --- Consumer Complaints & Triage ---

  // File a complaint (Consumers)
  fastify.post(
    "/compliance/complaints",
    {
      preHandler: [
        authenticateToken,
        requirePermission(PERMISSIONS.COMPLAINT_FILE),
      ],
    },
    complaintController.fileComplaint
  );

  // List complaints (scoped to consumer, reviewer, or jurisdiction).
  // REVIEWER and CONTROLLER are admitted through their existing scan-view
  // permissions and receive only the RLS scope produced by getComplaintScope.
  // Neither gains complaint triage permission from this read route.
  fastify.get(
    "/compliance/complaints",
    {
      preHandler: [
        authenticateToken,
        requireAnyPermission(
          PERMISSIONS.COMPLAINT_FILE,
          PERMISSIONS.COMPLAINT_TRIAGE,
          PERMISSIONS.DASHBOARD_GLOBAL,
          PERMISSIONS.SCAN_VIEW_ORG,
          PERMISSIONS.SCAN_VIEW_JURISDICTION
        ),
      ],
    },
    complaintController.listComplaints
  );

  // Triage complaint (Consumers / Officers)
  fastify.patch(
    "/compliance/complaints/:id/triage",
    {
      preHandler: [
        authenticateToken,
        requirePermission(PERMISSIONS.COMPLAINT_TRIAGE),
      ],
    },
    complaintController.triageComplaint
  );

  // --- Executive & Regional Compliance Dashboards ---

  // District Controller Dashboard
  fastify.get(
    "/compliance/dashboard/jurisdiction",
    {
      preHandler: [
        authenticateToken,
        requirePermission(PERMISSIONS.DASHBOARD_JURISDICTION),
      ],
    },
    dashboardController.getJurisdictionDashboard
  );

  // Director Global Dashboard
  fastify.get(
    "/compliance/dashboard/global",
    {
      preHandler: [
        authenticateToken,
        requirePermission(PERMISSIONS.DASHBOARD_GLOBAL),
      ],
    },
    dashboardController.getGlobalDashboard
  );
}

export default complianceRoutes;
