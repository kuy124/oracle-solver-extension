/**
 * FIX 1 regression: applying an answer must go through the PAGE'S OWN
 * toggleChoice() via a real click, and must update P190_CHOICE_CLICKED and the
 * submit button exactly as a human click would. Proves the isolated-world fix.
 */
const { createPage, loadLibsOnly } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

(async () => {
  const { window } = createPage();
  loadLibsOnly(window);

  const doc = window.document;
  const g = window;

  // Spy on the page's own state, mirroring the page's apex.item mechanism.
  window.apex = { item: () => ({ setValue: (v) => { window.__choiceClicked = v; } }) };

  console.log("== Page world wired ==");
  assert(typeof window.toggleChoice === "function", "page toggleChoice present");
  assert(typeof window.checkSubmitButton === "function", "page checkSubmitButton present");

  console.log("\n== Apply via real click drives page logic ==");
  const before = window.__pageToggleCalls || 0;
  const ok = g.OQSApply.applyAnswerById("52443");
  assert(ok === true, "applyAnswerById returned true");

  const after = window.__pageToggleCalls || 0;
  assert(after === before + 1, `page toggleChoice ran exactly once via click (before=${before}, after=${after})`);

  const target = [...doc.querySelectorAll("#collapse-Choices-reg .choice-Container")].find(
    (c) => c.querySelector('.choice-Info input[name="f02"]').value === "52443"
  );
  assert(target.querySelector(".qzlab-choice").value === "Y", "target qzlab-choice = Y (set by page logic)");
  assert(target.querySelector(".choice-Icon").classList.contains("fa-check"), "target icon = fa-check");
  assert(target.querySelector("button.choice-SelectArea").getAttribute("aria-checked") === "true", "target aria-checked = true");

  const selected = [...doc.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter((i) => i.value === "Y");
  assert(selected.length === 1, `exactly one choice selected (got ${selected.length})`);

  console.log("\n== Page's P190_CHOICE_CLICKED updated (best-effort) ==");
  // The page's own checkSubmitButton selects with `[value=Y]` (attribute), while
  // toggleChoice sets the `value` property — so even real jQuery reports "N".
  // This documents the page's latent quirk that our enableSubmit() compensates for.
  assert(window.__choiceClicked === "N", `page reports N due to [value=Y] attribute quirk (got ${window.__choiceClicked})`);

  console.log("\n== Submit button enabled by OUR enableSubmit() (page's own check is broken) ==");
  const submit = doc.querySelector("#quiz-submit");
  assert(!submit.classList.contains("apex_disabled"), "submit no longer has apex_disabled");
  assert(submit.disabled === false, "submit .disabled = false");

  console.log("\n== Re-applying the SAME answer is idempotent (no toggle-off) ==");
  const before2 = window.__pageToggleCalls || 0;
  g.OQSApply.applyAnswerById("52443");
  const after2 = window.__pageToggleCalls || 0;
  assert(after2 === before2, "no extra toggle when already selected");
  assert(target.querySelector(".qzlab-choice").value === "Y", "still selected after re-apply");

  console.log("\n== Switching to a different answer re-selects only it ==");
  g.OQSApply.applyAnswerById("52444");
  const selected2 = [...doc.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter((i) => i.value === "Y");
  assert(selected2.length === 1, "exactly one selected after switching");
  assert(selected2[0].closest(".choice-Container") === target ? false : true, "selection moved to the new choice");
  const newTarget = [...doc.querySelectorAll("#collapse-Choices-reg .choice-Container")].find(
    (c) => c.querySelector('.choice-Info input[name="f02"]').value === "52444"
  );
  assert(newTarget.querySelector(".qzlab-choice").value === "Y", "new target is selected");

  console.log("\n== Unknown id is a no-op ==");
  assert(g.OQSApply.applyAnswerById("999999") === false, "unknown id returns false");

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
