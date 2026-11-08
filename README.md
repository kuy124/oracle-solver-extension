# Oracle Quiz Solver

Suggested answers for Oracle Academy quizzes, with one-click selection in Chrome, Edge, and Firefox on Windows, macOS, and Linux.

## About

Oracle Quiz Solver is a browser extension for quizzes on
[Oracle Academy](https://academy.oracle.com). It checks your saved answers first,
then asks your selected AI provider when needed. It supports single-answer and
“select all that apply” questions, including SQL, database theory, and other
subjects in multiple languages.

**By default, you stay in control:** the extension suggests an answer; you review
it, click **Apply**, and submit it yourself. Automatic submission is optional.

> Use this as a study aid and follow your course's rules. AI answers can be wrong;
> a confidence score is not a guarantee.

**Jump to:** [Install](#install) · [Use it](#use-it) ·
[Settings](#settings) · [AI providers](#ai-providers) ·
[Backups](#back-up-your-answers) · [Troubleshooting](#troubleshooting)

## Install

No build step is needed.

### Chrome / Edge (including Linux)

1. [Download the repository ZIP](https://github.com/kuy124/oracle-solver-extension/archive/HEAD.zip)
   and **extract it**, or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Turn on **Developer mode**, then click **Load unpacked**.
4. Select the extracted folder that contains **`manifest.json`**
   (not the ZIP, `src`, or `tests` folder).
5. Open or refresh your Oracle Academy quiz tab.

Keep that folder in place: the browser loads the extension from it.

### Firefox 142+ (including Linux)

1. Download the **oracle-quiz-solver-v1.7.0.zip** asset from the
   [1.7.0 release](https://github.com/kuy124/oracle-solver-extension/releases/tag/1.7.0)
   and extract it, or clone this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on**, then select **`manifest.json`** in the extracted folder.
4. Open or refresh your Oracle Academy quiz tab.

If Firefox asks for site access, allow it for Oracle Academy and your selected
AI provider so the extension can read questions and request answers.

**Firefox removes temporary add-ons when it closes.** Repeat steps 2–3 after a
restart. This release is unsigned; permanent installation in standard Firefox
requires a Mozilla-signed add-on. Do not disable Firefox's signing protections.

On Linux, use these same steps in your preferred supported browser; there is
no separate Linux installer. Chrome's on-device AI is browser/hardware-dependent
and is not available in Firefox; use a hosted provider or a local endpoint instead.

## Use it

1. Open a quiz on **`https://academy.oracle.com`**.
2. Find the **Quiz Solver** panel in the top-right corner.
3. Review the suggested answer and its confidence score.
4. Click **Apply** to select the suggested choice(s).
5. Click the quiz page's **Submit Answer** button yourself.

For questions with multiple answers, **Apply selects the whole suggested set**.
You do not need to change any settings. Drag the panel's header to move it.

| Panel button | What it does |
|---|---|
| **Apply** | Selects the suggested answer(s), without submitting. |
| **Cycle** | Shows the next-best single-answer suggestion; unavailable for multi-answer questions. |
| **Ask AI** | Requests a fresh AI answer. |
| **Never** | Skips this exact question in future. |
| **STOP** | Stops Autopilot. |

**Shortcuts:** `1`–`9` selects a choice; `Ctrl+Enter` (Windows/Linux) or
`Cmd+Enter` (Mac) asks the AI again.

## Settings

Right-click the extension's toolbar icon → **Options**. You can also open
your browser's extensions page → **Details** → **Extension options**.
**Changes save automatically.**

Start with a preset:

| Preset | Selects answers | Submits answers |
|---|---|---|
| **Suggest only** (default) | You click Apply | You submit |
| **Auto-fill** | Automatically | You submit |
| **Full auto** | Automatically | Automatically |

> **Full auto submits real answers.** It can also finish the assessment when
> **Complete on last question** is enabled. Submitted answers cannot be undone
> by the extension. Review your settings before enabling it.

Autopilot pauses for low confidence, image questions, and preview pages. It has
a submit delay, a loop cap, and a **STOP** button. It stops at the last question
for review unless **Complete on last question** is enabled.

<details>
<summary><strong>More settings</strong></summary>

| Setting | What to know |
|---|---|
| **Free AI fallback** | Turn off to use only saved answers, offline. |
| **Auto-solve when a question loads** | Turn off to wait for **Ask AI**. Auto-fill and Autopilot still solve when needed. |
| **3-model consensus** | Uses a majority vote where supported; takes longer than a single answer. Gemini web and keyless Pollinations use a single answer. |
| **Show AI reasoning** | Shows a short explanation in the panel. |
| **Minimum confidence** | Autopilot pauses below this score. |
| **Delay before submit** | Time in milliseconds to review or press STOP. |
| **Complete on last question** | Allows Autopilot to finish the assessment. |
| **Human mode** | Off by default. Deliberately misses some hard questions during Auto-fill or Autopilot. |

Human mode's **miss rate** and **difficulty threshold** control which questions
can be missed. Manual **Apply** still uses the suggested answer, and deliberate
misses are not saved to your answer key.

Autopilot controls are disabled until Autopilot is on; Human-mode controls are
disabled until Human mode is on.

</details>

## AI providers

Saved answers work offline. For new questions, the default provider is the
**Google Gemini web app**. Change it in **Options → AI provider**.

| Provider | Setup | Main trade-off |
|---|---|---|
| **Google Gemini web app** (default) | No API key or account required by the extension | Uses an unofficial public web endpoint; availability can change. |
| **TuskCentral** | No account or key | Hosted service with rate limits. |
| **Pollinations** | Optional free API key | Keyless access is slower; keyed access uses a refillable balance. |
| **Ollama** | Install and run a local model | Requires your computer's resources. |
| **LM Studio** | Run its local server and load a model | Requires your computer's resources. |
| **On-device AI** | A compatible Chrome installation and model download | Hardware and browser requirements apply. |
| **Custom endpoint** | An OpenAI-compatible endpoint and your own key, if required | Setup and limits depend on the service. |

**Privacy:** unsaved questions and answer choices are sent to the provider you
use. Hosted providers can fall back to another hosted service on failure.
Local, on-device, and custom providers do **not** fall back to a hosted provider.
Turn off **Free AI fallback** if you want saved answers only.

<details>
<summary><strong>Provider setup and details</strong></summary>

### Google Gemini web app

Select **Google Gemini web app** in Options. It uses a guest, temporary chat and
does not ask for or store your Google password or cookies. It returns one answer
per question rather than a three-model vote.

This is not an official Gemini API integration. Google may rate-limit or change
the endpoint. The protocol was ported from
[Gemini-API](https://github.com/HanaokaYuzu/Gemini-API) (AGPL-3.0).

### Ollama or LM Studio

For Ollama, install [Ollama](https://ollama.com), then run:

```sh
ollama pull qwen3-coder:30b
ollama serve
```

If Ollama is already running, you do not need to start another server.
Choose **Ollama** in Options → **Detect models** → select your model.
The default address is `http://localhost:11434`.

For [LM Studio](https://lmstudio.ai), load a model and start its local server,
then select **LM Studio**. The default address is `http://localhost:1234`.

Local inference keeps questions on your computer. Answer quality and speed
depend on the model and your hardware.

### Pollinations

1. Create a free key at <https://enter.pollinations.ai/keys>.
2. Select **Pollinations** and paste it into **API key**.
3. Click **Test provider** and look for `OK`.

The key stays in this browser profile's local extension storage and is sent in a
request header. Free accounts have a balance that refills over time. Without a
key, the extension uses a rate-limited, single-model endpoint.

### On-device AI and custom endpoints

On-device AI requires a supported desktop Chrome version (138+), a model
download, and suitable hardware. Allow at least **22 GB free disk space**;
availability also depends on memory and GPU/CPU support.

For a custom endpoint, choose a preset or enter its base URL, provide your own
key if needed, and select a model. Presets include Groq, OpenRouter, Google
Gemini, Cerebras, Mistral, NVIDIA NIM, and Ollama Cloud. Use **Detect models**
and **Test provider** to check your setup.

</details>

## Back up your answers

Answers are saved in this browser profile's **answer key**.

- **Options → Export:** copies the key to your clipboard and displays it in a
  text box. Save that text in a file for backup.
- **Options → Import:** paste a saved key into the text box to restore it or move
  it to another browser profile/computer.
- **Options → Clear:** deletes the saved key after confirmation.

**Export before removing the extension:** uninstalling can delete its local data.

## Troubleshooting

| Problem | Try this |
|---|---|
| **Panel is missing** | Confirm the quiz is on `academy.oracle.com`. Reload the extension on your browser's extensions page, then refresh the quiz tab. |
| **AI fails or is rate-limited** | Open Options → **Test provider**. Check the key, local server, or balance, or choose another provider. Saved answers still work. |
| **Autopilot pauses** | Read the panel message. Low confidence, an image, a preview page, or the loop cap can stop it. Review and submit manually if needed. |
| **Wrong suggestion** | Review the choices; try **Cycle** for a single-answer question or **Ask AI** for a fresh answer. Do not rely on confidence alone. |
| **Old behavior after updating** | Reload the extension, then refresh all quiz tabs. Unpacked extensions do not update automatically. |

If a reload does not fix a stale build or an error such as `Unexpected token
'export'` or `Status code: 15`:

1. **Export your answer key first**, if you can.
2. Remove the extension and close all Oracle Academy tabs.
3. Restart the browser and **Load unpacked** from the updated folder.
4. Import your backup and reopen the quiz.

## Limits

- AI and saved answers can be wrong. Review suggestions before submitting.
- Image questions need manual review; the AI cannot read their images.
- Free hosted services can be rate-limited, change, or stop working.
- Local and on-device models depend on your hardware and model quality.
- This tool does not guarantee a grade. You are responsible for how you use it.
