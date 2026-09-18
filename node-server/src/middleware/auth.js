const jwt = require("jsonwebtoken");
const prisma = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // In development, set JWT_SECRET in your .env file.
  // Never fall back to a hardcoded secret — attackers can forge admin tokens.
  throw new Error(
    "FATAL: JWT_SECRET environment variable is not set. " +
    "Set it in your .env file before starting the server."
  );
}

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

    // Trust the JWT payload for normal requests — avoids a DB round-trip
    // per authenticated call. The JWT already carries id, email, role, fullName
    // (signed at login/register time). For sensitive ops that need the latest
    // DB state, use requireFreshUser() instead.
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      fullName: decoded.fullName,
    };
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
