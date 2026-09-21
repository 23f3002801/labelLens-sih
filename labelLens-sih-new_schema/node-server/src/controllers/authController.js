import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../config/db.js";
import { JWT_SECRET } from "../middleware/auth.js";
import {
  ROLES,
  ALL_ROLES,
  isValidRole,
  isGovernmentRole,
  getRolePermissions,
} from "../constants/rbac.js";

/**
 * Normalizes legacy or newly configured role names to standard UserRole
 */
function normalizeRole(roleInput) {
  if (!roleInput) return ROLES.CONSUMER;
  const upper = String(roleInput).toUpperCase().trim();

  // Backward compatibility mapping for older test suites and clients
  const legacyMap = {
    FIELD_INSPECTOR: ROLES.INSPECTOR,
    DISTRICT_OFFICER: ROLES.CONTROLLER,
    STATE_CONTROLLER: ROLES.DIRECTOR,
    ADMIN: ROLES.DIRECTOR,
  };

  if (legacyMap[upper]) {
    return legacyMap[upper];
  }

  if (isValidRole(upper)) {
    return upper;
  }

  return null;
}

/**
 * Register a new user with role, badge number, and hierarchy metadata
 */
async function register(req, reply) {
  try {
    const {
      email,
      password,
      fullName,
      full_name,
      role,
      district,
      state,
      badgeNumber,
      badge_number,
    } = req.body || {};

    const name = fullName || full_name;
    const badge = badgeNumber || badge_number;

    if (!email || !password || !name) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Email, password, and full name are required",
      });
    }

    if (password.length < 6) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Password must be at least 6 characters long",
      });
    }

    const assignedRole = normalizeRole(role || ROLES.CONSUMER);
    if (!assignedRole) {
      return reply.code(400).send({
        error: "Bad Request",
        message: `Invalid role. Must be one of: ${ALL_ROLES.join(", ")}`,
      });
    }

    // Role-specific validation rules
    if (assignedRole === ROLES.CONTROLLER && (!district || !String(district).trim())) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Jurisdiction 'district' is required when registering a CONTROLLER",
      });
    }

    // Check unique email
    const existingEmail = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingEmail) {
      return reply.code(409).send({
        error: "Conflict",
        message: "A user with this email address already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        fullName: name.trim(),
        role: assignedRole,
        district: district ? String(district).trim() : null,
        state: state ? String(state).trim() : null,
        badgeNumber: badge ? String(badge).trim() : null,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        badgeNumber: true,
        district: true,
        state: true,
        createdAt: true,
      },
    });

    const tokenPayload = {
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
      fullName: newUser.fullName,
      district: newUser.district,
      state: newUser.state,
      badgeNumber: newUser.badgeNumber,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    return reply.code(201).send({
      message: "User registered successfully",
      token,
      user: {
        ...newUser,
        permissions: getRolePermissions(newUser.role),
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to register user",
    });
  }
}

/**
 * Login user and issue JWT with complete scoping claims
 */
async function login(req, reply) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Email and password are required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user || !user.password) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Invalid email or password",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Invalid email or password",
      });
    }

    const role = user.role.toUpperCase();

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role,
      fullName: user.fullName,
      district: user.district,
      state: user.state,
      badgeNumber: user.badgeNumber,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    return reply.code(200).send({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role,
        badgeNumber: user.badgeNumber,
        district: user.district,
        state: user.state,
        permissions: getRolePermissions(role),
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to login",
    });
  }
}

/**
 * Returns current authenticated user's profile and permissions
 */
async function getMe(req, reply) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        badgeNumber: true,
        district: true,
        state: true,
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
          },
        },
        createdAt: true,
      },
    });

    if (!user) {
      return reply.code(404).send({
        error: "Not Found",
        message: "User account no longer exists",
      });
    }

    return reply.code(200).send({
      user: {
        ...user,
        permissions: getRolePermissions(user.role),
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to retrieve profile",
    });
  }
}

/**
 * Update user's profile
 */
async function updateProfile(req, reply) {
  try {
    const { fullName, district, state, badgeNumber } = req.body || {};

    const data = {};
    if (fullName !== undefined) data.fullName = String(fullName).trim();
    if (district !== undefined) data.district = district ? String(district).trim() : null;
    if (state !== undefined) data.state = state ? String(state).trim() : null;
    if (badgeNumber !== undefined) data.badgeNumber = badgeNumber ? String(badgeNumber).trim() : null;

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "No updatable fields provided",
      });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        badgeNumber: true,
        district: true,
        state: true,
        createdAt: true,
      },
    });

    return reply.code(200).send({
      message: "Profile updated successfully",
      user: {
        ...user,
        permissions: getRolePermissions(user.role),
      },
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to update profile",
    });
  }
}

export {
  register,
  login,
  getMe,
  updateProfile,
};
