/**
 * MV3 background service worker (CLASSIC worker, not a module).
 * Loads its dependencies via importScripts() so the shared libs stay plain
 * scripts (usable by both the content scripts and this worker).
 * Routes solve requests from the content script, does the CORS-bypassing
 * network work, and persists results to the answer key.
 * @module background/service-worker
 */

importScripts(
  "../lib/version.js",
  "../lib/hash.js",
  "../lib/prompt.js",
  "../lib/answer-key.js",
  "../lib/human.js",
  "./tusk-client.js"
);

const { ask } = globalThis.OQSTusk;
const {
  buildSolverPrompt,
  parseSolverReply,
  buildVerifierPrompt,
  parseVerifierReply,
  DEFAULT_MODEL_ID,
  CONSENSUS_MODELS,
} = globalThis.OQSPrompt;
const { getEntry, putEntry, loadSettings } = globalThis.OQSKey;

console.info(`[OQS] v${globalThis.OQS_VERSION ?? "unknown"} background service worker started.`);

/** Serialize solves so we stay friendly to the 1-minute rate limit. */
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/**
 * @typedef {Object} SolveRequest
 * @property {string} hash
 * @property {string} questionText
 * @property {Array<{ id: string, text: string }>} choices
 * @property {boolean} [forceAi]
 */

/**
 * Solve one question with a 3-MODEL MAJORITY VOTE for high accuracy:
 *   1. Ask three independent, distinct models the same solver prompt (parallel).
 *   2. Take the majority answer index.
 *   3. If the three all disagree (no majority), run the verifier to break the tie;
 *      otherwise keep the majority.
 * Different providers make decorrelated mistakes, so the majority is far more
 * accurate than any single model, and a lone verifier can never flip a majority.
 *
 * @param {{ questionText: string, choices: Array<{id:string,text:string}> }} question
 * @param {string} preferredModelId  preferred first voter (usually the user's pick)
 * @returns {Promise<{ answerIndex: number, confidence: number, reason: string, source: string, verified: boolean } | null>}
 */
async function solveConsensus(question, preferredModelId) {
  const n = question.choices.length;
  const valid = (p) => p && Number.isInteger(p.answerIndex) && p.answerIndex >= 0 && p.answerIndex < n;

  // Build the voter panel: preferred model first, then the rest of the panel.
  const panel = [preferredModelId || DEFAULT_MODEL_ID, ...CONSENSUS_MODELS].filter(
    (id, i, arr) => id && arr.indexOf(id) === i
  );
  const voters = panel.slice(0, 3);

  const solverPrompt = buildSolverPrompt(question);
  // Run voters SEQUENTIALLY with a small gap. The free endpoint is rate-limited
  // per minute, so a parallel burst trips HTTP 429; sequential + pacing is safe,
  // and we STOP EARLY once two voters agree (a guaranteed majority of 3).
  const votes = new Map(); // answerIndex -> count
  const results = [];
  for (let i = 0; i < voters.length; i += 1) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700));
    let parsed = null;
    try {
      parsed = parseSolverReply(await ask(solverPrompt, voters[i]));
    } catch {
      parsed = null;
    }
    results.push(parsed);
    if (valid(parsed)) {
      votes.set(parsed.answerIndex, (votes.get(parsed.answerIndex) ?? 0) + 1);
      // Early exit: 2 agreeing voters is already an unbeatable majority of 3.
      if (votes.get(parsed.answerIndex) >= 2) break;
    }
  }

  const picks = results.filter(valid);

  if (picks.length === 0) return null;

  // Tally votes.
  const tally = new Map();
  for (const p of picks) {
    const cur = tally.get(p.answerIndex) ?? { count: 0, conf: 0, reason: "" };
    cur.count += 1;
    cur.conf = Math.max(cur.conf, p.confidence || 0);
    if (!cur.reason && p.reason) cur.reason = p.reason;
    tally.set(p.answerIndex, cur);
  }

  // Majority (2+ of 3, or 2+ of however many returned).
  let bestIndex = null;
  let bestCount = 0;
  let bestConf = 0;
  let bestReason = "";
  for (const [idx, info] of tally) {
    if (info.count > bestCount || (info.count === bestCount && info.conf > bestConf)) {
      bestIndex = idx;
      bestCount = info.count;
      bestConf = info.conf;
      bestReason = info.reason;
    }
  }
  const majorityThreshold = Math.floor(picks.length / 2) + 1;
  if (bestCount >= majorityThreshold) {
    return {
      answerIndex: bestIndex,
      confidence: Math.min(0.99, Math.max(bestConf, bestCount === 3 ? 0.95 : 0.85)),
      reason: bestReason || "Agreed by " + bestCount + " of " + picks.length + " models.",
      source: "ai-consensus",
      verified: true,
    };
  }

  // No majority -> verifier breaks the tie between the top pick and its rival.
  const primary = picks.find((p) => p.answerIndex === bestIndex) ?? picks[0];
  let verdict = null;
  try {
    verdict = parseVerifierReply(await ask(buildVerifierPrompt(question, primary.answerIndex), DEFAULT_MODEL_ID));
  } catch {
    verdict = null;
  }
  if (valid(verdict) && verdict.answerIndex !== primary.answerIndex) {
    // Accept the verifier's override only if it matches another voter OR is confident.
    const corroborated = picks.some((p) => p.answerIndex === verdict.answerIndex);
    if (corroborated || (verdict.confidence || 0) >= 0.8) {
      return {
        answerIndex: verdict.answerIndex,
        confidence: verdict.confidence || 0.7,
        reason: verdict.reason || "verifier tie-break",
        source: "ai-tiebreak",
        verified: true,
      };
    }
  }
  return {
    answerIndex: primary.answerIndex,
    confidence: primary.confidence || 0,
    reason: primary.reason || "",
    source: "ai",
    verified: false,
  };
}

/**
 * @param {SolveRequest} req
 * @returns {Promise<{ ok: boolean, entry?: any, error?: string }>}
 */
async function solve(req) {
  const { hash, questionText, choices, forceAi = false } = req;

  if (!forceAi) {
    const cached = await getEntry(hash);
    if (cached) return { ok: true, entry: { ...cached, source: cached.source ?? "key" } };
  }

  const settings = await loadSettings();
  if (!settings.aiEnabled) {
    return { ok: false, error: "AI fallback is disabled and no cached answer exists." };
  }

  const modelId = settings.modelId || DEFAULT_MODEL_ID;
  const question = { questionText, choices };

  let result;
  if (settings.doubleCheck !== false) {
    result = await solveConsensus(question, modelId);
  } else {
    // Single-pass mode (faster, lower accuracy).
    try {
      const parsed = parseSolverReply(await ask(buildSolverPrompt(question), modelId));
      result = parsed ? { answerIndex: parsed.answerIndex, confidence: parsed.confidence, reason: parsed.reason, source: "ai", verified: false } : null;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!result || result.answerIndex < 0 || result.answerIndex >= choices.length) {
    return { ok: false, error: "The AI reply could not be parsed into an answer." };
  }

  const chosen = choices[result.answerIndex];
  const entry = {
    answerId: chosen?.id ?? null,
    answerIndex: result.answerIndex,
    questionText: questionText.slice(0, 4000),
    source: result.source,
    confidence: result.confidence,
    reason: result.reason,
    modelId,
    verified: result.verified,
  };
  await putEntry(hash, entry);
  return { ok: true, entry };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OQS_SOLVE") return undefined;

  enqueue(() => solve(message.payload))
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));

  return true; // keep the message channel open for the async response
});
