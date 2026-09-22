/**
 * Autopilot tests: auto-select + auto-submit.
 * Covers: submit on non-last question, stop on last unless autopilotComplete,
 * min-confidence gate, delay, loop cap, STOP, and preview-mode pause.
 */
const { createPage, loadContentScripts } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Build a page with a mock worker returning a fixed answer. */
function makePage({ settings, answerId = "52443", sendMessage } = {}) {
  const store = { settings: settings ?? {} };
  const sessionStore = {};
  const sendMessageFn =
    sendMessage ||
    ((msg, cb) => cb({ ok: true, entry: { answerId, source: "ai", confidence: 0.95, reason: "test" } }));
  const page = createPage({ store, sessionStore, sendMessage: sendMessageFn });
  return page;
}

/** Wait until a predicate is true or timeout. */
async function waitUntil(fn, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await tick(50);
  }
  return false;
}

(async () => {
  // ---------------------------------------------------------------- Case 1
  console.log("== 1. Autopilot OFF: no auto-apply, no submit ==");
  {
    const page = makePage({ settings: { autopilot: false, aiEnabled: true } });
    loadContentScripts(page.window);
    await tick(400);
    const w = page.window;
    assert(w.__submitPageCalls.length === 0, "no submit happened");
    const selected = [...w.document.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter((i) => i.value === "Y");
    assert(selected.length === 0, "no choice auto-selected");
  }

  // ---------------------------------------------------------------- Case 2
  console.log("\n== 2. Autopilot ON, non-last question: applies + submits ==");
  {
    const page = makePage({ settings: { autopilot: true, autopilotDelayMs: 100, autopilotMinConfidence: 0.5 } });
    page.window.__setItem("P190_QUESTION_SEQUENCE", 3);
    page.window.__setItem("P190_QUESTION_COUNT", 15);
    loadContentScripts(page.window);
    const w = page.window;
    const submitted = await waitUntil(() => w.__submitPageCalls.length > 0, 3000);
    assert(submitted, "page submitPage was called");
    assert(w.__submitPageCalls[0] === "SUBMIT", `submit used request=SUBMIT (got ${w.__submitPageCalls[0]})`);
    const selected = [...w.document.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter((i) => i.value === "Y");
    assert(selected.length === 1, `exactly one choice selected before submit (got ${selected.length})`);
    assert(page.store.autopilotState?.count === 1, "autopilot count incremented");
  }

  // ---------------------------------------------------------------- Case 3
  console.log("\n== 3. Autopilot ON, LAST question, autopilotComplete OFF: does NOT complete ==");
  {
    const page = makePage({ settings: { autopilot: true, autopilotDelayMs: 60, autopilotComplete: false } });
    page.window.__setItem("P190_QUESTION_SEQUENCE", 15);
    page.window.__setItem("P190_QUESTION_COUNT", 15);
    loadContentScripts(page.window);
    const w = page.window;
    await tick(700);
    assert(w.__submitPageCalls.length === 0, "did not submit/complete on last question");
    const auto = w.document.querySelector('[data-role="autopilot-text"]')?.textContent ?? "";
    assert(/last question/i.test(auto), `panel tells user to submit manually (got "${auto}")`);
  }

  // ---------------------------------------------------------------- Case 4
  console.log("\n== 4. Min-confidence gate: low confidence pauses autopilot ==");
  {
    const page = makePage({
      settings: { autopilot: true, autopilotDelayMs: 60, autopilotMinConfidence: 0.9 },
      sendMessage: (msg, cb) => cb({ ok: true, entry: { answerId: "52443", source: "ai", confidence: 0.4, reason: "unsure" } }),
    });
    page.window.__setItem("P190_QUESTION_SEQUENCE", 2);
    page.window.__setItem("P190_QUESTION_COUNT", 15);
    loadContentScripts(page.window);
    const w = page.window;
    await tick(700);
    assert(w.__submitPageCalls.length === 0, "did not submit low-confidence answer");
    const selected = [...w.document.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter((i) => i.value === "Y");
    assert(selected.length === 0, "did not even apply the low-confidence answer");
    const auto = w.document.querySelector('[data-role="autopilot-text"]')?.textContent ?? "";
    assert(/confidence/i.test(auto), `panel explains why (got "${auto}")`);
  }

  // ---------------------------------------------------------------- Case 5
  console.log("\n== 5. Loop cap: stops after questionCount+2 submits ==");
  {
    const page = makePage({ settings: { autopilot: true, autopilotDelayMs: 30 } });
    page.window.__setItem("P190_QUESTION_SEQUENCE", 1);
    page.window.__setItem("P190_QUESTION_COUNT", 2); // cap = 4
    // Pre-seed the session count at the cap so the next step stops.
    page.store.autopilotState = { count: 4, stopped: false, lastQuestionId: "" };
    loadContentScripts(page.window);
    const w = page.window;
    await tick(700);
    assert(w.__submitPageCalls.length === 0, "did not submit once cap exceeded");
    assert(page.store.autopilotState.stopped === true, "autopilot marked stopped at cap");
    const auto = w.document.querySelector('[data-role="autopilot-text"]')?.textContent ?? "";
    assert(/cap/i.test(auto), `panel mentions the safety cap (got "${auto}")`);
  }

  // ---------------------------------------------------------------- Case 6
  console.log("\n== 6. STOP aborts before submit ==");
  {
    const page = makePage({ settings: { autopilot: true, autopilotDelayMs: 1200 } });
    page.window.__setItem("P190_QUESTION_SEQUENCE", 4);
    page.window.__setItem("P190_QUESTION_COUNT", 15);
    loadContentScripts(page.window);
    const w = page.window;
    // Wait until the answer has been applied (during the submit delay), then STOP.
    const applied = await waitUntil(
      () => [...w.document.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].some((i) => i.value === "Y"),
      2000
    );
    assert(applied, "answer applied before the delay elapsed");
    w.document.querySelector('[data-role="stop"]').click();
    await tick(1500);
    assert(w.__submitPageCalls.length === 0, "STOP prevented the submit");
    assert(page.store.autopilotState.stopped === true, "stop flag persisted");
  }

  // ---------------------------------------------------------------- Case 7
  console.log("\n== 7. Preview-only: autopilot never submits ==");
  {
    const page = makePage({ settings: { autopilot: true, autopilotDelayMs: 50 } });
    page.window.__setItem("P190_PREVIEW_ONLY", "Y");
    page.window.__setItem("P190_QUESTION_SEQUENCE", 2);
    page.window.__setItem("P190_QUESTION_COUNT", 15);
    loadContentScripts(page.window);
    const w = page.window;
    await tick(700);
    assert(w.__submitPageCalls.length === 0, "no submit in preview mode");
    const auto = w.document.querySelector('[data-role="autopilot-text"]')?.textContent ?? "";
    assert(/preview/i.test(auto), `panel says preview mode (got "${auto}")`);
  }

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
