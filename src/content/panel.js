/**
 * Floating "Solve & Apply" suggestion panel + numbered keyboard shortcuts.
 * Classic script (no ESM). IIFE-wrapped (safe to load twice).
 * Depends on OQSApply + OQSKey globals. Exposes `globalThis.OQSPanel`.
 * @module content/panel
 */

(() => {
const OQS_PANEL_ID = "oqs-panel";

/** @type {HTMLElement | null} */
let panel = null;
/** @type {null | ((answerId: string) => void)} */
let onApply = null;
/** @type {Array<{ answerId: string, text: string }>} */
let candidates = [];
let candidateIndex = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function isPanelOpen() {
  return Boolean(document.getElementById(OQS_PANEL_ID));
}

function removePanel() {
  document.getElementById(OQS_PANEL_ID)?.remove();
  panel = null;
  clearSuggestionHighlight();
}

function clearSuggestionHighlight() {
  document.querySelectorAll(".choice-Container.oqs-suggested").forEach((c) => {
    c.classList.remove("oqs-suggested");
  });
}

/**
 * Highlight the answer's choice container in the underlying page.
 * @param {string} answerId
 */
function highlightSuggestion(answerId) {
  clearSuggestionHighlight();
  const container = [...document.querySelectorAll("#collapse-Choices-reg .choice-Container")].find(
    (c) => c.querySelector('.choice-Info input[name="f02"]')?.value === answerId
  );
  container?.classList.add("oqs-suggested");
}

function buildPanel() {
  const root = el("div");
  root.id = OQS_PANEL_ID;

  const head = el("div", "oqs-head");
  const title = el("span", "oqs-title", "Quiz Solver");
  const badge = el("span", "oqs-badge", "");
  badge.dataset.role = "badge";
  const collapse = el("button", "oqs-collapse", "\u2013");
  collapse.type = "button";
  collapse.title = "Collapse";
  collapse.addEventListener("click", () => root.classList.toggle("oqs-collapsed"));
  head.append(title, badge, collapse);

  const body = el("div", "oqs-body");
  const status = el("div", "oqs-status", "Ready.");
  status.dataset.role = "status";
  const answer = el("div", "oqs-answer");
  answer.dataset.role = "answer";
  answer.style.display = "none";
  const reason = el("div", "oqs-reason");
  reason.dataset.role = "reason";
  reason.style.display = "none";

  const row = el("div", "oqs-row");
  const applyBtn = el("button", "oqs-btn primary", "Apply");
  applyBtn.type = "button";
  applyBtn.dataset.role = "apply";
  const cycleBtn = el("button", "oqs-btn", "Cycle");
  cycleBtn.type = "button";
  cycleBtn.dataset.role = "cycle";
  const solveBtn = el("button", "oqs-btn", "Ask AI");
  solveBtn.type = "button";
  solveBtn.dataset.role = "solve";
  const skipBtn = el("button", "oqs-btn", "Never");
  skipBtn.type = "button";
  skipBtn.dataset.role = "skip";
  row.append(applyBtn, cycleBtn, solveBtn, skipBtn);

  // Autopilot status + STOP (hidden unless autopilot is active).
  const auto = el("div", "oqs-autopilot");
  auto.dataset.role = "autopilot";
  auto.style.display = "none";
  const autoText = el("span", "oqs-auto-text", "");
  autoText.dataset.role = "autopilot-text";
  const stopBtn = el("button", "oqs-btn oqs-stop", "STOP");
  stopBtn.type = "button";
  stopBtn.dataset.role = "stop";
  auto.append(autoText, stopBtn);

  const foot = el("div", "oqs-foot", "Keys: 1\u20134 pick \u00b7 Enter submit \u00b7 Tab solve");
  body.append(status, answer, reason, row, auto, foot);
  root.append(head, body);

  makeDraggable(root, head);
  document.body.append(root);
  panel = root;
  return root;
}

/** Minimal header-drag support (anchored top-right). */
function makeDraggable(root, handle) {
  let startX = 0;
  let startY = 0;
  let startRight = 0;
  let startTop = 0;
  let dragging = false;

  handle.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true;
    const rect = root.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startRight = window.innerWidth - rect.right;
    startTop = rect.top;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    root.style.right = `${Math.max(4, startRight - dx)}px`;
    root.style.top = `${Math.max(4, startTop + dy)}px`;
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
  });
}

function setStatus(text, kind) {
  const node = panel?.querySelector('[data-role="status"]');
  if (!node) return;
  node.textContent = text;
  node.className = `oqs-status${kind ? ` oqs-${kind}` : ""}`;
}

function setBadge(text, kind) {
  const node = panel?.querySelector('[data-role="badge"]');
  if (!node) return;
  node.textContent = text || "";
  node.className = `oqs-badge${kind ? ` ${kind}` : ""}`;
}

function renderCandidate() {
  const answer = panel?.querySelector('[data-role="answer"]');
  const cycleBtn = panel?.querySelector('[data-role="cycle"]');
  const applyBtn = panel?.querySelector('[data-role="apply"]');
  if (!answer) return;

  const current = candidates[candidateIndex];
  if (!current) {
    answer.style.display = "none";
    if (cycleBtn) cycleBtn.disabled = true;
    if (applyBtn) applyBtn.disabled = true;
    clearSuggestionHighlight();
    return;
  }

  answer.style.display = "block";
  answer.textContent = current.text;
  if (cycleBtn) cycleBtn.disabled = candidates.length < 2;
  if (applyBtn) applyBtn.disabled = false;
  highlightSuggestion(current.answerId);
}

