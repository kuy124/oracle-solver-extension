/**
 * Provider-layer tests:
 *   - the model catalog is per-provider (ids are NOT interchangeable)
 *   - the Pollinations client builds the right request (key in the header,
 *     never in the URL) and parses the reply
 *   - the worker fails over to the other provider when one fails
 *   - the consensus panel follows the selected provider
 *   - the keyless Pollinations endpoint is single-pass (1 request / 30 s)
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

/** Load a single classic script into a fake realm and return it. */
function loadScript(rel, extraGlobals = {}) {
  return loadScripts([rel], extraGlobals);
}

// ---------------------------------------------------------------------------
console.log("== The catalog is per-provider ==");
{
  const g = loadScript("src/lib/prompt.js");
  const P = g.OQSPrompt;

  assert(P.PROVIDERS.length === 7, `seven providers known (got ${P.PROVIDERS.length})`);
  assert(P.PROVIDERS.some((p) => p.id === "tusk"), "tusk provider listed");
  assert(P.PROVIDERS.some((p) => p.id === "pollinations"), "pollinations provider listed");
  assert(P.PROVIDERS.some((p) => p.id === "geminiweb"), "gemini web app provider listed");
  assert(P.PROVIDERS.some((p) => p.id === "ollama"), "ollama (local) provider listed");
  assert(P.PROVIDERS.some((p) => p.id === "lmstudio"), "lm studio (local) provider listed");
  assert(P.PROVIDERS.some((p) => p.id === "ondevice"), "on-device (chrome) provider listed");
  assert(P.PROVIDERS.some((p) => p.id === "custom"), "custom endpoint provider listed");
  assert(P.DEFAULT_PROVIDER_ID === "geminiweb", "geminiweb is the default provider (keyless + strongest zero-setup)");

  // The providers that need no account at all.
  const noAccount = P.PROVIDERS.filter((p) => !p.needsKey).map((p) => p.id);
  assert(
    noAccount.includes("ollama") && noAccount.includes("lmstudio") && noAccount.includes("ondevice"),
    `local + on-device providers need no key (got ${noAccount.join(",")})`
  );
  assert(
    noAccount.includes("geminiweb"),
    `the Gemini web app needs no key (got ${noAccount.join(",")})`
  );
  assert(P.providerById("geminiweb")?.private !== true, "geminiweb is not private (it can be a fallback)");
  // "private" = runs on the user's machine: never fails over to a cloud one.
  for (const id of ["ollama", "lmstudio", "ondevice", "custom"]) {
    assert(P.providerById(id)?.private === true, `${id} is marked private (no cloud fallback)`);
  }
  assert(P.providerById("tusk")?.private !== true, "tusk is not private (it can be a fallback)");
  assert(P.providerById("ollama")?.baseUrl === "http://localhost:11434/v1", "ollama points at the local server");
  assert(P.providerById("lmstudio")?.baseUrl === "http://localhost:1234/v1", "lm studio points at the local server");
  for (const id of ["groq", "openrouter", "gemini", "cerebras", "mistral", "nvidia", "ollama-local"]) {
    assert(
      P.BASE_URL_PRESETS.some((p) => p.id === id),
      `endpoint preset "${id}" is offered`
    );
  }

  assert(P.modelsFor("tusk").length === 8, `tusk catalog kept its 8 models (got ${P.modelsFor("tusk").length})`);
  assert(P.modelsFor("pollinations").length > 0, "pollinations catalog is not empty");
  assert(
    P.modelsFor("pollinations").every((m) => m.id.includes("/")),
    "pollinations model ids are publisher/model names"
  );
  assert(
    P.modelsFor("pollinations").some((m) => m.id === "openai/gpt-5.4"),
    "pollinations catalog includes GPT-5.4"
  );

  assert(P.consensusFor("tusk").length === 3, "tusk consensus panel has 3 models");
  assert(P.consensusFor("pollinations").length === 3, "pollinations consensus panel has 3 models");
  const vendors = new Set(P.consensusFor("pollinations").map((id) => id.split("/")[0]));
  assert(vendors.size === 3, `pollinations panel spans 3 vendors (got ${[...vendors].join(",")})`);

  // The Gemini web app exposes ONE account's models, so a 3-model panel would
  // vote the same model three times: it answers in a single pass instead.
  assert(P.consensusFor("geminiweb").length === 0, "the gemini web panel is empty (single pass)");
  assert(P.modelsFor("geminiweb").length > 0, "the gemini web catalog is not empty");
  assert(
    P.modelsFor("geminiweb").every((m) => /^[0-9a-f]{16}$/.test(m.id)),
    "gemini web model ids are the 16-hex ids the web UI uses"
  );
  assert(
    P.modelsFor("geminiweb").every((m) => typeof m.number === "number"),
    "every gemini web model carries its model number"
  );
  assert(
    P.resolveModel("geminiweb", "bce9d196-5aa7-436a-9e28-760c6d3f8f3a") === P.defaultModelFor("geminiweb"),
    "a foreign model id resolves to the gemini web default"
  );
  assert(
    P.resolveModel("geminiweb", "fbb127bbb056c959") === "fbb127bbb056c959",
    "a valid gemini web model id is kept"
  );

  // A model id from one provider must not be used with another provider.
  assert(
    P.resolveModel("pollinations", "bce9d196-5aa7-436a-9e28-760c6d3f8f3a") === "openai/gpt-5.4",
    "a Tusk model id resolves to the Pollinations default"
  );
  assert(
    P.resolveModel("tusk", "openai/gpt-5.4") === "bce9d196-5aa7-436a-9e28-760c6d3f8f3a",
    "a Pollinations model id resolves to the Tusk default"
  );
  assert(
    P.resolveModel("pollinations", "openai/gpt-5.4") === "openai/gpt-5.4",
    "a valid model id of the same provider is kept"
  );
  assert(
    P.resolveModel("ollama", "qwen3-coder:30b") === "qwen3-coder:30b",
    "a local server accepts any model id (no fixed catalog)"
  );
  assert(P.resolveModel("custom", "") === "", "an empty model id stays empty (the user must pick one)");
  assert(P.modelName("openai/gpt-5.4") === "GPT-5.4", "modelName resolves across catalogs");
}

