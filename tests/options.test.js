/**
 * Options-page tests: presets, toggles, sliders, autopilot sub-row gating, and
 * that changes persist to chrome.storage.local.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const EXT = path.resolve(__dirname, "..");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Build the options page with real DOM + chrome.storage + the lib globals. */
function makeOptions() {
  const html = fs.readFileSync(path.join(EXT, "src/options/options.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://oqs.test/" });
  const { window } = dom;

  const store = {};
  window.chrome = {
    storage: {
      local: {
        get: (k) => Promise.resolve(typeof k === "string" ? { [k]: store[k] } : { ...store }),
        set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
      },
    },
  };
  window.confirm = () => true; // auto-accept confirm dialogs
  window.navigator.clipboard = { writeText: () => Promise.resolve() };
  window.OQS_VERSION = "test";

  // Load the lib scripts verbatim (classic) into the window.
  for (const rel of ["src/lib/version.js", "src/lib/prompt.js", "src/lib/answer-key.js"]) {
    const code = fs.readFileSync(path.join(EXT, rel), "utf8");
    const fn = new Function("globalThis", "chrome", "window", "navigator", code);
    fn.call(window, window, window.chrome, window, window.navigator);
  }
  // Load the options controller.
  const optCode = fs.readFileSync(path.join(EXT, "src/options/options.js"), "utf8");
  const optFn = new Function("globalThis", "chrome", "window", "document", "navigator", "confirm", "console", optCode);
  optFn.call(window, window, window.chrome, window, window.document, window.navigator, window.confirm, console);

  return { window, store };
}

