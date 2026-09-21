import os
import sys
import re
import json
import time
from pathlib import Path
import httpx
from dotenv import load_dotenv

load_dotenv()

SERVER_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = SERVER_DIR / "data"
EXTRACTED_DIR = DATA_DIR / "extracted_english"
RULES_FILE = SERVER_DIR / "rules.json"

USE_OLLAMA = "--ollama" in sys.argv or os.getenv("USE_OLLAMA", "").lower() in ("1", "true")

if USE_OLLAMA:
    LLM_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    LLM_API_KEY = "ollama"
    
    # Check CLI arg --model or env var
    custom_model = None
    if "--model" in sys.argv:
        try:
            custom_model = sys.argv[sys.argv.index("--model") + 1]
        except IndexError:
            pass

    if custom_model:
        LLM_MODEL = custom_model
    elif os.getenv("OLLAMA_MODEL"):
        LLM_MODEL = os.getenv("OLLAMA_MODEL")
    else:
        # Auto-detect available model from Ollama API
        try:
            with httpx.Client(timeout=5.0) as client:
                tag_resp = client.get("http://localhost:11434/api/tags")
                if tag_resp.status_code == 200:
                    models = [m["name"] for m in tag_resp.json().get("models", [])]
                    qwen_models = [m for m in models if "qwen" in m.lower() or "4b" in m.lower()]
                    LLM_MODEL = qwen_models[0] if qwen_models else (models[0] if models else "qwen3.5:4b")
                else:
                    LLM_MODEL = "qwen3.5:4b"
        except Exception:
            LLM_MODEL = "qwen3.5:4b"

    print(f"[*] Using local Ollama engine: {LLM_MODEL} at {LLM_BASE_URL}")
else:
    LLM_API_KEY = os.getenv("GROQ_API_KEY") or os.getenv("LLM_API_KEY") or ""
    LLM_BASE_URL = (os.getenv("GROQ_BASE_URL") or "https://api.groq.com/openai/v1").rstrip("/")
    LLM_MODEL = os.getenv("GROQ_MODEL") or "qwen/qwen3.8-27b"
    if not LLM_API_KEY:
        print("[!] ERROR: GROQ_API_KEY is not set in server/.env")
        exit(1)
    print(f"[*] Using Groq API: {LLM_MODEL} at {LLM_BASE_URL}")

def load_chunks():
    master_file = EXTRACTED_DIR / "all_extracted_english.json"
    if not master_file.exists():
        print(f"[!] ERROR: {master_file} not found.")
        exit(1)

    with open(master_file, "r", encoding="utf-8") as f:
        return json.load(f)

def get_batch_excerpts(chunks, target_keywords, max_chunks=4, max_chars=1200):
    """Selects top concise excerpts, truncated to stay well within token limits."""
    selected = []
    seen = set()
    for c in chunks:
        text_lower = c["english_text"].lower()
        score = sum(1 for kw in target_keywords if kw in text_lower)
        if score >= 1:
            snippet = c["english_text"][:100]
            if snippet not in seen:
                seen.add(snippet)
                selected.append({
                    "source_pdf": c["source_pdf"],
                    "page": c["original_page_number"],
                    "text": c["english_text"][:max_chars],
                    "score": score
                })
    selected.sort(key=lambda x: x["score"], reverse=True)
    return selected[:max_chunks]

def extract_clean_json(raw_text: str) -> dict:
    """Safely extracts and parses JSON even if Qwen outputs <think> tags or markdown fences."""
    if not raw_text:
        return {}
    
    # 1. Remove <think>...</think> reasoning blocks (common in Qwen 3.5)
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
    
    # 2. Extract content from markdown ```json ... ``` code blocks
    if "```" in cleaned:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
        if match:
            cleaned = match.group(1).strip()

    # 3. Locate the outer JSON object { ... }
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start:end+1]

    try:
        return json.loads(cleaned)
    except Exception as e:
        print(f"[!] JSON parsing failed: {e}\nRaw output preview:\n{raw_text[:300]}")
        return {}

def call_llm(system_prompt, user_prompt, max_retries=4):
    headers = {
        "Authorization": f"Bearer {LLM_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 1200
    }
    if USE_OLLAMA:
        payload["format"] = "json"
    else:
        payload["response_format"] = {"type": "json_object"}

    for attempt in range(1, max_retries + 1):
        try:
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(f"{LLM_BASE_URL}/chat/completions", headers=headers, json=payload)

            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"]
                return extract_clean_json(content)
            elif resp.status_code == 429:
                wait_time = 25
                print(f"  [429 Rate Limit] Groq TPM limit reached. Waiting {wait_time}s for token quota reset (Attempt {attempt}/{max_retries})...")
                time.sleep(wait_time)
            else:
                print(f"[!] API Error {resp.status_code}: {resp.text}")
                return {}
        except Exception as e:
            print(f"  [Connection error: {e}] Retrying in 5s...")
            time.sleep(5)

    return {}

