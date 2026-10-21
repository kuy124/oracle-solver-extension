/**
 * Options page controller.
 * Classic script (no ESM); uses the OQSPrompt + OQSKey globals loaded first.
 * Everything auto-saves; presets set a whole mode in one click.
 * @module options/options
 */

(() => {
  const { PROVIDERS, BASE_URL_PRESETS, modelsFor, defaultModelFor, resolveModel, providerById } =
    globalThis.OQSPrompt;
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

  /** Fill the provider dropdown. */
  function populateProviders(selectedId) {
    const select = $("provider");
    select.replaceChildren();
    for (const provider of PROVIDERS) {
      const opt = document.createElement("option");
      opt.value = provider.id;
      opt.textContent = provider.name;
      if (provider.id === selectedId) opt.selected = true;
      select.append(opt);
    }
  }

  /** Fill the model dropdown for the given provider. */
  function populateModels(providerId, selectedId) {
    const select = $("modelId");
    select.replaceChildren();
    const list = modelsFor(providerId);
    // A model id from another provider is not valid here: fall back to the
    // provider's own default so the select always shows a usable model.
    const wanted = resolveModel(providerId, selectedId);
    for (const model of list) {
      const opt = document.createElement("option");
      opt.value = model.id;
      opt.textContent = `${model.name} \u00b7 ${model.provider}`;
      if (model.id === wanted) opt.selected = true;
      select.append(opt);
    }
    if (!list.length) {
      // No fixed catalog (local server / custom endpoint): the free-text box
      // next to it is the model picker.
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— type the model id below —";
      opt.selected = true;
      select.append(opt);
    }
  }

  /** Fill the endpoint-preset dropdown. */
  function populateBaseUrlPresets(selectedUrl) {
    const select = $("baseUrlPreset");
    select.replaceChildren();
    for (const preset of BASE_URL_PRESETS) {
      const opt = document.createElement("option");
      opt.value = preset.baseUrl;
      opt.textContent = preset.name;
      if (preset.baseUrl && preset.baseUrl === selectedUrl) opt.selected = true;
      select.append(opt);
    }
    const custom = document.createElement("option");
    custom.value = "";
    custom.textContent = "Custom…";
    custom.selected = !selectedUrl || !BASE_URL_PRESETS.some((p) => p.baseUrl === selectedUrl);
    select.append(custom);
  }

  /**
   * Show only the controls the selected provider actually needs, and dim the
   * ones it does not.
   */
  function updateProviderRow(settings = {}) {
    const provider = providerById($("provider").value);
    const needsKey = provider?.needsKey === true;
    const hasEndpoint = Boolean(provider?.baseUrl) || provider?.needsBaseUrl === true;
    const hasCatalog = modelsFor($("provider").value).length > 0;
    // On-device AI has a fixed model: no model picker at all.
    const fixedModel = provider?.id === "ondevice";

    $("apiKeyRow").style.display = needsKey ? "" : "none";
    $("apiKey").disabled = !needsKey;
    $("baseUrlRow").style.display = hasEndpoint ? "" : "none";
    $("baseUrlCustomRow").style.display = hasEndpoint ? "" : "none";
    $("baseUrl").disabled = !hasEndpoint;
    $("baseUrlPreset").disabled = !hasEndpoint;
    // Catalog providers pick from a list; the rest get a free-text box.
    $("modelId").disabled = !hasCatalog || fixedModel;
    $("modelTextRow").style.display = hasCatalog || fixedModel ? "none" : "";
    $("modelIdText").disabled = hasCatalog || fixedModel;

    const info = [];
    if (provider?.private) info.push("Runs on your own machine — the question is not sent to any server.");
    if (provider?.id === "ondevice") {
      info.push("Needs Chrome 138+ on desktop, 22 GB free disk and 4 GB VRAM or 16 GB RAM.");
    }
    if (provider?.id === "geminiweb") {
      info.push("Uses the public Gemini web app — no key, no account. Answers in a single pass (~5 s).");
    }
    const url = String(settings.baseUrl ?? "").trim() || provider?.baseUrl || "";
    if (url) info.push(`Endpoint: ${url}`);
    $("providerInfo").textContent = info.join(" ");
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

    if ($("provider").options.length) $("provider").value = s.provider ?? PROVIDERS[0].id;
    if ($("modelId").options.length) $("modelId").value = resolveModel(s.provider, s.modelId);
    $("modelIdText").value = s.modelId ?? "";
    $("apiKey").value = s.apiKey ?? "";
    $("baseUrl").value = s.baseUrl ?? "";

    updateAutopilotSubRows();
    updateHumanSubRows();
    updateProviderRow(s);
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

  /** Dim/disable the human-mode sub-options when human mode is off. */
  function updateHumanSubRows() {
    const on = $("humanMode").checked;
    for (const id of ["humanRateRow", "humanMinDiffRow"]) {
      const row = $(id);
      row.style.opacity = on ? "1" : "0.45";
      row.querySelectorAll("input").forEach((el) => { el.disabled = !on; });
    }
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
    populateProviders(settings.provider);
    populateModels(settings.provider, settings.modelId);
    populateBaseUrlPresets(settings.baseUrl);
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
      // The placeholder option ("type the model id below") must not wipe the
      // value the free-text box holds.
      if (!e.target.value) return;
      saveSettings({ modelId: e.target.value });
      setStatus(`Preferred model: ${e.target.selectedOptions[0].textContent}`);
    });

    // --- Provider ---
    $("provider").addEventListener("change", async (e) => {
      const providerId = e.target.value;
      const provider = providerById(providerId);
      // Model ids AND endpoints are provider-specific: reset both.
      const modelId = defaultModelFor(providerId);
      const baseUrl = provider?.baseUrl ?? "";
      await saveSettings({ provider: providerId, modelId, baseUrl });
      populateModels(providerId, modelId);
      populateBaseUrlPresets(baseUrl);
      renderForm(await loadSettings());
      setStatus(`Provider: ${e.target.selectedOptions[0].textContent}`);
    });

    $("apiKey").addEventListener("change", async (e) => {
      const apiKey = e.target.value.trim();
      await saveSettings({ apiKey });
      setStatus(apiKey ? "API key saved (this browser only)." : "API key cleared.");
    });

    $("baseUrlPreset").addEventListener("change", async (e) => {
      const baseUrl = e.target.value;
      await saveSettings({ baseUrl });
      $("baseUrl").value = baseUrl;
      setStatus(baseUrl ? `Endpoint: ${baseUrl}` : "Endpoint cleared.");
    });

    $("baseUrl").addEventListener("change", async (e) => {
      const baseUrl = e.target.value.trim();
      await saveSettings({ baseUrl });
      setStatus(baseUrl ? `Endpoint: ${baseUrl}` : "Endpoint cleared.");
    });

    $("modelIdText").addEventListener("change", async (e) => {
      const modelId = e.target.value.trim();
      await saveSettings({ modelId });
      setStatus(modelId ? `Model id: ${modelId}` : "Model id cleared.");
    });

    $("detectModelsBtn").addEventListener("click", async () => {
      if (!chrome.runtime?.sendMessage) {
        setStatus("Cannot reach the background worker.", true);
        return;
      }
      const providerId = $("provider").value;
      // The Gemini web app has no endpoint URL: it lists its own models.
      const baseUrl = $("baseUrl").value.trim();
      if (providerId !== "geminiweb" && !baseUrl) {
        setStatus("Set an endpoint URL first.", true);
        return;
      }
      setStatus("Asking the endpoint for its models\u2026");
      try {
        const res = await chrome.runtime.sendMessage({
          type: "OQS_LIST_MODELS",
          payload: { baseUrl, apiKey: $("apiKey").value.trim(), provider: providerId },
        });
        if (!res?.ok) {
          setStatus(`Could not list models: ${res?.error ?? "unknown error"}`, true);
          return;
        }
        const list = $("modelList");
        list.replaceChildren();
        for (const m of res.models ?? []) {
          const opt = document.createElement("option");
          opt.value = m.id;
          list.append(opt);
        }
        setStatus(`${(res.models ?? []).length} models found \u2014 type one into the model box.`);
      } catch (err) {
        setStatus(`Could not list models: ${err?.message ?? err}`, true);
      }
    });

    $("testProviderBtn").addEventListener("click", async () => {
      if (!chrome.runtime?.sendMessage) {
        setStatus("Cannot reach the background worker.", true);
        return;
      }
      setStatus("Testing provider\u2026");
      try {
        const res = await chrome.runtime.sendMessage({ type: "OQS_TEST_PROVIDER" });
        if (res?.ok) setStatus(`OK \u2014 ${res.provider} / ${res.model} answered.`);
        else setStatus(`Failed: ${res?.error ?? "unknown error"}`, true);
      } catch (err) {
        setStatus(`Failed: ${err?.message ?? err}`, true);
      }
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

    // --- Human mode ---
    $("humanMode").addEventListener("change", async (e) => {
      await saveSettings({ humanMode: e.target.checked });
      updateHumanSubRows();
      setStatus(
        e.target.checked
          ? "Human mode ON — autopilot/auto-fill will occasionally miss hard questions."
          : "Human mode off."
      );
    });

    // Miss rate: slider <-> number
    $("humanRateRange").addEventListener("input", (e) => {
      $("humanFailRate").value = e.target.value;
      saveSettings({ humanFailRate: Number(e.target.value) });
    });
    $("humanFailRate").addEventListener("change", (e) => {
      const v = Math.min(1, Math.max(0, Number(e.target.value) || 0));
      e.target.value = String(v);
      $("humanRateRange").value = String(v);
      saveSettings({ humanFailRate: v });
    });

    // Min difficulty: slider <-> number
    $("humanMinDiffRange").addEventListener("input", (e) => {
      $("humanMinDifficulty").value = e.target.value;
      saveSettings({ humanMinDifficulty: Number(e.target.value) });
    });
    $("humanMinDifficulty").addEventListener("change", (e) => {
      const v = Math.min(1, Math.max(0, Number(e.target.value) || 0));
      e.target.value = String(v);
      $("humanMinDiffRange").value = String(v);
      saveSettings({ humanMinDifficulty: v });
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
