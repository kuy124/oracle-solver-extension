/**
 * Content-script orchestrator: detects the assessment question, asks the
 * background worker to solve it (key -> free AI), shows the suggestion panel,
 * and (optionally) auto-applies + auto-submits each question in "autopilot".
 * Classic script (no ESM). Exposes nothing; runs on load.
 * @module content/content
 */

(() => {
  const { scrapeQuestion, isAssessmentPage } = globalThis.OQSScraper ?? {};
  const { hashQuestion } = globalThis.OQSHash ?? {};
  const { applyAnswerById, applyAnswersByIds } = globalThis.OQSApply ?? {};
  const {
    getEntry,
    putEntry,
    normalizeEntry,
    loadSettings,
    loadIgnored,
    ignoreHash,
    loadAutopilotState,
    saveAutopilotState,
    resetAutopilotState,
    stopAutopilot,
  } = globalThis.OQSKey ?? {};
  const panel = globalThis.OQSPanel ?? {};
  const { difficulty, pickHumanFailure, pickHumanFailureMulti } = globalThis.OQSHuman ?? {};

  // Build stamp so "am I running stale code?" is a one-glance check in DevTools.
  const VERSION = globalThis.OQS_VERSION ?? "unknown";
  console.info(`[OQS] v${VERSION} content script loaded.`);

  if (!scrapeQuestion || !hashQuestion || !applyAnswerById || !applyAnswersByIds || !panel.showSuggestion) {
    console.error(
      `[OQS] v${VERSION} dependencies missing; aborting. ` +
        `This usually means a STALE build is cached — fully reload the extension ` +
        `(chrome://extensions) AND the page, or restart the browser.`
    );
    return;
  }

  /** @type {string | null} */
  let currentHash = null;
  let debounceTimer = null;
  /** Monotonic token: any async solve that finishes after a newer run is dropped. */
  let runToken = 0;
  /** Prevents autopilot from acting twice on the same question id. */
  let autopilotHandledQuestionId = null;
  /** Timer for the pre-submit delay, so STOP can cancel it. */
  let autopilotTimer = null;
  /** The most recently scraped question (for id <-> index mapping). */
  let lastQuestion = null;

  // ---- Small DOM helpers for the APEX autopilot ----------------------------

  /** Read a hidden P190_* page item's value. */
  function readItem(name) {
    const el = document.querySelector(`#${name}`);
    return el?.value ?? "";
  }

  /** Current question sequence (1-based) and total, from the page items. */
  function readProgress() {
    const seq = Number(readItem("P190_QUESTION_SEQUENCE") || "0");
    const count = Number(readItem("P190_QUESTION_COUNT") || "0");
    return { seq, count, isLast: count > 0 && seq >= count };
  }

  /** The page's own submit button (fires apex.da.submitPage). */
  function submitButton() {
    return document.querySelector("#quiz-submit");
  }

  /** Is this the preview-only assessment? (never autopilot these) */
  function isPreviewOnly() {
    return readItem("P190_PREVIEW_ONLY") === "Y";
  }

  /** Click the page's own submit button (triggers its native submit). */
  function clickSubmit() {
    const btn = submitButton();
    if (!btn) return false;
    if (btn.classList.contains("apex_disabled") || btn.disabled) return false;
    btn.click();
    return true;
  }

  /**
   * Complete the assessment: the submit button is now labelled "Complete
   * Assessment" and clicking it opens the confirm dialog; then click the
   * dialog's "Complete Assessment" to submit with request=VIEW.
   * @returns {Promise<boolean>}
   */
  async function completeAssessment() {
    clickSubmit();
    // Wait (up to ~3s) for the confirm dialog's Complete button to appear.
    const completeBtn = await waitFor(() => document.querySelector("#B102388866620266126"), 3000);
    if (completeBtn) {
      completeBtn.click();
      return true;
    }
    return false;
  }

  /** Poll for an element/condition. */
  function waitFor(fn, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const v = fn();
        if (v) return resolve(v);
        if (Date.now() - started >= timeoutMs) return resolve(null);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  /** Ask the background worker to solve. */
  function requestSolve(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "OQS_SOLVE", payload }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response ?? { ok: false, error: "No response" });
        });
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  /**
   * Apply a set of answer ids and persist the outcome.
   * @param {string[]} answerIds
   * @param {"key"|"ai"|"manual"|string} source
   * @param {string} reason
   * @param {number} confidence
   */
  function applyAndPersist(answerIds, source, reason, confidence) {
    const ids = normalizeIds(answerIds);
    if (ids.length === 0) {
      panel.showError?.("No answer to apply.");
      return false;
    }
    const ok = applyAnswersByIds(ids);
    if (!ok) {
      panel.showError?.("Could not find that choice on the page.");
      return false;
    }
    if (currentHash) {
      putEntry(currentHash, {
        answerId: ids[0],
        answerIds: ids,
        answerIndexes: indexesForIds(ids),
        multiSelect: ids.length > 1,
        source: source ?? "manual",
        reason,
        confidence,
      }).catch(() => {});
    }
    return true;
  }

  /** Coerce any answer representation into a clean array of ids. */
  function normalizeIds(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  }

  /** Map a set of answer ids back to their current page indexes (best-effort). */
  function indexesForIds(ids) {
    const choices = lastQuestion?.choices ?? [];
    return ids.map((id) => choices.findIndex((c) => c.id === id)).filter((i) => i >= 0);
  }

  /**
   * Apply answer ids directly WITHOUT persisting to the key. Used for deliberate
   * "human mode" misses so a wrong answer is never cached/reused.
   */
  function applyWithoutPersist(answerIds) {
    const ids = normalizeIds(answerIds);
    if (ids.length === 0) {
      panel.showError?.("No answer to apply.");
      return false;
    }
    if (!applyAnswersByIds(ids)) {
      panel.showError?.("Could not find that choice on the page.");
      return false;
    }
    return true;
  }

  /** Candidate list (suggested answer first, then the rest) for the panel's Cycle. */
  function buildCandidates(question, answerId) {
    const correct = question.choices.find((c) => c.id === answerId);
    const others = question.choices.filter((c) => c.id !== answerId);
    return [{ answerId, text: correct?.text ?? "" }, ...others.map((c) => ({ answerId: c.id, text: c.text }))];
  }

  // ---- Autopilot -----------------------------------------------------------

  /**
   * Run one autopilot step for the just-solved question: apply the answer, wait
   * the configured delay (abortable), then submit / complete / stop.
   * @param {{ question: any, answerId: string, source: string, confidence: number, reason: string, settings: any }} ctx
   */
  async function autopilotStep(ctx) {
    const { question, answerId, source, confidence, reason, settings } = ctx;

    // One action per question, keyed by question id (or hash fallback).
    const qid = question.questionId || currentHash || "";
    if (autopilotHandledQuestionId === qid) return;
    autopilotHandledQuestionId = qid;

    // Safety gates — stop rather than guess/submit.
    if (isPreviewOnly()) {
      panel.setAutopilotStatus?.("Autopilot paused: preview mode.");
      return;
    }
    const minConf = Number(settings.autopilotMinConfidence ?? 0.5);
    const conf = Number(confidence ?? 0);
    if (Number.isFinite(conf) && conf < minConf) {
      panel.setAutopilotStatus?.(`Autopilot paused: confidence ${Math.round(conf * 100)}% < ${Math.round(minConf * 100)}%.`);
      return;
    }

    const state = await loadAutopilotState();
    if (state.stopped) {
      panel.setAutopilotStatus?.("Autopilot stopped.");
      return;
    }

    // Loop guard: cap total submits for this assessment.
    const { count } = readProgress();
    const cap = (count > 0 ? count : 50) + 2;
    if (state.count >= cap) {
      panel.setAutopilotStatus?.(`Autopilot stopped: safety cap (${cap}) reached.`);
      await saveAutopilotState({ stopped: true });
      return;
    }

    const { seq, isLast } = readProgress();
    panel.setAutopilotStatus?.(`Autopilot: Q${seq || "?"} applied \u00b7 preparing\u2026`, { active: true });

    // Apply the suggestion.
    if (!applyAndPersist(answerId, source, reason, confidence)) {
      panel.setAutopilotStatus?.("Autopilot stopped: could not apply the answer.");
      return;
    }

    // Delay before submitting (abortable via STOP).
    const delay = Math.max(0, Number(settings.autopilotDelayMs ?? 1500));
    const aborted = await new Promise((resolve) => {
      const start = Date.now();
      const step = () => {
        loadAutopilotState().then((s) => {
          if (s.stopped) return resolve(true);
          const left = delay - (Date.now() - start);
          if (left <= 0) return resolve(false);
          panel.setAutopilotStatus?.(
            `Autopilot: Q${seq || "?"} selected \u00b7 submitting in ${(left / 1000).toFixed(1)}s\u2026`,
            { active: true }
          );
          autopilotTimer = setTimeout(step, 200);
        });
      };
      step();
    });
    if (aborted) {
      panel.setAutopilotStatus?.("Autopilot stopped before submit.");
      return;
    }

    // Re-check stop right before submitting.
    if ((await loadAutopilotState()).stopped) {
      panel.setAutopilotStatus?.("Autopilot stopped before submit.");
      return;
    }

    if (!isLast) {
      panel.setAutopilotStatus?.(`Autopilot: Q${seq || "?"} submitting \u2192 next\u2026`, { active: true });
      await saveAutopilotState({ count: state.count + 1 });
      const ok = clickSubmit();
      if (!ok) panel.setAutopilotStatus?.("Autopilot stopped: submit button not clickable.");
      return;
    }

    // Last question.
    if (settings.autopilotComplete) {
      panel.setAutopilotStatus?.("Autopilot: completing assessment\u2026", { active: true });
      await saveAutopilotState({ count: state.count + 1 });
      await completeAssessment();
      return;
    }

    panel.setAutopilotStatus?.("Last question \u2014 review and submit manually.", { active: false });
  }

  /**
   * Decide whether autopilot / auto-apply should act on this question.
   * @param {any} question
   * @param {{ answerId: string, source?: string, confidence?: number, reason?: string }} entry
   * @param {any} settings
   */
  function maybeAutopilot(question, entry, settings) {
    if (settings.autopilot) {
      // Full autopilot: apply + submit (errors logged, fire-and-forget).
      autopilotStep({
        question,
        answerId: entry.answerId,
        source: entry.source ?? "ai",
        confidence: entry.confidence,
        reason: entry.reason,
        settings,
      }).catch((e) => console.warn("[OQS] autopilot error:", e));
      return;
    }

    // Auto-fill mode: auto-select only (no submit).
    if (settings.autoApply) {
      const qid = question.questionId || currentHash || "";
      if (autopilotHandledQuestionId === qid) return;
      autopilotHandledQuestionId = qid;

      const minConf = Number(settings.autopilotMinConfidence ?? 0.5);
      const conf = Number(entry.confidence ?? 0);
      if (Number.isFinite(conf) && conf < minConf) {
        panel.setAutopilotStatus?.(`Auto-fill paused: confidence ${Math.round(conf * 100)}% < ${Math.round(minConf * 100)}%.`);
        return;
      }
      applyAndPersist(entry.answerId, entry.source ?? "ai", entry.reason, entry.confidence);
      panel.setAutopilotStatus?.("Auto-filled \u2014 review, then Submit.", { active: false });
      return;
    }

    panel.setAutopilotStatus?.(null);
  }

  /**
   * Solve the current question and render the panel.
   * @param {boolean} forceAi
   */
  async function run(forceAi = false) {
    if (!isAssessmentPage()) return;
    const question = scrapeQuestion();
    if (!question) return;

    const token = ++runToken;

    // Image-only questions cannot be text-solved.
    if (!question.questionText && question.hasImage) {
      currentHash = null;
      if (!forceAi) {
        const s = await loadSettings();
        if (s.autopilot || s.autoApply) {
          panel.setAutopilotStatus?.("Paused: image question needs manual input.");
          return;
        }
      }
      panel.showInfo?.("Image question detected - answer manually (AI cannot read the image).");
      return;
    }

    const hash = await hashQuestion(question);
    if (token !== runToken) return; // a newer question superseded this run
    currentHash = hash;

    const ignored = await loadIgnored();
    if (token !== runToken) return;
    if (!forceAi && ignored.has(hash)) return;

    const settings = await loadSettings();
    if (token !== runToken) return;

    // Reset the per-question autopilot guard as soon as a new question is seen.
    const qid = question.questionId || hash;
    if (autopilotHandledQuestionId && autopilotHandledQuestionId !== qid) {
      autopilotHandledQuestionId = null;
    }

    // Fast path: cached key -> instant suggestion.
    if (!forceAi) {
      const cached = await getEntry(hash);
      if (token !== runToken) return;
      if (cached) {
        panel.showSuggestion({
          answerId: cached.answerId,
          text: question.choices.find((c) => c.id === cached.answerId)?.text ?? "",
          source: cached.source ?? "key",
          confidence: cached.confidence,
          reason: settings.showReason ? cached.reason : "",
          candidates: buildCandidates(question, cached.answerId),
          onApply: (id) => applyAndPersist(id, cached.source ?? "key", cached.reason, cached.confidence),
        });
        maybeAutopilot(question, { answerId: cached.answerId, source: cached.source ?? "key", confidence: cached.confidence, reason: cached.reason }, settings);
        return;
      }
    }

    if (!settings.aiEnabled && !forceAi) {
      if (settings.autopilot || settings.autoApply) {
        panel.setAutopilotStatus?.("Paused: no cached answer and AI is disabled.");
        return;
      }
      panel.showError?.("No cached answer. Enable free AI in options to auto-solve.");
      return;
    }

    panel.showBusy?.(forceAi ? "Re-solving with AI..." : "Solving...");
    const result = await requestSolve({
      hash,
      questionText: question.questionText,
      choices: question.choices.map((c) => ({ id: c.id, text: c.text })),
      forceAi,
    });

    if (token !== runToken) return; // stale result - drop it

    if (!result.ok) {
      if (settings.autopilot || settings.autoApply) {
        panel.setAutopilotStatus?.(`Paused: ${result.error ?? "solve failed"}`);
        return;
      }
      panel.showError?.(result.error ?? "Solve failed.");
      return;
    }

    const entry = result.entry;
    // Guard: the suggested answer must still exist on the current page.
    const validChoice = question.choices.find((c) => c.id === entry.answerId);
    if (!validChoice) {
      panel.showError?.("Solved answer no longer matches this question.");
      return;
    }

    panel.showSuggestion({
      answerId: entry.answerId,
      text: validChoice.text,
      source: entry.source ?? "ai",
      confidence: entry.confidence,
      reason: settings.showReason ? entry.reason : "",
      candidates: buildCandidates(question, entry.answerId),
      onApply: (id) => applyAndPersist(id, entry.source ?? "ai", entry.reason, entry.confidence),
    });
    maybeAutopilot(question, entry, settings);
  }

  /** Debounced re-scan on DOM changes (APEX re-renders regions via AJAX). */
  function scheduleRun() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      run(false).catch((e) => console.warn("[OQS]", e));
    }, 400);
  }

  /** Stop autopilot immediately (panel STOP button). */
  function handleStop() {
    if (autopilotTimer) {
      clearTimeout(autopilotTimer);
      autopilotTimer = null;
    }
    stopAutopilot?.().catch(() => {});
    panel.setAutopilotStatus?.("Autopilot stopped.");
  }

  function wirePanel() {
    panel.wireHandlers?.({
      onApplyRequest: () => run(true),
      onNever: async () => {
        if (currentHash) {
          await ignoreHash(currentHash);
          panel.showInfo?.("Marked as never-solve.");
        }
      },
      onStop: handleStop,
    });
  }

  /** Numbered shortcuts (1-9 select, Tab re-solve). */
  function wireKeyboard() {
    document.addEventListener(
      "keydown",
      (e) => {
        if (!isAssessmentPage()) return;
        const target = e.target;
        const typing = target instanceof HTMLElement && /input|textarea|select/i.test(target.tagName);
        if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

        if (e.key >= "1" && e.key <= "9") {
          const idx = Number(e.key) - 1;
          const btn = document.querySelectorAll("#collapse-Choices-reg button.choice-SelectArea")[idx];
          if (btn) {
            btn.click();
            e.preventDefault();
          }
        } else if (e.key === "Tab") {
          run(true).catch(() => {});
          e.preventDefault();
        }
      },
      true
    );
  }

  async function init() {
    if (!isAssessmentPage()) return;

    // A fresh assessment starts autopilot from a clean slate. Everything here is
    // best-effort: a storage/wiring failure must never surface as an uncaught
    // rejection or stop the solver from running.
    try {
      const state = await loadAutopilotState();
      if (state.stopped && readProgress().seq <= 1) {
        // New assessment detected (back at Q1) — clear the prior stop flag.
        await resetAutopilotState();
      }
    } catch (e) {
      console.warn("[OQS] autopilot state init failed (continuing):", e);
    }

    try {
      panel.removePanel?.();
      wirePanel(); // builds the panel + listeners first
      wireKeyboard();

      const target = document.querySelector("#collapse-Choices-reg") ?? document.body;
      const observer = new MutationObserver(() => scheduleRun());
      observer.observe(target, { childList: true, subtree: true });

      document.addEventListener("apexafterrefresh", scheduleRun);
    } catch (e) {
      console.warn("[OQS] wiring failed (solve still runs):", e);
    }

    // Kick off the first solve regardless of observer wiring success.
    run(false).catch((e) => console.warn("[OQS]", e));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init().catch((e) => console.warn("[OQS] init failed:", e));
    });
  } else {
    init().catch((e) => console.warn("[OQS] init failed:", e));
  }
})();
