/**
 * Pollinations free-AI client (thin wrapper over the generic OpenAI-compatible
 * client).
 *
 * Two endpoints, one protocol:
 *   1. WITH an API key  -> POST https://gen.pollinations.ai/v1/chat/completions
 *      Every model (GPT-5.4, Claude Sonnet 5, Gemini 3.8, DeepSeek V4, Kimi K3,
 *      ...) and no per-IP rate cap. The key travels in the Authorization
 *      header, never in the URL. A free key (no credit card) is enough for the
 *      models that are not paid-only.
 *   2. WITHOUT a key     -> POST https://text.pollinations.ai/openai
 *      One model (openai-fast / GPT-OSS 20B) and 1 request / 30 s per IP, so
 *      the caller must use it single-pass (no 3-model consensus).
 *
 * Classic script (no ESM). IIFE-wrapped so internals never leak/collide and the
 * file is safe to load more than once. Exposes `globalThis.OQSPollinations`.
 * @module background/pollinations-client
 */

(() => {
  const GEN_URL = "https://gen.pollinations.ai/v1/chat/completions";
  const CLASSIC_URL = "https://text.pollinations.ai/openai";

  /** The single model the keyless (classic) endpoint serves. */
  const CLASSIC_MODEL = "openai-fast";

  /**
   * The keyless endpoint allows 1 request / 30 s per IP. When it refuses it
   * answers HTTP 402 fast, but sometimes it QUEUES the request instead and
   * then stalls for minutes. A short timeout turns that stall into a quick
   * failure, so the extension can fall over to the other provider instead of
   * leaving the user waiting.
   */
  const CLASSIC_TIMEOUT_MS = 25_000;

  /**
   * Build the HTTP request for a Pollinations call.
   * @param {string} prompt
   * @param {string} modelId
   * @param {string} apiKey
   */
  function buildRequest(prompt, modelId, apiKey) {
    const key = String(apiKey ?? "").trim();
    return globalThis.OQSOpenAI.__test.buildRequest({
      url: key ? GEN_URL : CLASSIC_URL,
      apiKey: key,
      // The keyless endpoint serves exactly one model; ignore the ask.
      model: key ? modelId : CLASSIC_MODEL,
      prompt,
    });
  }

  /**
   * Ask Pollinations and return the full reply text.
   * @param {string} prompt
   * @param {string} modelId
   * @param {string} [apiKey]  optional; without it the keyless endpoint is used
   * @returns {Promise<string>}
   */
  async function ask(prompt, modelId, apiKey) {
    const key = String(apiKey ?? "").trim();
    try {
      return await globalThis.OQSOpenAI.chat({
        url: key ? GEN_URL : CLASSIC_URL,
        apiKey: key,
        model: key ? modelId : CLASSIC_MODEL,
        prompt,
        timeoutMs: key ? undefined : CLASSIC_TIMEOUT_MS,
      });
    } catch (err) {
      const message = String(err?.message ?? err);
      // The keyless endpoint answers 402 with "FREE_LIMIT" once per 30 s.
      if (!key && /\b402\b/.test(message)) {
        throw new Error(
          "The keyless Pollinations endpoint is rate-limited (one reply per 30 seconds). Add a free key for unlimited requests."
        );
      }
      throw err;
    }
  }

  globalThis.OQSPollinations = {
    ask,
    __test: {
      buildRequest,
      splitPrompt: (p) => globalThis.OQSOpenAI.__test.splitPrompt(p),
      extractContent: (d) => globalThis.OQSOpenAI.__test.extractContent(d),
      GEN_URL,
      CLASSIC_URL,
      CLASSIC_MODEL,
    },
  };
})();
