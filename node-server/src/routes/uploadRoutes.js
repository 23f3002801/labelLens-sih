import * as uploadController from "../controllers/uploadController.js";

async function uploadRoutes(fastify, options) {
  fastify.post("/raw", uploadController.uploadRawFile);
}

export default uploadRoutes;
