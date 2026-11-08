const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EXT } = require("./harness");

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
  const data = {};
  let listener;
  const context = vm.createContext({
    console, setTimeout, clearTimeout, TextEncoder, TextDecoder, AbortController,
    crypto: require("node:crypto").webcrypto,
    fetch: () => { throw new Error("Offline Firefox test must not fetch"); },
    browser: {
      storage: { local: {
        async get(key) { return { [key]: data[key] }; },
        async set(value) { Object.assign(data, value); },
      } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    },
  });
  assert.equal(manifest.background.scripts.at(-1), manifest.background.service_worker);
  for (const file of manifest.background.scripts) {
    vm.runInContext(fs.readFileSync(path.join(EXT, file), "utf8"), context, { filename: file });
  }
  assert.equal(typeof listener, "function", "Firefox background registers messaging without importScripts or chrome");
  await context.OQSKey.saveSettings({ aiEnabled: false });
  assert.equal((await context.OQSKey.loadSettings()).aiEnabled, false);
  const reply = await new Promise((resolve) => {
    assert.equal(listener({ type: "OQS_SOLVE", payload: {
      hash: "firefox-offline", questionText: "SELECT 1", choices: [{ id: "1", text: "1" }],
    } }, {}, resolve), true);
  });
  assert.equal(typeof reply.ok, "boolean", "Firefox responds through the message channel");
  console.log("PASS: Firefox background scripts, browser storage, and messaging");
})().catch((error) => { console.error(error); process.exitCode = 1; });
