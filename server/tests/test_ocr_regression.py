import os
import sys
import json
import pytest
from PIL import Image, ImageDraw

# Ensure server root is in python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.ocr_service import get_ocr_service

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
GROUND_TRUTH_FILE = os.path.join(DATA_DIR, "ocr_ground_truth.json")


def create_synthetic_image_from_declarations(declarations: list[str]) -> Image.Image:
    """Generates synthetic image with specified declaration text lines."""
    img = Image.new("RGB", (700, 40 + len(declarations) * 50), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(declarations):
        draw.text((30, 20 + i * 50), line, fill=(0, 0, 0))
    return img


def test_ground_truth_file_exists():
    """Verify ground truth configuration file is properly structured."""
    assert os.path.exists(GROUND_TRUTH_FILE), f"Missing ground truth file at {GROUND_TRUTH_FILE}"
    with open(GROUND_TRUTH_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert "synthetic_benchmark" in data
    assert len(data["synthetic_benchmark"]) > 0


def test_ocr_synthetic_regression_benchmarks():
    """Run regression assertion against synthetic benchmark labels."""
    with open(GROUND_TRUTH_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    ocr_service = get_ocr_service()

    for item in data["synthetic_benchmark"]:
        name = item["name"]
        declarations = item["expected_declarations"]
        required_keywords = item["required_keywords"]
        min_blocks = item.get("min_blocks", 1)

        img = create_synthetic_image_from_declarations(declarations)
        result = ocr_service.extract_text(img, fallback=True)

        assert result.success is True, f"OCR extraction failed for {name}: {result.error}"
        assert result.total_text_blocks >= min_blocks, (
            f"Expected at least {min_blocks} blocks for {name}, found {result.total_text_blocks}"
        )

        extracted_text = result.raw_text.upper()
        for kw in required_keywords:
            assert kw.upper() in extracted_text, (
                f"Regression failure in {name}: missing expected keyword '{kw}' in extracted text: {extracted_text}"
            )


def test_dataset_sample_regression():
    """Verify OCR token extraction against real dataset images in ground truth."""
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    with open(GROUND_TRUTH_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    samples = data.get("dataset_samples", [])
    if not samples:
        pytest.skip("No dataset_samples configured in ocr_ground_truth.json")

    ocr_service = get_ocr_service()

    tested_count = 0
    for item in samples:
        rel_path = item["image_path"]
        fpath = os.path.join(repo_root, rel_path.replace("/", os.sep))

        if not os.path.exists(fpath):
            continue

        tested_count += 1
        result = ocr_service.extract_text(fpath, fallback=True)
        assert result.success is True, f"Failed on dataset image {rel_path}: {result.error}"

        min_blocks = item.get("min_blocks", 1)
        assert result.total_text_blocks >= min_blocks, (
            f"Expected at least {min_blocks} blocks for {rel_path}, got {result.total_text_blocks}"
        )

        extracted_text = result.raw_text.upper()
        for kw in item.get("required_keywords", []):
            assert kw.upper() in extracted_text, (
                f"Regression failure in {rel_path}: missing expected keyword '{kw}' in extracted text: {extracted_text}"
            )

    if tested_count == 0:
        pytest.skip("None of the configured dataset sample images were found on disk")
