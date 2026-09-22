/**
 * "Human mode": deliberately miss some HARD questions so an auto-solved run
 * looks like a real student instead of a flawless bot.
 *
 * Everything here is PURE and LOCAL — no AI calls, no DOM access:
 *   - difficulty(): a 0..1 heuristic score for how "high level" a question is,
 *     derived from the question text length/complexity keywords and #choices.
 *   - pickHumanFailure(): decide whether to fail this question and, if so, which
 *     (plausible but wrong) choice to submit instead.
 *
 * Classic script (no ESM). IIFE-wrapped so internals never leak/collide and the
 * file is safe to load more than once. Exposes `globalThis.OQSHuman`.
 * @module lib/human
 */

(() => {
  /**
   * SQL/assessment complexity markers. Each hit nudges the difficulty score up.
   * Weighted: multi-table / set / analytic constructs are "high level".
   * @type {Array<[RegExp, number]>}
   */
  const COMPLEXITY_MARKERS = [
    [/\bjoin\b/i, 0.12],
    [/\bnatural\s+join\b/i, 0.1],
    [/\b(?:left|right|full|inner|outer)\s+join\b/i, 0.12],
    [/\bcross\s+join\b/i, 0.1],
    [/\bgroup\s+by\b/i, 0.1],
    [/\bhaving\b/i, 0.12],
    [/\border\s+by\b/i, 0.05],
    [/\bsub-?query\b/i, 0.15],
    [/\bcorrelated\b/i, 0.18],
    [/\bexists\b/i, 0.12],
    [/\b(?:union|intersect|minus)\b/i, 0.15],
    [/\bnvl\b/i, 0.08],
    [/\bdecode\b/i, 0.1],
    [/\bcase\s+when\b/i, 0.12],
    [/\bover\s*\(/i, 0.18],
    [/\brollup\b|\bcube\b/i, 0.15],
    [/\banalytic\b|\bwindow\s+function\b/i, 0.18],
    [/\bdistinct\b/i, 0.06],
    [/\baggregate\b|\bcount\s*\(|\bsum\s*\(|\bavg\s*\(|\bmax\s*\(|\bmin\s*\(/i, 0.08],
    [/\bview\b/i, 0.06],
    [/\bindex\b|\bconstraint\b|\bforeign\s+key\b|\bprimary\s+key\b/i, 0.08],
    [/\bnull\b/i, 0.04],
  ];

  /** Count occurrences of the SQL keyword SELECT (multiple => subqueries). */
  function countSelects(text) {
    return (text.match(/\bselect\b/gi) ?? []).length;
  }

  /**
   * Heuristic "high level" difficulty score in [0, 1].
   * Longer questions, more choices, and more/weightier complexity markers all
   * raise the score. Deterministic (no randomness) so it is unit-testable.
   * @param {{ questionText?: string, choices?: Array<{ text?: string }> }} question
   * @returns {number} 0 (trivial) .. 1 (very hard)
   */
  function difficulty(question) {
    const text = String(question?.questionText ?? "");
    const choices = Array.isArray(question?.choices) ? question.choices : [];

    // 1. Length component: ~0 at 40 chars, saturating at ~600 chars.
    const lenScore = Math.max(0, Math.min(1, (text.length - 40) / 560));

    // 2. Choice-count component: 2 choices = easy, 5+ = harder.
    const choiceScore = Math.max(0, Math.min(1, (choices.length - 2) / 4));

    // 3. Keyword component: sum marker weights, saturating at 1.
    let kw = 0;
    for (const [re, weight] of COMPLEXITY_MARKERS) {
      if (re.test(text)) kw += weight;
    }
    // Extra credit for multiple SELECTs (subqueries / set operations).
    const selects = countSelects(text);
    if (selects > 1) kw += 0.12 * (selects - 1);
    const kwScore = Math.min(1, kw);

    // Weighted blend, then clamp.
    const score = 0.3 * lenScore + 0.15 * choiceScore + 0.55 * kwScore;
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Choose a plausible-but-wrong choice to submit instead of the correct one.
   * Prefers the "nearest" distractor (the choice adjacent to the correct one) so
   * the miss looks like a believable student error rather than a random pick.
   * @param {Array<{ id: string }>} choices
   * @param {string} correctAnswerId
   * @param {() => number} rng
   * @returns {string | null} an answer id different from the correct one, or null
   */
  function pickPlausibleWrong(choices, correctAnswerId, rng) {
    const idx = choices.findIndex((c) => c.id === correctAnswerId);
    if (idx < 0 || choices.length < 2) return null;

    // Order distractors by proximity to the correct choice (nearest first).
    const distractorIdx = [];
    for (let i = 0; i < choices.length; i += 1) {
      if (i !== idx) distractorIdx.push(i);
    }
    distractorIdx.sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx));

    // Usually the nearest distractor; occasionally a more distant one, to avoid
    // an obvious pattern.
    const offset = rng() < 0.7 ? 0 : Math.min(distractorIdx.length - 1, 1);
    return choices[distractorIdx[offset]]?.id ?? null;
  }
})();
