/**
 * Options page controller.
 * Classic script (no ESM); uses the OQSPrompt + OQSKey globals loaded first.
 * Everything auto-saves; presets set a whole mode in one click.
 * @module options/options
 */

(() => {
  const { MODELS } = globalThis.OQSPrompt;
  const {
    loadSettings,
    saveSettings,
    loadKey,
    clearKey,
    importKey,
    exportKey,
    loadIgnored,
    unignoreAll,
    resetAutopilotState,
  } = globalThis.OQSKey;

  const VERSION = globalThis.OQS_VERSION ?? "unknown";
  console.info(`[OQS] v${VERSION} options page loaded.`);

  const $ = (id) => document.getElementById(id);
  let statusTimer = null;

  function setStatus(text, isError = false) {
    const node = $("status");
    node.textContent = text;
    node.className = `status show${isError ? " err" : ""}`;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }

  async function refreshCount() {
    const map = await loadKey();
    const ignored = await loadIgnored();
    const total = Object.keys(map).length;
    $("keyCount").textContent = `${total} saved answer${total === 1 ? "" : "s"} \u00b7 ${ignored.size} ignored.`;
  }

  function populateModels(selectedId) {
    const select = $("modelId");
    select.replaceChildren();
    for (const model of MODELS) {
      const opt = document.createElement("option");
      opt.value = model.id;
      opt.textContent = `${model.name} \u00b7 ${model.provider}`;
      if (model.id === selectedId) opt.selected = true;
      select.append(opt);
    }
  }

  /** Reflect the current settings into the form controls. */
  function renderForm(s) {
    $("aiEnabled").checked = s.aiEnabled;
    $("autoSuggest").checked = s.autoSuggest;
    $("doubleCheck").checked = s.doubleCheck !== false;
    $("showReason").checked = s.showReason;
    $("autopilot").checked = s.autopilot;
    $("autopilotComplete").checked = s.autopilotComplete;

    $("autopilotMinConfidence").value = String(s.autopilotMinConfidence);
    $("minConfRange").value = String(s.autopilotMinConfidence);
    $("autopilotDelayMs").value = String(s.autopilotDelayMs);
    $("delayRange").value = String(Math.min(8000, s.autopilotDelayMs));

    $("humanMode").checked = s.humanMode;
    $("humanFailRate").value = String(s.humanFailRate);
    $("humanRateRange").value = String(s.humanFailRate);
    $("humanMinDifficulty").value = String(s.humanMinDifficulty);
    $("humanMinDiffRange").value = String(s.humanMinDifficulty);

    if ($("modelId").options.length) $("modelId").value = s.modelId;

    updateAutopilotSubRows();
    updateHumanSubRows();
    updatePresetHighlight(s);
  }

  /** Dim/disable the autopilot sub-options when autopilot is off. */
  function updateAutopilotSubRows() {
    const on = $("autopilot").checked;
    for (const id of ["autoCompleteRow", "minConfRow", "delayRow"]) {
      const row = $(id);
      row.style.opacity = on ? "1" : "0.45";
      row.querySelectorAll("input").forEach((el) => { el.disabled = !on; });
    }
    $("autopilotComplete").disabled = !on;
  }

  /** Highlight whichever preset matches the current settings. */
  function updatePresetHighlight(s) {
    const isSafe = !s.autopilot && !s.autoApply;
    const isAutoFill = !s.autopilot && s.autoApply;
    const isFull = s.autopilot && s.autopilotComplete;
    const isAuto = s.autopilot && !s.autopilotComplete;
    $("presetSafe").classList.toggle("active", isSafe);
    $("presetAuto").classList.toggle("active", isAutoFill || isAuto);
    $("presetFull").classList.toggle("active", isFull);
  }

  /** Apply a whole preset (one click = whole mode). */
  async function applyPreset(name) {
    const base = { aiEnabled: true, autoSuggest: true };
    if (name === "safe") {
      await saveSettings({ ...base, autopilot: false, autoApply: false, autopilotComplete: false });
      setStatus("Mode: Suggest only — the panel shows answers, you apply & submit.");
    } else if (name === "auto") {
      await saveSettings({ ...base, autopilot: false, autoApply: true, autopilotComplete: false });
      setStatus("Mode: Auto-fill — answers are auto-selected; you submit each question.");
    } else if (name === "full") {
      if (!confirm("Full auto will auto-select AND auto-submit every question, and complete the assessment. Continue?")) return;
      await saveSettings({ ...base, autopilot: true, autoApply: true, autopilotComplete: true });
      setStatus("Mode: Full auto — the extension will answer and submit the whole assessment.");
    }
    renderForm(await loadSettings());
    await refreshCount();
  }

  async function init() {
    $("verTag").textContent = `v${VERSION}`;

    const settings = await loadSettings();
    populateModels(settings.modelId);
    renderForm(settings);
    await refreshCount();

    // --- Presets ---
    $("presetSafe").addEventListener("click", () => applyPreset("safe"));
    $("presetAuto").addEventListener("click", () => applyPreset("auto"));
    $("presetFull").addEventListener("click", () => applyPreset("full"));

    // --- Solver toggles (auto-save) ---
    $("aiEnabled").addEventListener("change", async (e) => {
      await saveSettings({ aiEnabled: e.target.checked });
      setStatus(e.target.checked ? "Free AI fallback ON." : "Free AI fallback OFF (cached answers only).");
    });
    $("autoSuggest").addEventListener("change", (e) => saveSettings({ autoSuggest: e.target.checked }));
    $("doubleCheck").addEventListener("change", async (e) => {
      await saveSettings({ doubleCheck: e.target.checked });
      setStatus(e.target.checked ? "3-model consensus ON (higher accuracy)." : "Single-pass mode (faster, less accurate).");
    });
    $("showReason").addEventListener("change", (e) => saveSettings({ showReason: e.target.checked }));
    $("modelId").addEventListener("change", (e) => {
      saveSettings({ modelId: e.target.value });
      setStatus(`Preferred model: ${e.target.selectedOptions[0].textContent}`);
    });

    // --- Autopilot ---
    $("autopilot").addEventListener("change", async (e) => {
      if (e.target.checked && !confirm("Autopilot will auto-select AND auto-submit every question. Continue?")) {
        e.target.checked = false;
        return;
      }
      await saveSettings({ autopilot: e.target.checked, autoApply: e.target.checked || (await loadSettings()).autoApply });
      updateAutopilotSubRows();
      setStatus(e.target.checked ? "Autopilot ON — open an assessment." : "Autopilot off.");
      renderForm(await loadSettings());
    });
    $("autopilotComplete").addEventListener("change", async (e) => {
      if (e.target.checked && !confirm("This submits the FINAL completion — irreversible. Continue?")) {
        e.target.checked = false;
        return;
      }
      await saveSettings({ autopilotComplete: e.target.checked });
      renderForm(await loadSettings());
    });

    // Min confidence: slider <-> number
    $("minConfRange").addEventListener("input", (e) => {
      $("autopilotMinConfidence").value = e.target.value;
      saveSettings({ autopilotMinConfidence: Number(e.target.value) });
    });
    $("autopilotMinConfidence").addEventListener("change", (e) => {
      const v = Math.min(1, Math.max(0, Number(e.target.value) || 0));
      e.target.value = String(v);
      $("minConfRange").value = String(v);
      saveSettings({ autopilotMinConfidence: v });
    });

    // Delay: slider <-> number
    $("delayRange").addEventListener("input", (e) => {
      $("autopilotDelayMs").value = e.target.value;
      saveSettings({ autopilotDelayMs: Number(e.target.value) });
    });
    $("autopilotDelayMs").addEventListener("change", (e) => {
      const v = Math.max(0, Math.round(Number(e.target.value) || 0));
      e.target.value = String(v);
      $("delayRange").value = String(Math.min(8000, v));
      saveSettings({ autopilotDelayMs: v });
    });

    $("autopilotResetBtn").addEventListener("click", async () => {
      await resetAutopilotState();
      setStatus("Autopilot session reset (stop flag cleared).");
    });

    // --- Answer key ---
    $("exportBtn").addEventListener("click", async () => {
      const json = await exportKey();
      $("keyText").value = json;
      $("keyText").closest("details").open = true;
      // Also copy to clipboard for convenience.
      try {
        await navigator.clipboard.writeText(json);
        setStatus("Key exported and copied to clipboard.");
      } catch {
        setStatus("Key exported below.");
      }
    });
    $("importBtn").addEventListener("click", async () => {
      try {
        const parsed = JSON.parse($("keyText").value);
        const { added, total } = await importKey(parsed);
        await refreshCount();
        setStatus(`Imported. ${added} new entries (${total} total).`);
      } catch (err) {
        setStatus(`Import failed: ${err.message}`, true);
      }
    });
    $("clearBtn").addEventListener("click", async () => {
      if (!confirm("Delete all cached answers? This cannot be undone.")) return;
      await clearKey();
      await refreshCount();
      setStatus("Answer key cleared.");
    });
    $("unignoreBtn").addEventListener("click", async () => {
      await unignoreAll();
      await refreshCount();
      setStatus("'Never solve' list reset.");
    });
  }

  init().catch((err) => setStatus(`Init failed: ${err.message}`, true));
})();
