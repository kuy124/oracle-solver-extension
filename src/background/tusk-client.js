/**
 * TuskCentral free-AI client (ported from TuskCompanion chat.rs + stream_parser.rs).
 *
 * Runs in the MV3 background service worker so requests bypass CORS
 * (new.tusksearch.com returns no Access-Control-Allow-Origin, so the content
 * script / page context could never call it directly).
 *
 * Protocol:
 *   1. POST /api/v2/chat/conversations  -> { sessionId, chatId, title }
 *   2. POST /api/V2/Chat                -> streamed JSON objects, each with .content
 * No API key / auth is required.
 *
 * Classic script (no ESM). IIFE-wrapped so internals never leak/collide and the
 * file is safe to load more than once. Exposes `globalThis.OQSTusk`.
 * @module background/tusk-client
 */

(() => {
const CREATE_CONVERSATION_URL = "https://new.tusksearch.com/api/v2/chat/conversations";
const SEND_MESSAGE_URL = "https://new.tusksearch.com/api/V2/Chat";

const REQUEST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  Origin: "https://new.tusksearch.com",
  Referer: "https://new.tusksearch.com/",
};

const CREATE_TIMEOUT_MS = 30_000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;

/**
 * Streaming-safe extractor for concatenated top-level `{...}` JSON objects.
 * Handles braces inside strings and objects split across chunks.
 * (Direct port of JsonStreamParser from stream_parser.rs.)
 */
class JsonStreamParser {
  constructor() {
    this.buffer = "";
    this.maxBuffer = 1024 * 1024;
  }

  /**
   * @param {string} text
   * @returns {any[]} complete parsed top-level objects
   */
  push(text) {
    if (!text) return [];
    this.buffer += text;
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxBuffer);
    }

    const objects = [];
    let depth = 0;
    let openStart = -1;
    let inString = false;
    let escape = false;
    let consumedUpTo = 0;
    const buf = this.buffer;

    for (let i = 0; i < buf.length; i += 1) {
      const ch = buf[i];

      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        if (depth === 0) openStart = i;
        depth += 1;
      } else if (ch === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0 && openStart !== -1) {
          const slice = buf.slice(openStart, i + 1);
          try {
            objects.push(JSON.parse(slice));
          } catch {
            /* drop unparseable */
          }
          consumedUpTo = i + 1;
          openStart = -1;
        }
      }
    }

    if (openStart !== -1) {
      this.buffer = this.buffer.slice(openStart);
    } else if (consumedUpTo > 0) {
      this.buffer = this.buffer.slice(consumedUpTo);
    } else if (!inString) {
      this.buffer = "";
    }
    return objects;
  }
}

/** Pull the human text out of one streamed object. */
function extractStreamText(obj) {
  if (!obj || typeof obj !== "object") return "";
  const content = obj.content;
  if (typeof content === "string") {
    try {
      const inner = JSON.parse(content);
      // Normal frame: inner JSON carries the token in its own "content".
      if (typeof inner?.content === "string") return inner.content;
      // Inner JSON without a "content" field: treat the raw string as the text
      // (never silently drop it).
      return content;
    } catch {
      // Not JSON at all: the string IS the token.
      return content;
    }
  }
  if (content && typeof content === "object" && typeof content.content === "string") {
    return content.content;
  }
  return "";
}

/** fetch with AbortController timeout. */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Read a streamed response body, accumulating all `content` text. */
async function readStream(response) {
  const parser = new JsonStreamParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let idleTimer = null;

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => reader.cancel().catch(() => {}), STREAM_IDLE_TIMEOUT_MS);
  };

  try {
    resetIdle();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      const text = decoder.decode(value, { stream: true });
      for (const obj of parser.push(text)) {
        const t = extractStreamText(obj);
        if (t) output += t;
      }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
  return output;
}

/**
 * Open a conversation; retries with backoff, honoring HTTP 429 rate limits.
 * @param {string} aiModelId
 * @returns {Promise<{ sessionId: string, chatId: string }>}
 */
async function createConversation(aiModelId) {
  const body = JSON.stringify({
    role: "user",
    content: "Initialize conversation session.",
    aiModelId,
    chatAiModelType: "text",
    askClarifyingQuestion: false,
  });

  let lastErr = new Error("createConversation failed");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    try {
      const res = await fetchWithTimeout(
        CREATE_CONVERSATION_URL,
        { method: "POST", headers: REQUEST_HEADERS, body },
        CREATE_TIMEOUT_MS
      );
      if (res.status === 429) {
        // Rate limited: honor Retry-After (seconds) before the next attempt.
        const retryAfter = Number(res.headers?.get?.("retry-after") || "5");
        lastErr = new Error("HTTP 429 rate limited");
        await new Promise((r) => setTimeout(r, Math.min(60, Math.max(1, retryAfter)) * 1000));
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} creating conversation`);
        continue;
      }
      const data = await res.json();
      const sessionId = data?.sessionId;
      const chatId = data?.chatId;
      if (!sessionId || !chatId) {
        lastErr = new Error("Conversation response missing sessionId/chatId");
        continue;
      }
      return { sessionId, chatId };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr;
}

/**
 * Send one prompt through the free AI and return the full text reply.
 * @param {string} prompt
 * @param {string} aiModelId
 * @returns {Promise<string>}
 */
async function ask(prompt, aiModelId) {
  const { sessionId, chatId } = await createConversation(aiModelId);

  const body = JSON.stringify({
    sessionId,
    chatId,
    role: "user",
    content: prompt,
    aiModelId,
    grokproOptions: null,
    voiceAndTone: "analytical",
    askClarifyingQuestion: false,
    isWebSearchEnabled: false,
    isLocationEnabled: false,
    location: null,
    inputMode: "text",
    snowplow: { sessionId, networkId: null },
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    const res = await fetchWithTimeout(
      SEND_MESSAGE_URL,
      { method: "POST", headers: REQUEST_HEADERS, body },
      STREAM_IDLE_TIMEOUT_MS
    );
    if (res.status === 429) {
      const retryAfter = Number(res.headers?.get?.("retry-after") || "5");
      await new Promise((r) => setTimeout(r, Math.min(60, Math.max(1, retryAfter)) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} sending message`);
    return readStream(res);
  }
  throw new Error("HTTP 429 rate limited (retries exhausted)");
}

globalThis.OQSTusk = { ask, __test: { JsonStreamParser, extractStreamText } };
})();
