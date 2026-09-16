const jwt = require("jsonwebtoken");
const prisma = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "labellens_default_jwt_secret_change_in_prod";

async function authenticateToken(req, reply) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Authentication token is missing or invalid format (Bearer token required)",
      });
    }

    const token = authHeader.split(" ")[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Invalid or expired authentication token",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        district: true,
        state: true,
        badgeNumber: true,
        createdAt: true,
      },
    });

    if (!user) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "User associated with this token no longer exists",
      });
    }

    req.user = user;
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "An error occurred during authentication",
    });
  }
}

function requireRoles(...allowedRoles) {
  return async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    const userRole = (req.user.role || "").toUpperCase();
    const normalizedRoles = allowedRoles.map((r) => r.toUpperCase());

    if (!normalizedRoles.includes(userRole)) {
      return reply.code(403).send({
        error: "Forbidden",
        message: `Insufficient permissions. Allowed roles: ${normalizedRoles.join(", ")}`,
      });
    }
  };
}

module.exports = {
  authenticateToken,
  requireRoles,
  JWT_SECRET,
};
