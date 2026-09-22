/**
 * FIX 5 regression: showBusy() must clear any previous suggestion (answer text,
 * reason, and the page highlight) so a stale answer never lingers while the new
 * question is solving.
 */
const { createPage, loadContentScripts } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

(async () => {
  const { window } = createPage({
    sendMessage: (msg, cb) =>
      cb({ ok: true, entry: { answerId: msg.payload.choices[0].id, source: "ai", confidence: 0.9, reason: "because" } }),
  });
  loadContentScripts(window);
  await new Promise((r) => setTimeout(r, 250));

  const doc = window.document;
  const panel = doc.getElementById("oqs-panel");
  assert(panel !== null, "panel rendered");

  const answer = panel.querySelector('[data-role="answer"]');
  const reason = panel.querySelector('[data-role="reason"]');
  const status = panel.querySelector('[data-role="status"]');

  console.log("== Suggestion is present after solve ==");
  assert(answer.style.display !== "none" && answer.textContent.length > 0, "answer visible with text");
  assert(doc.querySelector(".choice-Container.oqs-suggested") !== null, "a choice is highlighted");

  console.log("\n== showBusy() clears everything ==");
  window.OQSPanel.showBusy("Solving…");
  assert(answer.style.display === "none", "answer hidden");
  assert(answer.textContent === "", "answer text cleared");
  assert(reason.style.display === "none", "reason hidden");
  assert(doc.querySelector(".choice-Container.oqs-suggested") === null, "highlight cleared");
  assert(/Solving/.test(status.textContent), "status shows busy text");
  assert(status.className.includes("oqs-busy"), "status has busy styling");

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
