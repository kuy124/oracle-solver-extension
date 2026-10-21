/**
 * MV3 background service worker (CLASSIC worker, not a module).
 * Loads its dependencies via importScripts() so the shared libs stay plain
 * scripts (usable by both the content scripts and this worker).
 * Routes solve requests from the content script, does the CORS-bypassing
 * network work, and persists results to the answer key.
 * @module background/service-worker
 */

// Use extension-root-absolute paths ("/src/..."). Relative parent paths resolve
// inconsistently across Chrome versions and fail with "Failed to execute
// 'importScripts': ... failed to load", the most common way this worker breaks
// after an update. Absolute paths always resolve from the extension root.
importScripts(
  "/src/lib/version.js",
  "/src/lib/hash.js",
  "/src/lib/prompt.js",
  "/src/lib/answer-key.js",
  "/src/lib/human.js",
  "/src/background/openai-client.js",
  "/src/background/tusk-client.js",
  "/src/background/pollinations-client.js",
  "/src/background/gemini-web-client.js",
  "/src/background/ondevice-client.js"
);

// Fail loudly and clearly if a dependency did not wire up (e.g. a stale unpacked
// build that is missing a file), instead of a confusing downstream error.
if (!globalThis.OQSOpenAI || !globalThis.OQSTusk || !globalThis.OQSPollinations || !globalThis.OQSGeminiWeb || !globalThis.OQSonDevice || !globalThis.OQSPrompt || !globalThis.OQSKey) {
  console.error(
    "[OQS] A background dependency failed to load. Reload the extension " +
      "(chrome://extensions -> Reload) and, if it persists, remove + restart " +
      "Chrome + Load unpacked again. Missing: " +
      [
        !globalThis.OQSOpenAI && "OQSOpenAI",
        !globalThis.OQSTusk && "OQSTusk",
        !globalThis.OQSPollinations && "OQSPollinations",
        !globalThis.OQSGeminiWeb && "OQSGeminiWeb",
        !globalThis.OQSonDevice && "OQSonDevice",
        !globalThis.OQSPrompt && "OQSPrompt",
        !globalThis.OQSKey && "OQSKey",
      ]
        .filter(Boolean)
        .join(", ")
  );
}

