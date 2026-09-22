/**
 * Multi-select ("select all that apply" / "Pilih dua") end-to-end coverage.
 *
 * Proves the whole pipeline handles a SET of answers:
 *   - the scraper flags the question as multi and reads the required count,
 *   - the worker's solveConsensusMulti tallies per-choice votes across the
 *     model panel and returns an answer SET (answerIds/answerIndexes),
 *   - the orchestrator applies the whole set to the page,
 *   - autopilot submits the set,
 *   - the panel renders the set with Cycle disabled.
 *
 * The worker is exercised in its real sandbox (importScripts) with a mocked
 * fetch that streams distinct `answerIndexes` replies per conversation.
 */
const fs = require("fs");
const path = require("path");
const { createPage, loadContentScripts, loadServiceWorker, loadLibsOnly } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until a predicate is true or timeout. */
async function waitUntil(fn, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await tick(50);
  }
  return false;
}

const MULTI_HTML = path.join(__dirname, "fixtures", "exampleoracle-multi.html");

/** Build the multi-select page (optionally with a mocked solve worker). */
function makeMultiPage({ settings, sendMessage, store = {} } = {}) {
  const html = fs.readFileSync(MULTI_HTML, "utf8");
  const backing = settings ? { ...store, settings } : store;
  const page = createPage({ html, store: backing, sendMessage });
  return page;
}

/** In-memory chrome.storage backing for the worker sandbox. */
function stubStorage(store) {
  return {
    local: {
      get: (k) => Promise.resolve(typeof k === "string" ? { [k]: store[k] } : { ...store }),
      set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
    },
  };
}
