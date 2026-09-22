/**
 * Regression for the reported bug:
 *   "Uncaught SyntaxError: Unexpected token 'export'  at src/lib/hash.js:14"
 *
 * Proves EVERY shipped script is a valid CLASSIC script (no ESM import/export)
 * when parsed the way Chrome injects content scripts and loads a classic MV3
 * service worker, and that the worker wires up via importScripts() end-to-end.
 */
const fs = require("fs");
const path = require("path");
const { EXT, loadServiceWorker } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

const SHIPPED = [
  "src/lib/version.js",
  "src/lib/hash.js",
  "src/lib/prompt.js",
  "src/lib/answer-key.js",
  "src/lib/human.js",
  "src/content/scraper.js",
  "src/content/applier.js",
  "src/content/panel.js",
  "src/content/content.js",
  "src/background/tusk-client.js",
  "src/background/service-worker.js",
  "src/options/options.js",
];

(async () => {
  console.log("== No file has a UTF-8 BOM (fatal for manifest.json / confusing in JS) ==");
  {
    const all = fs
      .readdirSync(EXT, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    // Check manifest + all js/css/html in src and root.
    const targets = ["manifest.json"];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|css|html|json)$/.test(e.name)) targets.push(path.relative(EXT, p));
      }
    };
    walk(path.join(EXT, "src"));
    let bom = null;
    for (const rel of targets) {
      const buf = fs.readFileSync(path.join(EXT, rel));
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        bom = rel;
        break;
      }
    }
    assert(bom === null, "no BOM in manifest/src" + (bom ? ` (found in ${bom})` : ""));
    // And manifest must parse (a BOM breaks JSON.parse).
    let parsed = false;
    try {
      JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
      parsed = true;
    } catch {
      parsed = false;
    }
    assert(parsed, "manifest.json parses as JSON (no BOM)");
  }

  console.log("\n== No script contains top-level ESM import/export ==");
  for (const rel of SHIPPED) {
    const code = fs.readFileSync(path.join(EXT, rel), "utf8");
    const hasEsm = /^\s*(export\s|import\s)/m.test(code);
    assert(!hasEsm, `${rel} has no ESM import/export`);
  }

  console.log("\n== Every shipped script parses as a CLASSIC script ==");
  for (const rel of SHIPPED) {
    const code = fs.readFileSync(path.join(EXT, rel), "utf8");
    // new Function parses classic-script syntax; an `export` throws SyntaxError.
    let err = null;
    try {
      // eslint-disable-next-line no-new-func
      new Function("globalThis", "self", "document", "chrome", "importScripts", "fetch", code);
    } catch (e) {
      err = e.message;
    }
    assert(err === null, `${rel} parses as classic${err ? ` (${err})` : ""}`);
  }

  console.log("\n== src/lib/hash.js specifically (the file in the stack trace) ==");
  const hashCode = fs.readFileSync(path.join(EXT, "src/lib/hash.js"), "utf8");
  let hashErr = null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("globalThis", "TextEncoder", "crypto", hashCode + "\n;return globalThis.OQSHash;");
    const g = {};
    const OQSHash = fn(g, require("util").TextEncoder, require("crypto").webcrypto);
    assert(typeof OQSHash?.hashQuestion === "function", "hash.js exposes OQSHash.hashQuestion");
  } catch (e) {
    hashErr = e.message;
    assert(false, `hash.js parses + exposes global (${hashErr})`);
  }

  console.log("\n== Regression: double-loading a shared lib must NOT throw ==");
  // Reproduces:
  //   "Uncaught SyntaxError: Identifier 'buildSolverPrompt' has already been declared"
  // A shared global (same realm) evaluated twice must be idempotent (IIFE-wrapped,
  // internals scoped, only globalThis.<ns> reassigned).
  {
    const shared = ["src/lib/prompt.js", "src/lib/hash.js", "src/lib/answer-key.js", "src/lib/human.js", "src/background/tusk-client.js"];
    const realm = {};
    realm.globalThis = realm;
    realm.TextEncoder = require("util").TextEncoder;
    realm.crypto = require("crypto").webcrypto;
    realm.chrome = { storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } } };

    let threw = null;
    for (const rel of shared) {
      const code = fs.readFileSync(path.join(EXT, rel), "utf8");
      for (let pass = 1; pass <= 2; pass += 1) {
        try {
          // eslint-disable-next-line no-new-func
          const fn = new Function(
            "globalThis", "self", "document", "chrome", "fetch", "TextEncoder", "TextDecoder",
            "AbortController", "setTimeout", "clearTimeout", code
          );
          fn.call(
            realm, realm, realm, realm.document, realm.chrome, () => Promise.reject(new Error("no net")),
            realm.TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout
          );
        } catch (e) {
          threw = `${rel} (pass ${pass}): ${e.message}`;
          break;
        }
      }
      if (threw) break;
    }
    assert(threw === null, "loading each shared lib twice is harmless" + (threw ? ` -> ${threw}` : ""));
    assert(typeof realm.OQSPrompt?.buildSolverPrompt === "function", "OQSPrompt still valid after double-load");
    assert(typeof realm.OQSHash?.hashQuestion === "function", "OQSHash still valid after double-load");
    assert(typeof realm.OQSTusk?.ask === "function", "OQSTusk still valid after double-load");
  }

  console.log("\n== Build stamp is present and in sync with the manifest ==");
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
    const vcode = fs.readFileSync(path.join(EXT, "src/lib/version.js"), "utf8");
    const m = vcode.match(/OQS_VERSION\s*=\s*"([^"]+)"/);
    assert(m !== null, "version.js defines OQS_VERSION");
    assert(m && m[1] === manifest.version, `version.js (${m && m[1]}) matches manifest (${manifest.version})`);
    // version.js must be the FIRST content script and referenced by the worker.
    const cs = manifest.content_scripts[0];
    assert(cs.js[0] === "src/lib/version.js", "version.js is the first content script");
    const sw = fs.readFileSync(path.join(EXT, "src/background/service-worker.js"), "utf8");
    assert(
      sw.includes('"/src/lib/version.js"') && !sw.includes('"../lib/'),
      "service worker imports version.js via a root-absolute path"
    );
  }

  console.log("\n== Service worker loads via importScripts() (classic) ==");
  // In-memory chrome.storage backing for the worker, provided at load time so
  // answer-key.js captures the right chrome object.
  const store = {};
  const stubStorage = {
    local: {
      get: (k) => Promise.resolve(typeof k === "string" ? { [k]: store[k] } : { ...store }),
      set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
    },
  };
  let sw;
  try {
    sw = loadServiceWorker({
      chrome: { storage: stubStorage, runtime: {} },
      // Mock fetch so the AI path resolves deterministically (no network).
      fetch: async (url) => {
        if (String(url).includes("/conversations")) {
          return { ok: true, headers: { get: () => null }, json: async () => ({ sessionId: "s1", chatId: "c1" }) };
        }
        // Streaming chat endpoint: mimic the REAL wire format. Each object is
        // {"role":"assistant","content":"<json-string>"} where the inner JSON has
        // its own "content" field carrying the model token.
        const tokens = ['{"answerIndex": 3, "confidence": 0.9, "reason": "ok"}'];
        const frames = tokens.map((t) =>
          JSON.stringify({ role: "assistant", content: JSON.stringify({ isComplete: false, content: t }) }) + "\n"
        );
        let i = 0;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: {
            getReader: () => ({
              read: async () => (i < frames.length ? { done: false, value: new TextEncoder().encode(frames[i++]) } : { done: true }),
              cancel: async () => {},
            }),
          },
        };
      },
    });
  } catch (e) {
    sw = null;
    assert(false, `service worker loaded without error (${e.message})`);
  }

  if (sw) {
    assert(typeof sw.globals.OQSTusk?.ask === "function", "worker sees OQSTusk.ask (via importScripts)");
    assert(typeof sw.globals.OQSPrompt?.buildSolverPrompt === "function", "worker sees OQSPrompt");
    assert(typeof sw.globals.OQSKey?.getEntry === "function", "worker sees OQSKey");

    console.log("\n== Worker handles an OQS_SOLVE message end-to-end ==");
    const listener = sw.getMessageListener();
    assert(typeof listener === "function", "worker registered an onMessage listener");

    const payload = {
      hash: "testhash",
      questionText: "pick one",
      choices: [{ id: "1", text: "a" }, { id: "2", text: "b" }, { id: "3", text: "c" }, { id: "4", text: "d" }],
    };
    const response = await new Promise((resolve) => {
      const keep = listener({ type: "OQS_SOLVE", payload }, {}, resolve);
      assert(keep === true, "listener returns true (async channel kept open)");
    });
    assert(response?.ok === true, `solve resolved ok (${JSON.stringify(response).slice(0, 120)})`);
    assert(response?.entry?.answerId === "4", `answerIndex 3 -> choice id '4' (got ${response?.entry?.answerId})`);
    assert(
      Array.isArray(response?.entry?.answerIds) && response.entry.answerIds.join(",") === "4",
      `answerIndex 3 -> answerIds ['4'] (got ${JSON.stringify(response?.entry?.answerIds)})`
    );
    assert(
      typeof response?.entry?.source === "string" && response.entry.source.startsWith("ai"),
      `source is an AI consensus source (got ${response?.entry?.source})`
    );
    assert(store.answerKey?.testhash?.answerId === "4", "result persisted to the answer key");
    assert(
      Array.isArray(store.answerKey?.testhash?.answerIds) && store.answerKey.testhash.answerIds.join(",") === "4",
      "answerIds persisted alongside the legacy answerId"
    );
  }

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
