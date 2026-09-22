/**
 * Test runner. Runs the OFFLINE suites (jsdom + the captured fixture; no network).
 * The live free-AI check is opt-in via `node ai.test.js` (requires network).
 *
 * Run `npm install` in this folder first (needs jsdom), or point NODE_PATH at a
 * jsdom install.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const suites = [
  "classic-scripts.test.js", // no ESM anywhere + worker loads via importScripts
  "fixture.test.js",        // scraper/hash/prompt/applier on the real capture
  "page-world.test.js",     // applier drives the PAGE'S OWN toggleChoice via click
  "integration.test.js",    // all content scripts load + auto-solve renders
  "autopilot.test.js",      // auto-select + auto-submit, gates, cap, STOP
  "options.test.js",        // options GUI: presets, toggles, sliders, persistence
  "stale-guard.test.js",    // stale solve results are dropped
  "image-question.test.js", // image questions detected + reported
  "multi-select.test.js",   // "select all that apply": set scrape/solve/apply/submit
  "busy-reset.test.js",     // showBusy clears prior suggestion
  "human.test.js",          // human mode: difficulty heuristic + deliberate misses
];

let failed = 0;
const results = [];

for (const file of suites) {
  console.log(`\n########## ${file} ##########`);
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  const ok = res.status === 0;
  results.push([file, ok]);
  if (!ok) failed += 1;
}

console.log("\n==================================================");
for (const [file, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${file}`);
console.log("==================================================");
console.log(failed === 0 ? "ALL OFFLINE SUITES PASSED" : `${failed} SUITE(S) FAILED`);
console.log("Run `node ai.test.js` for the live free-AI check (requires network).");
process.exit(failed === 0 ? 0 : 1);
