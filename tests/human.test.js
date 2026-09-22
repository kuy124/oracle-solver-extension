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

(async () => {
  const { difficulty, pickHumanFailure } = loadHuman();
  assert(typeof difficulty === "function", "OQSHuman.difficulty exported");
  assert(typeof pickHumanFailure === "function", "OQSHuman.pickHumanFailure exported");

  console.log("\n== Difficulty heuristic ==");
  const dEasy = difficulty(EASY_Q);
  const dHard = difficulty(HARD_Q);
  assert(dEasy >= 0 && dEasy <= 1, `easy score in [0,1] (got ${dEasy})`);
  assert(dHard >= 0 && dHard <= 1, `hard score in [0,1] (got ${dHard})`);
  assert(dHard > dEasy, `hard question scores higher than easy (${dHard.toFixed(2)} > ${dEasy.toFixed(2)})`);
  assert(difficulty({}) === 0 || difficulty({}) < 0.2, "empty question scores near 0");

  // Length alone should raise the score.
  const longText = "x".repeat(800);
  const dLong = difficulty({ questionText: longText, choices: [{ id: "a" }, { id: "b" }] });
  assert(dLong > dEasy, "longer question scores higher than the short easy one");

  // Complexity keyword ("GROUP BY") should raise the score vs the same length.
  const base = { questionText: "Return the total salary for every department in the table.", choices: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  const withGroupBy = { ...base, questionText: base.questionText + " Use GROUP BY." };
  assert(
    difficulty(withGroupBy) > difficulty(base),
    "adding a complexity keyword raises the score"
  );

  console.log("\n== pickHumanFailure: disabled / gated ==");
  assert(
    pickHumanFailure(HARD_Q, "a", { humanMode: false, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0)) === null,
    "no failure when human mode is OFF"
  );
  assert(
    pickHumanFailure(EASY_Q, "a", { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0.9 }, fixed(0)) === null,
    "no failure when difficulty < threshold"
  );
  assert(
    pickHumanFailure(HARD_Q, "a", { humanMode: true, humanFailRate: 0.2, humanMinDifficulty: 0 }, fixed(0.999)) === null,
    "no failure when RNG roll exceeds the miss rate"
  );
  assert(
    pickHumanFailure({ questionText: "x", choices: [{ id: "a" }] }, "a", { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0)) === null,
    "no failure when there is only one choice"
  );

  console.log("\n== pickHumanFailure: fires + picks a WRONG choice ==");
  const fire = pickHumanFailure(HARD_Q, "a", { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0));
  assert(fire !== null, "fails a hard question when eligible + roll passes");
  assert(fire && fire.answerId !== "a", `chosen answer differs from the correct one (got ${fire && fire.answerId})`);
  assert(fire && typeof fire.difficulty === "number", "result reports the difficulty");
  assert(
    fire && HARD_Q.choices.some((c) => c.id === fire.answerId),
    "chosen answer is one of the question's choices"
  );

  console.log("\n== pickHumanFailure: prefers the nearest distractor ==");
  // Correct is [1] (id "b"); nearest distractors are [0] and [2].
  const q4 = { questionText: HARD_Q.questionText, choices: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] };
  const near = pickHumanFailure(q4, "b", { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0));
  assert(near && (near.answerId === "a" || near.answerId === "c"), `nearest distractor chosen (got ${near && near.answerId})`);

  console.log("\n== Determinism with same RNG ==");
  const r1 = pickHumanFailure(HARD_Q, "a", { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0));
  const r2 = pickHumanFailure(HARD_Q, "a", { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0));
  assert(r1 && r2 && r1.answerId === r2.answerId, "same RNG -> same result (deterministic)");

  console.log("\n== pickHumanFailureMulti: drops exactly one correct answer ==");
  const { pickHumanFailureMulti } = loadHuman();
  assert(typeof pickHumanFailureMulti === "function", "OQSHuman.pickHumanFailureMulti exported");

  // Human mode off -> never fires.
  assert(
    pickHumanFailureMulti(HARD_Q, ["a", "c"], { humanMode: false, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0)) === null,
    "returns null when human mode is off"
  );
  // Fewer than two correct answers -> nothing plausible to drop.
  assert(
    pickHumanFailureMulti(HARD_Q, ["b"], { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0)) === null,
    "returns null with only one correct answer"
  );
  // Below the difficulty threshold -> skipped.
  assert(
    pickHumanFailureMulti(EASY_Q, ["a", "b"], { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0.9 }, fixed(0)) === null,
    "returns null below the difficulty threshold"
  );
  // Fires when eligible: drops one, keeps the rest, never adds a wrong id.
  const missed = pickHumanFailureMulti(HARD_Q, ["a", "b", "c"], { humanMode: true, humanFailRate: 1, humanMinDifficulty: 0 }, fixed(0));
  assert(missed && Array.isArray(missed.answerIds), "returns an answerIds array when eligible");
  assert(missed && missed.answerIds.length === 2, `drops exactly one of three correct answers (got ${missed && missed.answerIds.length})`);
  assert(
    missed && missed.answerIds.every((id) => ["a", "b", "c"].includes(id)),
    "kept answers are all from the correct set (no distractor added)"
  );

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
