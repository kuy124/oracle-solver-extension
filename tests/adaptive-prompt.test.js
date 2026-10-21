/**
 * Adaptive-prompt tests: the solver must adapt to the QUESTION TYPE, not assume
 * every Oracle Academy item is SQL code.
 *
 * Grounded in the two captured pages:
 *   - fixture 1 (EXAMPLEORACLE.txt)          -> a real SQL query question,
 *   - fixture 2 (EXAMPLEORACLEMORETHANONE)   -> a "Database Design" CONCEPT
 *     question in Indonesian ("Opsionalitas Hubungan") with natural-language
 *     choices.
 *
 * Asserts:
 *   - detectQuestionType() classifies SQL vs theory vs code vs general correctly,
 *   - the SQL prompt still carries the original SQL checklist (no regression),
 *   - the theory/general prompts add the language + "not only SQL" guidance and
 *     do NOT force SQL-only rules,
 *   - the multi + verifier + fill prompts are adaptive too,
 *   - the reply parsers still round-trip (no format change).
 */
const fs = require("fs");
const path = require("path");
const { createPage, loadLibsOnly, loadServiceWorker } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

/** Load OQSPrompt into a fresh sandbox (pure libs only, no auto-init). */
function loadPromptLib() {
  const page = createPage();
  loadLibsOnly(page.window);
  return page.window.OQSPrompt;
}

const SQL_Q = {
  questionText:
    "Anda memiliki tabel EMPLOYESS berikut: EMPLOYEE_ID NUMBER(5) NOT NULL PRIMARY KEY. " +
    "Manakah dari kueri berikut yang seharusnya Anda terbitkan?",
  choices: [
    { id: "52444", text: "SELECT e.first_name FROM employees e, bonus b WHERE e.employee_id = b.employee_id;" },
    { id: "52445", text: "SELECT e.first_name FROM employees, bonus WHERE e.employee_id = b.employee_id;" },
  ],
};

const THEORY_Q = {
  questionText: "Manakah dari berikut ini yang benar terkait Opsionalitas Hubungan? (Pilih dua)",
  choices: [
    { id: "20878", text: "Opsionalitas menentukan hanya singularitas atau pluralitas, tetapi bukan angka plural tertentu." },
    { id: "20880", text: "Opsionalitas menentukan apakah sesuatu diperlukan atau tidak." },
    { id: "20877", text: "Jawaban opsionalitas \"mungkin atau harus\"." },
  ],
};

const GENERAL_Q = {
  questionText: "What is the capital city of Australia?",
  choices: [
    { id: "a", text: "Sydney" },
    { id: "b", text: "Canberra" },
    { id: "c", text: "Melbourne" },
  ],
};

const CODE_Q = {
  questionText: "Which function correctly returns the sum of a list in Python?",
  choices: [
    { id: "a", text: "def total(xs):\n    return sum(xs)" },
    { id: "b", text: "function total(xs) { return xs.length }" },
  ],
};

