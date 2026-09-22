/**
 * Build stamp / version, shared by every extension context.
 * Classic script (no ESM). IIFE-wrapped + idempotent so it is safe to load more
 * than once. Exposes `globalThis.OQS_VERSION`.
 *
 * Keep this in sync with manifest.json's `version` (enforced by the test suite).
 * It exists so you can tell at a glance (in DevTools) WHICH build is actually
 * running - the single biggest source of confusion when a stale extension build
 * is cached by the browser.
 * @module lib/version
 */

(() => {
  globalThis.OQS_VERSION = "1.2.1";
})();
