/**
 * Chrome built-in AI (the "Prompt API", Gemini Nano) client.
 *
 * The only provider that needs NO account, NO key and NO network: the model
 * runs on the user's own machine. Requirements (Chrome's own):
 *   - Chrome 138+ (extensions) / 148+ (web); desktop only
 *   - 22 GB free disk for the model, 4 GB+ VRAM or 16 GB RAM + 4 cores
 *   - the model is downloaded separately on first use
 * Users who do not meet the bar get a clear error and the extension fails over
 * to the hosted providers.
 *
 * The API is exposed as `LanguageModel` in the page/worker scope. It may be
 * missing (older Chrome, unsupported platform), so every use is guarded.
 *
 * Classic script (no ESM). IIFE-wrapped, idempotent, exposes
 * `globalThis.OQSonDevice`.
 * @module background/ondevice-client
 */

(() => {
  /** @returns {boolean} true when this browser exposes the Prompt API. */
  function supported() {
    return typeof LanguageModel !== "undefined";
  }

  /**
   * Model state: "available", "downloadable", "downloading", "unavailable" or
   * "unsupported" (this browser/platform cannot run it at all).
   * @returns {Promise<string>}
   */
  async function availability() {
    if (!supported()) return "unsupported";
    try {
      const state = await LanguageModel.availability();
      return String(state ?? "unavailable");
    } catch {
      return "unavailable";
    }
  }

  /**
   * Ask the on-device model and return the reply text.
   * @param {string} prompt
   * @param {{ allowDownload?: boolean }} [opts]  allowDownload lets a call
   *   trigger the model download (the options-page "Test provider" button sets
   *   it; a normal solve never does, so a solve cannot silently pull GBs).
   * @returns {Promise<string>}
   */
  async function ask(prompt, opts = {}) {
    if (!supported()) {
      throw new Error("This browser has no built-in AI (Chrome 138+ on desktop).");
    }
    const state = await availability();
    if (state === "unavailable" || state === "unsupported") {
      throw new Error(
        "Chrome's on-device model is not available on this device (needs Chrome 138+, 22 GB free disk and 4 GB VRAM or 16 GB RAM)."
      );
    }
    if ((state === "downloadable" || state === "downloading") && !opts.allowDownload) {
      throw new Error(
        "Chrome's on-device model is not downloaded yet. Press 'Test provider' to start the download."
      );
    }

    // Reuse the OpenAI client's framing: spine -> system, question -> user.
    const messages = globalThis.OQSOpenAI.__test.splitPrompt(prompt);
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const user = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n\n");

    let session;
    try {
      session = await LanguageModel.create(
        system ? { initialPrompts: [{ role: "system", content: system }] } : undefined
      );
      const text = await session.prompt(user);
      return typeof text === "string" ? text : "";
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    } finally {
      try {
        session?.destroy?.();
      } catch {
        /* ignore */
      }
    }
  }

  globalThis.OQSonDevice = {
    ask,
    availability,
    supported,
    __test: {},
  };
})();
