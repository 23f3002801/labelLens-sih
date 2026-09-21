import jwt from "jsonwebtoken";
import prisma from "../config/db.js";
import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  isValidRole,
} from "../constants/rbac.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is not set. " +
    "Set it in your .env file before starting the server."
  );
}

/**
 * Standard Fastify PreHandler: Authenticate Bearer JWT
 * Attaches structured AuthenticatedUserContext to req.user with all scoping claims
 */
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

    const role = (decoded.role || "").toUpperCase();
    if (!isValidRole(role)) {
      return reply.code(403).send({
        error: "Forbidden",
        message: `Token contains unrecognized role: '${decoded.role}'`,
      });
    }

    // Attach complete scoping context
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role,
      fullName: decoded.fullName || decoded.full_name || "",
      district: decoded.district || null,
      state: decoded.state || null,
      organizationId: decoded.organizationId || decoded.organization_id || null,
      employeeId: decoded.employeeId || decoded.employee_id || null,
      badgeNumber: decoded.badgeNumber || decoded.badge_number || null,
    };
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "An error occurred during authentication",
    });
  }
}

/**
 * Optional authentication preHandler:
 * If Authorization header is provided, verifies and sets req.user;
 * otherwise leaves req.user undefined and continues.
 */
async function optionalAuth(req, reply) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      const role = (decoded.role || "").toUpperCase();
      if (isValidRole(role)) {
        req.user = {
          id: decoded.id,
          email: decoded.email,
          role,
          fullName: decoded.fullName || decoded.full_name || "",
          district: decoded.district || null,
          state: decoded.state || null,
          organizationId: decoded.organizationId || decoded.organization_id || null,
          employeeId: decoded.employeeId || decoded.employee_id || null,
          badgeNumber: decoded.badgeNumber || decoded.badge_number || null,
        };
      }
    } catch {
      // Ignore token verification errors for optional auth
    }
  }
}

/**
 * Fresh user loader: Hydrates user record from PostgreSQL to guarantee
 * that changes to jurisdiction (district) or organizationId take effect immediately.
 */
async function requireFreshUser(req, reply) {
  if (!req.user || !req.user.id) {
    return reply.code(401).send({
      error: "Unauthorized",
      message: "Authentication required before refreshing user context",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      role: true,
      fullName: true,
      district: true,
      state: true,
      organizationId: true,
      employeeId: true,
      badgeNumber: true,
    },
  });

  if (!user) {
    return reply.code(401).send({
      error: "Unauthorized",
      message: "Authenticated user no longer exists in database",
    });
  }

  req.user = {
    id: user.id,
    email: user.email,
    role: user.role.toUpperCase(),
    fullName: user.fullName,
    district: user.district,
    state: user.state,
    organizationId: user.organizationId,
    employeeId: user.employeeId,
    badgeNumber: user.badgeNumber,
  };
}

/**
 * Functional RBAC Permission Guard:
 * Requires the caller's role to possess ALL of the specified permissions.
 * @param  {...string} requiredPermissions 
 */
function requirePermission(...requiredPermissions) {
  return async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Authentication required to access this endpoint",
      });
    }

    const role = req.user.role;
    const missingPermissions = requiredPermissions.filter(
      (perm) => !hasPermission(role, perm)
    );

    if (missingPermissions.length > 0) {
      req.log.warn({
        userId: req.user.id,
        role: req.user.role,
        missingPermissions,
      }, "Access denied: Missing functional permissions");

      return reply.code(403).send({
        error: "Forbidden",
        message: `Insufficient permissions. Your role '${role}' lacks: ${missingPermissions.join(", ")}`,
        requiredPermissions,
      });
    }
  };
}

/**
 * Functional RBAC Permission Guard (Any):
 * Requires the caller's role to possess AT LEAST ONE of the specified permissions.
 * @param  {...string} allowedPermissions 
 */
function requireAnyPermission(...allowedPermissions) {
  return async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Authentication required to access this endpoint",
      });
    }

    const role = req.user.role;
    const hasAny = hasAnyPermission(role, allowedPermissions);

    if (!hasAny) {
      req.log.warn({
        userId: req.user.id,
        role: req.user.role,
        allowedPermissions,
      }, "Access denied: Lacks any required permission");

      return reply.code(403).send({
        error: "Forbidden",
        message: `Insufficient permissions. Role '${role}' must have at least one of: ${allowedPermissions.join(", ")}`,
        allowedPermissions,
      });
    }
  };
}

/**
 * Role-Based Guard:
 * Restricts access to a set of specific roles.
 * @param  {...string} allowedRoles 
 */
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

export {
  authenticateToken,
  optionalAuth,
  requireFreshUser,
  requirePermission,
  requireAnyPermission,
  requireRoles,
  JWT_SECRET,
};
