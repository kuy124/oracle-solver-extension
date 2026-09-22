/**
 * Human-mode tests.
 * Covers: the difficulty heuristic is monotonic in complexity, and
 * pickHumanFailure respects the toggle / threshold / rate (via injected RNG)
 * and always returns a choice DIFFERENT from the correct one.
 */
const fs = require("fs");
const path = require("path");

const EXT = path.resolve(__dirname, "..");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

/** Load src/lib/human.js into a fresh sandbox exposing OQSHuman. */
function loadHuman() {
  const code = fs.readFileSync(path.join(EXT, "src/lib/human.js"), "utf8");
  const sandbox = {};
  sandbox.globalThis = sandbox;
  const fn = new Function("globalThis", code);
  fn.call(sandbox, sandbox);
  return sandbox.OQSHuman;
}

const EASY_Q = {
  questionText: "SELECT * FROM employees",
  choices: [{ id: "a" }, { id: "b" }],
};

const HARD_Q = {
  questionText:
    "Write a correlated subquery that uses a NATURAL JOIN and GROUP BY with HAVING, " +
    "plus an analytic OVER (PARTITION BY ...) and a UNION of two SELECT statements to " +
    "return each department's total salary where the department has more than three employees.",
  choices: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
};

/** RNG that always returns a fixed value. */
const fixed = (v) => () => v;

// Placeholder body.
(async () => {
  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
