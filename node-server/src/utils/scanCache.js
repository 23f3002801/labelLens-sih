/**
 * Small in-memory TTL cache with a max-entries cap (oldest entry evicted).
 * Used to memoize expensive OCR / compliance pipeline results keyed by the
 * SHA-256 of the uploaded image, so identical re-uploads skip the Python
 * OCR service and Cloudinary entirely.
 */
const MAX_ENTRIES = parseInt(process.env.SCAN_CACHE_MAX_ENTRIES, 10) || 100;
const TTL_MS = parseInt(process.env.SCAN_CACHE_TTL_MS, 10) || 10 * 60 * 1000; // 10 min

const store = new Map(); // key -> { expires, value }

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value) {
  if (!store.has(key) && store.size >= MAX_ENTRIES) {
    // Evict the oldest entry (Map preserves insertion order)
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
  store.set(key, { expires: Date.now() + TTL_MS, value });
}

export { get, set };
