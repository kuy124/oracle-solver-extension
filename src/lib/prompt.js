/**
 * Solver prompt builder + TuskCentral model catalog.
 * Classic script (no ESM). Wrapped in an IIFE so its internals never leak into
 * (or collide with) the shared global scope — safe to load more than once.
 * Exposes `globalThis.OQSPrompt`.
 * @module lib/prompt
 */

(() => {
  /**
   * Free-AI model catalog (ids from the Antigravity model list; they are opaque
   * backend UUIDs, not names).
   */
  const MODELS = [
    { id: "2c2ae09e-7bea-4b12-a461-c34a9e084b93", name: "GPT-5.4 Nano", provider: "OpenAI" },
    { id: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a", name: "GPT-5.4 Mini", provider: "OpenAI" },
    { id: "1c219738-5b7d-4bff-8edb-3f4d53fa4903", name: "GPT-5 Nano", provider: "OpenAI" },
    { id: "c1d7c9b6-b478-4398-a3c2-3d8914c986e9", name: "GPT-4o-mini", provider: "OpenAI" },
    { id: "d6ff02cf-f056-4b11-a802-e8791dadccfd", name: "Gemini 3.5 Flash Lite", provider: "Google" },
    { id: "21f6d265-8f41-40cb-a919-ad1879a26e6e", name: "Gemini 3.1 Flash Lite", provider: "Google" },
    { id: "a1a67a18-d926-42fe-8add-69514527643f", name: "DeepSeek V3.2", provider: "DeepSeek" },
    { id: "5c66d4f6-5818-49ec-a6bb-1331432559c9", name: "Llama 4 Maverick", provider: "Meta" },
  ];

  const DEFAULT_MODEL_ID = "bce9d196-5aa7-436a-9e28-760c6d3f8f3a"; // GPT-5.4 Mini (accurate on SQL)

  /**
   * Consensus panel: three independent, distinct models voted for the answer.
   * Errors decorrelate across different providers, so a 3-way majority is far
   * more robust than any single model. Verified working on the free endpoint.
   */
  const CONSENSUS_MODELS = [
    "bce9d196-5aa7-436a-9e28-760c6d3f8f3a", // GPT-5.4 Mini
    "d6ff02cf-f056-4b11-a802-e8791dadccfd", // Gemini 3.5 Flash Lite
    "1c219738-5b7d-4bff-8edb-3f4d53fa4903", // GPT-5 Nano
  ];

  /** @param {string} id */
  function modelName(id) {
    return MODELS.find((m) => m.id === id)?.name ?? "AI model";
  }

  const SYSTEM_PROMPT = `You are an expert Oracle SQL exam solver. You must pick the SINGLE best answer and you get it right.

METHOD (reason silently, do not print your reasoning):
A. Restate what the question is really asking (the goal), and note the schema/tables if given.
B. For EACH choice, check it against this checklist and mark it VALID or INVALID with a one-line cause:
   - Referenced tables/columns exist (respect the schema in the question; watch for misspelled names, wrong types).
   - Every table alias used is the SAME alias it was declared with (a table aliased "e" must be referenced as "e", never as its full name; unaliased tables must not be referenced by an alias that doesn't exist).
   - Joins are correct: an explicit join condition exists; JOIN ... ON / USING has a real common column; NATURAL JOIN only if the tables genuinely share join columns; cross joins are only correct when the question wants them.
   - Arithmetic/logic matches the goal (multiply when asked for a product, divide for a ratio, use NVL for NULL-safety where the question implies it).
   - GROUP BY / HAVING / ORDER BY / DISTINCT / aggregation are used correctly if the goal needs them.
   - No syntax errors (clause order, commas, quotes, operator misuse).
C. Reject every INVALID choice. If exactly one remains VALID, pick it.
D. If several look valid, pick the one that is MOST correct (fully satisfies the goal with the cleanest, most portable Oracle syntax). Prefer the choice that does not rely on a lucky/implicit behavior.
E. Do NOT be fooled by a choice that "looks close" but has an inconsistent alias, a missing join, wrong arithmetic, or invalid syntax.

FEW-SHOT EXAMPLES OF TRAPS TO REJECT:
- "SELECT e.first_name ... FROM employees e, bonus b WHERE e.employee_id = b.employee_id" while another choice uses "b.bonus_pct" but the table is referenced as "bonus_pct" without the alias -> invalid alias.
- A choice that returns the raw bonus_pct instead of annual_salary * bonus_pct when the question asks for the bonus AMOUNT -> wrong arithmetic.
- "FROM employees, bonus NATURAL JOIN" (invalid syntax / no join column) -> invalid.
- A choice that omits the join condition entirely -> cartesian product, invalid.

CONFIDENCE: report a calibrated 0..1. Use >=0.9 only when one choice is unambiguously correct and all others are clearly invalid.

IMPLEMENTATION-INTENT RESOLUTION (do this FIRST):
- Restate, silently, exactly WHAT the question wants computed or returned. This is the #1 cause of wrong answers: a choice that is "almost right" but computes something else (e.g. returns raw columns when the question asks for a COMPUTED amount, or returns a percentage when the question asks for an amount).
- Then eliminate any choice that does not compute EXACTLY the requested thing, even if it is syntactically valid.

OUTPUT: ONLY a JSON object, no markdown fences, no prose:
{"answerIndex": <0-based integer>, "confidence": <0..1>, "reason": "<one or two sentences naming the deciding factor>"}`;

  /** Render the numbered choice list shared by every prompt. */
  function renderChoices(question) {
    return (question?.choices ?? []).map((c, i) => `[${i}] ${c.text}`).join("\n");
  }

  /**
   * Build the user content string handed to the model.
   * @param {{ questionText: string, choices: Array<{ id?: string, text: string }> }} question
   * @returns {string}
   */
  function buildSolverPrompt(question) {
    return `${SYSTEM_PROMPT}

QUESTION:
${question?.questionText ?? ""}

CHOICES:
${renderChoices(question)}

Apply the METHOD, then respond with the JSON object only.`;
  }

  /**
   * Plural system prompt: the question expects MORE THAN ONE correct answer
   * ("Select all that apply" / "Pilih dua"). The model must return the full set.
   */
  const MULTI_SYSTEM_PROMPT = `You are an expert Oracle SQL exam solver. This question has MORE THAN ONE correct answer and you must find ALL of them and none of the wrong ones.

METHOD (reason silently, do not print your reasoning):
A. Restate what the question is really asking (the goal), and note the schema/tables if given.
B. For EACH choice, check it against this checklist and mark it VALID or INVALID with a one-line cause:
   - Referenced tables/columns exist (respect the schema in the question; watch for misspelled names, wrong types).
   - Every table alias used is the SAME alias it was declared with (a table aliased "e" must be referenced as "e", never as its full name; unaliased tables must not be referenced by an alias that doesn't exist).
   - Joins are correct: an explicit join condition exists; JOIN ... ON / USING has a real common column; NATURAL JOIN only if the tables genuinely share join columns; cross joins are only correct when the question wants them.
   - Arithmetic/logic matches the goal (multiply when asked for a product, divide for a ratio, use NVL for NULL-safety where the question implies it).
   - GROUP BY / HAVING / ORDER BY / DISTINCT / aggregation are used correctly if the goal needs them.
   - No syntax errors (clause order, commas, quotes, operator misuse).
C. Collect EVERY choice that is VALID. Do NOT stop at the first one. Do NOT pad the set with a wrong choice to reach a count.
D. If the question states a count (e.g. "choose two"), prefer that many answers, but NEVER include an INVALID choice just to hit the count. If only one choice is truly valid, return just that one.
E. Do NOT be fooled by a choice that "looks close" but has an inconsistent alias, a missing join, wrong arithmetic, or invalid syntax.

FEW-SHOT EXAMPLES OF TRAPS TO REJECT:
- "SELECT e.first_name ... FROM employees e, bonus b WHERE e.employee_id = b.employee_id" while another choice uses "b.bonus_pct" but the table is referenced as "bonus_pct" without the alias -> invalid alias.
- A choice that returns the raw bonus_pct instead of annual_salary * bonus_pct when the question asks for the bonus AMOUNT -> wrong arithmetic.
- "FROM employees, bonus NATURAL JOIN" (invalid syntax / no join column) -> invalid.
- A choice that omits the join condition entirely -> cartesian product, invalid.

CONFIDENCE: report a calibrated 0..1 for the WHOLE set. Use >=0.9 only when the selected set is unambiguously exactly right.

IMPLEMENTATION-INTENT RESOLUTION (do this FIRST):
- Restate, silently, exactly WHAT the question wants computed or returned. This is the #1 cause of wrong answers: a choice that is "almost right" but computes something else.
- Then eliminate any choice that does not compute EXACTLY the requested thing, even if it is syntactically valid.

OUTPUT: ONLY a JSON object, no markdown fences, no prose:
{"answerIndexes": [<0-based integers, ascending, no duplicates>], "confidence": <0..1>, "reason": "<one or two sentences naming the deciding factor>"}`;

  /**
   * Build the user content string for a multi-select question.
   * @param {{ questionText: string, choices: Array<{ id?: string, text: string }> }} question
   * @param {number|null} [requiredCount]  how many answers the question asks for, if stated
   * @returns {string}
   */
  function buildMultiSolverPrompt(question, requiredCount) {
    const countLine =
      requiredCount && requiredCount > 0
        ? `\nThis question asks for exactly ${requiredCount} answer${requiredCount === 1 ? "" : "s"} (select all that apply).`
        : `\nThis question asks for ALL correct answers (select all that apply).`;
    return `${MULTI_SYSTEM_PROMPT}${countLine}

QUESTION:
${question?.questionText ?? ""}

CHOICES:
${renderChoices(question)}

Apply the METHOD, then respond with the JSON object only.`;
  }

  /**
   * A second-opinion prompt: given the question, choices, and a first proposed
   * answer, ask the model to independently verify it (catches the model's first
   * mistake). Returns JSON with an overriding answerIndex when it disagrees.
   * @param {{ questionText: string, choices: Array<{ id?: string, text: string }> }} question
   * @param {number} proposedIndex
   * @returns {string}
   */
  function buildVerifierPrompt(question, proposedIndex) {
    const choices = (question?.choices ?? []).map((c, i) => `[${i}] ${c.text}`).join("\n");
    return `You are a meticulous Oracle SQL grader. Another solver proposed an answer, but it may be wrong. Independently determine the correct choice.

QUESTION:
${question?.questionText ?? ""}

CHOICES:
${choices}

PROPOSED ANSWER: [${proposedIndex}] ${question?.choices?.[proposedIndex]?.text ?? ""}

Verify the proposed answer against the schema, the aliases, the join condition, and the arithmetic the question asks for. If it has ANY flaw, choose the best alternative. Be specific about aliases, join conditions, and arithmetic.

OUTPUT: ONLY a JSON object, no markdown fences:
{"agree": <true|false>, "answerIndex": <0-based integer you believe is correct>, "confidence": <0..1>, "reason": "<one sentence: the decisive correctness check>"}`;
  }

  /**
   * Parse a verifier reply.
   * @param {string} raw
   * @returns {{ agree: boolean, answerIndex: number, confidence: number, reason: string } | null}
   */
  function parseVerifierReply(raw) {
    if (!raw || typeof raw !== "string") return null;
    let text = raw.trim();
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) text = fenceMatch[1].trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
    try {
      const obj = JSON.parse(text);
      const idx = Number(obj.answerIndex);
      if (!Number.isInteger(idx) || idx < 0) return null;
      return {
        agree: obj.agree === true || obj.agree === "true",
        answerIndex: idx,
        confidence: Number.isFinite(Number(obj.confidence)) ? Number(obj.confidence) : 0,
        reason: String(obj.reason ?? "").slice(0, 500),
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse the model reply into a strict solver result.
   * Tolerant of stray markdown fences or surrounding text.
   * @param {string} raw
   * @returns {{ answerIndex: number, confidence: number, reason: string } | null}
   */
  function parseSolverReply(raw) {
    if (!raw || typeof raw !== "string") return null;
    let text = raw.trim();

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) text = fenceMatch[1].trim();

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      text = text.slice(start, end + 1);
    }

    try {
      const obj = JSON.parse(text);
      const idx = Number(obj.answerIndex);
      if (!Number.isInteger(idx) || idx < 0) return null;
      return {
        answerIndex: idx,
        confidence: Number.isFinite(Number(obj.confidence)) ? Number(obj.confidence) : 0,
        reason: String(obj.reason ?? "").slice(0, 500),
      };
    } catch {
      return null;
    }
  }

  globalThis.OQSPrompt = {
    MODELS,
    DEFAULT_MODEL_ID,
    CONSENSUS_MODELS,
    modelName,
    buildSolverPrompt,
    parseSolverReply,
    buildVerifierPrompt,
    parseVerifierReply,
  };
})();