/**
 * Show a solved suggestion.
 * @param {{ answerId: string, text?: string, source?: string, confidence?: number, reason?: string, candidates?: Array<{answerId:string,text:string}>, onApply: (answerId: string) => void }} data
 */
function showSuggestion(data) {
  if (!panel) buildPanel();
  onApply = data.onApply ?? null;
  candidates = data.candidates?.length ? data.candidates : [{ answerId: data.answerId, text: data.text ?? "" }];
  candidateIndex = 0;

  const found = candidates.findIndex((c) => c.answerId === data.answerId);
  if (found >= 0) candidateIndex = found;

  setBadge(data.source ?? "", data.source === "key" || data.source === "ai" ? data.source : "");
  const conf = typeof data.confidence === "number" ? ` \u00b7 ${Math.round(data.confidence * 100)}%` : "";
  setStatus(`Suggested answer${conf}`, "");

  const reason = panel.querySelector('[data-role="reason"]');
  if (reason) {
    if (data.reason) {
      reason.style.display = "block";
      reason.textContent = data.reason;
    } else {
      reason.style.display = "none";
    }
  }
  renderCandidate();
}

function showError(message) {
  if (!panel) buildPanel();
  setBadge("", "");
  setStatus(message, "error");
  const answer = panel.querySelector('[data-role="answer"]');
  if (answer) {
    answer.style.display = "none";
    answer.textContent = "";
  }
  const applyBtn = panel.querySelector('[data-role="apply"]');
  if (applyBtn) applyBtn.disabled = true;
  const cycleBtn = panel.querySelector('[data-role="cycle"]');
  if (cycleBtn) cycleBtn.disabled = true;
  clearSuggestionHighlight();
}

function showBusy(message = "Solving\u2026") {
  if (!panel) buildPanel();
  // Reset any previous suggestion so a stale answer never lingers while solving.
  const answer = panel.querySelector('[data-role="answer"]');
  if (answer) {
    answer.style.display = "none";
    answer.textContent = "";
  }
  const reason = panel.querySelector('[data-role="reason"]');
  if (reason) {
    reason.style.display = "none";
    reason.textContent = "";
  }
  const applyBtn = panel.querySelector('[data-role="apply"]');
  if (applyBtn) applyBtn.disabled = true;
  const cycleBtn = panel.querySelector('[data-role="cycle"]');
  if (cycleBtn) cycleBtn.disabled = true;
  clearSuggestionHighlight();
  setBadge("", "");
  setStatus(message, "busy");
}

/**
 * Show a neutral informational state (e.g. image question needing manual input).
 * @param {string} message
 */
function showInfo(message) {
  if (!panel) buildPanel();
  showError(message);
  const status = panel.querySelector('[data-role="status"]');
  if (status) status.className = "oqs-status";
}

/**
 * Show or hide the autopilot status row.
 * @param {string | null} text  null/empty hides the row.
 * @param {{ active?: boolean }} [opts]
 */
function setAutopilotStatus(text, opts = {}) {
  if (!panel) buildPanel();
  const auto = panel.querySelector('[data-role="autopilot"]');
  const autoText = panel.querySelector('[data-role="autopilot-text"]');
  if (!auto || !autoText) return;
  if (!text) {
    auto.style.display = "none";
    return;
  }
  auto.style.display = "flex";
  auto.classList.toggle("oqs-auto-active", Boolean(opts.active));
  autoText.textContent = text;
}

/**
 * Wire panel buttons.
 * @param {{ onApplyRequest: () => void, onCycle?: () => void, onNever: () => void, onStop?: () => void }} handlers
 */
function wireHandlers(handlers) {
  if (!panel) buildPanel();
  const applyBtn = panel.querySelector('[data-role="apply"]');
  const cycleBtn = panel.querySelector('[data-role="cycle"]');
  const solveBtn = panel.querySelector('[data-role="solve"]');
  const skipBtn = panel.querySelector('[data-role="skip"]');
  const stopBtn = panel.querySelector('[data-role="stop"]');

  applyBtn?.addEventListener("click", () => {
    const current = candidates[candidateIndex];
    if (current && onApply) onApply(current.answerId);
  });
  cycleBtn?.addEventListener("click", () => {
    if (candidates.length < 2) return;
    candidateIndex = (candidateIndex + 1) % candidates.length;
    renderCandidate();
  });
  solveBtn?.addEventListener("click", () => handlers.onApplyRequest?.());
  skipBtn?.addEventListener("click", () => handlers.onNever?.());
  stopBtn?.addEventListener("click", () => {
    setAutopilotStatus("Stopping\u2026");
    handlers.onStop?.();
  });
}

globalThis.OQSPanel = {
  isPanelOpen,
  removePanel,
  showSuggestion,
  showError,
  showInfo,
  showBusy,
  setAutopilotStatus,
  wireHandlers,
};
})();
