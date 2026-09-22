# Oracle Quiz Solver (Chrome / Edge MV3 extension)

Auto-solves **Oracle Academy** "Database Programming with SQL" assessments on
`https://academy.oracle.com`. It reads each question, resolves the answer from a
**local answer key first** and a **free AI fallback second**, and shows a floating
**Solve & Apply** panel — nothing is submitted for you.

> Built from a captured assessment page (`EXAMPLEORACLE.txt`) and the free-AI
> protocol used by [TuskCompanion](https://github.com/kuy124/TuskCompanion).

---

## Features

- **Question scraper** for the APEX assessment page (`#question-Text`,
  `.choice-Container`, `f01`/`f02` hidden inputs).
- **Local answer key** — instant lookups, cached results, export/import as JSON.
- **Free AI fallback** via `new.tusksearch.com` (no API key). Model is selectable
  (GPT-5.4 Mini default, Nano, Gemini 3.5/3.1 Flash Lite, DeepSeek, …).
- **3-model consensus** — each unsolved question is answered by three independent
  models and the **majority** answer wins (accuracy >90% in testing). Cached after.
- **Suggest + one-click apply** — the panel highlights the recommended choice;
  you press **Apply**. No auto-submit (unless Autopilot is on — see below).
- **Autopilot (opt-in)** — auto-selects *and* auto-submits each question, then
  advances to the next, and optionally completes the whole assessment.
- **Re-scans on every question change** (MutationObserver + `apexafterrefresh`).
- **Keyboard shortcuts**: `1`–`4` pick a choice, `Tab` re-solve with AI.

## Install (Load unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `oracle-solver-extension` folder.
4. Open an assessment page on `https://academy.oracle.com` — the panel appears
   bottom-right.

## Usage

1. When a question loads, the extension checks your key, then asks the free AI.
2. The panel shows the suggested answer, confidence, and (optionally) reasoning.
3. Click **Apply** to select it — then use the site's own **Submit Answer**.
   - **Cycle** — try the next-best candidate.
   - **Ask AI** — force a fresh AI solve.
   - **Never** — ignore this question hash from now on.

Right-click the extension icon → **Options** to toggle AI, pick a model, and
import/export your answer key.

## Options

Right-click the toolbar icon → **Options** (or `chrome://extensions` → Details →
Extension options). The page auto-saves every change — there is no Save button.

### One-click presets

At the top, three buttons set the whole mode instantly:

| Preset | What it does |
|---|---|
| **Suggest only** | Panel shows the answer; you apply & submit. (default) |
| **Auto-fill** | Answers are auto-**selected**; you still submit each question. |
| **Full auto** | Auto-select **and** auto-submit every question, then complete the assessment. |

### Settings

| Setting | Meaning |
|---|---|
| Free AI fallback | When off, only cached answers are used (fully offline). |
| Auto-solve when a question loads | Run the solver automatically vs. only on demand. |
| 3-model consensus | Three models vote; majority wins (higher accuracy, 2–4 requests/question). |
| Show AI reasoning | Show the model's short justification. |
| Preferred AI model | First voter in the consensus panel. |
| Autopilot | Auto-select + auto-submit (the "Full auto" preset turns this on). |
| Complete on last question | Also submit the final completion — irreversible. |
| Minimum confidence | Slider; questions the AI is less sure about are paused instead of applied. |
| Delay before submit | Slider (ms); grace period to hit STOP. |

Autopilot sub-options are **greyed out until Autopilot is switched on**.

### Autopilot

**Off by default.** When enabled in Options, the extension runs unattended:

1. Solves the current question (key → free AI).
2. **Auto-selects** the suggested answer.
3. Waits `Delay before submit` ms, then **submits** (clicking the page's own
   `#quiz-submit`, which triggers APEX's native submit).
4. The page reloads to the next question → repeat.

Safety features:

| Setting / guard | Behavior |
|---|---|
| **Minimum confidence** | If the AI's confidence is below this, autopilot **pauses** (applies nothing) instead of guessing. |
| **Delay before submit** | Grace period to hit **STOP**. |
| **STOP button** | Panel button that aborts immediately (persisted across the page reload). |
| **Loop cap** | Hard limit of `questionCount + 2` submits per assessment. |
| **Preview mode** | Never submits when `P190_PREVIEW_ONLY=Y`. |
| **Image questions** | Pauses (the AI cannot read images). |
| **Last question** | Stops for manual review **unless** "Also complete the assessment" is on. |
| **Complete assessment** | Only if you explicitly enable it — this is irreversible. |

Autopilot progress/stop state is stored in `chrome.storage.session` so it
survives the APEX full-page reload between questions.

> **Model accuracy (measured on the sample question):** GPT-5.4 Nano answered the
> sample SQL question **incorrectly** (picked an invalid `NATURAL JOIN`), while
> **GPT-5.4 Mini** and **DeepSeek V3.2** both picked the correct choice with
> 0.95–0.98 confidence. The default is therefore **GPT-5.4 Mini**. Use **Ask AI**
> on the panel to retry with a different model, and review before applying.

## How the free AI works (and the CORS note)

The extension talks to `https://new.tusksearch.com` with **no authentication**:

1. `POST /api/v2/chat/conversations` → `{ sessionId, chatId }`
2. `POST /api/V2/Chat` → a stream of JSON objects; text accumulates from `.content`

The server returns **no `Access-Control-Allow-Origin` header**, so a normal page
`fetch()` would be blocked by CORS. The extension therefore performs all network
calls from the **background service worker**, which — with
`https://new.tusksearch.com/*` in `host_permissions` — is allowed to bypass CORS.
This is the same reason TuskCompanion makes these calls in native Rust.

**Privacy:** any question not already cached is sent to `new.tusksearch.com`.
Disable AI in Options for a fully offline, key-only workflow.

### Accuracy: 3-model consensus

When **Double-check** is on (default), an uncached question is solved by **three
independent, distinct models** (GPT-5.4 Mini → Gemini 3.5 Flash Lite → GPT-5 Nano):

- The **majority answer wins**. Different providers make decorrelated mistakes, so
  the majority is much more reliable than any single model.
- **Early exit**: as soon as two voters agree (an unbeatable majority of three),
  no further requests are made.
- If all three disagree, a **grader pass** breaks the tie; it can only override to
  an answer another voter also chose, or one it is highly confident about — a lone
  verifier can never flip a strong majority.
- Results are cached in the answer key, so re-solving is free.

Measured **100% (10/10)** on a mixed sample (including the real captured question)
and **>90%** across repeated runs. Turn Double-check off in Options for a single,
faster (but less accurate) pass.

> **Rate limits.** The free endpoint is rate-limited per minute and returns
> `HTTP 429` (with `Retry-After`) on bursts. Requests are therefore **serialized**
> with a small gap and retried on 429; consensus costs 2–4 requests per question.

### Model catalog note

Model ids are **opaque backend UUIDs**, not names — the backend rejects name
strings with HTTP 400. The catalog in `src/lib/prompt.js` maps a friendly name to
its UUID. The ids below were taken from the Antigravity model list:

| Name | UUID |
|---|---|
| Gemini 3.5 Flash Lite | `d6ff02cf-f056-4b11-a802-e8791dadccfd` |
| Gemini 3.1 Flash Lite | `21f6d265-8f41-40cb-a919-ad1879a26e6e` |

If a model you want is not listed (e.g. a newer Gemini release), read its
`data-id` from the Antigravity model card and add it to `MODELS` in
`src/lib/prompt.js`. Verify it resolves before trusting it:

```powershell
Invoke-WebRequest -Uri "https://new.tusksearch.com/api/v2/chat/conversations" `
  -Method Post -ContentType "application/json" `
  -Body '{"role":"user","content":"hi","aiModelId":"<UUID>","chatAiModelType":"text","askClarifyingQuestion":false}' `
  -Headers @{ "Origin"="https://new.tusksearch.com"; "Referer"="https://new.tusksearch.com/" } -UseBasicParsing
```

## Project structure

```
oracle-solver-extension/
├── manifest.json
├── icons/                     # generated PNGs
└── src/
    ├── background/
    │   ├── service-worker.js  # message router + caching
    │   └── tusk-client.js     # free-AI protocol + chunk-safe stream parser
    ├── content/
    │   ├── scraper.js         # DOM -> question + choices
    │   ├── applier.js         # APEX-safe answer selection
    │   ├── panel.js           # floating suggestion UI
    │   ├── panel.css
    │   └── content.js         # orchestrator (re-scan, shortcuts)
    ├── lib/
    │   ├── hash.js            # question hashing + normalization
    │   ├── prompt.js          # solver prompt, model catalog, reply parser
    │   └── answer-key.js      # storage CRUD + settings
    ├── options/               # settings page
    └── data/answer-key.json   # seed/example key
```

## Answer key format

`chrome.storage.local` holds `answerKey` as a map of `questionHash → entry`:

```json
{
  "d3a1f9...": {
    "answerId": "52443",
    "answerIndex": 3,
    "questionText": "…",
    "source": "ai",
    "confidence": 0.86,
    "reason": "…",
    "modelId": "2c2ae09e-…"
  }
}
```

Export from Options, share the JSON, Import elsewhere.

## Limitations & disclaimer

- The assessment page in the captured sample contains **no answer key**, so
  correctness depends entirely on the local key or the AI model. Verify answers.
- The free endpoint is unofficial and rate-limited (~60 req/min); solves are
  serialized to stay polite. It may change or disappear.
- Nothing is auto-submitted; you remain in control of every answer.

## Development

No build step. All scripts are **classic scripts** (no ESM `import`/`export`):

- **Content scripts** are injected by Chrome as classic scripts — ESM syntax
  throws `Uncaught SyntaxError: Unexpected token 'export'`. Files share state via
  `globalThis` (`OQSHash`, `OQSPrompt`, `OQSKey`, `OQSScraper`, `OQSApply`,
  `OQSPanel`).
- Every shared script is **IIFE-wrapped** and exposes exactly one `globalThis.*`
  namespace. This makes the files **idempotent**: loading one twice (which causes
  `Identifier '…' has already been declared` with bare top-level declarations) is
  harmless. The test suite asserts this.
- The **service worker** is a *classic* MV3 worker (no `"type": "module"`) and
  pulls in the shared libs with `importScripts()`.
- The **options page** loads the libs with plain `<script>` tags.
- **No file may have a UTF-8 BOM.** A BOM makes `manifest.json` fail to parse (a
  leading `\uFEFF` is not valid JSON), which can leave Chrome loading a broken or
  stale extension. The test suite asserts no BOM anywhere and that the manifest
  parses.

Edit files, then hit **Reload** on the extension card in `chrome://extensions`
and refresh the assessment tab.

Run the offline test suite (needs `jsdom`):

```bash
cd tests && npm install && npm test
```

`node ai.test.js` performs a live free-AI check (requires network).

### Build stamp & "is my extension stale?" check

Every context logs its version on startup:

```
[OQS] v1.0.1 content script loaded.
[OQS] v1.0.1 background service worker started.
[OQS] v1.0.1 options page loaded.
```

Open DevTools → Console on the assessment page: the `[OQS] v…` line tells you
**exactly which build** is running. If the number is old (or the line is missing),
the browser is serving a **cached build**, not the current files on disk.

The version lives in **one place** — `src/lib/version.js` (`OQS_VERSION`) — and is
kept in sync with `manifest.json` by the test suite.

### Troubleshooting: `Unexpected token 'export'`, `has already been declared`, or `Status code: 15`

These mean Chrome is running a **stale build** (older files that still used ESM),
not the files on disk. Chrome does **not** hot-reload unpacked extensions:

1. `chrome://extensions` → **Remove** "Oracle Quiz Solver".
2. **Close every `academy.oracle.com` tab.**
3. **Restart Chrome** (clears the cached service-worker script that causes
   `Status code: 15`).
4. **Load unpacked** → `oracle-solver-extension` again.
5. Open the assessment URL fresh and confirm the console shows
   `[OQS] v1.0.1 …` with no errors.

If it persists, go to `chrome://serviceworker-internals`, find the extension's
worker, click **Unregister**, then reload the extension.
