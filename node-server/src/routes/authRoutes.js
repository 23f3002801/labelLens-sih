const authController = require("../controllers/authController");
const { authenticateToken } = require("../middleware/auth");

async function authRoutes(fastify, options) {
  fastify.post("/register", authController.register);
  fastify.post("/login", authController.login);
  fastify.get("/me", { preHandler: [authenticateToken] }, authController.getMe);
}

module.exports = authRoutes;
