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

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
