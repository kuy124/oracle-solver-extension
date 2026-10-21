/**
 * Gemini WEB client tests:
 *   - the length-prefixed frame parser (the marker counts the separator
 *     newline, and astral characters count as TWO UTF-16 units)
 *   - the answer text is extracted from the RPC envelope
 *   - the request payload has the right shape (f.req, at, the 81-slot array)
 *   - the worker dispatches to the Gemini client, in a SINGLE pass
 *   - the worker fails over to another provider when Gemini fails
 *   - the model id is the 16-hex id the web UI uses, with its model number
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
console.log("== The frame parser ==");
{
  const g = loadScripts(["src/background/gemini-web-client.js"], { fetch: async () => ({}) });
  const C = g.OQSGeminiWeb;
  assert(typeof C.ask === "function", "the client exposes ask()");
  assert(typeof C.listModels === "function", "the client exposes listModels()");

  const P = C.__test;

  /** Frame a payload the way Google does: the marker counts the separator
   *  newline PLUS the payload, measured in UTF-16 code units. */
  const frame = (payload) => `${payload.length + 1}\n${payload}`;

  // The real wire format: ")]}'" then "<len>\n<json>" frames. The length
  // marker counts the separator newline PLUS the JSON payload.
  const payload = '[["wrb.fr",null,"{}"]]';
  const framed = `)]}'\n\n${frame(payload)}`;
  const frames = P.parseFrames(framed);
  assert(frames.length === 1, `one frame parsed (got ${frames.length})`);
  assert(Array.isArray(frames[0]) && frames[0][0] === "wrb.fr", "the frame content is read");

  // Two frames back to back.
  const two = `)]}'\n\n${frame(payload)}${frame(payload)}`;
  assert(P.parseFrames(two).length === 2, "two frames parsed");

  // An astral character (emoji = 2 UTF-16 units) must not cut the frame short.
  const emojiPayload = '[["x","😀"]]';
  const emojiFrames = P.parseFrames(frame(emojiPayload));
  assert(emojiFrames.length === 1, `an emoji frame is parsed whole (got ${emojiFrames.length})`);
  assert(emojiFrames[0][1] === "😀", "the emoji survives the parse");

  // A malformed frame must not kill the rest of the stream.
  const broken = `)]}'\n\n${frame("{{{{{")}${frame(payload)}`;
  assert(P.parseFrames(broken).length >= 1, "a broken frame does not lose the good one");

  // No text -> no frames.
  assert(P.parseFrames("").length === 0, "empty input yields no frames");
  assert(P.parseFrames(")]}'\n\ngarbage").length === 0, "garbage yields no frames");
}

// ---------------------------------------------------------------------------
console.log("\n== The answer text is extracted ==");
{
  const g = loadScripts(["src/background/gemini-web-client.js"], { fetch: async () => ({}) });
  const P = g.OQSGeminiWeb.__test;

  // The reply shape: part[2] is a JSON string whose [4] holds the candidates,
  // and candidate[1][0] is the text.
  const inner = JSON.stringify({
    4: [["rc_1", ["{\"answerIndex\":1,\"confidence\":0.9,\"reason\":\"ok\"}"]]],
  });
  const frame = JSON.stringify([["wrb.fr", null, inner]]);
  const frames = P.parseFrames(`${frame.length + 1}\n${frame}`);
  assert(P.extractText(frames) === '{"answerIndex":1,"confidence":0.9,"reason":"ok"}', "the reply text is found");

  // A partial stream: a later, longer candidate wins.
  const inner2 = JSON.stringify({ 4: [["rc_1", ["short"]], ["rc_2", ["a longer reply"]]] });
  const frame2 = JSON.stringify([["wrb.fr", null, inner2]]);
  const frames2 = P.parseFrames(`${frame2.length + 1}\n${frame2}`);
  assert(P.extractText(frames2) === "a longer reply", "the longest candidate wins");

  // No candidates -> empty text.
  const empty = JSON.stringify([["x", null, "{}"]]);
  assert(P.extractText([]) === "", "no frames means no text");
  assert(P.extractText(P.parseFrames(`${empty.length + 1}\n${empty}`)) === "", "a frame without candidates means no text");
}

