/**
 * Live accuracy test for the Gemini web provider, with HARD questions.
 *
 * These are the traps the Oracle Academy quizzes are built from: the
 * plausible wrong answers, the "almost right" SQL, the theory questions
 * with a misconception as the decoy, and the localized ones.
 *
 * Run it with:  node tests/hard.test.js
 * It needs the network and takes a few minutes.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { EXT } = require("./harness");

// gemini.google.com sends more than 16 KB of response headers, which Node's
// default fetch refuses with "Headers Overflow Error". The flag raises that
// limit, so re-run this file with it.
if (!process.env.OQS_RAISED_HEADER_LIMIT) {
  const res = spawnSync(
    process.execPath,
    ["--max-http-header-size=262144", __filename, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, OQS_RAISED_HEADER_LIMIT: "1" } }
  );
  process.exit(res.status ?? 1);
}

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

/** Load the extension's prompt + client code into this realm. */
function loadLibs() {
  const g = { globalThis: null, fetch: globalThis.fetch.bind(globalThis) };
  g.globalThis = g;
  for (const rel of ["src/lib/prompt.js", "src/background/gemini-web-client.js"]) {
    const code = fs.readFileSync(path.join(EXT, rel), "utf8");
    const fn = new Function(
      "globalThis", "self", "fetch", "console", "setTimeout", "clearTimeout",
      "TextDecoder", "TextEncoder", "AbortController", "URLSearchParams", code
    );
    fn.call(g, g, g, g.fetch, console, setTimeout, clearTimeout, TextDecoder, TextEncoder, AbortController, URLSearchParams);
  }
  return g;
}

const g = loadLibs();
const P = g.OQSPrompt;
const G = g.OQSGeminiWeb;

/** The model ids the web app uses, and their model numbers. */
const FLASH = { modelId: "fbb127bbb056c959", modelNumber: 1 };
const FLASH_LITE = { modelId: "cf41b0e0dd7d53e5", modelNumber: 6 };

