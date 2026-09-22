# Oracle Quiz Solver

**Answers Oracle Academy quizzes for you.** Open a quiz, and a small panel works
out the answer to each question; click **Apply** and submit. That's the whole idea.

- Works on single-answer questions **and** "select all that apply" questions.
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
**`Tab`** to re-ask the AI.

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

---