// ---------------------------------------------------------------------------
console.log("\n== The request payload ==");
{
  const g = loadScripts(["src/background/gemini-web-client.js"], { fetch: async () => ({}) });
  const P = g.OQSGeminiWeb.__test;

  const inner = P.buildRequestArray("hello", { language: "en" });
  assert(inner.length === 81, `the request array has 81 slots (got ${inner.length})`);
  assert(inner[0][0] === "hello", "the prompt is the first slot");
  assert(inner[1][0] === "en", "the language is slot 1");
  assert(inner[7] === 1, "the streaming flag is set");
  assert(inner[45] === null, "a normal chat is not marked temporary");
  const temp = P.buildRequestArray("hello", { language: "en", temporary: true });
  assert(temp[45] === 1, "a temporary chat is flagged");

  const body = P.buildBody("hello", { language: "en", accessToken: "AT", temporary: true });
  assert(body.startsWith("at=AT&f.req="), "the body carries at + f.req");
  const fReq = JSON.parse(new URLSearchParams(body).get("f.req"));
  assert(Array.isArray(fReq) && fReq[0] === null, "f.req is [null, <json>]");
  const parsedInner = JSON.parse(fReq[1]);
  assert(parsedInner.length === 81, "the embedded request array has 81 slots");
  assert(parsedInner[0][0] === "hello", "the embedded array carries the prompt");

  const query = P.buildQuery({ language: "en", buildLabel: "BL", sessionId: "SID" });
  assert(query.includes("hl=en"), "the query carries the language");
  assert(query.includes("bl=BL"), "the query carries the build label");
  assert(query.includes("f.sid=SID"), "the query carries the frontend session id");
  assert(P.buildQuery({ language: "en" }).includes("rt=c"), "the query carries rt=c");

  // The model header is the web UI's own model selector.
  const header = P.buildModelHeader({ modelId: "cf41b0e0dd7d53e5", capacity: 1, modelNumber: 6, sessionId: "SS" });
  const parsedHeader = JSON.parse(header);
  assert(parsedHeader[4] === "cf41b0e0dd7d53e5", "the model id is in the header");
  assert(parsedHeader[14] === 6, "the model number is in the header");
  assert(parsedHeader[parsedHeader.length - 1] === "SS", "the session id terminates the header");
}

// ---------------------------------------------------------------------------
console.log("\n== The worker talks to the Gemini web app ==");

