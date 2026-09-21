import os
from uuid import uuid4

import cloudinary
import cloudinary.uploader


def upload_image(
    image_bytes: bytes,
    filename: str | None = None,
    public_id: str | None = None,
) -> dict[str, str]:
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")
    if not all((cloud_name, api_key, api_secret)):
        raise RuntimeError(
            "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, "
            "CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET."
        )

    cloudinary.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        secure=True,
    )

    resolved_public_id = public_id or (
        f"{uuid4()}-{filename.rsplit('.', 1)[0] if filename and '.' in filename else 'label'}"
    )

    result = cloudinary.uploader.upload(
        image_bytes,
        folder="labellens/scans",
        public_id=resolved_public_id,
        resource_type="image",
    )
    return {
        "secure_url": result["secure_url"],
        "public_id": result["public_id"],
    }