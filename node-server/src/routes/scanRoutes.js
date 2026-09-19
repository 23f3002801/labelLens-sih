import * as scanController from "../controllers/scanController.js";
import jwt from "jsonwebtoken";
import prisma from "../config/db.js";
import { JWT_SECRET } from "../middleware/auth.js";

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
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, role: true, fullName: true },
      });
      if (user) {
        req.user = user;
      }
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
}

export default scanRoutes;
