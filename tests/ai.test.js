/**
 * Test the free-AI client: (a) chunk-safe JsonStreamParser, (b) live end-to-end
 * solve of the EXAMPLEORACLE question via new.tusksearch.com.
 */
const fs = require("fs");
const path = require("path");

const EXT = "F:\\GAMES\\Code\\Oracle\\oracle-solver-extension";

let failures = 0;
const assert = (c, m) => {
  console.log((c ? "  PASS: " : "  FAIL: ") + m);
  if (!c) failures += 1;
};

// Load tusk-client VERBATIM as a classic script (would throw on ESM export).
function loadClient() {
  const code = fs.readFileSync(path.join(EXT, "src/background/tusk-client.js"), "utf8");
  const g = {};
  g.globalThis = g;
  const fn = new Function(
    "globalThis", "fetch", "TextDecoder", "TextEncoder", "AbortController", "setTimeout", "clearTimeout",
    code
  );
  fn.call(g, g, () => {}, TextDecoder, TextEncoder, AbortController, setTimeout, clearTimeout);
  return g.OQSTusk;
}

// --- 1. Parser unit tests (ported behavior from stream_parser.rs) ---
console.log("== JsonStreamParser ==");
const { __test } = loadClient();
const { JsonStreamParser, extractStreamText } = __test;

{
  const p = new JsonStreamParser();
  assert(p.push('{"content":"he').length === 0, "partial object not emitted");
  const objs = p.push('llo"}{"done":true}');
  assert(objs.length === 2, "two objects split across chunks parsed");
  assert(extractStreamText(objs[0]) === "hello", "content extracted");
}
{
  const p = new JsonStreamParser();
  const objs = p.push('noise {"content":"a \\"quoted\\" {brace} done"} trailing');
  assert(objs.length === 1 && extractStreamText(objs[0]) === 'a "quoted" {brace} done', "braces inside strings handled");
}
{
  const p = new JsonStreamParser();
  // Nested content-as-string form: {"content":"{\"content\":\"inner\"}"}
  const objs = p.push('{"content":"{\\"content\\":\\"inner\\"}"}');
  assert(extractStreamText(objs[0]) === "inner", "nested JSON content unwrapped");
}

// --- 2. Live end-to-end solve ---
function loadPrompt() {
  const code = fs.readFileSync(path.join(EXT, "src/lib/prompt.js"), "utf8");
  const g = {};
  g.globalThis = g;
  const fn = new Function("globalThis", code);
  fn.call(g, g);
  return g.OQSPrompt;
}

(async () => {
  console.log("\n== Live free-AI solve ==");
  const { buildSolverPrompt, parseSolverReply, DEFAULT_MODEL_ID } = loadPrompt();
  const { ask } = loadClient();

  // Reconstruct the sample Q6 exactly (from the captured page).
  const question = {
    questionText:
      "Anda memiliki tabel EMPLOYESS berikut: EMPLOYEE_ID NUMBER(5) NOT NULL PRIMARY KEY, FIRST_NAME VARCHAR2(25), LAST_NAME VARCHAR(25), ADDRESS VARCHAR2(35), CITY VARCHAR2(25), STATE VARCHAR2(2), ZIP NUMBER(9), TELEPHONE NUMBER(10), DEPARTMENT_ID NUMBER(5) NOT NULL FOREIGN KEY. Tabel BONUS mencakup kolom berikut: BONUS_ID NUMBER(5) NOT NULL PRIMARY KEY, ANNUAL_SALARY NUMBER(10), BONUS_PCT NUMBER(3,2), EMPLOYEE_ID VARCHAR2(5) NOT NULL FOREIGN KEY. Anda ingin menentukan jumlah bonus setiap karyawan sebagai penghitungan gaji dikali bonus. Manakah dari kueri berikut yang seharusnya Anda terbitkan?",
    choices: [
      { id: "52444", text: "SELECT e.first_name, e.last_name, b.annual_salary, b. bonus_pct FROM employees e, bonus b WHERE e.employee_id = b.employee_id;" },
      { id: "52445", text: "SELECT e.first_name, e.last_name, b.annual_salary, b. bonus_pct FROM employees, bonus WHERE e.employee_id = b.employee_id;" },
      { id: "52446", text: "SELECT first_name, last_name, annual_salary * bonus_pct FROM employees, bonus NATURAL JOIN;" },
      { id: "52443", text: "SELECT e.first_name, e.last_name, b.annual_salary * b. bonus_pct FROM employees e, bonus b WHERE e.employee_id = b.employee_id;" },
    ],
  };

  const prompt = buildSolverPrompt(question);
  console.log("  Calling free AI (model GPT-5.4 Nano)…");
  let raw;
  try {
    raw = await ask(prompt, DEFAULT_MODEL_ID);
  } catch (err) {
    console.log("  AI call error: " + err.message);
  }

  if (raw) {
    console.log("  Raw reply (first 300 chars):\n  " + raw.slice(0, 300).replace(/\n/g, "\n  "));
    const parsed = parseSolverReply(raw);
    assert(parsed !== null, "AI reply parsed into a solver result");
    if (parsed) {
      const chosen = question.choices[parsed.answerIndex];
      console.log(`  -> answerIndex=${parsed.answerIndex} confidence=${parsed.confidence} reason="${parsed.reason}"`);
      console.log(`  -> chosen id=${chosen.id}`);
      // The pedagogically correct answer is 52443 (index 3): aliases are
      // consistent and it multiplies salary by bonus_pct.
      assert(parsed.answerIndex >= 0 && parsed.answerIndex < question.choices.length, "answer index in range");
      assert(chosen.id === "52443", `AI chose the expected answer 52443 (got ${chosen.id})`);
    }
  }

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("crash:", e);
  process.exit(2);
});
