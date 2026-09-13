require("dotenv").config();
const fastify = require("fastify")({ logger: true });
const prisma = require("./config/db");

async function buildServer() {
  // CORS configuration
  await fastify.register(require("@fastify/cors"), {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Multipart form data support (up to 100MB for video scanning)
  await fastify.register(require("@fastify/multipart"), {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100 MB
      files: 10,
    },
  });

  // Register Routes
  await fastify.register(require("./routes/healthroute"));
  await fastify.register(require("./routes/authRoutes"), { prefix: "/api/v1/auth" });
  await fastify.register(require("./routes/authRoutes"), { prefix: "/auth" });
  await fastify.register(require("./routes/uploadRoutes"), { prefix: "/api/v1/uploads" });
  await fastify.register(require("./routes/scanRoutes"), { prefix: "/api/v1" });

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

if (require.main === module) {
  start();
}

module.exports = { buildServer };