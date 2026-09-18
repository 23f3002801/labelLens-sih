const scanController = require("../controllers/scanController");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");

/**
 * Optional user authentication preHandler:
 * If Authorization header is provided, decode and attach user;
 * otherwise continue as unauthenticated guest.
 */
async function optionalAuth(req, reply) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      // Trust JWT payload — same approach as authenticateToken middleware
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        fullName: decoded.fullName,
      };
    } catch {
      // Ignore token verification errors for optional auth
    }
  }
}

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
  fastify.get("/uploads/:scanId", scanController.getScanById);

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
  fastify.get("/video/:scanId", scanController.getScanById);
  fastify.get("/video/frames/:scanId", scanController.getScanById);

  // Inspections list
  fastify.get("/inspections", scanController.listScans);

  // Compliance Rules & Statutory Citations (proxied from FastAPI compute engine)
  fastify.get("/compliance/rules", scanController.getComplianceRules);
  fastify.get("/compliance/citations", scanController.getStatutoryCitations);
  fastify.get("/compliance/citations-search", scanController.searchStatutoryCorpus);
}

module.exports = scanRoutes;
