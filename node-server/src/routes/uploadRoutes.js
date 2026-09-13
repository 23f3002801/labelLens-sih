const uploadController = require("../controllers/uploadController");

async function uploadRoutes(fastify, options) {
  fastify.post("/raw", uploadController.uploadRawFile);
}

module.exports = uploadRoutes;
