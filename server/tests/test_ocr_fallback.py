import io
import os
import sys
import pytest
import numpy as np
from PIL import Image, ImageDraw

# Ensure server root is in python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.ocr_service import calculate_bbox_iou, OCRService, get_ocr_service
from schemas.ocr import BBox, TextBlock, BlockSize, Point


def test_calculate_bbox_iou():
    """Test IoU calculation for distinct spatial relationships."""
    box_a = BBox(x_min=0, y_min=0, x_max=10, y_max=10)  # Area 100
    box_b = BBox(x_min=0, y_min=0, x_max=10, y_max=10)  # Identical
    box_c = BBox(x_min=5, y_min=0, x_max=15, y_max=10)  # 50% overlap
    box_d = BBox(x_min=20, y_min=20, x_max=30, y_max=30)  # Disjoint

    assert calculate_bbox_iou(box_a, box_b) == 1.0
    assert abs(calculate_bbox_iou(box_a, box_c) - (50.0 / 150.0)) < 1e-4
    assert calculate_bbox_iou(box_a, box_d) == 0.0


def test_merge_blocks_iou_deduplication():
    """Test merging and IoU deduplication of text blocks."""
    ocr_service = get_ocr_service()

    block1 = TextBlock(
        id=1,
        text="MRP Rs. 250",
        confidence=0.85,
        polygon=[[10, 10], [100, 10], [100, 30], [10, 30]],
        bbox=BBox(x_min=10, y_min=10, x_max=100, y_max=30),
        size=BlockSize(width=90, height=20, aspect_ratio=4.5, estimated_font_size_px=20),
        center=Point(x=55, y=20)
    )

    # Duplicate block with slightly different coords (IoU > 0.45) but higher confidence
    block1_better = TextBlock(
        id=1,
        text="MRP Rs. 250.00 (INCL. OF ALL TAXES)",
        confidence=0.96,
        polygon=[[12, 10], [105, 10], [105, 30], [12, 30]],
        bbox=BBox(x_min=12, y_min=10, x_max=105, y_max=30),
        size=BlockSize(width=93, height=20, aspect_ratio=4.65, estimated_font_size_px=20),
        center=Point(x=58.5, y=20)
    )

    # Completely separate new block
    block2 = TextBlock(
        id=2,
        text="Net Qty: 500g",
        confidence=0.90,
        polygon=[[10, 50], [100, 50], [100, 70], [10, 70]],
        bbox=BBox(x_min=10, y_min=50, x_max=100, y_max=70),
        size=BlockSize(width=90, height=20, aspect_ratio=4.5, estimated_font_size_px=20),
        center=Point(x=55, y=60)
    )

    merged = ocr_service._merge_blocks([block1], [block1_better, block2], iou_threshold=0.45)

    # Must contain exactly 2 blocks (block1 upgraded, block2 added)
    assert len(merged) == 2
    # The upgraded text must be present
    assert any("INCL. OF ALL TAXES" in b.text for b in merged)
    assert any("Net Qty" in b.text for b in merged)


def test_preprocessing_pipelines():
    """Verify that all 4 preprocessing routines output valid 3-channel RGB numpy images."""
    ocr_service = get_ocr_service()
    test_img = np.zeros((300, 300, 3), dtype=np.uint8)
    test_img[100:200, 100:200] = 255  # White square on black

    p1, s1 = ocr_service.preprocess_standard(test_img)
    assert p1.shape[2] == 3
    assert s1 >= 1.0

    p2, s2 = ocr_service.preprocess_aggressive_contrast(test_img)
    assert p2.shape[2] == 3
    assert s2 >= 1.0

    p3, s3 = ocr_service.preprocess_otsu_binarize(test_img)
    assert p3.shape[2] == 3
    assert s3 >= 1.0

    p4, s4 = ocr_service.preprocess_inverted(test_img)
    assert p4.shape[2] == 3
    assert s4 >= 1.0
