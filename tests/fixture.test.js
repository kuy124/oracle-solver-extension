/**
 * Fixture test: load EXAMPLEORACLE.txt in jsdom, run the extension's scraper,
 * hasher, prompt builder, reply parser, and applier; assert real behavior.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const EXT = "F:\\GAMES\\Code\\Oracle\\oracle-solver-extension";
const HTML_PATH = "F:\\GAMES\\Code\\Oracle\\EXAMPLEORACLE.txt";

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log("  PASS: " + msg);
  } else {
    console.log("  FAIL: " + msg);
    failures += 1;
  }
}

const html = fs.readFileSync(HTML_PATH, "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only" });
const { window } = dom;

// Minimal chrome API stub so lib/answer-key.js and content.js don't explode.
const store = {};
window.chrome = {
  storage: {
    local: {
      get: (k) => Promise.resolve(typeof k === "string" ? { [k]: store[k] } : { ...store }),
      set: (obj) => {
        Object.assign(store, obj);
        return Promise.resolve();
      },
    },
  },
  runtime: { sendMessage: () => {}, lastError: null },
};

// Load the content libs into the jsdom window VERBATIM as classic scripts, so a
// lingering ESM export/import would throw (regression guard for the export bug).
function loadGlobal(file) {
  const code = fs.readFileSync(path.join(EXT, file), "utf8");
  const run = new Function("window", "globalThis", "document", "crypto", "TextEncoder", code + "\n;return globalThis;");
  return run.call(window, window, window, window.document, require("crypto").webcrypto, require("util").TextEncoder);
}

console.log("Loading content libs...");
const g = window;
["src/lib/hash.js", "src/lib/prompt.js", "src/content/scraper.js", "src/content/applier.js"].forEach((f) => {
  const code = fs.readFileSync(path.join(EXT, f), "utf8");
  const fn = new Function("window", "globalThis", "document", "crypto", "TextEncoder", code);
  fn.call(window, window, window, window.document, require("crypto").webcrypto, require("util").TextEncoder);
});

(async () => {
  console.log("\n== Scraper ==");
  const isAssessment = g.OQSScraper.isAssessmentPage();
  assert(isAssessment === true, "detects assessment page");

  const q = g.OQSScraper.scrapeQuestion();
  assert(q !== null, "scrapes a question");
  assert(q && q.qNumber === "6 of 15", `question number is '6 of 15' (got '${q && q.qNumber}')`);
  assert(q && q.choices.length === 4, `found 4 choices (got ${q && q.choices.length})`);
  assert(
    q && q.choices.every((c) => /^\d+$/.test(c.id)),
    "every choice has a numeric f02 id"
  );
  assert(
    q && q.choices.map((c) => c.id).sort().join(",") === "52443,52444,52445,52446",
    `choice ids match sample (got ${q && q.choices.map((c) => c.id).join(",")})`
  );
  assert(
    q && /EMPLOYESS|BONUS/i.test(q.questionText),
    "question text contains the table description"
  );
  assert(
    q && q.choices.some((c) => c.text.includes("NATURAL JOIN")),
    "a NATURAL JOIN choice was captured"
  );
  assert(q && q.choices.every((c) => c.responseType === 1), "all choices are single-select (type 1)");
  assert(q && q.multiSelect === false, "single-select question reports multiSelect = false");
  assert(q && q.requiredCount === null, "single-select question has no requiredCount");

  console.log("\n== Hash (stable) ==");
  const h1 = await g.OQSHash.hashQuestion(q);
  const h2 = await g.OQSHash.hashQuestion(q);
  assert(typeof h1 === "string" && h1.length >= 8, `hash produced (${h1})`);
  assert(h1 === h2, "same question hashes identically");

  console.log("\n== Prompt + reply parser ==");
  const prompt = g.OQSPrompt.buildSolverPrompt(q);
  assert(prompt.includes("QUESTION:"), "prompt contains QUESTION section");
  assert(prompt.includes("[2]"), "prompt enumerates choices with index");
  const parsed = g.OQSPrompt.parseSolverReply('```json\n{"answerIndex":3,"confidence":0.9,"reason":"aliases consistent"}\n```');
  assert(parsed && parsed.answerIndex === 3, "parses fenced JSON reply");
  assert(parsed && parsed.confidence === 0.9, "parses confidence");
  const bad = g.OQSPrompt.parseSolverReply("no json here");
  assert(bad === null, "rejects non-JSON reply");

  console.log("\n== Applier ==");
  const correctId = "52443"; // the alias-consistent, multiply choice
  const applied = g.OQSApply.applyAnswerById(correctId);
  assert(applied === true, "applyAnswerById returns true for a valid id");

  const appliedContainer = [...window.document.querySelectorAll("#collapse-Choices-reg .choice-Container")].find(
    (c) => c.querySelector('.choice-Info input[name="f02"]').value === correctId
  );
  assert(
    appliedContainer.querySelector("input.qzlab-choice").value === "Y",
    "target choice qzlab-choice == Y"
  );
  assert(
    appliedContainer.querySelector(".choice-Icon").classList.contains("fa-check"),
    "target icon shows fa-check"
  );
  assert(
    appliedContainer.querySelector("button.choice-SelectArea").getAttribute("aria-checked") === "true",
    "target aria-checked == true"
  );

  const otherSelected = [...window.document.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter(
    (i) => i.value === "Y"
  );
  assert(otherSelected.length === 1, `exactly one choice selected (got ${otherSelected.length})`);

  const submit = window.document.querySelector("#quiz-submit");
  assert(submit && !submit.classList.contains("apex_disabled"), "submit button enabled after apply");

  console.log("\n== Applier (unknown id is a no-op) ==");
  const bogus = g.OQSApply.applyAnswerById("999999");
  assert(bogus === false, "unknown id returns false");

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(2);
});

/**
 * Multi-select fixture ("Pilih dua"): scraper detects type-2 choices, the applier
 * selects a SET without clearing siblings, and the parser reads the array shape.
 */