const { chat: askOpenAI, listModels: listOpenAIModels } = globalThis.OQSOpenAI;
const { ask: askTusk } = globalThis.OQSTusk;
const { ask: askPollinations } = globalThis.OQSPollinations;
const { ask: askGeminiWeb } = globalThis.OQSGeminiWeb;
const { ask: askOnDevice } = globalThis.OQSonDevice;
const {
  buildSolverPrompt,
  parseSolverReply,
  buildVerifierPrompt,
  parseVerifierReply,
  buildMultiSolverPrompt,
  parseMultiSolverReply,
  buildMultiVerifierPrompt,
  parseMultiVerifierReply,
  buildMultiFillPrompt,
  PROVIDERS,
  DEFAULT_PROVIDER_ID,
  consensusFor,
  defaultModelFor,
  modelsFor,
  providerById,
  resolveModel,
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

// ---- Provider layer --------------------------------------------------------
//
// The extension can talk to more than one free AI backend. The user picks one
// in the options page; every request goes through the chosen provider and, if
// that provider fails (rate limit, network, dead endpoint), the next one is
// tried. TuskCentral is always in the chain, so a broken provider never leaves
// the user with no answer at all.

/**
 * The endpoint base URL for a provider. The user may override it in Options
 * (needed for the "custom" provider, useful to move a local server to another
 * port).
 * @param {string} providerId
 * @param {any} settings
 */
function baseUrlFor(providerId, settings) {
  const provider = providerById(providerId);
  const url = String(settings?.baseUrl ?? "").trim() || provider?.baseUrl || "";
  if (!url) throw new Error("No endpoint URL is set for this provider.");
  return url;
}

/**
 * Ask ONE provider. Throws on failure so the caller can fail over.
 * @param {string} providerId
 * @param {string} prompt
 * @param {string} modelId   a model id OF THAT PROVIDER
 * @param {any} settings
 * @returns {Promise<string>}
 */
async function askProvider(providerId, prompt, modelId, settings) {
  switch (providerId) {
    case "pollinations":
      return askPollinations(prompt, modelId, settings?.apiKey);
    case "geminiweb":
      // The Gemini web app needs the model's internal number alongside its
      // hex id, so look it up in this provider's catalog.
      return askGeminiWeb(prompt, geminiWebModel(modelId));
    case "ollama":
    case "lmstudio":
    case "custom":
      return askOpenAI({
        baseUrl: baseUrlFor(providerId, settings),
        apiKey: settings?.apiKey,
        model: modelId,
        prompt,
      });
    case "ondevice":
      // Never let a solve silently start a multi-GB model download.
      return askOnDevice(prompt, { allowDownload: false });
    case "tusk":
      return askTusk(prompt, modelId);
    default:
      // Never fall through to another backend with a foreign model id: the
      // backend would reject it. Fail over instead.
      throw new Error(`Unknown AI provider: ${providerId}`);
  }
}

/**
 * The Gemini web client needs a model id AND its number; look both up in the
 * provider catalog. An unknown id falls back to the provider default.
 * @param {string} modelId
 * @returns {{ modelId: string, modelNumber: number }}
 */
function geminiWebModel(modelId) {
  const list = modelsFor("geminiweb");
  const chosen = list.find((m) => m.id === modelId) ?? list.find((m) => m.id === defaultModelFor("geminiweb"));
  return { modelId: chosen?.id ?? modelId, modelNumber: chosen?.number ?? 1 };
}

/**
 * The provider chain for the current settings: the chosen provider first, then
 * every other HOSTED provider as a fallback. A "private" provider (local
 * server, on-device AI, custom endpoint) never falls back to a hosted one —
 * the question must not leave the machine the user chose.
 * @param {any} settings
 * @returns {string[]}
 */
function providerChain(settings) {
  const primary = settings?.provider || DEFAULT_PROVIDER_ID;
  if (providerById(primary)?.private) return [primary];
  return [
    primary,
    ...PROVIDERS.map((p) => p.id).filter((id) => id !== primary && defaultModelFor(id)),
  ];
}

/**
 * Ask the AI, failing over to the next provider when the current one fails.
 * @param {string} prompt
 * @param {string} modelId   the preferred model of the PRIMARY provider
 * @param {any} settings
 * @returns {Promise<string>}
 */
async function ask(prompt, modelId, settings) {
  const primary = settings?.provider || DEFAULT_PROVIDER_ID;
  let lastError = null;
  for (const providerId of providerChain(settings)) {
    // The preferred model belongs to the primary provider; a fallback provider
    // gets its own default model (ids are not interchangeable).
    const id =
      providerId === primary ? resolveModel(providerId, modelId) : defaultModelFor(providerId);
    try {
      return await askProvider(providerId, prompt, id, settings);
    } catch (err) {
      lastError = err;
      console.warn(`[OQS] provider "${providerId}" failed: ${err?.message ?? err}`);
    }
  }
  throw lastError ?? new Error("No AI provider is available");
}

/**
 * Can this provider run a 3-model consensus?
 *  - The keyless Pollinations endpoint allows 1 request / 30 s per IP, so a
 *    panel would take minutes: there we use a single pass.
 *  - On-device AI and local/custom endpoints have no fixed panel: single pass.
 * @param {string} providerId
 * @param {any} settings
 */
function canVote(providerId, settings) {
  if (providerId === "pollinations" && !String(settings?.apiKey ?? "").trim()) return false;
  if (providerId === "ondevice") return false;
  if (consensusFor(providerId).length < 2) return false;
  return true;
}

/**
 * @typedef {Object} SolveRequest
 * @property {string} hash
 * @property {string} questionText
 * @property {Array<{ id: string, text: string }>} choices
 * @property {boolean} [forceAi]
 * @property {boolean} [multiSelect]   true when the question expects >1 answer
 * @property {number|null} [requiredCount] how many answers the question asks for
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
 * @param {any} settings            provider + API key from the options page
 * @returns {Promise<{ answerIndex: number, confidence: number, reason: string, source: string, verified: boolean } | null>}
 */
async function solveConsensus(question, preferredModelId, settings) {
  const n = question.choices.length;
  const valid = (p) => p && Number.isInteger(p.answerIndex) && p.answerIndex >= 0 && p.answerIndex < n;
  const providerId = settings?.provider || DEFAULT_PROVIDER_ID;

  // Build the voter panel: preferred model first, then the rest of THIS
  // provider's panel (model ids are provider-specific).
  const panel = [preferredModelId || defaultModelFor(providerId), ...consensusFor(providerId)].filter(
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
      parsed = parseSolverReply(await ask(solverPrompt, voters[i], settings));
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

  // A single valid reply is not a majority; send it through the verifier path.
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
  if (picks.length >= 2 && bestCount >= majorityThreshold) {
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
    verdict = parseVerifierReply(await ask(buildVerifierPrompt(question, primary.answerIndex), defaultModelFor(providerId), settings));
  } catch {
    verdict = null;
  }
  if (valid(verdict) && verdict.answerIndex === primary.answerIndex) {
    return {
      answerIndex: primary.answerIndex,
      confidence: verdict.confidence || primary.confidence || 0,
      reason: verdict.reason || primary.reason || "verifier confirmed the leading answer",
      source: "ai-verified",
      verified: true,
    };
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
 * Solve a MULTI-SELECT question with the same 3-model panel, but vote PER CHOICE.
 *
 * Each model returns a SET of indexes. A choice is included in the final answer
 * when a MAJORITY of the returned voters selected it. This is more robust than
 * voting over whole sets: a model that misses one choice still corroborates the
 * others. The stated count ("choose two") is NOT enforced: we never add a choice
 * that the models did not vote for, so a wrong choice is never padded in.
 *
 * @param {{ questionText: string, choices: Array<{id:string,text:string}> }} question
 * @param {number|null} requiredCount
 * @param {string} preferredModelId
 * @param {any} settings
 * @returns {Promise<{ answerIndexes: number[], confidence: number, reason: string, source: string, verified: boolean } | null>}
 */
async function solveConsensusMulti(question, requiredCount, preferredModelId, settings) {
  const n = question.choices.length;
  const valid = (p) =>
    p && Array.isArray(p.answerIndexes) && p.answerIndexes.length > 0 && p.answerIndexes.every((i) => i >= 0 && i < n);
  const providerId = settings?.provider || DEFAULT_PROVIDER_ID;

  const panel = [preferredModelId || defaultModelFor(providerId), ...consensusFor(providerId)].filter(
    (id, i, arr) => id && arr.indexOf(id) === i
  );
  const voters = panel.slice(0, 3);

  const solverPrompt = buildMultiSolverPrompt(question, requiredCount);

  /** Per-choice vote count and the best confidence/reason seen per set. */
  const choiceVotes = new Array(n).fill(0); // index -> how many voters picked it
  let voterCount = 0;
  const parsedSets = [];
  let bestConf = 0;
  let bestReason = "";

  // Sequential with pacing (free endpoint is rate-limited per minute).
  for (let i = 0; i < voters.length; i += 1) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700));
    let parsed = null;
    try {
      parsed = parseMultiSolverReply(await ask(solverPrompt, voters[i], settings));
    } catch {
      parsed = null;
    }
    if (!valid(parsed)) continue;
    voterCount += 1;
    parsedSets.push(parsed);
    for (const idx of parsed.answerIndexes) choiceVotes[idx] += 1;
    if ((parsed.confidence || 0) > bestConf) {
      bestConf = parsed.confidence || 0;
      bestReason = parsed.reason || "";
    }
  }

  if (voterCount === 0) return null;

  // Majority threshold over the voters that actually returned a set. A single
  // surviving voter is NOT a majority of the panel, so we require the count to be
  // met by real votes and let the verifier help below.
  const majority = Math.floor(voterCount / 2) + 1;
  let indexes = [];
  for (let i = 0; i < n; i += 1) {
    if (choiceVotes[i] >= majority) indexes.push(i);
  }

  // Only ONE voter returned a set: its picks are not corroborated by anyone, so
  // treat this like a no-majority case and let the verifier confirm (or correct)
  // the whole set instead of trusting a lone model.
  let noMajority = false;
  if (voterCount < 2 || indexes.length === 0) {
    noMajority = true;
    const union = new Set();
    for (const s of parsedSets) for (const idx of s.answerIndexes) union.add(idx);
    indexes = [...union].sort((a, b) => a - b);
  }

  // Verifier: confirm/tighten the set. A single verifier cannot flip a clean
  // majority, but it can fix the no-majority case and catch a missing/extra pick.
  let verdict = null;
  try {
    verdict = parseMultiVerifierReply(
      await ask(buildMultiVerifierPrompt(question, indexes), defaultModelFor(providerId), settings)
    );
  } catch {
    verdict = null;
  }

  let finalIndexes = indexes;
  let confidence = bestConf;
  let reason = bestReason;
  let source = "ai-consensus";
  let verified = true;

  if (verdict && valid(verdict) && (noMajority || verdict.answerIndexes.join(",") !== indexes.join(","))) {
    // Trust the verifier when there was no majority; when there WAS a majority,
    // only adopt a changed set if the verifier is confident.
    if (noMajority || (verdict.confidence || 0) >= 0.8) {
      finalIndexes = verdict.answerIndexes;
      confidence = verdict.confidence || bestConf || 0.7;
      reason = verdict.reason || reason || "verifier-tightened set";
      source = "ai-consensus-verified";
    }
  }

  // COUNT ENFORCEMENT: a "choose two" question must not submit a single answer.
  // When we know how many answers the question needs and the set is short:
  //   1. add the best-supported remaining choices the panel already voted for, then
  //   2. if still short, ask a focused "which other choice also belongs" pass.
  // We NEVER add a choice that no signal supports.
  if (requiredCount && requiredCount > 0 && finalIndexes.length < requiredCount) {
    const have = new Set(finalIndexes);
    const ranked = [];
    for (let i = 0; i < n; i += 1) {
      if (have.has(i)) continue;
      const voted = choiceVotes[i] > 0;
      const verifierPicked = Boolean(verdict && valid(verdict) && verdict.answerIndexes.includes(i));
      if (voted || verifierPicked) ranked.push({ i, score: choiceVotes[i] + (verifierPicked ? 0.5 : 0) });
    }
    ranked.sort((a, b) => b.score - a.score || a.i - b.i);
    for (const { i } of ranked) {
      if (finalIndexes.length >= requiredCount) break;
      finalIndexes.push(i);
    }
    if (ranked.length > 0 && finalIndexes.length >= requiredCount) {
      source = source === "ai-consensus" ? "ai-consensus-padded" : source;
      if (!reason) reason = `Completed to ${requiredCount} answers from the panel votes.`;
    }

    // Still short: ask the model which OTHER choice(s) also belong.
    let guard = 0;
    while (finalIndexes.length < requiredCount && guard < 2) {
      guard += 1;
      const need = requiredCount - finalIndexes.length;
      let fill = null;
      try {
        fill = parseMultiSolverReply(await ask(buildMultiFillPrompt(question, finalIndexes, need), defaultModelFor(providerId), settings));
      } catch {
        fill = null;
      }
      if (!fill) break;
      let added = false;
      for (const i of fill.answerIndexes) {
        if (i >= 0 && i < n && !finalIndexes.includes(i) && finalIndexes.length < requiredCount) {
          finalIndexes.push(i);
          added = true;
        }
      }
      if (!added) break;
    }
    if (finalIndexes.length >= requiredCount) {
      source = "ai-consensus-filled";
      if (!reason) reason = `Filled to ${requiredCount} answers after the panel under-selected.`;
    }
    finalIndexes = [...new Set(finalIndexes)].sort((a, b) => a - b);
  }

  if (finalIndexes.length === 0) return null;

  const everyMajority = finalIndexes.every((i) => choiceVotes[i] >= majority);
  const baseConf = everyMajority ? Math.max(bestConf, 0.85) : confidence;

  return {
    answerIndexes: finalIndexes,
    confidence: Math.min(0.99, baseConf || 0.7),
    reason: reason || `Selected by the ${voterCount}-model panel.`,
    source,
    verified,
  };
}

/**
 * @param {SolveRequest} req
 * @returns {Promise<{ ok: boolean, entry?: any, error?: string }>}
 */
async function solve(req) {
  const { hash, questionText, choices, forceAi = false, multiSelect = false, requiredCount = null } = req;

  if (!forceAi) {
    const cached = await getEntry(hash);
    if (cached) return { ok: true, entry: { ...cached, source: cached.source ?? "key" } };
  }

  const settings = await loadSettings();
  if (!settings.aiEnabled) {
    return { ok: false, error: "AI fallback is disabled and no cached answer exists." };
  }

  const providerId = settings.provider || DEFAULT_PROVIDER_ID;
  // A model id belongs to one provider; a stale/foreign id falls back to this
  // provider's default instead of being sent to the backend.
  const modelId = resolveModel(providerId, settings.modelId);
  const question = { questionText, choices };

  if (multiSelect) {
    return solveMulti({ hash, questionText, choices, question, modelId, settings, requiredCount });
  }

  let result;
  if (settings.doubleCheck !== false && canVote(providerId, settings)) {
    result = await solveConsensus(question, modelId, settings);
  } else {
    // Single-pass mode (faster, lower accuracy).
    try {
      const parsed = parseSolverReply(await ask(buildSolverPrompt(question), modelId, settings));
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
    answerIds: chosen?.id ? [chosen.id] : [],
    answerIndex: result.answerIndex,
    answerIndexes: [result.answerIndex],
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

/**
 * Solve a multi-select question and persist the resulting set.
 * @param {{ hash: string, questionText: string, choices: any[], question: any, modelId: string, settings: any, requiredCount: number|null }} ctx
 * @returns {Promise<{ ok: boolean, entry?: any, error?: string }>}
 */
async function solveMulti(ctx) {
  const { hash, questionText, choices, question, modelId, settings, requiredCount } = ctx;

  let result;
  if (settings.doubleCheck !== false && canVote(settings.provider || DEFAULT_PROVIDER_ID, settings)) {
    result = await solveConsensusMulti(question, requiredCount, modelId, settings);
  } else {
    try {
      const parsed = parseMultiSolverReply(await ask(buildMultiSolverPrompt(question, requiredCount), modelId, settings));
      result = parsed
        ? { answerIndexes: parsed.answerIndexes, confidence: parsed.confidence, reason: parsed.reason, source: "ai", verified: false }
        : null;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!result || !Array.isArray(result.answerIndexes) || result.answerIndexes.length === 0) {
    return { ok: false, error: "The AI reply could not be parsed into an answer set." };
  }

  const answerIndexes = result.answerIndexes.filter((i) => i >= 0 && i < choices.length);
  if (answerIndexes.length === 0) {
    return { ok: false, error: "The AI answer set did not match any choice." };
  }

  const answerIds = answerIndexes.map((i) => choices[i]?.id).filter(Boolean);
  const entry = {
    // Legacy scalar fields (first element) keep older readers working.
    answerId: answerIds[0] ?? null,
    answerIndex: answerIndexes[0],
    // Canonical multi-answer fields.
    answerIds,
    answerIndexes,
    multiSelect: true,
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

/**
 * Probe the configured provider with one tiny request (the options page
 * "Test provider" button). Runs outside the solve queue so a test is never
 * blocked by a running solve.
 * @returns {Promise<{ ok: boolean, provider: string, model: string, reply?: string, error?: string }>}
 */
async function testProvider() {
  const settings = await loadSettings();
  const providerId = settings.provider || DEFAULT_PROVIDER_ID;
  const modelId = resolveModel(providerId, settings.modelId);
  try {
    // The on-device model is allowed to start its download here (the user
    // pressed the button); a normal solve never does.
    const reply =
      providerId === "ondevice"
        ? await askOnDevice(
            'Reply with only this JSON: {"answerIndex":0,"confidence":1,"reason":"ok"}',
            { allowDownload: true }
          )
        : await ask(
            'Reply with only this JSON: {"answerIndex":0,"confidence":1,"reason":"ok"}',
            modelId,
            settings
          );
    return { ok: true, provider: providerId, model: modelId, reply: String(reply).slice(0, 120) };
  } catch (err) {
    return {
      ok: false,
      provider: providerId,
      model: modelId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * List the models an endpoint offers (options page "Detect models" button).
 * @param {{ baseUrl?: string, apiKey?: string, provider?: string }} opts
 */
async function listModels(opts) {
  const baseUrl = String(opts?.baseUrl ?? "").trim();
  // The Gemini web app has no OpenAI-compatible /models endpoint: its model
  // list comes from its own RPC instead.
  if (opts?.provider === "geminiweb") return globalThis.OQSGeminiWeb.listModels();
  if (!baseUrl) throw new Error("No endpoint URL given.");
  return listOpenAIModels({ baseUrl, apiKey: opts?.apiKey });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OQS_TEST_PROVIDER") {
    testProvider()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true; // keep the message channel open for the async response
  }

  if (message?.type === "OQS_LIST_MODELS") {
    listModels(message.payload)
      .then((models) => sendResponse({ ok: true, models }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (message?.type !== "OQS_SOLVE") return undefined;

  enqueue(() => solve(message.payload))
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));

  return true; // keep the message channel open for the async response
});