(async () => {
  const P = loadPromptLib();
  assert(typeof P.detectQuestionType === "function", "OQSPrompt.detectQuestionType exported");
  assert(typeof P.buildSystemPrompt === "function", "OQSPrompt.buildSystemPrompt exported");
  assert(typeof P.buildMultiSystemPrompt === "function", "OQSPrompt.buildMultiSystemPrompt exported");

  console.log("\n== detectQuestionType ==");
  assert(P.detectQuestionType(SQL_Q) === "sql-query", `SQL query question -> sql-query (got ${P.detectQuestionType(SQL_Q)})`);
  assert(
    P.detectQuestionType(THEORY_Q) === "database-theory",
    `Indonesian database-design concept question -> database-theory (got ${P.detectQuestionType(THEORY_Q)})`
  );
  assert(P.detectQuestionType(CODE_Q) === "code", `non-SQL code question -> code (got ${P.detectQuestionType(CODE_Q)})`);
  assert(P.detectQuestionType(GENERAL_Q) === "general", `plain MCQ -> general (got ${P.detectQuestionType(GENERAL_Q)})`);
  assert(P.detectQuestionType({}) === "general", "empty question -> general (no throw)");
  assert(P.detectQuestionType(null) === "general", "null question -> general (no throw)");

  console.log("\n== SQL path preserves the ORIGINAL SQL prompt (no regression) ==");
  const sqlPrompt = P.buildSystemPrompt(SQL_Q);
  assert(sqlPrompt.includes("expert Oracle SQL"), "SQL prompt keeps the Oracle SQL expert persona");
  assert(sqlPrompt.includes("table alias"), "SQL prompt keeps the alias rule");
  assert(sqlPrompt.includes("NATURAL JOIN"), "SQL prompt keeps the join rules");
  assert(sqlPrompt.includes("cartesian product"), "SQL prompt keeps the trap examples");
  assert(P.buildSolverPrompt(SQL_Q).startsWith("You are an expert multiple-choice exam solver."), "SQL solver prompt starts with the general spine");
  assert(P.buildSolverPrompt(SQL_Q).includes("EXPERT LENS - ORACLE SQL"), "SQL solver prompt includes the SQL lens");
  assert(P.buildVerifierPrompt(SQL_Q, 0).startsWith("You are a meticulous Oracle SQL grader."), "SQL verifier keeps the SQL grader persona");
  assert(P.buildVerifierPrompt(SQL_Q, 0).includes("aliases"), "SQL verifier keeps the alias guidance");

  console.log("\n== Theory path: generalized, language-aware, NOT SQL-only ==");
  const theoryPrompt = P.buildSystemPrompt(THEORY_Q);
  assert(!theoryPrompt.includes("EXPERT LENS - ORACLE SQL"), "theory prompt does NOT include the SQL lens");
  assert(theoryPrompt.includes("EXPERT LENS - DATABASE DESIGN"), "theory prompt includes the database-design lens");
  assert(/Bahasa|Indonesian/i.test(theoryPrompt), "theory prompt mentions localized (Bahasa) questions");
  assert(theoryPrompt.includes("Do NOT assume the subject is SQL"), "theory prompt tells the model not to assume SQL");
  assert(/output the JSON keys in English/i.test(theoryPrompt), "prompt pins the output language to English keys");
  assert(P.buildVerifierPrompt(THEORY_Q, 0).startsWith("You are a meticulous exam grader."), "theory verifier uses the general grader persona");
  assert(!/Oracle SQL grader/i.test(P.buildVerifierPrompt(THEORY_Q, 0)), "theory verifier is not the SQL grader");

  console.log("\n== Code path ==");
  const codePrompt = P.buildSystemPrompt(CODE_Q);
  assert(codePrompt.includes("EXPERT LENS - CODE (non-SQL)"), "code prompt includes the code lens");
  assert(/syntax/i.test(codePrompt), "code prompt checks syntax");

  console.log("\n== General path ==");
  const generalPrompt = P.buildSystemPrompt(GENERAL_Q);
  assert(generalPrompt.includes("EXPERT LENS - GENERAL"), "general prompt includes the general lens");
  assert(!generalPrompt.includes("EXPERT LENS - ORACLE SQL"), "general prompt has no SQL lens");

  console.log("\n== Multi prompts are adaptive too ==");
  const multiTheory = P.buildMultiSolverPrompt(THEORY_Q, 2);
  assert(multiTheory.includes("MORE THAN ONE correct answer"), "multi prompt states multiple answers");
  assert(multiTheory.includes("EXPERT LENS - DATABASE DESIGN"), "multi theory prompt uses the design lens");
  assert(!multiTheory.includes("EXPERT LENS - ORACLE SQL"), "multi theory prompt is not SQL-only");
  assert(/exactly 2 answers/.test(multiTheory), "multi prompt still states the required count");
  assert(P.buildMultiSystemPrompt(SQL_Q).includes("EXPERT LENS - ORACLE SQL"), "multi SQL prompt keeps the SQL lens");

  console.log("\n== Fill prompt is adaptive ==");
  const fillSql = P.buildMultiFillPrompt(SQL_Q, [0], 1);
  assert(fillSql.startsWith("You are an expert Oracle SQL exam solver."), "SQL fill prompt keeps the SQL persona");
  const fillTheory = P.buildMultiFillPrompt(THEORY_Q, [0], 1);
  assert(fillTheory.startsWith("You are an expert exam solver."), "theory fill prompt uses the general persona");
  assert(/answerIndexes/.test(fillTheory), "fill prompt still requests answerIndexes");

  console.log("\n== Output format unchanged: parsers still round-trip ==");
  assert(P.parseSolverReply('{"answerIndex":2,"confidence":0.9,"reason":"r"}')?.answerIndex === 2, "single parser round-trips");
  assert(P.parseMultiSolverReply('{"answerIndexes":[0,2],"confidence":0.9,"reason":"r"}')?.answerIndexes.join(",") === "0,2", "multi parser round-trips");
  assert(P.parseVerifierReply('{"agree":true,"answerIndex":1,"confidence":0.8,"reason":"ok"}')?.answerIndex === 1, "verifier parser round-trips");

  console.log("\n== Real fixtures classify correctly ==");
  {
    const p1 = createPage({ html: fs.readFileSync(path.join(__dirname, "fixtures", "exampleoracle.html"), "utf8") });
    loadLibsOnly(p1.window);
    const sqlQ = p1.window.OQSScraper.scrapeQuestion();
    assert(
      p1.window.OQSPrompt.detectQuestionType(sqlQ) === "sql-query",
      `fixture 1 (real SQL page) -> sql-query (got ${p1.window.OQSPrompt.detectQuestionType(sqlQ)})`
    );
  }
  {
    const p = createPage({ html: fs.readFileSync(path.join(__dirname, "fixtures", "exampleoracle-multi.html"), "utf8") });
    loadLibsOnly(p.window);
    const theoryQ = p.window.OQSScraper.scrapeQuestion();
    assert(
      p.window.OQSPrompt.detectQuestionType(theoryQ) === "database-theory",
      `fixture 2 (real concept page) -> database-theory (got ${p.window.OQSPrompt.detectQuestionType(theoryQ)})`
    );
    // And the theory question must NOT be fed the SQL checklist.
    const prompt = p.window.OQSPrompt.buildMultiSolverPrompt(theoryQ, theoryQ.requiredCount);
    assert(!prompt.includes("EXPERT LENS - ORACLE SQL"), "real concept question is no longer answered with the SQL-only checklist");
  }

  console.log("\n== Worker: a THEORY question is solved with the non-SQL prompt ==");
  {
    const prompts = [];
    const store = {};
    const stubStorage = {
      local: {
        get: (k) => Promise.resolve(typeof k === "string" ? { [k]: store[k] } : { ...store }),
        set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
      },
    };
    const sw = loadServiceWorker({
      chrome: { storage: stubStorage, runtime: {} },
      fetch: async (url, options) => {
        if (String(url).includes("/conversations")) {
          return { ok: true, headers: { get: () => null }, json: async () => ({ sessionId: "s", chatId: "c" }) };
        }
        prompts.push(JSON.parse(options.body).content);
        const frame = JSON.stringify({ content: JSON.stringify({ content: '{"answerIndexes":[1,2],"confidence":0.9,"reason":"theory"}' }) }) + "\n";
        let sent = false;
        return {
          ok: true, status: 200, headers: { get: () => null },
          body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: new TextEncoder().encode(frame) }), cancel: async () => {} }) },
        };
      },
    });
    const listener = sw.getMessageListener();
    const payload = {
      hash: "theoryhash",
      questionText: THEORY_Q.questionText,
      choices: THEORY_Q.choices.map((c) => ({ id: c.id, text: c.text })),
      multiSelect: true,
      requiredCount: 2,
    };
    const response = await new Promise((resolve) => listener({ type: "OQS_SOLVE", payload }, {}, resolve));
    assert(response?.ok === true, "theory question solved end-to-end by the worker");
    assert(prompts.length > 0, "worker issued at least one AI request");
    assert(
      prompts.every((p) => !p.includes("EXPERT LENS - ORACLE SQL")),
      "no worker request (solver/verifier/fill) used the SQL-only lens for a theory question"
    );
    assert(
      prompts.some((p) => p.includes("EXPERT LENS - DATABASE DESIGN")),
      "the theory question was answered with the database-design lens"
    );
    assert(
      Array.isArray(response?.entry?.answerIds) && response.entry.answerIds.join(",") === "20880,20877",
      `theory answerIds resolved from indexes [1,2] (got ${JSON.stringify(response?.entry?.answerIds)})`
    );
  }

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