// ---------------------------------------------------------------------------
// The HARD questions. Each one has a decoy that looks right.
// ---------------------------------------------------------------------------
const QUESTIONS = [
  {
    id: "sql-alias-mismatch",
    hard: "the second choice uses the right column but a table name that was never declared",
    question:
      "Tables: employees(employee_id, first_name, last_name), bonus(employee_id, bonus_pct, annual_salary). " +
      "Which query returns each employee's name and the bonus amount (annual_salary * bonus_pct)?",
    choices: [
      "SELECT e.first_name, e.last_name, b.annual_salary * b.bonus_pct FROM employees e, bonus b WHERE e.employee_id = b.employee_id;",
      "SELECT e.first_name, e.last_name, bonus.annual_salary * bonus.bonus_pct FROM employees e, bonus b WHERE e.employee_id = b.employee_id;",
      "SELECT e.first_name, e.last_name, b.annual_salary * b.bonus_pct FROM employees e, bonus WHERE e.employee_id = b.employee_id;",
      "SELECT e.first_name, e.last_name, b.annual_salary * b.bonus_pct FROM employees e, bonus b;",
    ],
    answer: 0,
  },
  {
    id: "sql-natural-join-trap",
    hard: "NATURAL JOIN looks tidy but the columns have different names, so it cannot join",
    question:
      "Tables: employees(employee_id NUMBER(5), first_name), bonus(emp_id VARCHAR2(5), bonus_pct). " +
      "The employee_id column and the emp_id column hold the same values. Which query correctly joins the two tables?",
    choices: [
      "SELECT first_name, bonus_pct FROM employees NATURAL JOIN bonus;",
      "SELECT first_name, bonus_pct FROM employees, bonus WHERE employees.employee_id = bonus.emp_id;",
      "SELECT first_name, bonus_pct FROM employees e JOIN bonus b ON e.employee_id = b.emp_id;",
      "SELECT first_name, bonus_pct FROM employees e JOIN bonus b ON e.employee_id = b.bonus_pct;",
    ],
    answer: 2,
  },
  {
    id: "sql-having-vs-where",
    hard: "WHERE on an aggregate is a syntax error; the filter belongs in HAVING",
    question:
      "Table employees(employee_id, salary, department_id). Which query returns the average salary per department, " +
      "but only for departments whose average salary is above 5000?",
    choices: [
      "SELECT department_id, AVG(salary) FROM employees WHERE AVG(salary) > 5000 GROUP BY department_id;",
      "SELECT department_id, AVG(salary) FROM employees GROUP BY department_id HAVING AVG(salary) > 5000;",
      "SELECT department_id, AVG(salary) FROM employees GROUP BY department_id ORDER BY AVG(salary) > 5000;",
      "SELECT department_id, AVG(salary) FROM employees WHERE salary > 5000 GROUP BY department_id;",
    ],
    answer: 1,
  },
  {
    id: "sql-group-by-extra-column",
    hard: "a column that is not grouped and not aggregated is invalid SQL",
    question:
      "Table employees(employee_id, first_name, department_id, salary). Which query is valid and lists every " +
      "department name with the number of employees in it?",
    choices: [
      "SELECT d.department_name, e.first_name, COUNT(*) FROM departments d, employees e GROUP BY d.department_name;",
      "SELECT d.department_name, COUNT(*) FROM departments d, employees e WHERE d.department_id = e.department_id GROUP BY d.department_name;",
      "SELECT d.department_name, COUNT(e.employee_id) FROM departments d, employees e GROUP BY d.department_name, e.first_name;",
      "SELECT d.department_name, COUNT(*) FROM departments d JOIN employees e ON d.department_id = e.department_id;",
    ],
    answer: 1,
  },
  {
    id: "sql-null-nvl",
    hard: "the arithmetic silently ignores NULL rows; NVL is the NULL-safe form",
    question:
      "Table employees(employee_id, salary, bonus_pct). bonus_pct is NULL for some employees. " +
      "Which query returns the bonus amount for EVERY employee, treating a missing bonus percentage as zero?",
    choices: [
      "SELECT employee_id, salary * bonus_pct FROM employees;",
      "SELECT employee_id, salary * NVL(bonus_pct, 0) FROM employees;",
      "SELECT employee_id, salary * bonus_pct FROM employees WHERE bonus_pct IS NOT NULL;",
      "SELECT employee_id, NVL(salary * bonus_pct, 0) FROM employees;",
    ],
    answer: 1,
  },
  {
    id: "sql-order-by-expression",
    hard: "ORDER BY cannot reference an alias it did not define",
    question:
      "Table employees(employee_id, first_name, salary, department_id). Which query lists the employees of " +
      "department 10 ordered by their salary from highest to lowest?",
    choices: [
      "SELECT first_name, salary FROM employees WHERE department_id = 10 ORDER BY salary DESC;",
      "SELECT first_name, salary FROM employees GROUP BY department_id ORDER BY salary DESC;",
      "SELECT first_name, salary FROM employees WHERE department_id = 10 ORDER BY department_id;",
      "SELECT first_name, salary FROM employees WHERE department_id = 10 GROUP BY salary ORDER BY salary DESC;",
    ],
    answer: 0,
  },
  {
    id: "theory-3nf-transitive",
    hard: "the decoy defines 3NF as 'no repeating groups', which is 1NF",
    question:
      "A relation is in Third Normal Form (3NF) when it is already in 1NF and 2NF and no non-key attribute " +
      "depends on another non-key attribute. Which statement is correct?",
    choices: [
      "A relation in 3NF has no repeating groups within an attribute",
      "A relation in 3NF has no partial dependency on a composite key",
      "A relation in 3NF has no transitive dependency of a non-key attribute on another non-key attribute",
      "A relation in 3NF must have a single-attribute primary key",
    ],
    answer: 2,
  },
  {
    id: "theory-optionality-vs-cardinality",
    hard: "the decoy swaps the two concepts, which is the classic trap",
    question:
      "In Entity-Relationship modelling, what does the OPTIONALITY of a relationship specify?",
    choices: [
      "The number of entities on each side of the relationship, for example one-to-many",
      "Whether an entity is required or optional in the relationship",
      "Whether the relationship is stored as a foreign key or as a separate table",
      "The order in which the entities are stored physically",
    ],
    answer: 1,
  },
  {
    id: "theory-functional-dependency",
    hard: "the decoy reverses the direction of the dependency",
    question:
      "In a relation R(A, B, C) there is a functional dependency A -> B and B -> C. What does A -> C mean?",
    choices: [
      "Every value of C determines exactly one value of A",
      "Every value of A determines exactly one value of C, by transitivity",
      "A and C must have the same value",
      "A and C cannot both be null",
    ],
    answer: 1,
  },
  {
    id: "theory-null-uniqueness",
    hard: "the decoy claims a primary key may contain nulls",
    question:
      "Which statement about a primary key in a relational database is correct?",
    choices: [
      "A primary key may contain null values, because null means unknown",
      "A primary key must be unique and must not contain null values",
      "A primary key can be nullable when it is defined on a composite key",
      "A primary key is only unique within a single table, not across the database",
    ],
    answer: 1,
  },
  {
    id: "indonesian-hard",
    hard: "the same optionality trap, in Indonesian",
    question:
      "Dalam pemodelan Entity-Relationship, apa yang ditentukan oleh opsionalitas sebuah hubungan?",
    choices: [
      "Berapa banyak entitas pada masing-masing sisi hubungan tersebut",
      "Apakah sebuah entitas wajib atau boleh tidak participating dalam hubungan tersebut",
      "Apakah hubungan tersebut disimpan sebagai foreign key atau sebagai tabel terpisah",
      "Urutan penyimpanan entitas secara fisik dalam database",
    ],
    answer: 1,
  },
  {
    id: "indonesian-hard-2",
    hard: "a decimal-placement trap in Indonesian",
    question:
      "Manakah rumus SQL yang benar untuk menghitung jumlah bonus setiap karyawan sebagai annual_salary dikali bonus_pct?",
    choices: [
      "SELECT e.first_name, b.annual_salary * b.bonus_pct FROM employees e, bonus b WHERE e.employee_id = b.employee_id;",
      "SELECT e.first_name, b.annual_salary, b.bonus_pct FROM employees e, bonus b WHERE e.employee_id = b.employee_id;",
      "SELECT e.first_name, b.annual_salary + b.bonus_pct FROM employees e, bonus b WHERE e.employee_id = b.employee_id;",
      "SELECT e.first_name, b.annual_salary * b.bonus_pct FROM employees e, bonus b;",
    ],
    answer: 0,
  },
  {
    id: "negative-question",
    hard: "the question asks which one is NOT true, and three are true",
    question:
      "Which of the following statements about an INNER JOIN is NOT correct?",
    choices: [
      "It returns only the rows that match in both tables",
      "Rows without a match in the other table are excluded",
      "It can produce a cartesian product when the join condition is missing",
      "It never returns more rows than the smaller of the two tables",
    ],
    answer: 3,
  },
  {
    id: "decimal-trap",
    hard: "a rounding trap: multiplying then rounding is not rounding then multiplying",
    question:
      "An employee's annual salary is 50000 and the bonus percentage is 7.5. The bonus amount must be rounded to " +
      "two decimal places. Which expression gives the correct bonus amount?",
    choices: [
      "ROUND(50000 * 7.5, 2)",
      "ROUND(50000, 2) * 7.5",
      "50000 * ROUND(7.5, 2)",
      "ROUND(50000 * 7.5)",
    ],
    answer: 0,
  },
];

