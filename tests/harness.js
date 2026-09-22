/**
 * Shared test harness.
 * - Builds a jsdom page from the captured EXAMPLEORACLE.html.
 * - Injects the page's REAL functions (toggleChoice/checkSubmitButton/clearAllChoices/
 *   enableSubmitButton), copied verbatim from the capture, into the page world, and
 *   binds the same APEX declarative-action click handler the page uses.
 * - Loads the extension's content scripts (ESM keywords stripped) into the page.
 *
 * This lets us prove the extension drives the page's OWN logic via real clicks.
 */
const fs = require("fs");
const path = require("path");
const util = require("util");
const { JSDOM } = require("jsdom");

const EXT = path.resolve(__dirname, "..");
const HTML = path.join(__dirname, "fixtures", "exampleoracle.html");

/** Real page functions, lifted from the capture's inline <script>. */
const PAGE_WORLD_SCRIPT = `
function clearAllChoices() {
  $('.choice-Icon').removeClass('fa-check').addClass('fa-square-o');
  $('.choice-SelectArea').attr('aria-checked', 'false');
  $('.qzlab-choice').val('N');
}
function enableSubmitButton() {
  $('#quiz-submit').removeClass('apex_disabled').prop('disabled', false);
}
function disableSubmitButton() {
  $('#quiz-submit').addClass('apex_disabled').prop('disabled', true);
}
function checkSubmitButton() {
  const anySelected = $('.qzlab-choice[value=Y]').length > 0;
  if (anySelected) { enableSubmitButton(); } else { disableSubmitButton(); }
  if (window.apex && window.apex.item) window.apex.item('P190_CHOICE_CLICKED').setValue(anySelected ? 'Y' : 'N');
}
function toggleChoice($button) {
  const $icon = $button.find('.choice-Icon');
  const $hiddenChoice = $button.find('.qzlab-choice');
  const isSelected = $hiddenChoice.val() === 'Y';
  const responseType = Number($button.data('response-type'));
  if (responseType === 1 || responseType === 3) {
    clearAllChoices();
    $hiddenChoice.val('Y');
    $icon.removeClass('fa-square-o').addClass('fa-check');
    $button.attr('aria-checked', 'true');
  } else if (responseType === 2) {
    if (isSelected) {
      $hiddenChoice.val('N');
      $icon.removeClass('fa-check').addClass('fa-square-o');
      $button.attr('aria-checked', 'false');
    } else {
      $hiddenChoice.val('Y');
      $icon.removeClass('fa-check').addClass('fa-square-o').removeClass('fa-square-o').addClass('fa-check');
      $button.attr('aria-checked', 'true');
    }
  }
  checkSubmitButton();
  window.__pageToggleCalls = (window.__pageToggleCalls || 0) + 1;
}
`;

/** A tiny jQuery-like shim sufficient for the page functions above. */
const JQUERY_SHIM = `
window.$ = (function () {
  function wrap(nodes) {
    const list = Array.isArray(nodes) ? nodes : [nodes];
    const api = {
      _nodes: list,
      find(sel) {
        const out = [];
        list.forEach((n) => n && out.push(...n.querySelectorAll(sel)));
        return wrap(out);
      },
      removeClass(c) { list.forEach((n) => n && n.classList.remove(c)); return api; },
      addClass(c) { list.forEach((n) => n && n.classList.add(c)); return api; },
      attr(k, v) { if (v === undefined) return list[0] && list[0].getAttribute(k); list.forEach((n) => n && n.setAttribute(k, v)); return api; },
      val(v) {
        if (v === undefined) {
          const el = list[0];
          if (!el) return undefined;
          if (el.classList && el.classList.contains('qzlab-choice')) {
            // jQuery val() reads the .value property for inputs
            return el.value;
          }
          return el.value;
        }
        list.forEach((n) => { if (n) n.value = v; });
        return api;
      },
      prop(k, v) { list.forEach((n) => { if (n) n[k] = v; }); return api; },
      data(k) {
        const el = list[0];
        if (!el) return undefined;
        // jQuery .data() maps dash-case to dataset camelCase.
        const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const v = el.dataset ? el.dataset[key] : undefined;
        if (v === undefined) return undefined;
        const n = Number(v);
        return Number.isNaN(n) ? v : n;
      },
      each(fn) { list.forEach((n, i) => fn.call(n, i, n)); return api; },
    };
    return api;
  }
  function $(sel) {
    if (typeof sel === 'string') return wrap([...document.querySelectorAll(sel)]);
    if (sel && sel.nodeType) return wrap([sel]);
    return wrap([]);
  }
  $.fn = {};
  return $;
})();
`;

