# Oracle Quiz Solver

**Answers Oracle Academy quizzes for you.** Open a quiz, and a small panel works
out the answer to each question; click **Apply** and submit. That's the whole idea.

- Works on single-answer questions **and** "select all that apply" questions.
- **Handles SQL *and* general questions** — Database Design / theory, other
  subjects, and quizzes in any language (English, Bahasa Indonesia, and more).
- Uses your own saved answers first (instant + offline), then free AI.
- **Nothing is submitted for you** unless you turn on Autopilot.

---

## Table of contents

- [Install (2 minutes)](#install-2-minutes)
- [Use it](#use-it)
- [The panel: every button explained](#the-panel-every-button-explained)
- [Questions with more than one answer](#questions-with-more-than-one-answer)
- [Going hands-off: Autopilot](#going-hands-off-autopilot)
- [Human mode](#human-mode)
- [Where answers come from](#where-answers-come-from)
- [Choosing an AI provider](#choosing-an-ai-provider)
- [All settings](#all-settings)
- [Backing up / sharing your answers](#backing-up--sharing-your-answers)
- [Troubleshooting](#troubleshooting)
- [Honest limits](#honest-limits)

---

## Install (2 minutes)

1. Open **`chrome://extensions`** in Chrome (or **`edge://extensions`** in Edge).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the **`oracle-solver-extension`** folder.
5. Done. The extension is now installed.

> Keep the `oracle-solver-extension` folder where it is — Chrome reads it from
> that location every time.

---

## Use it

1. Open your quiz on **`https://academy.oracle.com`**.
2. A **Quiz Solver** panel appears in the **top-right** of the page.
3. The panel shows the suggested answer(s) with a confidence score.
4. Click **Apply** to select it on the page.
5. Click the page's own **Submit Answer** — exactly like normal.

That's it. Repeat for each question.

> **The panel isn't appearing?** Reload the extension in `chrome://extensions`
> (the ↻ button) and refresh the quiz tab. See [Troubleshooting](#troubleshooting).

---

## The panel: every button explained

| Button | What it does |
|---|---|
| **Apply** | Selects the suggested answer(s) on the page. You still press Submit yourself. |
| **Cycle** | Shows the next-best guess, if you disagree with the first. |
| **Ask AI** | Asks the AI again for a fresh answer to this question. |
| **Never** | Skips this exact question from now on (useful for trick questions). |
| **STOP** | Stops Autopilot immediately. |

**Keyboard shortcuts:** press **`1`**–**`9`** to click that choice yourself, or
**`Ctrl+Enter`** (Windows/Linux) / **`Cmd+Enter`** (Mac) to re-ask the AI.

Turn off **Auto-solve when a question loads** to keep the panel idle until you
press **Ask AI**. Autopilot and Auto-fill continue solving because they need an
answer to act on.

You can drag the panel by its header to move it anywhere on the screen.

---

## Questions with more than one answer

Some Oracle questions say **"Select all that apply"** or **"(Pilih dua)"** and
want **two or more** answers. The extension handles these with no extra work from
you:

- The panel shows a count, e.g. **`Suggested answer (2 answers) · 90%`**.
- It highlights **all** correct choices in the page.
- **Apply** selects **all of them** at once.
- **Cycle** is greyed out, because there's nothing to cycle through — the whole
  set is the answer.

You don't have to tell the extension which type a question is — it reads that
from the page.

---

## Going hands-off: Autopilot

**Off by default.** Autopilot does everything for you: solve → select → submit →
next question.

**Turn it on:** right-click the toolbar icon → **Options** → click the
**Full auto** preset.

> ⚠️ **Full auto submits every answer for you** and, if enabled, completes the
> whole assessment. This is **irreversible**. Only use it when you're confident.

Autopilot has safety nets built in:

| Safety net | What it means |
|---|---|
| **Minimum confidence** | If the AI isn't sure enough, Autopilot **pauses** instead of guessing. |
| **Delay before submit** | A few seconds' grace so you can hit **STOP**. |
| **STOP** | Cancels right away — even across the page reload between questions. |
| **Loop cap** | Auto-stops after `questions + 2` submits. It can never run away. |
| **New quiz** | Starts with a fresh Autopilot count and clears a STOP from a previous quiz. |
| **Preview pages** | Never submits on preview-only pages. |
| **Image questions** | Pauses automatically (the AI can't read images). |
| **Last question** | Stops for your review, unless you turned on *Complete on last question*. |

---

## Human mode

**Off by default.** Autopilot answering everything 100% perfectly looks suspicious.
Human mode makes a run look like a real student by **occasionally getting hard
questions wrong on purpose**.

- It judges each question's difficulty locally — no extra AI calls.
- Only questions harder than **your threshold** can be missed.
- **Miss rate** controls how often eligible questions are missed.
- On single-answer questions it picks a believable wrong choice; on multi-answer
  questions it drops one of the correct answers.
- **It only affects Autopilot and Auto-fill.** When *you* press **Apply**, you
  always get the correct answer.
- A deliberate miss is **never saved**, so the same question can be answered
  correctly on your next attempt.

Turn it on in **Options → Human mode**.

---

## Where answers come from

Every question is answered in this order:

1. **Your saved answers first** — instant, offline, and free.
2. **Free AI second** — only for questions you haven't answered before.

With **3-model consensus** on (the default), a new question is answered by **three
different AI models** and the majority wins. This is much more accurate than any
single model, and the answer is then saved so it's never asked again. (The Google
Gemini web app answers in a single pass — see
[Choosing an AI provider](#choosing-an-ai-provider).)

**It adapts to the question.** The solver first works out *what kind of question*
it is — a real SQL query, a Database Design / theory concept, code in another
language, or an ordinary multiple-choice item — and applies the right expertise to
it. It also understands the question in its own language (e.g. Bahasa Indonesia)
and reasons in that language. You don't have to configure anything.

**Privacy note:** any question that isn't already saved is sent to the free AI
service you picked in **Options → AI provider** (by default the public
`gemini.google.com` web app). Turn **Free AI fallback** **off** in Options to
keep everything offline and use only your own saved answers.
---

## Choosing an AI provider

The extension can talk to **seven** free AI backends. Pick one in
**Options → AI provider**. Four of them need **no account and no key at all**.

| Provider | Account / key | What you get |
|---|---|---|
| **Google Gemini web app** | **None** | The real [gemini.google.com](https://gemini.google.com) web app, used the same way a browser uses it. **Gemini Flash** answers a question in about 5–10 seconds, needs no sign-up and no key, and stores no credential in the extension. **Recommended starting point.** |
| **TuskCentral** | **None** | 8 models (GPT-5.4 Mini, Gemini 3.5 Flash Lite, DeepSeek V3.2, Llama 4 Maverick…). Works immediately after install, but the free endpoint is rate-limited to roughly one request per minute. |
| **Pollinations** | **A free API key** | A far stronger catalogue: **GPT-5.4, GPT-6.1 Sol, Claude Sonnet 5, Gemini 3.8 Flash, DeepSeek V4, Kimi K3, GLM-5.3, Grok 4.6** — and no per-IP rate cap, so the 3-model vote is fast. |
| **Ollama** (local) | **None** | Runs on your own machine. Install [Ollama](https://ollama.com), pull a model (`ollama pull qwen3-coder:30b`), and the extension talks to `http://localhost:11434`. Free forever, unlimited, and **the question never leaves your computer**. |
| **LM Studio** (local) | **None** | Same idea with [LM Studio](https://lmstudio.ai) on `http://localhost:1234`. |
| **On-device AI** (Chrome) | **None** | Chrome's own built-in model (Gemini Nano) — no server, no account, no network. Needs Chrome 138+ on desktop, **22 GB free disk** and 4 GB VRAM or 16 GB RAM, and the model is downloaded on first use. |
| **Custom endpoint** | **Your own free key** | Any OpenAI-compatible endpoint. Presets included for **Groq, OpenRouter, Google Gemini, Cerebras, Mistral, NVIDIA NIM, Ollama Cloud** — each has a free tier that *you* sign up for. The extension never ships or spends anybody's key. |

### Google Gemini web app (no account, no key)

This is the strongest option that needs **nothing** from you: no sign-up, no API
key, no card, no configuration. The extension talks to the public
[gemini.google.com](https://gemini.google.com) web app directly and answers
with **Gemini Flash**.

- **Nothing to set up.** Pick *Google Gemini web app* in Options → AI provider
  and it works.
- **No credential is stored.** The extension does not ask for, read or keep your
  Google cookies or password. It works as a **guest session**, exactly like
  opening the site in a private window — and Chrome does not even let it: an
  extension's request carries no cookies for the site it calls, so your Google
  session is unreachable by construction.
- **Your questions are not saved** in your Gemini history — every question is
  sent as a temporary chat that is discarded afterwards.
- **Speed:** roughly **5–10 seconds** per question.
- **One answer per question.** The web app exposes one account's models, so
  there is no 3-model vote here — a second call would just ask the same model
  again. Turn **3-model consensus** on and the extension still uses its normal
  behaviour on the other providers.

The protocol was ported from the open-source
[Gemini-API](https://github.com/HanaokaYuzu/Gemini-API) project (AGPL-3.0),
which reverse-engineers the same web endpoint.

> **A note on "free".** This talks to a public web service without an official
> API agreement, so it is rate-limited by Google and could change or stop
> working at any time. The extension fails over to another provider
> automatically if it does, and your saved answers keep working regardless.

### Local models (no account, no key, no limits)

The best "free for everyone" answer if you're willing to run one command:

```bash
ollama pull qwen3-coder:30b      # or: ollama pull gpt-oss:20b
ollama serve                     # keeps running in the background
```

Then pick **Ollama** in Options → AI provider, press **Detect models**, and
choose your model. Nothing is sent to any third party, there is no rate limit,
and the quality is whatever model you install.

### Getting the free Pollinations key (30 seconds, no credit card)

1. Go to **<https://enter.pollinations.ai/keys>**, sign in, and create a key.
2. Paste it into **Options → AI provider → API key**.
3. Press **Test provider** — you should see `OK`.

The key stays in this browser profile only (Chrome's local extension storage)
and is sent in a request header, never in a URL. Each free account gets a small
pollen balance that refills over time; one solved question costs a tiny
fraction of it.

**Without a key** Pollinations still works, but only through its keyless
endpoint: one model, one request per 30 seconds. The extension therefore drops
to a single answer (no 3-model vote) on that path — use it if you just want
something free, or switch to TuskCentral.

### If a provider fails

The extension **fails over automatically**: if the selected hosted provider
errors or gets rate-limited, it asks the other one instead, so a broken
provider never leaves you with no answer.

**Local, on-device and custom providers never fall back to a hosted one** — the
question must not leave the machine you chose.

### Other providers?

Groq, OpenRouter, Gemini, Cerebras, Mistral and Ollama Cloud all have free
tiers too. They are all reachable through **Custom endpoint** with your own
free key, so you never depend on the extension author's account.

---

## All settings

Open **Options**: right-click the toolbar icon → **Options**, or
`chrome://extensions` → **Details** → **Extension options**.
**Every change saves automatically — there is no Save button.**

### Presets (one click sets a whole mode)

| Preset | What it does | Best for |
|---|---|---|
| **Suggest only** *(default)* | Panel shows the answer; you Apply and Submit. | Safest — you check everything. |
| **Auto-fill** | Answers are auto-**selected**; you still press Submit. | Faster, but you still confirm each question. |
| **Full auto** | Auto-select **and** auto-submit everything, then finish. | Hands-off (read the warnings above first). |

### Individual settings

| Setting | What it does |
|---|---|
| **Provider** | Which free AI backend to use: Google Gemini web app, TuskCentral, Pollinations, Ollama, LM Studio, On-device AI, or a custom endpoint. |
| **API key** | Your free key. Only needed by Pollinations and custom endpoints. |
| **Endpoint** | Preset base URL for a custom endpoint (Groq, OpenRouter, Gemini, Cerebras, Mistral, NVIDIA, Ollama…) or your own. |
| **Preferred AI model / Model id** | Which model votes first. A list for Gemini/Tusk/Pollinations; a typed id for local and custom endpoints. |
| **Detect models** | Asks the endpoint which models it has. |
| **Test provider** | Sends one tiny request to check the provider + key work. |
| **Free AI fallback** | Off = use only your saved answers (fully offline). |
| **Auto-solve when a question loads** | Solve automatically, or only when you click Ask AI. |
| **3-model consensus** | Three models vote; majority wins. More accurate, but slower. |
| **Show AI reasoning** | Show the AI's short explanation in the panel. |
| **Autopilot** | Auto-select + auto-submit each question. |
| **Complete on last question** | Also finish the whole assessment. Irreversible. |
| **Minimum confidence** | Below this, Autopilot pauses instead of applying. |
| **Delay before submit** | Grace period (in milliseconds) to hit STOP. |
| **Human mode** | Deliberately miss some hard questions. |
| **Miss rate on hard questions** | How often eligible hard questions are missed (0–100%). |
| **Only miss questions harder than** | Difficulty threshold; easier questions are always correct. |

Settings related to Autopilot are **greyed out until Autopilot is on**, and
Human-mode settings stay **greyed out until Human mode is on**.

---

## Backing up / sharing your answers

Every answer you get is saved to your **answer key**.

- **Options → Export** copies your whole key to the clipboard (and shows it in a
  box). Keep the file as a backup.
- **Options → Import** loads a key from the text box — handy for moving to another
  computer or sharing with a friend.
- **Options → Clear** deletes everything (asks first).

---

## Troubleshooting

**The panel doesn't appear / nothing happens.**
Reload the extension: `chrome://extensions` → click the **↻ Reload** button on the
extension → then refresh the quiz tab.

**It keeps showing an old answer / an error about `export` or `Status code: 15`.**
Chrome is running an **old cached copy**. Chrome does not auto-update extensions
you loaded yourself. To force a clean reload:

1. `chrome://extensions` → **Remove** the extension.
2. Close **every** `academy.oracle.com` tab.
3. **Restart Chrome.**
4. **Load unpacked** again (pick the `oracle-solver-extension` folder).
5. Reopen the quiz.

**Still stuck?** Go to `chrome://serviceworker-internals`, find the extension's
worker, click **Unregister**, then reload the extension.

**Autopilot stopped by itself.** That's usually a safety net doing its job — check
the message in the panel (low confidence, preview page, or the loop cap). You can
also raise **Minimum confidence**, or press **STOP** and take over.

---

## Honest limits

- Correctness depends on your saved answers and the AI — **always spot-check**
  before you rely on it.
- The hosted free AI services are unofficial and rate-limited; they may change
  or stop working. Your saved answers always keep working offline.
- The **Google Gemini web app** provider talks to a public web endpoint without
  an official API agreement. It needs no key and no account, but Google may
  rate-limit it or change it. The extension fails over to another provider
  automatically, and your saved answers keep working regardless.
- The Pollinations free tier is a **metered pollen balance** that refills over
  time. Heavy use can exhaust it until it refills; the extension then falls
  back to TuskCentral.
- Chrome's on-device AI needs **22 GB of free disk** and a decent GPU/CPU, and
  downloads its model on first use — it is not available on every machine.
- Local models are only as good as the model you install, and a weak local
  model can be less accurate than the hosted ones. Check the confidence score.
- Your question text is sent to whichever provider you selected. Use a local
  or on-device provider if that matters, or turn the AI fallback off entirely.
- This is a study aid. It helps you answer — it doesn't guarantee a grade, and you
  are responsible for how you use it.
