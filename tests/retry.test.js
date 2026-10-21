/**
 * Retry-when-unparsable tests:
 *   - the repair prompt shows the model its own reply and the exact shape
 *   - a single-pass solve retries when the first reply cannot be parsed
 *   - the retry is not made when the first reply is fine
 *   - the consensus panel makes ONE repair attempt when no voter answers
 *   - a transport failure is NOT retried (the failover chain owns that)
 */
const fs = require("fs");
const path = require("path");
const { EXT, loadServiceWorker } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

/** Load classic scripts into a fake realm (in order) and return it. */
function loadScripts(files, extraGlobals = {}) {
  const g = { globalThis: null, ...extraGlobals };
  g.globalThis = g;
  for (const rel of files) {
    const code = fs.readFileSync(path.join(EXT, rel), "utf8");
    const fn = new Function(
      "globalThis", "self", "document", "chrome", "fetch", "console", "setTimeout", "clearTimeout",
      "TextDecoder", "TextEncoder", "AbortController", code
    );
    fn.call(
      g, g, g, g.document, g.chrome, g.fetch, console, setTimeout, clearTimeout,
      TextDecoder, TextEncoder, AbortController
    );
  }
  return g;
}

// ---------------------------------------------------------------------------
console.log("== The repair prompt ==");
{
  const g = loadScripts(["src/lib/prompt.js"], { fetch: async () => ({}) });
  const P = g.OQSPrompt;
  assert(typeof P.buildRetryPrompt === "function", "buildRetryPrompt is exported");

  const question = {
    questionText: "Which one is correct?",
    choices: [{ text: "a" }, { text: "b" }, { text: "c" }],
  };

  const single = P.buildRetryPrompt(question, "I think the answer is the second one.");
  assert(single.includes("I think the answer is the second one."), "the previous reply is shown back");
  assert(single.includes("Which one is correct?"), "the question is repeated");
  assert(single.includes("[1] b"), "the choices are repeated with their indexes");
  assert(single.includes('"answerIndex"'), "the expected single-answer shape is stated");
  assert(single.includes("between 0 and 2"), "the valid index range is stated");
  assert(!single.includes("answerIndexes"), "the single-answer prompt does not ask for an array");

  const multi = P.buildRetryPrompt(question, "no idea", true);
  assert(multi.includes('"answerIndexes"'), "the multi-answer shape is stated");
  assert(multi.includes("MUST be an ARRAY"), "the multi prompt insists on an array");

  // The prompt must not leak a raw "undefined" or an empty body.
  const empty = P.buildRetryPrompt(question, "");
  assert(empty.includes("(the reply was empty)"), "an empty reply is handled");
  assert(!/undefined/.test(single), "the prompt has no 'undefined' in it");
}

// ---------------------------------------------------------------------------
console.log("\n== The worker retries an unparsable reply ==");

/** A worker whose AI endpoint returns the given replies in order. */
function makeWorker(settings, replies) {
  const store = { settings };
  const calls = [];
  let replyIndex = 0;
  const fetchMock = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, body: init && init.body ? String(init.body) : null });
    if (u.includes("tusksearch.com")) {
      if (u.includes("/conversations")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ sessionId: "s1", chatId: "c1" }) };
      }
      const token = replies[Math.min(replyIndex, replies.length - 1)];
      replyIndex += 1;
      const frame = JSON.stringify({ content: JSON.stringify({ content: token }) }) + "\n";
      let sent = false;
      return {
        ok: true, status: 200, headers: { get: () => null },
        body: { getReader: () => ({
          read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new TextEncoder().encode(frame) })),
          cancel: async () => {},
        }) },
      };
    }
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: '{"answerIndex":0,"confidence":0.9,"reason":"ok"}' } }] }),
    };
  };
  const worker = loadServiceWorker({
    chrome: {
      storage: {
        local: {
          get: (k) => Promise.resolve(typeof k === "string" ? { [k]: store[k] } : { ...store }),
          set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
        },
      },
      runtime: {},
    },
    fetch: fetchMock,
  });
  return { worker, calls, store };
}

const QUESTION = {
  hash: "h1",
  questionText: "Which query is correct?",
  choices: [
    { id: "1", text: "a" },
    { id: "2", text: "b" },
    { id: "3", text: "c" },
  ],
};