/**
 * Build a ready-to-test page.
 * @param {{ html?: string }} [opts]
 */
function createPage(opts = {}) {
  const html = opts.html ?? fs.readFileSync(HTML, "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;

  // Inject jQuery shim + page functions into the page world (window scope).
  window.eval(JQUERY_SHIM);
  window.eval(PAGE_WORLD_SCRIPT);

  // Bind the page's own APEX click handler: clicking .choice-SelectArea -> toggleChoice.
  window.document.querySelectorAll(".choice-SelectArea").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      window.toggleChoice(window.$(e.currentTarget));
    });
  });

  // APEX submit spy + the page's own #quiz-submit -> apex.da.submitPage binding.
  window.__submitPageCalls = [];
  window.apex = window.apex || {};
  window.apex.da = window.apex.da || {};
  window.apex.da.submitPage = function (opts) {
    window.__submitPageCalls.push(opts && opts.request ? opts.request : "SUBMIT");
  };
  // The page binds the button click via its declarative actions; emulate it.
  const reconfigureSubmit = () => {
    const btn = window.document.querySelector("#quiz-submit");
    if (!btn || btn.__oqsBound) return;
    btn.__oqsBound = true;
    btn.addEventListener("click", () => {
      if (btn.classList.contains("apex_disabled") || btn.disabled) return;
      window.apex.da.submitPage({ request: "SUBMIT" });
    });
  };
  reconfigureSubmit();

  // chrome stub shared between content scripts.
  const store = opts.store ?? {};
  const sessionStore = opts.sessionStore ?? {};
  window.__store = store;
  window.__sessionStore = sessionStore;
  console.info = console.info || (() => {});
  window.chrome = {
    storage: {
      local: {
        get: (k) => Promise.resolve(typeof k === "string" ? { [k]: store[k] } : { ...store }),
        set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
      },
      session: {
        get: (k) => Promise.resolve(typeof k === "string" ? { [k]: sessionStore[k] } : { ...sessionStore }),
        set: (obj) => { Object.assign(sessionStore, obj); return Promise.resolve(); },
      },
    },
    runtime: {
      lastError: null,
      sendMessage: opts.sendMessage || ((msg, cb) => { if (cb) cb({ ok: false, error: "no worker" }); }),
    },
  };

  /** Set a hidden P190_* page item value. */
  window.__setItem = (name, value) => {
    const el = window.document.querySelector(`#${name}`);
    if (el) el.value = String(value);
  };
  /** Re-run the page's submit binding after the DOM is rebuilt. */
  window.__reconfigureSubmit = reconfigureSubmit;

  return { dom, window, store, sessionStore };
}

/** Load extension content libs into the page VERBATIM (no ESM stripping), so a
 *  lingering `export`/`import` would be caught as a SyntaxError — exactly like
 *  Chrome would reject it. */
