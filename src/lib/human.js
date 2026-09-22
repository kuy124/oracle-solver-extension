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
})();
