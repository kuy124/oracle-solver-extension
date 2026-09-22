/**
 * FIX 4 regression: image-based questions (P190_USE_IMAGE = Y, or an <img> in
 * the question region) must be detected and reported, not silently ignored.
 */
const { createPage, loadLibsOnly } = require("./harness");

let failures = 0;
const assert = (c, m) => { console.log((c ? "  PASS: " : "  FAIL: ") + m); if (!c) failures += 1; };

(async () => {
  const { window } = createPage();
  loadLibsOnly(window);
  const doc = window.document;
  const g = window;

  console.log("== Baseline: text question is not an image ==");
  const base = g.OQSScraper.scrapeQuestion();
  assert(base !== null, "baseline scrapes");
  assert(base.hasImage === false, "baseline hasImage = false");
  assert(base.questionText.length > 0, "baseline has text");

  console.log("\n== P190_USE_IMAGE = Y forces hasImage = true ==");
  doc.querySelector("#P190_USE_IMAGE").value = "Y";
  const withFlag = g.OQSScraper.scrapeQuestion();
  assert(withFlag.hasImage === true, "hasImage true when P190_USE_IMAGE=Y");
  doc.querySelector("#P190_USE_IMAGE").value = ""; // reset

  console.log("\n== An <img> in the question region forces hasImage = true ==");
  const dyn = doc.querySelector("#question-Text a-dynamic-content");
  dyn.textContent = ""; // simulate image-only question: no text
  const img = doc.createElement("img");
  img.setAttribute("src", "data:image/png;base64,AAAA");
  dyn.appendChild(img);
  const imgQ = g.OQSScraper.scrapeQuestion();
  assert(imgQ !== null, "image-only question still scrapes (not null)");
  assert(imgQ.hasImage === true, "hasImage true from <img>");
  assert(imgQ.imageSrc.includes("data:image/png"), `imageSrc captured (got "${imgQ.imageSrc.slice(0, 30)}")`);
  assert(imgQ.questionText === "", "questionText empty for image-only");

  console.log("\n== Orchestrator reports image question instead of failing ==");
  // Load the rest (panel + content) and confirm showInfo path renders a notice.
  const { loadContentScripts } = require("./harness");
  const page2 = createPage({ sendMessage: (m, cb) => cb({ ok: false, error: "should not be called" }) });
  const d2 = page2.window.document;
  const dyn2 = d2.querySelector("#question-Text a-dynamic-content");
  dyn2.textContent = "";
  const img2 = d2.createElement("img");
  img2.setAttribute("src", "data:image/png;base64,BBBB");
  dyn2.appendChild(img2);
  loadContentScripts(page2.window);
  await new Promise((r) => setTimeout(r, 250));

  const panel = d2.getElementById("oqs-panel");
  assert(panel !== null, "panel rendered for image question");
  const status = panel.querySelector('[data-role="status"]')?.textContent ?? "";
  assert(/image/i.test(status), `status mentions image (got "${status}")`);

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("crash:", e); process.exit(2); });
