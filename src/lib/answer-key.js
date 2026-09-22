/**
 * Answer-key + settings persistence over chrome.storage.local.
 * Classic script (no ESM). IIFE-wrapped so internals never leak/collide and the
 * file is safe to load more than once. Exposes `globalThis.OQSKey`.
 * @module lib/answer-key
 */

(() => {
  const KEY_STORE = "answerKey"; // object map: hash -> entry
  const SETTINGS_STORE = "settings";

  const DEFAULT_SETTINGS = {
    aiEnabled: true,
    modelId: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a", // GPT-5.4 Mini (accurate on SQL)
    autoSuggest: true,
    showReason: true,
    // Second-pass verification (self-check) for higher accuracy.
    doubleCheck: true,
    // Auto-select the suggested answer WITHOUT submitting (the "Auto-fill" mode).
    autoApply: false,
    // Autopilot: auto-select AND auto-submit each question (then advance).
    autopilot: false,
    // Also click "Complete Assessment" on the last question (irreversible).
    autopilotComplete: false,
    // Pause after selecting, before submitting (ms) — lets you hit STOP.
    autopilotDelayMs: 1500,
    // Only auto-apply when the AI confidence is at least this (0..1).
    autopilotMinConfidence: 0.5,
    // ---- Human mode -------------------------------------------------------
    // Deliberately miss some HARD questions so results look human (not a perfect
    // 100% bot). Affects ONLY the automatic paths (autopilot / auto-fill); the
    // manual "Apply" button always applies the correct answer.
    humanMode: false,
    // Target fraction of qualifying hard questions to miss (0..1).
    humanFailRate: 0.25,
    // Only miss questions whose local difficulty score is at least this (0..1),
    // so easy questions are never sacrificed.
    humanMinDifficulty: 0.5,
  };

  /** @returns {Promise<Record<string, any>>} */
  async function loadKey() {
    try {
      const res = await chrome.storage.local.get(KEY_STORE);
      return res?.[KEY_STORE] ?? {};
    } catch (err) {
      console.warn("[OQS] loadKey failed:", err);
      return {};
    }
  }

  /** @param {Record<string, any>} map */
  async function saveKey(map) {
    try {
      await chrome.storage.local.set({ [KEY_STORE]: map });
    } catch (err) {
      console.warn("[OQS] saveKey failed:", err);
    }
  }

  /**
   * @param {string} hash
   * @returns {Promise<any | null>}
   */
  async function getEntry(hash) {
    const map = await loadKey();
    return map?.[hash] ?? null;
  }

  /**
   * Normalize ANY stored/imported entry into a single canonical shape with an
   * `answerIds` array. Reads the new `answerIds`, falling back to a legacy scalar
   * `answerId`. Used by the orchestrator so old exported keys keep working.
   * @param {any} entry
   * @returns {{ answerIds: string[], multiSelect: boolean } & Record<string, any>}
   */
  function normalizeEntry(entry) {
    if (!entry || typeof entry !== "object") return { answerIds: [], multiSelect: false };
    const fromArray = Array.isArray(entry.answerIds) ? entry.answerIds.filter(Boolean) : [];
    const list = fromArray.length ? fromArray : entry.answerId ? [entry.answerId] : [];
    return {
      ...entry,
      answerIds: list,
      // A stored `multiSelect` flag wins; otherwise >1 answer implies multi.
      multiSelect: entry.multiSelect === true || list.length > 1,
    };
  }

  /**
   * @param {string} hash
   * @param {any} entry
   */
  async function putEntry(hash, entry) {
    const map = await loadKey();
    map[hash] = { ...entry, solvedAt: new Date().toISOString() };
    await saveKey(map);
    return map[hash];
  }

  /** @param {string} hash */
  async function deleteEntry(hash) {
    const map = await loadKey();
    if (Object.hasOwn(map, hash)) {
      delete map[hash];
      await saveKey(map);
    }
  }

  async function clearKey() {
    await saveKey({});
  }

  /**
   * Merge an imported key object into storage.
   * @param {Record<string, any>} incoming
   * @returns {Promise<{ added: number, total: number }>}
   */
  async function importKey(incoming) {
    if (!incoming || typeof incoming !== "object") throw new Error("Invalid key file");
    const map = await loadKey();
    let added = 0;
    for (const [h, entry] of Object.entries(incoming)) {
      if (!Object.hasOwn(map, h) || !map[h]?.userLocked) {
        map[h] = entry;
        added += 1;
      }
    }
    await saveKey(map);
    return { added, total: Object.keys(map).length };
  }

  async function exportKey() {
    const map = await loadKey();
    return JSON.stringify(map, null, 2);
  }

  /** @returns {Promise<typeof DEFAULT_SETTINGS>} */
  async function loadSettings() {
    try {
      const res = await chrome.storage.local.get(SETTINGS_STORE);
      return { ...DEFAULT_SETTINGS, ...(res?.[SETTINGS_STORE] ?? {}) };
    } catch (err) {
      console.warn("[OQS] loadSettings failed:", err);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
  async function saveSettings(patch) {
    try {
      const current = await loadSettings();
      const next = { ...current, ...patch };
      await chrome.storage.local.set({ [SETTINGS_STORE]: next });
      return next;
    } catch (err) {
      console.warn("[OQS] saveSettings failed:", err);
      return { ...DEFAULT_SETTINGS, ...patch };
    }
  }

  /**
   * "Never solve this one" list: hashes the user asked to ignore.
   * @returns {Promise<Set<string>>}
   */
  async function loadIgnored() {
    try {
      const res = await chrome.storage.local.get("ignoredHashes");
      return new Set(res?.ignoredHashes ?? []);
    } catch (err) {
      console.warn("[OQS] loadIgnored failed:", err);
      return new Set();
    }
  }

  /** @param {string} hash */
  async function ignoreHash(hash) {
    try {
      const set = await loadIgnored();
      set.add(hash);
      await chrome.storage.local.set({ ignoredHashes: [...set] });
    } catch (err) {
      console.warn("[OQS] ignoreHash failed:", err);
    }
  }

  async function unignoreAll() {
    try {
      await chrome.storage.local.set({ ignoredHashes: [] });
    } catch (err) {
      console.warn("[OQS] unignoreAll failed:", err);
    }
  }

  // ---- Autopilot session state (survives the APEX full-page reload) --------
  // Uses chrome.storage.local, which is always accessible from BOTH the content
  // script and the service worker. (chrome.storage.session exists but is NOT
  // accessible from content scripts unless the worker calls setAccessLevel, which
  // throws "Access to storage is not allowed from this context".) Local storage
  // also survives the APEX full-page reload, which is all autopilot needs.

  const AUTOPILOT_KEY = "autopilotState";
  const AUTOPILOT_EMPTY = { count: 0, stopped: false, lastQuestionId: "" };

  /**
   * @returns {Promise<{ count: number, stopped: boolean, lastQuestionId: string }>}
   */
  async function loadAutopilotState() {
    try {
      const res = await chrome.storage.local.get(AUTOPILOT_KEY);
      return res?.[AUTOPILOT_KEY] ?? { ...AUTOPILOT_EMPTY };
    } catch (err) {
      // Never let a storage hiccup bubble up as an uncaught rejection.
      console.warn("[OQS] loadAutopilotState failed:", err);
      return { ...AUTOPILOT_EMPTY };
    }
  }

  /** @param {Partial<{count:number,stopped:boolean,lastQuestionId:string}>} patch */
  async function saveAutopilotState(patch) {
    try {
      const current = await loadAutopilotState();
      const next = { ...current, ...patch };
      await chrome.storage.local.set({ [AUTOPILOT_KEY]: next });
      return next;
    } catch (err) {
      console.warn("[OQS] saveAutopilotState failed:", err);
      return { ...AUTOPILOT_EMPTY, ...patch };
    }
  }

  async function resetAutopilotState() {
    try {
      await chrome.storage.local.set({ [AUTOPILOT_KEY]: { ...AUTOPILOT_EMPTY } });
    } catch (err) {
      console.warn("[OQS] resetAutopilotState failed:", err);
    }
  }

  /** Request an immediate stop (honored before the next submit). */
  async function stopAutopilot() {
    await saveAutopilotState({ stopped: true });
  }

  globalThis.OQSKey = {
    DEFAULT_SETTINGS,
    loadKey,
    saveKey,
    getEntry,
    putEntry,
    deleteEntry,
    clearKey,
    importKey,
    exportKey,
    loadSettings,
    saveSettings,
    loadIgnored,
    ignoreHash,
    unignoreAll,
    loadAutopilotState,
    saveAutopilotState,
    resetAutopilotState,
    stopAutopilot,
  };
})();