def run_analysis():
    print("Loading rules.json and extracted pages...")
    with open(RULES_FILE, "r", encoding="utf-8") as f:
        current_rules = json.load(f)

    all_chunks = load_chunks()

    # ---------------- BATCH 1: CORE DECLARATIONS (STRICTLY < 3,500 TOKENS) ----------------
    print("\n--- BATCH 1: Analyzing Core Legal Declarations & Citations ---")
    core_keywords = ["rule 6", "unit sale price", "maximum retail price", "net quantity", "consumer care"]
    batch1_chunks = get_batch_excerpts(all_chunks, core_keywords, max_chunks=4, max_chars=1000)

    context1 = "\n".join([f"[EXCERPT {i+1}] {c['source_pdf']} (p.{c['page']}):\n{c['text']}" for i, c in enumerate(batch1_chunks)])

    system1 = (
        "You are an Indian Legal Metrology regulatory expert. Map rules in rules.json to their exact statutory citation "
        "based on the provided Legal Metrology (Packaged Commodities) Rules excerpts.\n"
        "Return ONLY valid JSON matching: {\"statutory_citations\": {\"<rule_id>\": {\"act_name\": str, \"rule_number\": str, \"section_title\": str, \"source_document\": str, \"page_number\": int, \"statutory_quote\": str}}}"
    )
    user1 = f"Rules:\n{json.dumps(current_rules['base_declarations'], indent=2)}\n\nRegulatory Text Excerpts:\n{context1}"

    print(f"Sending Batch 1 ({len(user1)} chars) to {LLM_MODEL}...")
    res1 = call_llm(system1, user1)
    citations = res1.get("statutory_citations", {})
    print(f"-> Extracted {len(citations)} statutory citations.")

    if not USE_OLLAMA:
        print("  Waiting 20 seconds for Groq per-minute token quota to reset...")
        time.sleep(20)

    # ---------------- BATCH 2: AMENDMENTS & NEW RULES (STRICTLY < 3,500 TOKENS) ----------------
    print("\n--- BATCH 2: Analyzing Amendments, New Rules & Categories ---")
    amend_keywords = ["qr code", "pan masala", "garment", "cosmetic", "jan vishwas", "section 36"]
    batch2_chunks = get_batch_excerpts(all_chunks, amend_keywords, max_chunks=4, max_chars=1000)

    context2 = "\n".join([f"[EXCERPT {i+1}] {c['source_pdf']} (p.{c['page']}):\n{c['text']}" for i, c in enumerate(batch2_chunks)])

    system2 = (
        "You are an Indian Legal Metrology expert. Analyze recent gazette amendments to identify:\n"
        "1. Newly mandated rules (e.g. QR code provisions, Pan Masala standard sizes, COO requirements).\n"
        "2. Suggested new product categories.\n"
        "3. Statutory penalties under Section 36 / Jan Vishwas.\n"
        "Return ONLY valid JSON matching: {\"new_mandatory_rules\": [...], \"suggested_categories\": [...], \"statutory_penalties\": [...]}"
    )
    user2 = f"Current Categories: {list(current_rules['categories'].keys())}\n\nRegulatory Excerpts:\n{context2}"

    print(f"Sending Batch 2 ({len(user2)} chars) to {LLM_MODEL}...")
    res2 = call_llm(system2, user2)

    # ---------------- MERGE & SAVE ----------------
    combined_gap = {
        "statutory_citations": citations,
        "new_mandatory_rules": res2.get("new_mandatory_rules", []),
        "suggested_categories": res2.get("suggested_categories", []),
        "statutory_penalties": res2.get("statutory_penalties", [])
    }

    gap_file = DATA_DIR / "rules_gap_analysis.json"
    with open(gap_file, "w", encoding="utf-8") as f:
        json.dump(combined_gap, f, indent=2, ensure_ascii=False)

    citations_file = DATA_DIR / "statutory_citations.json"
    with open(citations_file, "w", encoding="utf-8") as f:
        json.dump(citations, f, indent=2, ensure_ascii=False)

    print("\n" + "="*60)
    print("LEGAL GAP ANALYSIS COMPLETE!")
    print(f"Citations Mapped:           {len(citations)}")
    print(f"New Rules Suggested:        {len(combined_gap['new_mandatory_rules'])}")
    print(f"New Categories Suggested:   {len(combined_gap['suggested_categories'])}")
    print(f"Penalties Extracted:        {len(combined_gap['statutory_penalties'])}")
    print(f"Full Gap Analysis Report:   {gap_file}")
    print(f"RAG Citations File:         {citations_file}")
    print("="*60)

if __name__ == "__main__":
    run_analysis()
