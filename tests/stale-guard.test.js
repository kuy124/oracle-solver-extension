/**
 * FIX 6 regression: a solve that resolves AFTER the user has moved to a new
 * question must be dropped (stale-run token), never rendered.
 */
const { createPage, loadContentScripts } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await tick(25);
  }
  return false;
}

/** Replace the choices region with a synthetic Q with distinct text/ids. */
function setQuestion(window, { qText, choices, questionId }) {
  const doc = window.document;
  const region = doc.querySelector("#collapse-Choices-reg");
  const body = region.querySelector(".t-Region-body");
  const qRegion = doc.querySelector("#question-Text a-dynamic-content");
  if (qRegion) qRegion.textContent = qText;
  const questionIdInput = doc.querySelector("#P190_QUESTION_ID");
  if (questionIdInput && questionId) questionIdInput.value = questionId;
  body.innerHTML = choices
    .map(
      (c) => `
    <div class="choice-Container" role="radiogroup">
      <div class="t-Region-header choice-Header">
        <div class="t-Region-headerItems t-Region-headerItems--buttons choice-Icon-div">
          <button type="button" class="choice-SelectArea" data-response-type="1" role="radio" aria-checked="false">
            <span class="choice-Icon fa fa-square-o">
              <span class="choice-Info"><input type="hidden" name="f02" value="${c.id}" /><input type="hidden" name="f01" value="N" class="qzlab-choice" /></span>
            </span>
            <span class="choice-Text"><p>${c.text}</p></span>
          </button>
        </div>
      </div>
    </div>`
    )
    .join("");
  // Rebind the page's click handler for the new buttons.
  doc.querySelectorAll(".choice-SelectArea").forEach((btn) => {
    btn.addEventListener("click", (e) => window.toggleChoice(window.$(e.currentTarget)));
  });
}

(async () => {
  // A worker that resolves Q6 slowly, even if the page briefly has no choices.
  let call = 0;
  const sendMessage = (msg, cb) => {
    call += 1;
    const id = msg.payload.choices[0].id;
    const delay = id === "1001" ? 800 : 0;
    setTimeout(() => {
      cb({ ok: true, entry: { answerId: id, source: "ai", confidence: 0.9, reason: `answer for ${id}` } });
    }, delay);
  };

  const { window } = createPage({ sendMessage });
  // Prevent content.js auto-init from hijacking the fixture mid-band; we drive manually.
  loadContentScripts(window);

  // Wait for any initial auto-solve to settle.
  await new Promise((r) => setTimeout(r, 200));

  console.log("== Setup: Q6 solve in flight, then APEX briefly clears the choices ==");
  setQuestion(window, { qText: "QUESTION SIX text", questionId: "qid-six", choices: [{ id: "1001", text: "six-A" }, { id: "1002", text: "six-B" }] });
  window.document.dispatchEvent(new window.Event("apexafterrefresh"));
  const q6Started = await waitUntil(() => call >= 2, 1500);
  assert(q6Started, "Q6 request actually started before the transition");

  // The 400 ms debounce previously left the active run token unchanged. APEX
  // can take longer than that to replace the question content.
  setQuestion(window, { qText: "", questionId: "qid-transition", choices: [] });
  window.document.dispatchEvent(new window.Event("apexafterrefresh"));
  await new Promise((r) => setTimeout(r, 850)); // past Q6 completion, before any next question exists

  const panel = window.document.getElementById("oqs-panel");
  assert(panel !== null, "panel exists");
  let answerText = panel?.querySelector('[data-role="answer"]')?.textContent ?? "";
  let status = panel?.querySelector('[data-role="status"]')?.textContent ?? "";

  console.log("\n== Stale Q6 result must NOT be shown ==");
  assert(!answerText.includes("six-"), `Q6 answer was dropped during the blank refresh state (got "${answerText}")`);
  assert(!/six/i.test(status), `status does not mention Q6 after refresh (got "${status}")`);

  console.log("\n== Latest Q7 result is shown after the transition ==");
  setQuestion(window, { qText: "QUESTION SEVEN text", questionId: "qid-seven", choices: [{ id: "2001", text: "seven-A" }, { id: "2002", text: "seven-B" }] });
  window.document.dispatchEvent(new window.Event("apexafterrefresh"));
  assert(await waitUntil(() => panel?.querySelector('[data-role="answer"]')?.textContent.includes("seven-"), 2000), "Q7 solve completed");
  answerText = panel?.querySelector('[data-role="answer"]')?.textContent ?? "";
  status = panel?.querySelector('[data-role="status"]')?.textContent ?? "";
  assert(answerText.includes("seven-"), `Q7 answer rendered (got "${answerText}")`);

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
