/**
 * Generic OpenAI-compatible chat client.
 *
 * One transport, many free backends. Every provider below speaks the same
 * "POST {base}/chat/completions with {model, messages}" protocol, so they all
 * share this file:
 *
 *   Pollinations   https://gen.pollinations.ai/v1        (free key)
 *   Pollinations   https://text.pollinations.ai/v1        (no key, 1 req/30 s)
 *   Ollama         http://localhost:11434/v1              (local, no key)
 *   LM Studio      http://localhost:1234/v1               (local, no key)
 *   Groq           https://api.groq.com/openai/v1          (free key)
 *   OpenRouter     https://openrouter.ai/api/v1           (free key)
 *   Gemini         https://generativelanguage.googleapis.com/v1beta/openai
 *   Cerebras       https://api.cerebras.ai/v1              (free key)
 *   Mistral        https://api.mistral.ai/v1               (free key)
 *   NVIDIA NIM     https://integrate.api.nvidia.com/v1     (free key)
 *   ...or any other OpenAI-compatible base URL the user types in.
 *
 * The key is sent in the `Authorization` header, never in the URL. A local
 * server ignores it (Ollama wants one present, LM Studio does not).
 *
 * Classic script (no ESM). IIFE-wrapped, idempotent, exposes
 * `globalThis.OQSOpenAI`.
 * @module background/openai-client
 */

(() => {
  const REQUEST_TIMEOUT_MS = 60_000;
  const LIST_TIMEOUT_MS = 20_000;

  /**
   * Frame a built prompt as chat messages. The prompt builders put the rules in
   * a "spine" followed by "\n\nQUESTION:", so the spine becomes the system
   * message and the question the user message. Prompts without that marker are
   * sent as a single user message.
   * @param {string} prompt
   * @returns {{ role: string, content: string }[]}
   */
  function splitPrompt(prompt) {
    const text = String(prompt ?? "");
    const marker = text.indexOf("\n\nQUESTION");
    if (marker === -1) return [{ role: "user", content: text }];
    return [
      { role: "system", content: text.slice(0, marker).trim() },
      { role: "user", content: text.slice(marker).trim() },
    ];
  }

  /** Pull the assistant text out of an OpenAI-shaped response body. */
  function extractContent(data) {
    const choice = data?.choices?.[0];
    const content = choice?.message?.content ?? choice?.text ?? "";
    return typeof content === "string" ? content : "";
  }

  /** Join a base URL with the chat-completions path. */
  function chatUrl(baseUrl) {
    return `${String(baseUrl ?? "").replace(/\/+$/, "")}/chat/completions`;
  }

  /**
   * Build the HTTP request for one chat call.
   * @param {{ url: string, apiKey?: string, model: string, prompt: string, headers?: Record<string,string> }} opts
   */
  function buildRequest({ url, apiKey, model, prompt, headers }) {
    const h = { "Content-Type": "application/json", Accept: "application/json", ...(headers ?? {}) };
    const key = String(apiKey ?? "").trim();
    if (key) h.Authorization = `Bearer ${key}`;
    return {
      url,
      init: {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: splitPrompt(prompt),
        }),
      },
    };
  }

  /** fetch with an AbortController timeout. */
  async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send one prompt to an OpenAI-compatible endpoint and return the reply text.
   * @param {{ baseUrl?: string, url?: string, apiKey?: string, model: string, prompt: string, headers?: Record<string,string>, timeoutMs?: number }} opts
   * @returns {Promise<string>}
   */
  async function chat(opts) {
    const url = opts.url ?? chatUrl(opts.baseUrl);
    if (!opts.model) throw new Error("No model selected for this provider.");
    const { init } = buildRequest({ ...opts, url });
    const res = await fetchWithTimeout(
      url,
      init,
      Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : REQUEST_TIMEOUT_MS
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status}${detail ? `: ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`
      );
    }
    const data = await res.json();
    const text = extractContent(data);
    if (!text) throw new Error("The AI returned an empty reply.");
    return text;
  }

  /**
   * List the models an endpoint offers (used by the options page to fill the
   * model box for local servers and user-supplied endpoints).
   * @param {{ baseUrl: string, apiKey?: string, headers?: Record<string,string> }} opts
   * @returns {Promise<{ id: string, name: string }[]>}
   */
  async function listModels(opts) {
    const url = `${String(opts.baseUrl ?? "").replace(/\/+$/, "")}/models`;
    const h = { Accept: "application/json", ...(opts.headers ?? {}) };
    const key = String(opts.apiKey ?? "").trim();
    if (key) h.Authorization = `Bearer ${key}`;
    const res = await fetchWithTimeout(url, { method: "GET", headers: h }, LIST_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status} listing models`);
    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list
      .map((m) => ({ id: String(m?.id ?? m?.name ?? ""), name: String(m?.name ?? m?.id ?? "") }))
      .filter((m) => m.id);
  }

  globalThis.OQSOpenAI = {
    chat,
    listModels,
    __test: { splitPrompt, extractContent, buildRequest, chatUrl },
  };
})();