(async () => {
  console.log("== Options page loads + reflects defaults ==");
  const { window, store } = makeOptions();
  const doc = window.document;
  await tick(150);

  const ver = doc.getElementById("verTag").textContent;
  assert(/^v\d+\.\d+\.\d+$/.test(ver), `version tag rendered (got "${ver}")`);
  assert(doc.getElementById("modelId").options.length > 0, "model dropdown populated");
  assert(doc.getElementById("provider").options.length === 7, "provider dropdown lists every provider");
  assert(doc.getElementById("provider").value === "geminiweb", "the Gemini web app is the default provider");
  assert(doc.getElementById("apiKey").disabled === true, "API-key field disabled while the provider needs no key");
  assert(doc.getElementById("baseUrlRow").style.display === "none", "endpoint row hidden for a provider without one");
  assert(doc.getElementById("presetSafe").classList.contains("active"), "Suggest-only preset highlighted by default");
  assert(doc.getElementById("aiEnabled").checked === true, "AI fallback defaults ON");

  console.log("\n== Toggle persists to storage ==");
  const dc = doc.getElementById("doubleCheck");
  dc.checked = false;
  dc.dispatchEvent(new window.Event("change"));
  await tick(50);
  assert(store.settings.doubleCheck === false, "double-check toggle saved to storage");

  console.log("\n== Preset: Full auto sets autopilot + complete ==");
  doc.getElementById("presetFull").click();
  await tick(120);
  assert(store.settings.autopilot === true, "Full auto -> autopilot ON");
  assert(store.settings.autopilotComplete === true, "Full auto -> complete ON");
  assert(doc.getElementById("presetFull").classList.contains("active"), "Full auto preset highlighted");
  assert(doc.getElementById("autopilot").checked === true, "autopilot checkbox reflected");

  console.log("\n== Autopilot sub-rows enabled when autopilot is on ==");
  assert(doc.getElementById("minConfRow").querySelector("input").disabled === false, "min-confidence enabled");
  assert(doc.getElementById("delayRow").querySelector("input").disabled === false, "delay enabled");

  console.log("\n== Preset: Suggest only turns autopilot off ==");
  doc.getElementById("presetSafe").click();
  await tick(120);
  assert(store.settings.autopilot === false, "Suggest only -> autopilot OFF");
  assert(store.settings.autoApply === false, "Suggest only -> autoApply OFF");

  console.log("\n== Preset: Auto-fill sets autoApply without autopilot ==");
  doc.getElementById("presetAuto").click();
  await tick(120);
  assert(store.settings.autoApply === true, "Auto-fill -> autoApply ON");
  assert(store.settings.autopilot === false, "Auto-fill -> autopilot OFF");
  assert(doc.getElementById("presetAuto").classList.contains("active"), "Auto-fill preset highlighted");

  console.log("\n== Autopilot OFF dims + disables sub-rows ==");
  assert(doc.getElementById("minConfRow").querySelector("input").disabled === true, "min-confidence disabled when autopilot off");
  assert(doc.getElementById("autopilotComplete").disabled === true, "complete-toggle disabled when autopilot off");

  console.log("\n== Slider syncs with number input ==");
  const range = doc.getElementById("minConfRange");
  range.value = "0.75";
  range.dispatchEvent(new window.Event("input"));
  await tick(40);
  assert(doc.getElementById("autopilotMinConfidence").value === "0.75", "number mirrors slider");
  assert(store.settings.autopilotMinConfidence === 0.75, "slider value persisted");

  const num = doc.getElementById("autopilotDelayMs");
  num.value = "2500";
  num.dispatchEvent(new window.Event("change"));
  await tick(40);
  assert(store.settings.autopilotDelayMs === 2500, "delay number persisted");
  assert(doc.getElementById("delayRange").value === "2500", "delay slider mirrors number");

  console.log("\n== Model change persists ==");
  const sel = doc.getElementById("modelId");
  sel.value = sel.options[sel.options.length - 1].value;
  const picked = sel.value;
  sel.dispatchEvent(new window.Event("change"));
  await tick(40);
  assert(store.settings.modelId === picked, "model selection persisted");

  console.log("\n== Switching provider swaps the model list ==");
  const tuskModels = [...sel.options].map((o) => o.value);
  const prov = doc.getElementById("provider");
  prov.value = "pollinations";
  prov.dispatchEvent(new window.Event("change"));
  await tick(80);
  const newModels = [...doc.getElementById("modelId").options].map((o) => o.value);
  assert(store.settings.provider === "pollinations", "provider persisted");
  assert(newModels.length !== tuskModels.length, "the model list changed with the provider");
  assert(newModels.every((m) => m.includes("/")), "the new list holds pollinations model ids");
  assert(store.settings.modelId === newModels[0], `the model id was reset to the new provider's (got ${store.settings.modelId})`);
  assert(doc.getElementById("apiKey").disabled === false, "API-key field enabled for a provider that needs one");

  console.log("\n== API key persists ==");
  const key = doc.getElementById("apiKey");
  key.value = "pk_test_key";
  key.dispatchEvent(new window.Event("change"));
  await tick(60);
  assert(store.settings.apiKey === "pk_test_key", "API key saved to storage");
  assert(doc.getElementById("apiKey").getAttribute("type") === "password", "API key field is masked");

  console.log("\n== A local provider needs no key and takes a typed model id ==");
  const prov2 = doc.getElementById("provider");
  prov2.value = "ollama";
  prov2.dispatchEvent(new window.Event("change"));
  await tick(80);
  assert(store.settings.provider === "ollama", "local provider persisted");
  assert(store.settings.baseUrl === "http://localhost:11434/v1", "the local endpoint was filled in");
  assert(doc.getElementById("apiKey").disabled === true, "no key needed for a local server");
  assert(doc.getElementById("baseUrlRow").style.display === "", "the endpoint row is shown for a local provider");
  assert(doc.getElementById("modelTextRow").style.display === "", "the free-text model box is shown");
  assert(doc.getElementById("modelId").disabled === true, "the catalog dropdown is disabled without a catalog");
  const modelText = doc.getElementById("modelIdText");
  modelText.value = "qwen3-coder:30b";
  modelText.dispatchEvent(new window.Event("change"));
  await tick(60);
  assert(store.settings.modelId === "qwen3-coder:30b", "the typed model id is saved");

  console.log("\n== Human mode: sub-rows disabled until enabled ==");
  assert(doc.getElementById("humanRateRow").querySelector("input").disabled === true, "miss-rate disabled when human mode off");
  assert(doc.getElementById("humanMinDiffRow").querySelector("input").disabled === true, "min-difficulty disabled when human mode off");

  console.log("\n== Human mode: toggle persists + enables sub-rows ==");
  const hm = doc.getElementById("humanMode");
  hm.checked = true;
  hm.dispatchEvent(new window.Event("change"));
  await tick(50);
  assert(store.settings.humanMode === true, "human mode toggle saved");
  assert(doc.getElementById("humanRateRow").querySelector("input").disabled === false, "miss-rate enabled when human mode on");
  assert(doc.getElementById("humanMinDiffRow").querySelector("input").disabled === false, "min-difficulty enabled when human mode on");

  console.log("\n== Human mode: sliders sync + persist ==");
  const rateRange = doc.getElementById("humanRateRange");
  rateRange.value = "0.4";
  rateRange.dispatchEvent(new window.Event("input"));
  await tick(40);
  assert(doc.getElementById("humanFailRate").value === "0.4", "miss-rate number mirrors slider");
  assert(store.settings.humanFailRate === 0.4, "miss-rate persisted");

  const minDiff = doc.getElementById("humanMinDifficulty");
  minDiff.value = "0.65";
  minDiff.dispatchEvent(new window.Event("change"));
  await tick(40);
  assert(store.settings.humanMinDifficulty === 0.65, "min-difficulty persisted");
  assert(doc.getElementById("humanMinDiffRange").value === "0.65", "min-difficulty slider mirrors number");

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