/** Build a worker whose fetch records every call and answers like Gemini. */
function makeWorker(settings, opts = {}) {
  const store = { settings };
  const calls = [];
  const fetchMock = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init, body: init && init.body ? String(init.body) : null });
    if (u.includes("gemini.google.com/app")) {
      // The init page: build label, frontend session id, UI language.
      return {
        ok: true,
        status: 200,
        headers: { get: () => null, getSetCookie: () => [] },
        text: async () =>
          'window.WIZ_global_data={"cfb2h":"boq_test","FdrFJe":"-12345","TuX5cc":"en"};',
      };
    }
    if (u.includes("StreamGenerate")) {
      if (opts.geminiFails) {
        return { ok: false, status: 503, headers: { get: () => null }, text: async () => "unavailable" };
      }
      const answer = opts.answer ?? '{"answerIndex":1,"confidence":0.9,"reason":"gemini"}';
      const inner = JSON.stringify({ 4: [["rc_1", [answer]]] });
      const frame = JSON.stringify([["wrb.fr", null, inner]]);
      const body = `)]}'\n\n${frame.length + 1}\n${frame}`;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
    }
    if (u.includes("batchexecute")) {
      // The model-list RPC: GetUserStatus returns the account's models.
      // The real wire format wraps the RPC part in an outer array, and the
      // model item is POSITIONAL: [0]=hex id, [1]=category, [11]=display
      // name, [17]=model number.
      const modelItem = [];
      modelItem[0] = "cf41b0e0dd7d53e5"; // model id
      modelItem[1] = "Flash-Lite"; // category
      modelItem[2] = "Fastest answers"; // description
      modelItem[11] = "3.5 Flash-Lite"; // display name
      modelItem[17] = 6; // model number
      const partBody = JSON.stringify([6, [false, null, false], false, null, null, null, false, null, null, null, null, null, false, false, 1000, [modelItem]]);
      const part = JSON.stringify([["wrb.fr", "otAQ7b", partBody]]);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => `)]}'\n\n${part.length + 1}\n${part}`,
      };
    }
    // Every other endpoint speaks the OpenAI JSON shape.
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { role: "assistant", content: '{"answerIndex":0,"confidence":0.9,"reason":"other"}' } }] }),
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
  // --- Gemini solves, in a single pass ----------------------------------
  {
    const { worker, calls } = makeWorker({
      aiEnabled: true,
      doubleCheck: true,
      provider: "geminiweb",
      apiKey: "",
      modelId: "fbb127bbb056c959",
    });
    const res = await solve(worker);
    const gen = calls.filter((c) => c.url.includes("StreamGenerate"));
    assert(res?.ok === true, `the gemini solve succeeded (got ${JSON.stringify(res).slice(0, 140)})`);
    assert(gen.length === 1, `gemini answers in a single pass (got ${gen.length} calls)`);
    assert(res?.entry?.answerId === "2", `the gemini answer was applied (got ${res?.entry?.answerId})`);
    assert(res?.entry?.modelId === "fbb127bbb056c959", `the entry records the model (got ${res?.entry?.modelId})`);

    // The request carried the model header and the right body.
    const headers = gen[0].init.headers;
    const modelHeader = headers["x-goog-ext-525001261-jspb"];
    assert(typeof modelHeader === "string" && modelHeader.includes("fbb127bbb056c959"), "the model id is in the model header");
    assert(headers["Content-Type"].includes("x-www-form-urlencoded"), "the body is form-encoded");
    assert(gen[0].body.startsWith("at=&f.req="), "the body carries at + f.req");
    assert(gen[0].url.includes("bl=boq_test"), "the build label is in the query");
    assert(gen[0].url.includes("f.sid=-12345"), "the frontend session id is in the query");
  }

  // --- A guest session needs no key and no cookie ------------------------
  {
    const { worker, calls } = makeWorker({ aiEnabled: true, doubleCheck: false, provider: "geminiweb" });
    const res = await solve(worker);
    const gen = calls.filter((c) => c.url.includes("StreamGenerate"));
    assert(res?.ok === true, "a keyless gemini solve succeeded");
    assert(gen.length === 1, "one call was made");
    assert(!gen[0].init.headers.Authorization, "no Authorization header is sent");
    assert(gen[0].init.headers.Origin === "https://gemini.google.com", "the request is browser-shaped");
  }

  // --- Failover: Gemini down -> the next provider ------------------------
  {
    const { worker, calls } = makeWorker(
      { aiEnabled: true, doubleCheck: false, provider: "geminiweb", modelId: "fbb127bbb056c959" },
      { geminiFails: true }
    );
    const res = await solve(worker);
    assert(calls.some((c) => c.url.includes("StreamGenerate")), "gemini was tried first");
    assert(calls.some((c) => c.url.includes("tusksearch.com")), "the worker fell back to TuskCentral");
    assert(res?.ok === true, `the fallback produced an answer (got ${JSON.stringify(res).slice(0, 140)})`);
  }

  // --- With NO settings at all, the default provider is Gemini -----------
  {
    const { worker, calls } = makeWorker({ aiEnabled: true, doubleCheck: false });
    const res = await solve(worker);
    assert(calls.some((c) => c.url.includes("StreamGenerate")), "without a provider setting Gemini is used");
    assert(res?.ok === true, "the default provider still solves");
  }

  // --- The options page can list the Gemini models ------------------------
  {
    const { worker } = makeWorker({ aiEnabled: true, provider: "geminiweb" });
    const res = await new Promise((resolve) => {
      worker.getMessageListener()(
        { type: "OQS_LIST_MODELS", payload: { provider: "geminiweb" } },
        {},
        resolve
      );
    });
    assert(res?.ok === true, `model listing succeeded (got ${JSON.stringify(res).slice(0, 140)})`);
    assert(Array.isArray(res?.models), "a model array is returned");
    assert(res.models.length === 1, `one model was read (got ${res.models.length})`);
    assert(res.models[0].id === "cf41b0e0dd7d53e5", `the model id is read (got ${res.models[0].id})`);
    assert(res.models[0].name === "3.5 Flash-Lite", `the display name is read (got ${res.models[0].name})`);
    assert(res.models[0].number === 6, `the model number is read (got ${res.models[0].number})`);
  }

  // --- The options page can probe the provider ---------------------------
  {
    const { worker } = makeWorker({ aiEnabled: true, provider: "geminiweb" });
    const res = await new Promise((resolve) => {
      worker.getMessageListener()({ type: "OQS_TEST_PROVIDER" }, {}, resolve);
    });
    assert(res?.ok === true, `the provider test succeeded (got ${JSON.stringify(res).slice(0, 160)})`);
    assert(res?.provider === "geminiweb", `the test reports the provider (got ${res?.provider})`);
  }

  // --- A foreign model id is corrected to a Gemini model -----------------
  {
    const { worker, calls } = makeWorker({
      aiEnabled: true,
      doubleCheck: false,
      provider: "geminiweb",
      modelId: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a", // a Tusk id
    });
    await solve(worker);
    const gen = calls.filter((c) => c.url.includes("StreamGenerate"));
    const header = gen[0].init.headers["x-goog-ext-525001261-jspb"];
    assert(
      !header.includes("bce9d196"),
      `a foreign model id is corrected (got ${header.slice(0, 80)})`
    );
    assert(header.includes("fbb127bbb056c959"), "the gemini default model is used instead");
  }

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
