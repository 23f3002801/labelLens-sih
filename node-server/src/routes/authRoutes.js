import * as authController from "../controllers/authController.js";
import { authenticateToken } from "../middleware/auth.js";

async function authRoutes(fastify, options) {
  fastify.post("/register", authController.register);
  fastify.post("/login", authController.login);
  fastify.get("/me", { preHandler: [authenticateToken] }, authController.getMe);
  fastify.put("/me", { preHandler: [authenticateToken] }, authController.updateProfile);
}

export default authRoutes;
