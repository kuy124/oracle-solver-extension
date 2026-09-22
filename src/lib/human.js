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
})();
