/**
 * FIX 6 regression: a solve that resolves AFTER the user has moved to a new
 * question must be dropped (stale-run token), never rendered.
 */
const { createPage, loadContentScripts } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

/** Replace the choices region with a synthetic Q with distinct text/ids. */
function setQuestion(window, { qText, choices }) {
  const doc = window.document;
  const region = doc.querySelector("#collapse-Choices-reg");
  const body = region.querySelector(".t-Region-body");
  const qRegion = doc.querySelector("#question-Text a-dynamic-content");
  if (qRegion) qRegion.textContent = qText;
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
  // A worker that resolves Q6 slowly and Q7 immediately, so Q6 lands last.
  let call = 0;
  const sendMessage = (msg, cb) => {
    call += 1;
    const id = msg.payload.choices[0].id;
    const delay = id === "1001" ? 250 : 0; // Q6 (slow), Q7 (fast)
    setTimeout(() => {
      cb({ ok: true, entry: { answerId: id, source: "ai", confidence: 0.9, reason: `answer for ${id}` } });
    }, delay);
  };

  const { window } = createPage({ sendMessage });
  // Prevent content.js auto-init from hijacking the fixture mid-band; we drive manually.
  loadContentScripts(window);

  // Wait for any initial auto-solve to settle.
  await new Promise((r) => setTimeout(r, 200));

  console.log("== Setup: Q6 then immediately Q7 ==");
  setQuestion(window, { qText: "QUESTION SIX text", choices: [{ id: "1001", text: "six-A" }, { id: "1002", text: "six-B" }] });
  // Trigger Q6 (slow). content.js wires a MutationObserver + debounce; nudge via event.
  window.document.dispatchEvent(new window.Event("apexafterrefresh"));

  await new Promise((r) => setTimeout(r, 50)); // let Q6 start, not finish

  // Now switch to Q7 (fast) BEFORE Q6 resolves.
  setQuestion(window, { qText: "QUESTION SEVEN text", choices: [{ id: "2001", text: "seven-A" }, { id: "2002", text: "seven-B" }] });
  window.document.dispatchEvent(new window.Event("apexafterrefresh"));

  // Wait long enough for BOTH solves to have resolved (Q6 slow = 250ms).
  await new Promise((r) => setTimeout(r, 700));

  const panel = window.document.getElementById("oqs-panel");
  assert(panel !== null, "panel exists");
  const answerText = panel?.querySelector('[data-role="answer"]')?.textContent ?? "";
  const status = panel?.querySelector('[data-role="status"]')?.textContent ?? "";

  console.log("\n== Stale Q6 result must NOT be shown ==");
  assert(!answerText.includes("six-"), `Q6 answer (six-*) was dropped, not rendered (got "${answerText}")`);
  assert(!/six/i.test(status), `status does not mention Q6 (got "${status}")`);

  console.log("\n== Latest Q7 result IS shown ==");
  assert(answerText.includes("seven-"), `Q7 answer rendered (got "${answerText}")`);

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