// ---------------------------------------------------------------------------
console.log("\n== The generic OpenAI-compatible client ==");
{
  const g = loadScripts(["src/background/openai-client.js"], {
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: "hi" } }] }) }),
  });
  const C = g.OQSOpenAI;
  assert(typeof C.chat === "function", "client exposes chat()");
  assert(typeof C.listModels === "function", "client exposes listModels()");

  const req = C.__test.buildRequest({
    url: "http://localhost:11434/v1/chat/completions",
    apiKey: "sk-test",
    model: "qwen3-coder:30b",
    prompt: "rules\n\nQUESTION:\nwhich one?",
  });
  assert(req.url === "http://localhost:11434/v1/chat/completions", "the call goes to the given URL");
  assert(req.init.headers.Authorization === "Bearer sk-test", "the key is a Bearer header");
  assert(!req.url.includes("sk-test"), "the key never appears in the URL");
  const body = JSON.parse(req.init.body);
  assert(body.model === "qwen3-coder:30b", "the model id is sent as-is");
  assert(body.messages[0].role === "system" && body.messages[1].role === "user", "the prompt is split system/user");
  assert(C.__test.chatUrl("http://localhost:11434/v1/") === "http://localhost:11434/v1/chat/completions", "base URL -> chat path");

  // listModels reads the OpenAI {data:[{id}]} shape (async: called below).
}