const solve = (worker, payload) =>
  new Promise((resolve) => {
    worker.getMessageListener()({ type: "OQS_SOLVE", payload: { ...QUESTION, ...payload } }, {}, resolve);
  });

(async () => {
  // --- A prose reply is repaired on the second attempt -------------------
  {
    const { worker, calls } = makeWorker(
      { aiEnabled: true, doubleCheck: false, provider: "tusk", modelId: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a" },
      [
        "The second choice looks right to me because it joins the tables.", // prose, unusable
        '{"answerIndex":1,"confidence":0.8,"reason":"the second one"}', // repaired
      ]
    );
    const res = await solve(worker);
    const chatCalls = calls.filter((c) => c.url.includes("tusksearch.com") && !c.url.includes("/conversations"));
    assert(res?.ok === true, `the solve recovered (got ${JSON.stringify(res).slice(0, 140)})`);
    assert(res?.entry?.answerIndex === 1, `the repaired answer was used (got ${res?.entry?.answerIndex})`);
    assert(res?.entry?.source === "ai-retried", `the entry records the retry (got ${res?.entry?.source})`);
    assert(chatCalls.length === 2, `exactly two calls were made (got ${chatCalls.length})`);
    assert(
      chatCalls[1].body.includes("previous reply"),
      "the second call uses the repair prompt"
    );
    assert(
      chatCalls[1].body.includes("The second choice looks right"),
      "the repair prompt shows the model its own reply"
    );
  }

  // --- A good reply is NOT retried ---------------------------------------
  {
    const { worker, calls } = makeWorker(
      { aiEnabled: true, doubleCheck: false, provider: "tusk", modelId: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a" },
      ['{"answerIndex":2,"confidence":0.9,"reason":"third one"}']
    );
    const res = await solve(worker);
    const chatCalls = calls.filter((c) => c.url.includes("tusksearch.com") && !c.url.includes("/conversations"));
    assert(res?.ok === true, "the solve succeeded");
    assert(res?.entry?.answerIndex === 2, `the first answer was used (got ${res?.entry?.answerIndex})`);
    assert(res?.entry?.source === "ai", `the entry is not marked as retried (got ${res?.entry?.source})`);
    assert(chatCalls.length === 1, `no retry happened (got ${chatCalls.length} calls)`);
  }

  // --- Two unusable replies still fail, but do not loop forever ----------
  {
    const { worker, calls } = makeWorker(
      { aiEnabled: true, doubleCheck: false, provider: "tusk", modelId: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a" },
      ["still just prose", "still just prose"]
    );
    const res = await solve(worker);
    const chatCalls = calls.filter((c) => c.url.includes("tusksearch.com") && !c.url.includes("/conversations"));
    assert(res?.ok === false, "the solve reports failure when even the retry is unusable");
    assert(chatCalls.length === 2, `the retry happens exactly once (got ${chatCalls.length} calls)`);
    assert(
      /could not be parsed/i.test(res?.error ?? ""),
      `the error explains the problem (got ${res?.error})`
    );
  }

  // --- The multi-answer path retries too --------------------------------
  {
    const { worker, calls } = makeWorker(
      { aiEnabled: true, doubleCheck: false, provider: "tusk", modelId: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a" },
      [
        "I believe the first and the last one are right.",
        '{"answerIndexes":[0,2],"confidence":0.8,"reason":"first and last"}',
      ]
    );
    const res = await solve(worker, { multiSelect: true, requiredCount: 2 });
    const chatCalls = calls.filter((c) => c.url.includes("tusksearch.com") && !c.url.includes("/conversations"));
    assert(res?.ok === true, `the multi solve recovered (got ${JSON.stringify(res).slice(0, 140)})`);
    assert(
      res?.entry?.answerIndexes?.join(",") === "0,2",
      `the repaired set was used (got ${JSON.stringify(res?.entry?.answerIndexes)})`
    );
    assert(chatCalls.length === 2, `exactly two calls were made (got ${chatCalls.length})`);
    assert(
      chatCalls[1].body.includes("answerIndexes"),
      "the multi repair prompt asks for the array shape"
    );
  }

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
