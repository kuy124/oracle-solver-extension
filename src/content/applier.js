/**
 * Apply a chosen answer to the Oracle Academy quiz DOM.
 * Dispatches a REAL CLICK on .choice-SelectArea so the page's own toggleChoice() runs,
 * ensuring P190_CHOICE_CLICKED and submit state are updated correctly (content scripts
 * run in an isolated world; globalThis.checkSubmitButton is undefined).
 * Falls back to manual mutation only if no click handler is present.
 * Classic script (no ESM). IIFE-wrapped (safe to load twice).
 * Exposes `globalThis.OQSApply`.
 * @module content/applier
 */

(() => {
/**
 * Clear every choice back to unselected (exact mirror of page clearAllChoices).
 */
function clearAllChoices() {
  document.querySelectorAll("#collapse-Choices-reg .choice-Icon").forEach((icon) => {
    icon.classList.remove("fa-check");
    icon.classList.add("fa-square-o");
  });
  document.querySelectorAll("#collapse-Choices-reg .choice-SelectArea").forEach((btn) => {
    btn.setAttribute("aria-checked", "false");
  });
  document.querySelectorAll("#collapse-Choices-reg .qzlab-choice").forEach((input) => {
    input.value = "N";
  });
}

function enableSubmit() {
  const btn = document.querySelector("#quiz-submit");
  if (!btn) return;
  btn.classList.remove("apex_disabled");
  btn.disabled = false;
}

/**
 * Select one choice by its server id.
 * 1. Dispatch a REAL CLICK so the page's own toggleChoice() runs (visual state,
 *    P190_CHOICE_CLICKED best-effort).
 * 2. ALWAYS ensure the submit button is enabled ourselves - the page's own
 *    checkSubmitButton() selects with `[value=Y]` (an attribute selector) while
 *    toggleChoice sets the `value` property, so on the real page it never matches
 *    and the button would otherwise stay disabled.
 * Falls back to manual mutation if no click handler is present.
 * @param {string} answerId
 * @returns {boolean} true if the target was found + marked selected
 */
function applyAnswerById(answerId) {
  const container = [...document.querySelectorAll("#collapse-Choices-reg .choice-Container")].find(
    (c) => c.querySelector('.choice-Info input[name="f02"]')?.value === answerId
  );
  if (!container) return false;

  const button = container.querySelector("button.choice-SelectArea");
  const stateInput = container.querySelector("input.qzlab-choice");
  if (!stateInput || !button) return false;

  // If already selected, just make sure submit is enabled, then stop.
  if (stateInput.value === "Y") {
    enableSubmit();
    return true;
  }

  const responseType = Number(button.dataset.responseType ?? "1");

  // Click the button - page's own toggleChoice runs.
  try {
    button.click();
  } catch {
    /* fall through to manual path */
  }

  // Verify the click produced the selection; if not, mutate manually.
  if (stateInput.value !== "Y") {
    if (responseType === 1 || responseType === 3) {
      clearAllChoices();
    }
    stateInput.value = "Y";
    const icon = container.querySelector(".choice-Icon");
    if (icon) {
      icon.classList.remove("fa-square-o");
      icon.classList.add("fa-check");
    }
    button.setAttribute("aria-checked", "true");
  }

  // Always guarantee the submit button is usable (the page's own check is broken).
  enableSubmit();
  return true;
}

/**
 * Select MULTIPLE choices by their server ids (for "select all that apply"
 * questions). Each id is applied idempotently via applyAnswerById, which already
 * never toggles a selected choice back off. For single-select questions
 * (responseType 1/3) the page's own clearAllChoices() keeps only the last pick,
 * so callers should pass a single id there; for multi-select (type 2) every id
 * accumulates.
 * @param {string[]} answerIds
 * @returns {boolean} true if EVERY id was found + selected
 */
function applyAnswersByIds(answerIds) {
  const ids = Array.isArray(answerIds) ? answerIds.filter(Boolean) : [];
  if (ids.length === 0) return false;
  let allOk = true;
  for (const id of ids) {
    if (!applyAnswerById(id)) allOk = false;
  }
  return allOk;
}

globalThis.OQSApply = { clearAllChoices, applyAnswerById, applyAnswersByIds };
})();
