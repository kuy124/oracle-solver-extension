/**
 * Google Gemini WEB client (the public gemini.google.com app, NOT the paid
 * Generative Language API). Protocol ported from the reverse-engineered
 * Python library "Gemini-API" by HanaokaYuzu (AGPL-3.0) — see
 * https://github.com/HanaokaYuzu/Gemini-API
 *
 * Why this exists: it gives a FREE, KEYLESS, account-free frontier model
 * (Gemini Flash / Flash-Lite) that the extension can reach without the user
 * signing up for anything. It is the strongest zero-config backend available.
 *
 * Protocol (verified live against gemini.google.com):
 *   1. GET  https://gemini.google.com/app
 *        -> page HTML carries the frontend build label ("bl"), the frontend
 *           session id ("f.sid") and the UI language. A LOGGED-IN session also
 *           carries the "SNlM0e" access token; a GUEST session has none.
 *   2. POST .../BardFrontendService/StreamGenerate
 *        body: at=<access token>&f.req=<JSON array>
 *        f.req = [null, <JSON string of an 81-slot JSPB array>]
 *        -> the reply is a stream of LENGTH-PREFIXED frames:
 *           ")]}'\n\n<len>\n<json>\n<len>\n<json>..."
 *           where <len> counts UTF-16 code units of (separator newline + JSON).
 *
 * The answer text lives at part[2] -> JSON -> [4] (candidates) -> [1][0].
 *
 * IMPORTANT (measured): a GUEST session (no cookies, no access token) works
 * and returns real answers, so the extension never needs the user's Google
 * cookies and never stores a credential. Verified in real Chrome: an
 * extension's fetch to a host it has permission for carries NO Cookie header
 * (and Chrome strips Origin/Referer), so the user's Google session is
 * unreachable from this code by construction.
 *
 * Classic script (no ESM). IIFE-wrapped, idempotent, exposes
 * `globalThis.OQSGeminiWeb`.
 * @module background/gemini-web-client
 */