function loadContentScripts(window) {
  const scripts = [
    "src/lib/version.js",
    "src/lib/hash.js",
    "src/lib/prompt.js",
    "src/lib/answer-key.js",
    "src/lib/human.js",
    "src/content/scraper.js",
    "src/content/applier.js",
    "src/content/panel.js",
    "src/content/content.js",
  ];
  const loaded = [];
  for (const rel of scripts) {
    const code = fs.readFileSync(path.join(EXT, rel), "utf8");
    // new Function() parses as a classic script: `export`/`import` will throw.
    const fn = new Function(
      "window", "globalThis", "document", "crypto", "TextEncoder", "AbortController",
      "fetch", "setTimeout", "clearTimeout", "MutationObserver", "chrome", code
    );
    fn.call(
      window, window, window, window.document,
      require("crypto").webcrypto, util.TextEncoder, window.AbortController,
      () => Promise.reject(new Error("no fetch in test")),
      window.setTimeout.bind(window), window.clearTimeout.bind(window),
      window.MutationObserver, window.chrome
    );
    loaded.push(rel);
  }
  return loaded;
}

/** Load ONLY the pure libs (no content.js auto-init) — for unit-style tests. */
function loadLibsOnly(window) {
  const scripts = [
    "src/lib/hash.js",
    "src/lib/prompt.js",
    "src/lib/answer-key.js",
    "src/lib/human.js",
    "src/content/scraper.js",
    "src/content/applier.js",
  ];
  for (const rel of scripts) {
    const code = fs.readFileSync(path.join(EXT, rel), "utf8");
    const fn = new Function("window", "globalThis", "document", "crypto", "TextEncoder", code);
    fn.call(window, window, window, window.document, require("crypto").webcrypto, util.TextEncoder);
  }
}

/**
 * Load the background worker in a sandbox that emulates a CLASSIC MV3 service
 * worker: `importScripts()` resolves relative to the worker file, and the
 * worker's own code is NOT a module (so ESM would throw).
 * @param {{ fetch?: Function, chrome?: any }} [env]
 * @returns {{ globals: any, getMessageListener: () => Function | undefined }}
 */
function loadServiceWorker(env = {}) {
  const workerPath = path.join(EXT, "src/background/service-worker.js");
  const workerDir = path.dirname(workerPath);
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder: util.TextEncoder,
    AbortController,
    fetch: env.fetch ?? (() => Promise.reject(new Error("no fetch"))),
    crypto: require("crypto").webcrypto,
    chrome: env.chrome ?? { runtime: { onMessage: { addListener() {} } } },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  let messageListener;
  sandbox.chrome = {
    ...sandbox.chrome,
    runtime: {
      ...(sandbox.chrome.runtime ?? {}),
      onMessage: { addListener: (fn) => { messageListener = fn; } },
    },
  };

  // Emulate importScripts: read + eval each dependency with the same sandbox.
  sandbox.importScripts = (...paths) => {
    for (const p of paths) {
      const full = path.resolve(workerDir, p);
      const code = fs.readFileSync(full, "utf8");
      const fn = new Function(
        "globalThis", "self", "chrome", "fetch", "console", "setTimeout", "clearTimeout",
        "TextDecoder", "TextEncoder", "AbortController", "crypto", "importScripts", code
      );
      fn.call(
        sandbox, sandbox, sandbox, sandbox.chrome, sandbox.fetch, console,
        sandbox.setTimeout, sandbox.clearTimeout, sandbox.TextDecoder, sandbox.TextEncoder,
        sandbox.AbortController, sandbox.crypto, sandbox.importScripts
      );
    }
  };

  // Evaluate the worker body (classic script).
  const workerCode = fs.readFileSync(workerPath, "utf8");
  const workerFn = new Function(
    "globalThis", "self", "chrome", "fetch", "console", "setTimeout", "clearTimeout",
    "TextDecoder", "TextEncoder", "AbortController", "crypto", "importScripts", workerCode
  );
  workerFn.call(
    sandbox, sandbox, sandbox, sandbox.chrome, sandbox.fetch, console,
    sandbox.setTimeout, sandbox.clearTimeout, sandbox.TextDecoder, sandbox.TextEncoder,
    sandbox.AbortController, sandbox.crypto, sandbox.importScripts
  );

  return { globals: sandbox, getMessageListener: () => messageListener };
}

module.exports = { EXT, HTML, createPage, loadContentScripts, loadLibsOnly, loadServiceWorker };