/** Ask one question and return the parsed answer. */
async function askOne(question, model) {
  const prompt = P.buildSolverPrompt(question);
  const raw = await G.ask(prompt, model);
  const parsed = P.parseSolverReply(raw);
  return { parsed, raw };
}

(async () => {
  console.log("== Hard questions, live, one pass (Gemini Flash) ==");
  let ok = 0;
  const times = [];
  for (const item of QUESTIONS) {
    const t0 = Date.now();
    let parsed = null;
    let raw = "";
    let error = null;
    try {
      const r = await askOne(
        { questionText: item.question, choices: item.choices.map((text) => ({ text })) },
        FLASH
      );
      parsed = r.parsed;
      raw = r.raw;
    } catch (err) {
      error = err.message;
    }
    const ms = Date.now() - t0;
    times.push(ms);
    const good = parsed && parsed.answerIndex === item.answer;
    if (good) ok += 1;
    console.log(
      `  ${good ? "OK  " : "WRONG"} ${item.id} (${ms}ms) got=${parsed ? parsed.answerIndex : "?"} want=${item.answer}`
    );
    if (!good) {
      console.log(`       trap: ${item.hard}`);
      if (error) console.log(`       error: ${error}`);
      else console.log(`       raw: ${raw.slice(0, 260)}`);
    }
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  console.log(`\n  => ${ok}/${QUESTIONS.length} correct, avg ${avg}ms`);
  assert(ok >= QUESTIONS.length - 1, `at most one question wrong (got ${ok}/${QUESTIONS.length})`);

  console.log("\n== The same questions with Flash-Lite (the second model) ==");
  let ok2 = 0;
  for (const item of QUESTIONS) {
    let parsed = null;
    try {
      parsed = (
        await askOne(
          { questionText: item.question, choices: item.choices.map((text) => ({ text })) },
          FLASH_LITE
        )
      ).parsed;
    } catch {
      parsed = null;
    }
    const good = parsed && parsed.answerIndex === item.answer;
    if (good) ok2 += 1;
    console.log(`  ${good ? "OK  " : "WRONG"} ${item.id} got=${parsed ? parsed.answerIndex : "?"} want=${item.answer}`);
  }
  console.log(`\n  => Flash-Lite: ${ok2}/${QUESTIONS.length} correct`);

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