(() => {
  const INIT_URL = "https://gemini.google.com/app";
  const GENERATE_URL =
    "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
  const BATCH_URL = "https://gemini.google.com/_/BardChatUi/data/batchexecute";
  const MODEL_HEADER_KEY = "x-goog-ext-525001261-jspb";
  const SESSION_ID_HEADER_KEY = "x-goog-ext-525005358-jspb";

  const INIT_TIMEOUT_MS = 20_000;
  const ASK_TIMEOUT_MS = 120_000;
  const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  /** The 81-slot JSPB array's chat-metadata default (Gemini's own constant). */
  const DEFAULT_METADATA = ["", "", "", null, null, null, null, null, null, ""];

  /** Slot indices inside the 81-slot request array (from the Python source). */
  const SLOT = {
    message: 0,
    language: 1,
    metadata: 2,
    flags: 6,
    streaming: 7,
    requestId: 59,
    temporary: 45,
  };

  /**
   * Fetch with an AbortController timeout.
   * @param {string} url
   * @param {RequestInit} init
   * @param {number} timeoutMs
   */
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
   * Parse Google's length-prefixed stream frames.
   *
   * The wire format is `)]}'` followed by frames of "<len>\n<json>", where
   * <len> is the number of UTF-16 code units of (the separator newline plus the
   * JSON payload). Astral characters (emoji) count as TWO units, so the
   * payload must be sliced by code unit, not by code point.
   *
   * @param {string} text
   * @returns {any[]} the parsed frames
   */
  function parseFrames(text) {
    if (!text || typeof text !== "string") return [];
    let buffer = text.replace(/^\)\]\}'\s*/, "");
    const frames = [];
    for (;;) {
      const marker = /^(\d+)\n/.exec(buffer);
      if (!marker) break;
      const units = Number(marker[1]);
      // The payload region starts at the newline that follows the digits,
      // because the marker counted that newline as part of the frame.
      const start = marker[1].length;
      let index = start;
      let counted = 0;
      while (counted < units && index < buffer.length) {
        const code = buffer.charCodeAt(index);
        const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
        const next = index + 1 < buffer.length ? buffer.charCodeAt(index + 1) : 0;
        const isLowSurrogate = next >= 0xdc00 && next <= 0xdfff;
        // A surrogate pair is ONE character but TWO UTF-16 code units.
        const size = isHighSurrogate && isLowSurrogate ? 2 : 1;
        if (counted + size > units) break;
        counted += size;
        index += size;
      }
      if (counted < units) break; // incomplete frame
      const payload = buffer.slice(start, index);
      buffer = buffer.slice(index);
      if (!payload.trim()) continue;
      try {
        const parsed = JSON.parse(payload);
        if (Array.isArray(parsed)) frames.push(...parsed);
        else frames.push(parsed);
      } catch {
        /* a malformed frame must not kill the rest of the stream */
      }
    }
    return frames;
  }

  /**
   * Pull the reply text out of the parsed frames.
   * @param {any[]} frames
   * @returns {string}
   */
  function extractText(frames) {
    let best = "";
    for (const part of frames) {
      if (!Array.isArray(part)) continue;
      const inner = part[2];
      if (typeof inner !== "string") continue;
      let parsed;
      try {
        parsed = JSON.parse(inner);
      } catch {
        continue;
      }
      const candidates = parsed?.[4];
      if (!Array.isArray(candidates)) continue;
      for (const candidate of candidates) {
        const text = candidate?.[1]?.[0];
        if (typeof text === "string" && text.length > best.length) best = text;
      }
    }
    return best;
  }

  /**
   * Build the 81-slot request array for one prompt.
   * @param {string} prompt
   * @param {{ language: string, temporary?: boolean }} opts
   * @returns {any[]}
   */
  function buildRequestArray(prompt, opts) {
    const inner = new Array(81).fill(null);
    inner[SLOT.message] = [prompt, 0, null, null, null, null, 0];
    inner[SLOT.language] = [opts.language];
    inner[SLOT.metadata] = DEFAULT_METADATA;
    inner[SLOT.flags] = [1];
    inner[SLOT.streaming] = 1;
    inner[10] = 1;
    inner[11] = 0;
    inner[17] = [[0]];
    inner[18] = 0;
    inner[27] = 1;
    inner[30] = [4];
    inner[41] = [1];
    inner[53] = 0;
    inner[61] = [];
    inner[68] = 1;
    inner[79] = 1;
    inner[80] = 1;
    inner[SLOT.requestId] = "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6";
    // A temporary chat is NOT written to the user's Gemini history.
    if (opts.temporary) inner[SLOT.temporary] = 1;
    return inner;
  }

  /**
   * Build the URL-encoded request body.
   * @param {string} prompt
   * @param {{ language: string, accessToken?: string, temporary?: boolean }} opts
   * @returns {string}
   */
  function buildBody(prompt, opts) {
    const inner = buildRequestArray(prompt, opts);
    const fReq = JSON.stringify([null, JSON.stringify(inner)]);
    return new URLSearchParams({ at: opts.accessToken ?? "", "f.req": fReq }).toString();
  }

  /**
   * Build the request query string (bl = build label, f.sid = frontend session).
   * @param {{ language: string, buildLabel?: string, sessionId?: string, reqId?: number }} opts
   * @returns {string}
   */
  function buildQuery(opts) {
    const params = new URLSearchParams({
      hl: opts.language,
      _reqid: String(opts.reqId ?? Math.floor(10000 + Math.random() * 89999)),
      rt: "c",
    });
    if (opts.buildLabel) params.set("bl", opts.buildLabel);
    if (opts.sessionId) params.set("f.sid", opts.sessionId);
    return params.toString();
  }

  /**
   * The model-selection header. Omitting it lets Google pick the account's
   * default model, which is the safest choice (a guest gets Flash-Lite).
   * @param {{ modelId: string, capacity: number|string, modelNumber: number, sessionId: string }} opts
   * @returns {string}
   */
  function buildModelHeader(opts) {
    const arr = [
      1, null, null, null, opts.modelId, null, null, 0, [4, 5, 6, 8],
      null, null, opts.capacity, null, null, opts.modelNumber,
    ];
    arr.push(1);
    arr.push(opts.sessionId);
    return JSON.stringify(arr);
  }

  /** Cached session info, so we only hit /app once per worker lifetime. */
  let session = null;
  let sessionPromise = null;

  /**
   * Fetch (and cache) the frontend session info: build label, session id,
   * language and — for a logged-in session — the access token.
   * @returns {Promise<{ buildLabel: string, sessionId: string, language: string, accessToken: string }>}
   */
  async function initSession() {
    if (session) return session;
    if (!sessionPromise) {
      sessionPromise = (async () => {
        const res = await fetchWithTimeout(
          INIT_URL,
          { method: "GET", headers: { Accept: "text/html", "User-Agent": USER_AGENT } },
          INIT_TIMEOUT_MS
        );
        if (!res.ok) throw new Error(`HTTP ${res.status} loading the Gemini web app`);
        const html = await res.text();
        const grab = (re) => (html.match(re) || [])[1] ?? "";
        session = {
          buildLabel: grab(/"cfb2h":\s*"(.*?)"/),
          sessionId: grab(/"FdrFJe":\s*"(.*?)"/),
          language: grab(/"TuX5cc":\s*"(.*?)"/) || "en",
          accessToken: grab(/"SNlM0e":\s*"(.*?)"/),
        };
        return session;
      })().catch((err) => {
        sessionPromise = null;
        throw err;
      });
    }
    return sessionPromise;
  }

  /**
   * Ask Gemini a question and return the reply text.
   *
   * @param {string} prompt
   * @param {object} [opts]
   * @param {string} [opts.modelId]  Gemini model id (hex). Omit for the default.
   * @param {number} [opts.capacity]  Tier capacity (1 = free tier).
   * @param {number} [opts.modelNumber]  Model number mirrored into the body.
   * @returns {Promise<string>}
   */
  async function ask(prompt, opts = {}) {
    if (!prompt || !String(prompt).trim()) throw new Error("Empty prompt.");
    const info = await initSession();

    const headers = {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      "User-Agent": USER_AGENT,
      // Gemini expects a browser-ish request. Chrome STRIPS Origin/Referer
      // from an extension request anyway, and the endpoint answers either
      // way, so these are cosmetic. No Cookie header is ever sent: an
      // extension's fetch to a host it has permission for does not carry the
      // user's cookies, so the user's Google session is unreachable from here.
      Origin: "https://gemini.google.com",
      Referer: "https://gemini.google.com/",
      "X-Same-Domain": "1",
    };
    if (opts.modelId) {
      headers[MODEL_HEADER_KEY] = buildModelHeader({
        modelId: opts.modelId,
        capacity: opts.capacity ?? 1,
        modelNumber: opts.modelNumber ?? 1,
        sessionId: "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6",
      });
    }
    headers[SESSION_ID_HEADER_KEY] =
      `["A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6",1]`;

    const url = `${GENERATE_URL}?${buildQuery({
      language: info.language,
      buildLabel: info.buildLabel,
      sessionId: info.sessionId,
    })}`;

    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers,
        body: buildBody(prompt, {
          language: info.language,
          accessToken: info.accessToken,
          // Keep the user's Gemini history clean: exam questions are not
          // something they asked for.
          temporary: true,
        }),
      },
      ASK_TIMEOUT_MS
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status}${detail ? `: ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`
      );
    }

    const text = await res.text();
    const frames = parseFrames(text);
    const answer = extractText(frames);
    if (!answer) throw new Error("Gemini returned no readable text.");
    return answer;
  }

  /**
   * List the models the current session may use.
   * A guest session only gets the default model; a logged-in session gets its
   * full list. Never throws: an empty list is a valid answer.
   * @returns {Promise<{ id: string, name: string, provider: string, number: number, capacity: number }[]>}
   */
  async function listModels() {
    const info = await initSession();
    const rpcId = "otAQ7b"; // GetUserStatus
    const fReq = JSON.stringify([[[rpcId, "[]", null, "generic"]]]);
    const body = new URLSearchParams({ at: info.accessToken ?? "", "f.req": fReq }).toString();
    const params = new URLSearchParams({
      rpcids: rpcId,
      hl: info.language,
      _reqid: String(Math.floor(10000 + Math.random() * 89999)),
      rt: "c",
      "source-path": "/app",
    });
    if (info.buildLabel) params.set("bl", info.buildLabel);
    if (info.sessionId) params.set("f.sid", info.sessionId);

    const headers = {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      "User-Agent": USER_AGENT,
      Origin: "https://gemini.google.com",
      Referer: "https://gemini.google.com/",
      "X-Same-Domain": "1",
    };

    const res = await fetchWithTimeout(
      `${BATCH_URL}?${params}`,
      { method: "POST", headers, body },
      INIT_TIMEOUT_MS
    );
    if (!res.ok) return [];
    const frames = parseFrames(await res.text());

    const models = [];
    for (const part of frames) {
      if (!Array.isArray(part) || part[1] !== rpcId) continue;
      if (typeof part[2] !== "string") continue;
      let parsed;
      try {
        parsed = JSON.parse(part[2]);
      } catch {
        continue;
      }
      // The RPC body is a POSITIONAL array: [14]=account status, [15]=models.
      const list = parsed?.[15];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!Array.isArray(item)) continue;
        const id = item[0];
        if (typeof id !== "string" || !id) continue;
        const category = String(item[1] ?? "");
        const display = String(item[11] ?? "");
        const number = typeof item[17] === "number" ? item[17] : 1;
        models.push({
          id,
          name: display || category || id,
          provider: "Google",
          number,
          capacity: 1,
        });
      }
    }
    return models;
  }

  globalThis.OQSGeminiWeb = {
    ask,
    listModels,
    __test: {
      parseFrames,
      extractText,
      buildRequestArray,
      buildBody,
      buildQuery,
      buildModelHeader,
    },
  };
})();
