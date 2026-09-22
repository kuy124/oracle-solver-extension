/**
 * Scrape the current Oracle Academy assessment question from the DOM.
 * Selectors are grounded in the captured EXAMPLEORACLE.txt (APEX page 190).
 * Classic script (no ESM). IIFE-wrapped (safe to load twice).
 * Exposes `globalThis.OQSScraper`.
 * @module content/scraper
 */

(() => {
/**
 * @typedef {Object} Choice
 * @property {string} id            f02 value (server choice id)
 * @property {string} text          visible choice text
 * @property {number} responseType  1/3 = single, 2 = multi
 * @property {boolean} selected     current qzlab-choice value === "Y"
 * @property {HTMLElement} el       the .choice-SelectArea button
 */

/**
 * @typedef {Object} ScrapedQuestion
 * @property {string} questionText
 * @property {string} qNumber       e.g. "6 of 15"
 * @property {string} questionId    P190_QUESTION_ID if present
 * @property {boolean} hasImage     question is image-based (P190_USE_IMAGE = Y)
 * @property {string} imageSrc      first question image src, if any
 * @property {boolean} multiSelect  true when the question expects >1 answer ("select all that apply")
 * @property {number|null} requiredCount  how many answers the question asks for, if stated (e.g. "Pilih dua" -> 2)
 * @property {Choice[]} choices
 */

/** @returns {boolean} */
function isAssessmentPage() {
  return Boolean(document.querySelector("#collapse-Choices-reg") && document.querySelector("#question-Text"));
}

/**
 * Visible text of an element. Prefers innerText (respects visibility) but
 * falls back to textContent where innerText is unavailable (e.g. jsdom).
 * @param {HTMLElement | null} el
 * @returns {string}
 */
function visibleText(el) {
  if (!el) return "";
  const text = typeof el.innerText === "string" ? el.innerText : el.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

/** Read question text from the dynamic-content region inside #question-Text. */
function readQuestionText() {
  const region = document.querySelector("#question-Text");
  if (!region) return "";
  const dynamic = region.querySelector("a-dynamic-content") ?? region.querySelector(".t-ContentBlock-body");
  return visibleText(dynamic ?? region);
}

function readQuestionNumber() {
  const heading = document.querySelector("#question-Text_heading");
  const raw = heading?.textContent ?? "";
  const m = raw.match(/Question\s+(\d+)\s+of\s+(\d+)/i);
  return m ? `${m[1]} of ${m[2]}` : "";
}

function readQuestionId() {
  const el = document.querySelector("#P190_QUESTION_ID");
  return el?.value ?? "";
}

/**
 * Detect image-based questions (P190_USE_IMAGE = "Y") or a question <img>.
 * @returns {{ hasImage: boolean, imageSrc: string }}
 */
function readImageState() {
  const useImage = document.querySelector("#P190_USE_IMAGE")?.value === "Y";
  const region = document.querySelector("#question-Text a-dynamic-content") ?? document.querySelector("#question-Text");
  const img = region?.querySelector("img");
  return {
    hasImage: useImage || Boolean(img),
    imageSrc: (img?.getAttribute("src") ?? "").slice(0, 300),
  };
}

/**
 * Scrape all answer choices.
 * @returns {Choice[]}
 */
function readChoices() {
  const containers = document.querySelectorAll("#collapse-Choices-reg .choice-Container");
  /** @type {Choice[]} */
  const choices = [];

  containers.forEach((container) => {
    const button = container.querySelector("button.choice-SelectArea");
    if (!button) return;
    const idInput = container.querySelector('.choice-Info input[name="f02"]');
    const stateInput = container.querySelector("input.qzlab-choice");
    const textEl = container.querySelector(".choice-Text");
    choices.push({
      id: idInput?.value ?? "",
      text: visibleText(textEl),
      responseType: Number(button.dataset.responseType ?? "1"),
      selected: stateInput?.value === "Y",
      el: button,
    });
  });

  return choices;
}

/**
 * @returns {ScrapedQuestion | null}
 */
function scrapeQuestion() {
  if (!isAssessmentPage()) return null;
  const questionText = readQuestionText();
  const choices = readChoices();
  const { hasImage, imageSrc } = readImageState();

  // Require text OR an image; without either there is nothing to solve.
  if ((!questionText && !hasImage) || choices.length === 0) return null;

  return {
    questionText,
    qNumber: readQuestionNumber(),
    questionId: readQuestionId(),
    hasImage,
    imageSrc,
    choices,
  };
}

globalThis.OQSScraper = { isAssessmentPage, scrapeQuestion };
})();
