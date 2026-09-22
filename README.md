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

Autopilot has safety nets built in:

| Safety net | What it means |
|---|---|
| **Minimum confidence** | If the AI isn't sure enough, Autopilot **pauses** instead of guessing. |
| **Delay before submit** | A few seconds' grace so you can hit **STOP**. |
| **STOP** | Cancels right away — even across the page reload between questions. |
| **Loop cap** | Auto-stops after `questions + 2` submits. It can never run away. |
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
single model, and the answer is then saved so it's never asked again.

**Privacy note:** any question that isn't already saved is sent to the free AI
service (`new.tusksearch.com`). Turn **Free AI fallback** **off** in Options to
keep everything offline and use only your own saved answers.

---