async function runMultiFixtureSuite() {
  const multiPath = path.join(EXT, "tests", "fixtures", "exampleoracle-multi.html");
  const mhtml = fs.readFileSync(multiPath, "utf8");
  const mdom = new JSDOM(mhtml, { runScripts: "outside-only" });
  const { window: w } = mdom;

  w.chrome = {
    storage: {
      local: {
        get: (k) => Promise.resolve(typeof k === "string" ? { [k]: store[k] } : { ...store }),
        set: (obj) => {
          Object.assign(store, obj);
          return Promise.resolve();
        },
      },
    },
    runtime: { sendMessage: () => {}, lastError: null },
  };

  for (const f of ["src/lib/hash.js", "src/lib/prompt.js", "src/content/scraper.js", "src/content/applier.js"]) {
    const code = fs.readFileSync(path.join(EXT, f), "utf8");
    const fn = new Function("window", "globalThis", "document", "crypto", "TextEncoder", code);
    fn.call(w, w, w, w.document, require("crypto").webcrypto, require("util").TextEncoder);
  }
  const mg = w.OQSScraper;

  console.log("\n== Multi-select fixture: scraper ==");
  const mq = mg.scrapeQuestion();
  assert(mq !== null, "multi fixture scrapes");
  assert(mq && mq.choices.length === 4, `4 choices (got ${mq && mq.choices.length})`);
  assert(mq && mq.choices.every((c) => c.responseType === 2), "all choices are multi-select (type 2)");
  assert(mq && mq.multiSelect === true, "multiSelect detected true");
  assert(mq && mq.requiredCount === 2, `requiredCount parsed from '(Pilih dua)' (got ${mq && mq.requiredCount})`);

  console.log("\n== Multi-select fixture: applier selects a SET ==");
  const ids = mq.choices.map((c) => c.id);
  const applied = w.OQSApply.applyAnswersByIds([ids[0], ids[2]]);
  assert(applied === true, "applyAnswersByIds returns true");
  const selected = [...w.document.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter((i) => i.value === "Y");
  assert(selected.length === 2, `exactly two choices selected (got ${selected.length})`);
  // Ensure idempotent re-apply does not toggle anything off.
  w.OQSApply.applyAnswersByIds([ids[0], ids[2]]);
  const selectedAgain = [...w.document.querySelectorAll("#collapse-Choices-reg .qzlab-choice")].filter((i) => i.value === "Y");
  assert(selectedAgain.length === 2, `re-apply stays at two selected (got ${selectedAgain.length})`);

  console.log("\n== Multi prompt/parser ==");
  const mprompt = w.OQSPrompt.buildMultiSolverPrompt(mq, mq.requiredCount);
  assert(/answerIndexes/.test(mprompt), "multi prompt requests answerIndexes");
  assert(/exactly 2 answers/.test(mprompt), "multi prompt states the required count");
  const mparsed = w.OQSPrompt.parseMultiSolverReply('```json\n{"answerIndexes":[0,2],"confidence":0.9,"reason":"ok"}\n```');
  assert(mparsed && mparsed.answerIndexes.join(",") === "0,2", "parses answerIndexes array");
  const wrapped = w.OQSPrompt.parseMultiSolverReply('{"answerIndex":1,"confidence":0.5,"reason":"x"}');
  assert(wrapped && wrapped.answerIndexes.join(",") === "1", "wraps a lone answerIndex into an array");
  assert(w.OQSPrompt.parseMultiSolverReply("nope") === null, "rejects non-JSON multi reply");
}
