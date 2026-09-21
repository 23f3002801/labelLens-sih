import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import prisma from "./config/db.js";
import healthRoute from "./routes/healthroute.js";
import authRoutes from "./routes/authRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import scanRoutes from "./routes/scanRoutes.js";
import complianceRoutes from "./routes/complianceRoutes.js";

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "warn",
  },
});

async function buildServer() {
  // CORS configuration
  await fastify.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Multipart form data support (up to 100MB for video scanning)
  await fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100 MB
      files: 10,
    },
  });

  // Register Routes
  await fastify.register(healthRoute);
  await fastify.register(authRoutes, { prefix: "/api/v1/auth" });
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(uploadRoutes, { prefix: "/api/v1/uploads" });
  await fastify.register(scanRoutes, { prefix: "/api/v1" });
  await fastify.register(complianceRoutes, { prefix: "/api/v1" });

  return fastify;
}

const start = async () => {
  try {
    const app = await buildServer();
    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || "0.0.0.0";

    await app.listen({ port: PORT, host: HOST });
    console.log(`🚀 LabelLens Fastify Server is running on http://localhost:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  try {
    console.log("\nGracefully shutting down Fastify and disconnecting Prisma...");
    await fastify.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Error during graceful shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  start();
}

export { buildServer };