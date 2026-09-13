const { uploadBuffer } = require("../services/cloudinaryService");

const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
];

async function uploadRawFile(req, reply) {
  try {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "No file provided in multipart request",
      });
    }

    if (!ALLOWED_IMAGE_MIMES.includes(data.mimetype)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: `Invalid file type '${data.mimetype}'. Allowed types: JPG, PNG, WEBP, GIF, BMP`,
      });
    }

    const buffer = await data.toBuffer();
    if (buffer.length === 0) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Uploaded file is empty",
      });
    }

    const cloudinaryResult = await uploadBuffer(buffer, {
      filename: data.filename,
    });

    return reply.code(200).send({
      message: "File uploaded successfully",
      filename: data.filename,
      secure_url: cloudinaryResult.secure_url,
      public_id: cloudinaryResult.public_id,
      format: cloudinaryResult.format,
      bytes: cloudinaryResult.bytes,
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({
      error: "Internal Server Error",
      message: error.message || "Failed to upload file to Cloudinary",
    });
  }
}

module.exports = {
  uploadRawFile,
};