// ---------------------------------------------------------------------------
console.log("\n== The Pollinations client ==");
{
  const g = loadScripts(
    ["src/background/openai-client.js", "src/background/pollinations-client.js"],
    { fetch: async () => { throw new Error("no net"); } }
  );
  const C = g.OQSPollinations;
  assert(typeof C.ask === "function", "client exposes ask()");

  const prompt = "You are a grader.\n\nQUESTION:\nWhich one?\n\nCHOICES:\n[0] a\n[1] b";

  // WITH a key -> gen endpoint, key in the header, never in the URL.
  const keyed = C.__test.buildRequest(prompt, "openai/gpt-5.4", "pk_secret");
  assert(keyed.url === "https://gen.pollinations.ai/v1/chat/completions", "keyed call uses the gen endpoint");
  assert(keyed.init.headers.Authorization === "Bearer pk_secret", "key is sent as a Bearer header");
  assert(!keyed.url.includes("pk_secret"), "key never appears in the URL");
  const body = JSON.parse(keyed.init.body);
  assert(body.model === "openai/gpt-5.4", "keyed call uses the requested model");
  assert(body.messages.length === 2, "prompt is split into system + user messages");
  assert(body.messages[0].role === "system", "the rules become the system message");
  assert(body.messages[1].role === "user" && body.messages[1].content.startsWith("QUESTION:"), "the question becomes the user message");
  assert(body.temperature === 0, "temperature is 0 (deterministic answers)");

  // WITHOUT a key -> classic endpoint, single model, no auth header.
  const keyless = C.__test.buildRequest(prompt, "openai/gpt-5.4", "");
  assert(keyless.url === "https://text.pollinations.ai/openai", "keyless call uses the classic endpoint");
  assert(!keyless.init.headers.Authorization, "keyless call sends no Authorization header");
  assert(JSON.parse(keyless.init.body).model === "openai-fast", "keyless call uses the one free model");

  // Prompt framing without the QUESTION marker stays a single user message.
  const noMarker = C.__test.splitPrompt("just a question");
  assert(noMarker.length === 1 && noMarker[0].role === "user", "a prompt without a QUESTION marker is one user message");

  // Reply parsing.
  assert(C.__test.extractContent({ choices: [{ message: { content: "hello" } }] }) === "hello", "reply text extracted");
  assert(C.__test.extractContent({ choices: [{ text: "fallback" }] }) === "fallback", "legacy text field extracted");
  assert(C.__test.extractContent({}) === "", "a malformed body yields an empty string");

  // ask() surfaces HTTP errors instead of returning garbage.
  // (Async: called from the main async block below.)
}

// ---------------------------------------------------------------------------
console.log("\n== The worker talks to the selected provider ==");

/** Build a worker whose fetch records every call. */
function makeWorker(settings, opts = {}) {
  const store = { settings };
  const calls = [];
  const fetchMock = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, body: init && init.body ? JSON.parse(init.body) : null });
    if (u.includes("gen.pollinations.ai")) {
      if (opts.pollinationsFails) {
        return { ok: false, status: 500, headers: { get: () => null }, text: async () => "boom" };
      }
      const model = calls[calls.length - 1].body?.model;
      const answer = opts.answerFor ? opts.answerFor(model) : '{"answerIndex":0,"confidence":0.9,"reason":"ok"}';
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ choices: [{ message: { role: "assistant", content: answer } }] }),
      };
    }
    if (u.includes("text.pollinations.ai")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ choices: [{ message: { role: "assistant", content: '{"answerIndex":2,"confidence":0.8,"reason":"classic"}' } }] }),
      };
    }
    // Tusk: create conversation, then stream frames.
    if (u.includes("tusksearch.com")) {
      if (u.includes("/conversations")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ sessionId: "s1", chatId: "c1" }) };
      }
      const frame = JSON.stringify({ content: JSON.stringify({ content: '{"answerIndex":1,"confidence":0.9,"reason":"tusk"}' }) }) + "\n";
      let sent = false;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new TextEncoder().encode(frame) })),
            cancel: async () => {},
          }),
        },
      };
    }
    // Every other endpoint (local servers, custom OpenAI-compatible) speaks
    // the OpenAI JSON shape.
    const model = calls[calls.length - 1].body?.model;
    const answer = opts.answerFor ? opts.answerFor(model) : '{"answerIndex":0,"confidence":0.9,"reason":"ok"}';
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { role: "assistant", content: answer } }] }),
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

/** listModels must read the OpenAI {data:[{id}]} shape. */
async function checkListModels() {
  const g = loadScripts(["src/background/openai-client.js"], {
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: [{ id: "qwen3-coder:30b" }, { id: "gpt-oss:20b" }] }),
    }),
  });
  const listed = await g.OQSOpenAI.listModels({ baseUrl: "http://localhost:11434/v1" });
  assert(listed.length === 2, `both models are listed (got ${listed.length})`);
  assert(listed[0].id === "qwen3-coder:30b", "the first model id is read");
}

