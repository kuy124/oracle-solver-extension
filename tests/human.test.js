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
  const { difficulty, pickHumanFailure } = loadHuman();
  assert(typeof difficulty === "function", "OQSHuman.difficulty exported");
  assert(typeof pickHumanFailure === "function", "OQSHuman.pickHumanFailure exported");

  console.log("\n== difficulty: range + monotonicity ==");
  const easyScore = difficulty(EASY_Q);
  const hardScore = difficulty(HARD_Q);
  assert(easyScore >= 0 && easyScore <= 1, `easy score in [0,1] (got ${easyScore})`);
  assert(hardScore >= 0 && hardScore <= 1, `hard score in [0,1] (got ${hardScore})`);
  assert(hardScore > easyScore, `hard question scores higher than easy (${hardScore.toFixed(2)} > ${easyScore.toFixed(2)})`);
  assert(difficulty({ questionText: "", choices: [] }) < 0.2, "empty question scores near 0");
  const longQ = { questionText: "x".repeat(600), choices: [{ id: "a" }, { id: "b" }] };
  assert(difficulty(longQ) > difficulty(EASY_Q), "longer question scores higher than the short easy one");
  const kwQ = { questionText: EASY_Q.questionText + " GROUP BY x HAVING y", choices: EASY_Q.choices };
  assert(difficulty(kwQ) > easyScore, "adding a complexity keyword raises the score");

  console.log("\n== pickHumanFailure: disabled / gated ==");
  assert(
    pickHumanFailure(HARD_Q, "a", { humanMode: false, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0)) === null,
    "no failure when human mode is OFF"
  );
  assert(
    pickHumanFailure(HARD_Q, "a", { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0.99 }, fixed(0)) === null,
    "no failure when difficulty < threshold"
  );
  assert(
    pickHumanFailure(HARD_Q, "a", { humanMode: true, humanFailRate: 0.1, humanMinDifficulty: 0 }, fixed(0.99)) === null,
    "no failure when RNG roll exceeds the miss rate"
  );
  const oneChoice = { questionText: HARD_Q.questionText, choices: [{ id: "a" }] };
  assert(
    pickHumanFailure(oneChoice, "a", { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0)) === null,
    "no failure when there is only one choice"
  );

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
