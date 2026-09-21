import { randomUUID } from "crypto";
import cloudinary from "../config/cloudinary.js";

/**
 * Upload an in-memory buffer to Cloudinary
 * @param {Buffer} buffer 
 * @param {Object} options 
 * @returns {Promise<{ secure_url: string, public_id: string, format: string, width: number, height: number }>}
 */
function uploadBuffer(buffer, options = {}) {
  const folder = options.folder || "labellens/scans";
  const publicId = options.publicId || (options.filename ? `${randomUUID()}-${options.filename.replace(/\.[^/.]+$/, "")}` : randomUUID());
  const resourceType = options.resourceType || "image";

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve({
          secure_url: result.secure_url,
          public_id: result.public_id,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

export {
  uploadBuffer,
};
