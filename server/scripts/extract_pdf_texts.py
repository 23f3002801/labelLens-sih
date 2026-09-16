import os
import io
import re
import json
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    print("\n[!] pypdf is not installed. Please run: uv add pypdf\n")
    exit(1)

# Lazy import RapidOCR only if needed for scanned pages
ocr_engine = None
def get_ocr_engine():
    global ocr_engine
    if ocr_engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            ocr_engine = RapidOCR()
            print("  -> Initialized RapidOCR engine for scanned image pages.")
        except Exception as e:
            print(f"  [!] RapidOCR could not be initialized: {e}")
    return ocr_engine

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUTPUT_DIR = DATA_DIR / "extracted_english"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Regex to detect Hindi / Devanagari Unicode characters (U+0900 to U+097F)
HINDI_CHAR_REGEX = re.compile(r'[\u0900-\u097F]')

def clean_and_filter_page(text: str) -> str:
    """
    Filters out lines containing primarily Hindi/Devanagari characters
    and keeps clean English statutory text.
    """
    if not text:
        return ""

    cleaned_lines = []
    for line in text.split("\n"):
        line_str = line.strip()
        if not line_str:
            continue

        hindi_chars = len(HINDI_CHAR_REGEX.findall(line_str))
        total_chars = len(line_str)

        # If line is more than 20% Hindi characters, skip it
        if total_chars > 0 and (hindi_chars / total_chars) > 0.20:
            continue

        cleaned_lines.append(line_str)

    return "\n".join(cleaned_lines)

def ocr_scanned_page(page) -> str:
    """
    Extracts embedded page images from scanned paper PDFs and runs RapidOCR.
    """
    engine = get_ocr_engine()
    if not engine:
        return ""

    extracted_ocr_lines = []
    try:
        for img in page.images:
            img_bytes = img.data
            result, _ = engine(img_bytes)
            if result:
                for line in result:
                    extracted_ocr_lines.append(line[1])
    except Exception as e:
        pass

    return "\n".join(extracted_ocr_lines)

def process_all_pdfs():
    pdf_files = sorted(list(DATA_DIR.glob("*.pdf")))
    print(f"Found {len(pdf_files)} PDF files in {DATA_DIR}...")

    all_extracted_chunks = []
    total_pages_seen = 0
    total_digital_pages = 0
    total_scanned_pages = 0

    for idx, pdf_path in enumerate(pdf_files, 1):
        pdf_name = pdf_path.name
        individual_json = OUTPUT_DIR / f"{pdf_path.stem}.json"
        individual_txt = OUTPUT_DIR / f"{pdf_path.stem}.txt"

        # Resume / Skip if already processed
        if individual_json.exists() and individual_json.stat().st_size > 5:
            try:
                with open(individual_json, "r", encoding="utf-8") as f:
                    cached_pages = json.load(f)
                all_extracted_chunks.extend(cached_pages)
                print(f"[{idx}/{len(pdf_files)}] [CACHED] {pdf_name[:55]} ({len(cached_pages)} pages)")
                continue
            except Exception:
                pass

        print(f"[{idx}/{len(pdf_files)}] Reading: {pdf_name[:55]}...")

        try:
            reader = PdfReader(str(pdf_path))
            num_pages = len(reader.pages)
            total_pages_seen += num_pages

            pdf_english_pages = []
            max_ocr_pages = 15 if num_pages > 30 else num_pages

            for page_idx, page in enumerate(reader.pages, 1):
                # 1. Attempt direct text extraction (for typed/digital pages)
                raw_text = page.extract_text() or ""
                english_text = clean_and_filter_page(raw_text)
                is_scanned = False

                # 2. If text is empty or too short, fallback to OCR on embedded page image
                if len(english_text.strip()) < 40:
                    if page_idx <= max_ocr_pages:
                        print(f"    - Running OCR on scanned page {page_idx}/{num_pages}...")
                        ocr_raw_text = ocr_scanned_page(page)
                        english_text = clean_and_filter_page(ocr_raw_text)
                        if len(english_text.strip()) >= 40:
                            is_scanned = True
                            total_scanned_pages += 1
                else:
                    total_digital_pages += 1

                # Keep pages with meaningful English statutory content
                if len(english_text.strip()) >= 40:
                    entry = {
                        "source_pdf": pdf_name,
                        "original_page_number": page_idx,
                        "total_pdf_pages": num_pages,
                        "extraction_mode": "scanned_ocr" if is_scanned else "digital_text",
                        "english_text": english_text
                    }
                    pdf_english_pages.append(entry)
                    all_extracted_chunks.append(entry)

            # Save individual PDF extraction as JSON and clean TXT
            individual_json = OUTPUT_DIR / f"{pdf_path.stem}.json"
            individual_txt = OUTPUT_DIR / f"{pdf_path.stem}.txt"
            with open(individual_json, "w", encoding="utf-8") as f:
                json.dump(pdf_english_pages, f, indent=2, ensure_ascii=False)
            with open(individual_txt, "w", encoding="utf-8") as f:
                for p in pdf_english_pages:
                    f.write(f"--- PAGE {p['original_page_number']} [{p['extraction_mode']}] ---\n")
                    f.write(p["english_text"] + "\n\n")

        except Exception as e:
            print(f"  [ERROR] Failed to read {pdf_name}: {e}")

    # Save master combined JSON index
    master_json = OUTPUT_DIR / "all_extracted_english.json"
    with open(master_json, "w", encoding="utf-8") as f:
        json.dump(all_extracted_chunks, f, indent=2, ensure_ascii=False)

    # Save master combined human-readable Markdown file
    master_md = OUTPUT_DIR / "combined_english_acts.md"
    with open(master_md, "w", encoding="utf-8") as f:
        f.write("# Cleaned English Legal Metrology Acts, Rules & Gazette Notifications\n\n")
        f.write(f"> Compiled from {len(pdf_files)} official regulatory documents with Hindi filtered out.\n\n")
        current_pdf = None
        for chunk in all_extracted_chunks:
            if chunk["source_pdf"] != current_pdf:
                current_pdf = chunk["source_pdf"]
                f.write(f"\n\n# DOCUMENT: {current_pdf}\n")
                f.write("=" * 80 + "\n")
            f.write(f"\n### Page {chunk['original_page_number']} (Source: {chunk['source_pdf']} | Mode: {chunk['extraction_mode']})\n")
            f.write("-" * 80 + "\n\n")
            f.write(chunk["english_text"] + "\n\n")

    print("\n" + "="*60)
    print("EXTRACTION COMPLETE!")
    print(f"Total PDFs Processed:       {len(pdf_files)}")
    print(f"Total Pages Scanned:         {total_pages_seen}")
    print(f"Typed Digital Pages Kept:    {total_digital_pages}")
    print(f"Scanned OCR Pages Kept:      {total_scanned_pages}")
    print(f"Total English Pages Saved:   {total_digital_pages + total_scanned_pages}")
    print(f"Master Combined Markdown:    {master_md}")
    print(f"Master Combined JSON:        {master_json}")
    print("="*60)

if __name__ == "__main__":
    process_all_pdfs()