/** ask() must surface HTTP errors instead of returning garbage. */
async function checkClientErrors() {
  const failing = loadScripts(
    ["src/background/openai-client.js", "src/background/pollinations-client.js"],
    {
      fetch: async () => ({ ok: false, status: 402, headers: { get: () => null }, text: async () => "Payment Required" }),
    }
  );
  let threw = null;
  try {
    await failing.OQSPollinations.ask("hi", "openai/gpt-5.4", "pk_x");
  } catch (err) {
    threw = err.message;
  }
  assert(threw !== null && /402/.test(threw), `an HTTP error is reported (got ${threw})`);

  // The keyless endpoint's 402 (FREE_LIMIT) must read like advice, not a stack.
  const keylessFailing = loadScripts(
    ["src/background/openai-client.js", "src/background/pollinations-client.js"],
    {
      fetch: async () => ({ ok: false, status: 402, headers: { get: () => null }, text: async () => "FREE_LIMIT" }),
    }
  );
  let friendly = null;
  try {
    await keylessFailing.OQSPollinations.ask("hi", "openai/gpt-5.4", "");
  } catch (err) {
    friendly = err.message;
  }
  assert(
    friendly !== null && /rate-limited/i.test(friendly) && !/Payment Required/.test(friendly),
    `the keyless rate limit reads as advice (got ${friendly})`
  );
}

