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

/**
 * A fetch mock that streams a fixed `answerIndexes` set from every model so the
 * per-choice majority vote resolves deterministically (no network).
 * @param {number[]} indexes
 */
function fetchReturningIndexes(indexes) {
  const token = JSON.stringify({ answerIndexes: indexes, confidence: 0.9, reason: "multi test" });
  return async (url) => {
    if (String(url).includes("/conversations")) {
      return { ok: true, headers: { get: () => null }, json: async () => ({ sessionId: "s", chatId: "c" }) };
    }
    const frame = JSON.stringify({ role: "assistant", content: JSON.stringify({ content: token }) }) + "\n";
    let done = false;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            if (done) return { done: true };
            done = true;
            return { done: false, value: new TextEncoder().encode(frame) };
          },
          cancel: async () => {},
        }),
      },
    };
  };
}

(async () => {
  // ------------------------------------------------------------------ Scraper
  console.log("== Scraper detects multi-select + required count ==");
  {
    const { window } = makeMultiPage();
    loadLibsOnly(window);
    const q = window.OQSScraper.scrapeQuestion();
    assert(q && q.multiSelect === true, "multiSelect = true on the multi fixture");
    assert(q && q.requiredCount === 2, `requiredCount = 2 (got ${q && q.requiredCount})`);
    assert(window.OQSScraper.isMultiSelect(q.choices) === true, "isMultiSelect() true for type-2 choices");
  }

  // ------------------------------------------------------------------- Worker
  console.log("\n== Worker: solveConsensusMulti returns an answer SET ==");
  {
    const store = {};
    const sw = loadServiceWorker({
      chrome: { storage: stubStorage(store), runtime: {} },
      fetch: fetchReturningIndexes([0, 2]),
    });
    const listener = sw.getMessageListener();
    const payload = {
      hash: "multihash",
      questionText: "Manakah yang benar? (Pilih dua)",
      choices: [{ id: "10", text: "a" }, { id: "11", text: "b" }, { id: "12", text: "c" }, { id: "13", text: "d" }],
      multiSelect: true,
      requiredCount: 2,
    };
    const response = await new Promise((resolve) => listener({ type: "OQS_SOLVE", payload }, {}, resolve));
    assert(response?.ok === true, `solve ok (${JSON.stringify(response).slice(0, 120)})`);
    assert(
      Array.isArray(response?.entry?.answerIds) && response.entry.answerIds.join(",") === "10,12",
      `answerIds = ['10','12'] (got ${JSON.stringify(response?.entry?.answerIds)})`
    );
    assert(
      Array.isArray(response?.entry?.answerIndexes) && response.entry.answerIndexes.join(",") === "0,2",
      `answerIndexes = [0,2] (got ${JSON.stringify(response?.entry?.answerIndexes)})`
    );
    assert(response?.entry?.answerId === "10", "legacy answerId = first id for back-compat");
    assert(response?.entry?.multiSelect === true, "entry is flagged multiSelect");
    assert(
      Array.isArray(store.answerKey?.multihash?.answerIds) && store.answerKey.multihash.answerIds.length === 2,
      "multi answer set persisted to the key"
    );
  }

  // ------------------------------------------------------- Orchestrator + UI
  console.log("\n== Orchestrator applies the whole SET (mocked worker) ==");
  {
    const page = makeMultiPage({
      sendMessage: (msg, cb) =>
        cb({ ok: true, entry: { answerIds: ["20880", "20879"], answerIndexes: [2, 1], multiSelect: true, source: "ai-consensus", confidence: 0.92, reason: "two correct" } }),
    });
    loadContentScripts(page.window);
    await tick(400);
    const w = page.window;

    const panel = w.document.getElementById("oqs-panel");
    assert(panel !== null, "panel rendered");
    const status = panel?.querySelector('[data-role="status"]')?.textContent ?? "";
    assert(/2 answers/.test(status), `status reports 2 answers (got "${status}")`);
    const cycleBtn = panel?.querySelector('[data-role="cycle"]');
    assert(cycleBtn && cycleBtn.disabled === true, "Cycle disabled for a multi-select set");

    // Two containers highlighted in the page.
    const highlighted = w.document.querySelectorAll(".choice-Container.oqs-suggested");
    assert(highlighted.length === 2, `two choices highlighted (got ${highlighted.length})`);

    // Apply drives the page's own logic and selects BOTH.
    panel.querySelector('[data-role="apply"]').click();
    const selected = [...w.document.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter((i) => i.value === "Y");
    assert(selected.length === 2, `apply selects both answers (got ${selected.length})`);
    const submit = w.document.querySelector("#quiz-submit");
    assert(submit && !submit.classList.contains("apex_disabled"), "submit enabled after multi apply");
  }

  // --------------------------------------------------------- Autopilot submit
  console.log("\n== Autopilot selects the SET then submits ==");
  {
    await tick(50); // let prior cases' timers settle before this page
    const page = makeMultiPage({
      settings: { autopilot: true, autopilotDelayMs: 60, autopilotMinConfidence: 0.5 },
      sendMessage: (msg, cb) =>
        cb({ ok: true, entry: { answerIds: ["20880", "20878"], answerIndexes: [2, 0], multiSelect: true, source: "ai-consensus", confidence: 0.9, reason: "ok" } }),
    });
    page.window.__setItem("P190_QUESTION_SEQUENCE", 4);
    page.window.__setItem("P190_QUESTION_COUNT", 50);
    loadContentScripts(page.window);
    const w = page.window;
    const submitted = await waitUntil(() => w.__submitPageCalls.length >= 1, 3000);
    assert(submitted, "autopilot submitted the multi answer set");
    const selected = [...w.document.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter((i) => i.value === "Y");
    assert(selected.length === 2, `autopilot selected both answers (got ${selected.length})`);
  }

  // ---------------------------------------------- Legacy scalar key still works
  console.log("\n== Legacy scalar cached entry is normalized to an array ==");
  {
    const page = makeMultiPage({
      store: {},
      sendMessage: (msg, cb) => cb({ ok: false, error: "should use cache" }),
    });
    loadLibsOnly(page.window);
    // Seed a legacy-style scalar entry and confirm normalizeEntry widens it.
    const norm = page.window.OQSKey.normalizeEntry({ answerId: "42", source: "key" });
    assert(norm.answerIds.join(",") === "42", "scalar answerId -> answerIds ['42']");
    assert(norm.multiSelect === false, "single legacy entry is not multi");
    const multi = page.window.OQSKey.normalizeEntry({ answerIds: ["1", "2"] });
    assert(multi.multiSelect === true, "array of 2 implies multiSelect");
  }

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
