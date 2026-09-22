/**
 * Integration test: load EVERY content script in the manifest order into a
 * jsdom page (as classic scripts, the way Chrome injects them), confirm the
 * globals line up, the orchestrator auto-solves, the panel renders top-anchored
 * (never covering the page's Submit button), and Apply uses the real-click path.
 */
const { createPage, loadContentScripts } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

(async () => {
  console.log("== Load all content scripts (manifest order) ==");
  const { window } = createPage({
    sendMessage: (msg, cb) =>
      cb({ ok: true, entry: { answerId: "52443", source: "ai", confidence: 0.98, reason: "aliases consistent" } }),
  });
  window.apex = { item: () => ({ setValue: () => {} }) };

  let loadErr = null;
  try {
    loadContentScripts(window).forEach((rel) => console.log("  loaded " + rel));
  } catch (err) {
    loadErr = err.message;
  }
  assert(loadErr === null, "all content scripts load without syntax/reference errors" + (loadErr ? ` (${loadErr})` : ""));

  console.log("\n== Globals wired ==");
  assert(typeof window.OQSHash?.hashQuestion === "function", "OQSHash.hashQuestion present");
  assert(typeof window.OQSPrompt?.buildSolverPrompt === "function", "OQSPrompt.buildSolverPrompt present");
  assert(typeof window.OQSKey?.loadSettings === "function", "OQSKey.loadSettings present");
  assert(typeof window.OQSScraper?.scrapeQuestion === "function", "OQSScraper.scrapeQuestion present");
  assert(typeof window.OQSApply?.applyAnswerById === "function", "OQSApply.applyAnswerById present");
  assert(typeof window.OQSPanel?.showSuggestion === "function", "OQSPanel.showSuggestion present");

  console.log("\n== Orchestrator run (mocked worker) ==");
  await new Promise((r) => setTimeout(r, 300));
  const panel = window.document.getElementById("oqs-panel");
  assert(panel !== null, "panel rendered after auto-solve");
  const status = panel?.querySelector('[data-role="status"]')?.textContent ?? "";
  const answer = panel?.querySelector('[data-role="answer"]')?.textContent ?? "";
  assert(/Suggested answer/i.test(status), `status shows a suggestion (got "${status}")`);
  assert(answer.includes("annual_salary * b. bonus_pct"), "panel shows the suggested choice text");

  const highlighted = window.document.querySelector(".choice-Container.oqs-suggested");
  assert(highlighted !== null, "suggested choice is highlighted in the page");

  console.log("\n== FIX 2: panel is top-anchored (does not cover bottom Submit button) ==");
  // The CSS sets top:16px; jsdom does not apply external stylesheets, so assert the
  // rule exists in panel.css and the inline drag anchor defaults to top.
  const css = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "content", "panel.css"), "utf8");
  assert(/#oqs-panel\s*\{[^}]*top:\s*16px/.test(css), "panel.css anchors the panel at top:16px");
  assert(!/#oqs-panel\s*\{[^}]*bottom:/.test(css.slice(0, css.indexOf("#oqs-panel .oqs-head"))), "panel.css does not bottom-anchor the panel");

  console.log("\n== Apply via the panel drives the page's own handler ==");
  const applyBtn = panel.querySelector('[data-role="apply"]');
  assert(applyBtn && !applyBtn.disabled, "Apply button enabled");
  const before = window.__pageToggleCalls || 0;
  applyBtn.click();
  const after = window.__pageToggleCalls || 0;
  assert(after === before + 1, `page toggleChoice ran via Apply (before=${before}, after=${after})`);

  const target = [...window.document.querySelectorAll("#collapse-Choices-reg .choice-Container")].find(
    (c) => c.querySelector('.choice-Info input[name="f02"]').value === "52443"
  );
  assert(target.querySelector(".qzlab-choice").value === "Y", "applied choice is selected");
  const submit = window.document.querySelector("#quiz-submit");
  assert(!submit.classList.contains("apex_disabled"), "Submit enabled after Apply");

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