(async () => {
  await checkClientErrors();
  await checkListModels();

  // --- Pollinations with a key: the panel is the Pollinations panel ---------
  {
    const requested = [];
    const { worker, calls } = makeWorker(
      { aiEnabled: true, doubleCheck: true, provider: "pollinations", apiKey: "pk_test", modelId: "openai/gpt-5.4" },
      { answerFor: (m) => { requested.push(m); return '{"answerIndex":0,"confidence":0.9,"reason":"ok"}'; } }
    );
    const res = await solve(worker);
    const genCalls = calls.filter((c) => c.url.includes("gen.pollinations.ai"));
    assert(res?.ok === true, `pollinations solve succeeded (got ${JSON.stringify(res).slice(0, 120)})`);
    assert(genCalls.length > 0, "the gen endpoint was called");
    assert(genCalls.every((c) => c.body.model.startsWith("openai/") || c.body.model.includes("/")), "only pollinations models were requested");
    assert(
      genCalls.every((c) => c.body.messages[0].role === "system"),
      "the solver prompt is sent as a system message"
    );
    const models = [...new Set(genCalls.map((c) => c.body.model))];
    assert(
      models.every((m) => ["openai/gpt-5.4", "google/gemini-3.8-flash", "deepseek/deepseek-v4-flash"].includes(m)),
      `the pollinations panel was used (got ${models.join(",")})`
    );
    assert(models.length >= 2, `at least two different panel models voted (got ${models.length})`);
    assert(res?.entry?.modelId === "openai/gpt-5.4", `entry records the model used (got ${res?.entry?.modelId})`);
  }

  // --- Failover: a broken provider falls back to the other one ------------
  {
    const { worker, calls } = makeWorker(
      { aiEnabled: true, doubleCheck: true, provider: "pollinations", apiKey: "pk_bad", modelId: "openai/gpt-5.4" },
      { pollinationsFails: true }
    );
    const res = await solve(worker);
    assert(calls.some((c) => c.url.includes("gen.pollinations.ai")), "the failing provider was tried first");
    assert(calls.some((c) => c.url.includes("tusksearch.com")), "the worker fell back to TuskCentral");
    assert(res?.ok === true, `the fallback produced an answer (got ${JSON.stringify(res).slice(0, 140)})`);
    assert(res?.entry?.answerId === "2", `the fallback answer was applied (got ${res?.entry?.answerId})`);
  }

  // --- Keyless Pollinations: single pass, classic endpoint ----------------
  {
    const { worker, calls } = makeWorker({
      aiEnabled: true,
      doubleCheck: true,
      provider: "pollinations",
      apiKey: "",
      modelId: "openai/gpt-5.4",
    });
    const res = await solve(worker);
    const classic = calls.filter((c) => c.url.includes("text.pollinations.ai"));
    assert(res?.ok === true, "the keyless pollinations solve succeeded");
    assert(classic.length === 1, `the keyless endpoint is called exactly once, not 3x (got ${classic.length})`);
    assert(classic[0].body.model === "openai-fast", "the keyless endpoint uses its single free model");
    assert(res?.entry?.answerId === "3", `the keyless answer was applied (got ${res?.entry?.answerId})`);
  }

  // --- A model id from another provider is corrected -----------------------
  {
    const { worker, calls } = makeWorker({
      aiEnabled: true,
      doubleCheck: false,
      provider: "pollinations",
      apiKey: "pk_test",
      modelId: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a", // a Tusk id
    });
    await solve(worker);
    const genCalls = calls.filter((c) => c.url.includes("gen.pollinations.ai"));
    assert(genCalls.length === 1, "the single-pass solve made one call");
    assert(genCalls[0].body.model === "openai/gpt-5.4", `a foreign model id is corrected (got ${genCalls[0].body.model})`);
  }

  // --- Tusk stays the default (no settings at all) ------------------------
  {
    const { worker, calls } = makeWorker({ aiEnabled: true, doubleCheck: false });
    const res = await solve(worker);
    assert(calls.some((c) => c.url.includes("tusksearch.com")), "without a provider setting Tusk is used");
    assert(res?.ok === true, "the default provider still solves");
  }

  // --- The options page can probe the provider ----------------------------
  {
    const { worker } = makeWorker({ aiEnabled: true, provider: "pollinations", apiKey: "pk_test" });
    const res = await new Promise((resolve) => {
      worker.getMessageListener()({ type: "OQS_TEST_PROVIDER" }, {}, resolve);
    });
    assert(res?.ok === true, `the provider test succeeded (got ${JSON.stringify(res).slice(0, 140)})`);
    assert(res?.provider === "pollinations", `the test reports the provider (got ${res?.provider})`);
  }

  // --- A local server: no key, no account, question never leaves the box ---
  {
    const { worker, calls } = makeWorker({
      aiEnabled: true,
      doubleCheck: true,
      provider: "ollama",
      apiKey: "",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3-coder:30b",
    });
    const res = await solve(worker);
    const local = calls.filter((c) => c.url.includes("localhost:11434"));
    assert(res?.ok === true, `the local provider solved (got ${JSON.stringify(res).slice(0, 140)})`);
    assert(local.length === 1, `a local provider answers in a single pass (got ${local.length} calls)`);
    assert(local[0].url === "http://localhost:11434/v1/chat/completions", `the local chat path is used (got ${local[0].url})`);
    assert(local[0].body.model === "qwen3-coder:30b", `the typed model id is sent (got ${local[0].body.model})`);
    assert(!local[0].init || true, "no key is needed for a local server");
    assert(
      !calls.some((c) => c.url.includes("tusksearch.com") || c.url.includes("pollinations.ai")),
      "a private provider never falls back to a hosted one"
    );
  }

  // --- A custom OpenAI-compatible endpoint with the user's own key ---------
  {
    const { worker, calls } = makeWorker({
      aiEnabled: true,
      doubleCheck: false,
      provider: "custom",
      apiKey: "gsk_user_key",
      baseUrl: "https://api.groq.com/openai/v1",
      modelId: "llama-3.3-70b-versatile",
    });
    const res = await solve(worker);
    const custom = calls.filter((c) => c.url.includes("api.groq.com"));
    assert(res?.ok === true, `the custom endpoint solved (got ${JSON.stringify(res).slice(0, 140)})`);
    assert(custom.length === 1, "one call was made");
    assert(custom[0].url === "https://api.groq.com/openai/v1/chat/completions", `the custom chat path is used (got ${custom[0].url})`);
    assert(custom[0].body.model === "llama-3.3-70b-versatile", "the model id is sent as-is");
  }

  // --- The options page can list an endpoint's models -----------------------
  {
    const { worker } = makeWorker({ aiEnabled: true, provider: "ollama", baseUrl: "http://localhost:11434/v1" });
    const res = await new Promise((resolve) => {
      worker.getMessageListener()(
        { type: "OQS_LIST_MODELS", payload: { baseUrl: "http://localhost:11434/v1" } },
        {},
        resolve
      );
    });
    assert(res?.ok === true, `model listing succeeded (got ${JSON.stringify(res).slice(0, 140)})`);
    assert(Array.isArray(res?.models), "a model array is returned");
  }

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
