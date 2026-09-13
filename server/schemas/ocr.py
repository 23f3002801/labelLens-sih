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

class BlockSize(BaseModel):
    width: float = Field(..., description="Width of text block in pixels")
    height: float = Field(..., description="Height of text block in pixels (bounding height)")
    aspect_ratio: float = Field(..., description="Width to height ratio (width / height)")
    estimated_font_size_px: float = Field(..., description="Estimated average font height/size in pixels")

class TextBlock(BaseModel):
    id: int = Field(..., description="Sequential ID of the text block")
    text: str = Field(..., description="Extracted text string")
    confidence: float = Field(..., description="OCR detection confidence score (0.0 to 1.0)")
    polygon: List[List[float]] = Field(..., description="4-point bounding polygon [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]")
    bbox: BBox = Field(..., description="Axis-aligned bounding box")
    size: BlockSize = Field(..., description="Physical dimensions and font size estimation of text block")
    center: Point = Field(..., description="Center coordinates of text block")

class ImageMetadata(BaseModel):
    width: int = Field(..., description="Image width in pixels")
    height: int = Field(..., description="Image height in pixels")
    channels: int = Field(default=3, description="Color channels (e.g. 3 for RGB)")

class OCRScanResult(BaseModel):
    success: bool = Field(default=True, description="Status of OCR extraction")
    image_metadata: ImageMetadata = Field(..., description="Metadata of scanned image")
    total_text_blocks: int = Field(..., description="Total count of text blocks detected")
    text_blocks: List[TextBlock] = Field(..., description="List of all extracted text blocks with position and size")
    raw_text: str = Field(..., description="All extracted text joined by line breaks")
    processing_time_ms: float = Field(..., description="Total processing time in milliseconds")
    annotated_image_base64: Optional[str] = Field(default=None, description="Optional base64 encoded image with bounding box visualization")
    pipelines_executed: Optional[List[str]] = Field(default=None, description="Names of preprocessing pipelines executed")
    error: Optional[str] = Field(default=None, description="Error message if scanning failed")
