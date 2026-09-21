import * as scanController from "../controllers/scanController.js";
import { optionalAuth } from "../middleware/auth.js";

async function scanRoutes(fastify, options) {
  // Photo scan endpoints
  fastify.post(
    "/uploads/image",
    { preHandler: [optionalAuth] },
    scanController.handlePhotoScan
  );
  fastify.post(
    "/scans/photo",
    { preHandler: [optionalAuth] },
    scanController.handlePhotoScan
  );
  fastify.post(
    "/uploads/images",
    { preHandler: [optionalAuth] },
    scanController.handlePhotoBatch
  );
  fastify.get(
    "/uploads/:scanId",
    { preHandler: [optionalAuth] },
    scanController.getScanById
  );

  // Video scan endpoints
  fastify.post(
    "/video/frames",
    { preHandler: [optionalAuth] },
    scanController.handleVideoScan
  );
  fastify.post(
    "/video/image",
    { preHandler: [optionalAuth] },
    scanController.handleVideoScan
  );
  fastify.get(
    "/video/:scanId",
    { preHandler: [optionalAuth] },
    scanController.getScanById
  );
  fastify.get(
    "/video/frames/:scanId",
    { preHandler: [optionalAuth] },
    scanController.getScanById
  );

  // Inspections list (scoped if authenticated)
  fastify.get(
    "/inspections",
    { preHandler: [optionalAuth] },
    scanController.listScans
  );

  // Reports
  fastify.get("/reports", scanController.listReports);
  fastify.get("/reports/:scanId", scanController.getReportByScanId);
  fastify.get("/inspections/:scanId/report", scanController.getReportByScanId);

  // Compliance Rules & Statutory Citations (proxied from FastAPI compute engine)
  fastify.get("/compliance/rules", scanController.getComplianceRules);
  fastify.get("/compliance/citations", scanController.getStatutoryCitations);
  fastify.get("/compliance/citations-search", scanController.searchStatutoryCorpus);
}

export default scanRoutes;
