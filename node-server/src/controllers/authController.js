const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../config/db");
const { JWT_SECRET } = require("../middleware/auth");

const VALID_ROLES = ["FIELD_INSPECTOR", "DISTRICT_OFFICER", "STATE_CONTROLLER", "ADMIN"];

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

    let assignedRole = (role || "FIELD_INSPECTOR").toUpperCase();
    if (!VALID_ROLES.includes(assignedRole)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
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
        fullName: name,
        role: assignedRole,
        district: district || null,
        state: state || null,
        badgeNumber: badge || null,
      },
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

    const token = jwt.sign(
      {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        fullName: newUser.fullName,
      },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return reply.code(201).send({
      message: "User registered successfully",
      token,
      user: newUser,
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to register user",
    });
  }
}

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

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
      },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return reply.code(200).send({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        district: user.district,
        state: user.state,
        badgeNumber: user.badgeNumber,
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

async function getMe(req, reply) {
  return reply.code(200).send({
    user: req.user,
  });
}

async function updateProfile(req, reply) {
  try {
    const { fullName, district, state } = req.body || {};

    if (fullName !== undefined && (!fullName || !String(fullName).trim())) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Full name cannot be empty",
      });
    }

    const data = {};
    if (fullName !== undefined) data.fullName = String(fullName).trim();
    if (district !== undefined) data.district = district ? String(district).trim() : null;
    if (state !== undefined) data.state = state ? String(state).trim() : null;

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "No updatable fields provided (fullName, district, state)",
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
        district: true,
        state: true,
        badgeNumber: true,
        createdAt: true,
      },
    });

    return reply.code(200).send({
      message: "Profile updated successfully",
      user,
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to update profile",
    });
  }
}

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
};
