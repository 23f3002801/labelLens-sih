import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List

from schemas.compliance import LegalCitation

logger = logging.getLogger("citation_service")

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
CITATIONS_FILE = DATA_DIR / "statutory_citations.json"
CHUNKS_FILE = DATA_DIR / "extracted_english" / "all_extracted_english.json"

class LegalCitationService:
    def __init__(self):
        self._citations: Dict[str, LegalCitation] = {}
        self._chunks: List[Dict[str, Any]] = []
        self._load_citations()
        self._load_chunks()

    def _load_citations(self):
        """Loads statutory citations mapped from official Legal Metrology / FSSAI Gazettes."""
        if not CITATIONS_FILE.exists():
            logger.warning(f"Statutory citations file not found at {CITATIONS_FILE}")
            return

        try:
            with open(CITATIONS_FILE, "r", encoding="utf-8") as f:
                raw_data = json.load(f)

            for rule_id, data in raw_data.items():
                self._citations[rule_id] = LegalCitation(
                    act_name=data.get("act_name", "Legal Metrology (Packaged Commodities) Rules, 2011"),
                    rule_number=data.get("rule_number"),
                    section_title=data.get("section_title"),
                    source_document=data.get("source_document", "Legal_Metrology_PCR.pdf"),
                    page_number=data.get("page_number"),
                    statutory_quote=data.get("statutory_quote", "")
                )
            logger.info(f"Loaded {len(self._citations)} statutory citations.")
        except Exception as e:
            logger.error(f"Failed to load statutory citations: {e}")

    def _load_chunks(self):
        """Loads statutory corpus chunks into memory once for fast lookup."""
        if not CHUNKS_FILE.exists():
            return
        try:
            with open(CHUNKS_FILE, "r", encoding="utf-8") as f:
                self._chunks = json.load(f)
            logger.info(f"Loaded {len(self._chunks)} statutory corpus chunks.")
        except Exception as e:
            logger.error(f"Failed to load statutory corpus chunks: {e}")

    def get_citation(self, rule_id: str) -> Optional[LegalCitation]:
        """Returns the specific Act, Rule number, and statutory quote for a given rule_id."""
        if not rule_id:
            return None
        norm_id = rule_id.lower().strip()
        if norm_id in self._citations:
            return self._citations[norm_id]

        # Fuzzy match (e.g., 'mrp_format' -> 'mrp', 'net_quantity_metric' -> 'net_quantity')
        for key, citation in self._citations.items():
            if key in norm_id or norm_id in key:
                return citation

        return None

    def search_statutory_corpus(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Searches the 1,100+ extracted statutory pages for matching legal provisions."""
        if not query:
            return []

        if not self._chunks:
            self._load_chunks()

        if not self._chunks:
            return []

        try:
            chunks = self._chunks
            q_terms = [t.lower() for t in query.split() if len(t) > 2]
            scored = []
            for c in chunks:
                text_lower = c.get("english_text", "").lower()
                matches = sum(1 for term in q_terms if term in text_lower)
                if matches > 0:
                    scored.append((matches, c))

            scored.sort(key=lambda x: x[0], reverse=True)
            return [
                {
                    "source_pdf": item[1].get("source_pdf"),
                    "page": item[1].get("original_page_number"),
                    "text_snippet": item[1].get("english_text", "")[:400]
                }
                for item in scored[:top_k]
            ]
        except Exception as e:
            logger.error(f"Statutory corpus search error: {e}")
            return []

# Singleton instance
_citation_service = None

def get_citation_service() -> LegalCitationService:
    global _citation_service
    if _citation_service is None:
        _citation_service = LegalCitationService()
    return _citation_service
