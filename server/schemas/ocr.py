from typing import List, Optional
from pydantic import BaseModel, Field

class Point(BaseModel):
    x: float = Field(..., description="X coordinate in pixels")
    y: float = Field(..., description="Y coordinate in pixels")

class BBox(BaseModel):
    x_min: float = Field(..., description="Minimum X coordinate (left)")
    y_min: float = Field(..., description="Minimum Y coordinate (top)")
    x_max: float = Field(..., description="Maximum X coordinate (right)")
    y_max: float = Field(..., description="Maximum Y coordinate (bottom)")

BoundingBox = BBox

class BlockSize(BaseModel):
    width: float = Field(default=0.0, description="Width of text block in pixels")
    height: float = Field(default=0.0, description="Height of text block in pixels (bounding height)")
    aspect_ratio: float = Field(default=1.0, description="Width to height ratio (width / height)")
    estimated_font_size_px: float = Field(..., description="Estimated average font height/size in pixels")

    def __init__(self, **data):
        if "width_px" in data and "width" not in data:
            data["width"] = data["width_px"]
        if "height_px" in data and "height" not in data:
            data["height"] = data["height_px"]
        if "aspect_ratio" not in data:
            w = data.get("width", 0.0)
            h = data.get("height", 1.0)
            data["aspect_ratio"] = round(w / max(h, 1.0), 2)
        super().__init__(**data)

class TextBlock(BaseModel):
    id: int = Field(..., description="Sequential ID of the text block")
    text: str = Field(..., description="Extracted text string")
    confidence: float = Field(..., description="OCR detection confidence score (0.0 to 1.0)")
    polygon: List[List[float]] = Field(default_factory=list, description="4-point bounding polygon [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]")
    bbox: BBox = Field(..., description="Axis-aligned bounding box")
    size: BlockSize = Field(..., description="Physical dimensions and font size estimation of text block")
    center: Optional[Point] = Field(default=None, description="Center coordinates of text block")
    face_index: Optional[int] = Field(default=None, description="Index of the product face this block was read from (multi-face scans)")

    def __init__(self, **data):
        if "bbox" in data:
            b = data["bbox"]
            if isinstance(b, BBox):
                if not data.get("polygon"):
                    data["polygon"] = [[b.x_min, b.y_min], [b.x_max, b.y_min], [b.x_max, b.y_max], [b.x_min, b.y_max]]
                if not data.get("center"):
                    data["center"] = Point(x=(b.x_min + b.x_max) / 2.0, y=(b.y_min + b.y_max) / 2.0)
        super().__init__(**data)

class ImageMetadata(BaseModel):
    width: int = Field(..., description="Image width in pixels")
    height: int = Field(..., description="Image height in pixels")
    channels: int = Field(default=3, description="Color channels (e.g. 3 for RGB)")

class OCRScanResult(BaseModel):
    success: bool = Field(default=True, description="Status of OCR extraction")
    image_metadata: ImageMetadata = Field(..., description="Metadata of scanned image")
    total_text_blocks: int = Field(default=0, description="Total count of text blocks detected")
    text_blocks: List[TextBlock] = Field(..., description="List of all extracted text blocks with position and size")
    raw_text: str = Field(default="", description="All extracted text joined by line breaks")
    processing_time_ms: float = Field(..., description="Total processing time in milliseconds")

    def __init__(self, **data):
        if "total_blocks" in data and "total_text_blocks" not in data:
            data["total_text_blocks"] = data["total_blocks"]
        if "full_text" in data and "raw_text" not in data:
            data["raw_text"] = data["full_text"]
        if "total_text_blocks" not in data and "text_blocks" in data:
            data["total_text_blocks"] = len(data["text_blocks"])
        if "raw_text" not in data and "text_blocks" in data:
            data["raw_text"] = "\n".join(getattr(b, "text", str(b)) for b in data["text_blocks"])
        super().__init__(**data)
    annotated_image_base64: Optional[str] = Field(default=None, description="Optional base64 encoded image with bounding box visualization")
    pipelines_executed: Optional[List[str]] = Field(default=None, description="Names of preprocessing pipelines executed")
    error: Optional[str] = Field(default=None, description="Error message if scanning failed")
