/**
 * Stable hashing + text normalization for questions.
 * Classic script (no ESM). IIFE-wrapped so internals never leak/collide and the
 * file is safe to load more than once. Exposes `globalThis.OQSHash`.
 * @module lib/hash
 */

(() => {
  /**
   * Normalize a question (or choice) string so the same question always hashes
   * to the same key regardless of incidental whitespace / entities.
   * @param {string} text
   * @returns {string}
   */
  function normalizeText(text) {
    return String(text ?? "")
      .replace(/\u00a0/g, " ") // non-breaking spaces (the page uses &nbsp; heavily)
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  /**
   * FNV-1a 32-bit hash - cheap, synchronous, dependency-free. Good enough for a
   * cache/answer-key lookup key. Rendered as 8 hex chars.
   * @param {string} text
   * @returns {string}
   */
  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  /**
   * Async SHA-256 (available in secure contexts / MV3). Falls back to FNV-1a.
   * @param {string} text
   * @returns {Promise<string>}
   */
  async function sha256(text) {
    try {
      const subtle = globalThis.crypto?.subtle;
      if (subtle) {
        const bytes = new TextEncoder().encode(text);
        const digest = await subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 16);
      }
    } catch {
      // fall through to FNV
    }
    return `fnv_${fnv1a(text)}`;
  }

  /**
   * Hash a scraped question object into a stable key.
   * @param {{ questionText?: string, choices?: Array<{ text?: string }> }} question
   * @returns {Promise<string>}
   */
  async function hashQuestion(question) {
    const q = normalizeText(question?.questionText ?? "");
    const choiceText = (question?.choices ?? []).map((c) => normalizeText(c?.text ?? "")).join("\u0001");
    return sha256(`${q}\u0000${choiceText}`);
  }

  globalThis.OQSHash = { normalizeText, fnv1a, sha256, hashQuestion };
})();
