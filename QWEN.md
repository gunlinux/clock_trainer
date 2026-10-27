# QWEN.md

Instructional context for working in this repository.

## Project Overview

A single-page, dependency-free web app for teaching children to read an analog clock. The UI is entirely in Russian (`<html lang="ru">`, title "Учимся читать время").

There is no framework, no bundler, no package manager, and no network calls. It is three static files loaded directly by the browser:

| File | Role |
| --- | --- |
| `index.html` | Static markup for the header (score, «Сброс», «Помощь»), the three mode tabs, the SVG clock, one panel per mode, and the help overlay. |
| `app.js` | Everything else: builds the clock face, generates tasks, validates answers, manages score, mode switching and the help overlay. |
| `styles.css` | All styling, animations, and the `@media (max-width:440px)` / `@media (max-width:380px)` breakpoints. |

Git history is a single commit (`initial`), so there is no established commit-message convention to infer.

## Building and Running

No build step exists. Open `index.html` directly, or serve the folder to avoid any file-URL quirks:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

There are no tests, no linter, and no type checker. Verification is manual and performed by the user in a real browser: do not add Playwright, Puppeteer, Selenium, jsdom, DOM harnesses, or any other automated UI tests. Load the page and exercise each tab:

1. **Выбери время** — three difficulty levels chosen in the panel; four options, exactly one is correct; wrong pick highlights the right option and shows the result until **Дальше**. Level 1 (easy): minute labels 5–60 on the dial, time always a multiple of 5. Level 2 (medium): no dial labels, time still a multiple of 5, three hearts; every third consecutive mistake costs a point. Level 3 (hard): no minute labels, any minute, two hearts, at least three options share the same 24-hour hour; every second consecutive mistake costs a point; its options show only the 24-hour reading, while feedback still lists both. On levels 1–2 an option pairs its 12-hour reading with a 24-hour one that always differs, using the +12-hour twin when the plain 24-hour form would repeat the first line. On levels 2–3 a correct answer restores all hearts and resets the consecutive-mistake streak; when the last heart burns the score drops by one (never below zero) and the hearts return with the next task. The score never goes below zero.
2. **Запиши время** — shares the three levels and the selected level with mode 1: level 1 shows minute labels 5–60 and times are multiples of 5, level 2 has no labels and times are still multiples of 5, level 3 has no labels and any minute, so the answer must be exact to the minute. Typing two characters in the hours field jumps focus to minutes; `Enter` submits; both the exact 24-hour reading and its +12-hour twin are accepted. Invalid input shows a validation message without locking the task and without a **Дальше** button. Levels 2–3 show hearts (3 on medium, 2 on hard) and charge the same penalties on consecutive mistakes; a correct answer restores all hearts. After a valid answer the message stays until **Дальше**.
3. **Поставь время** — shares the app-wide level with modes 1–2: the same «Легко / Средне / Сложно» buttons sit in this panel. Buttons move the set time by ±1 h / ±5 min and wrap past midnight, and the hour or minute hand can be dragged with mouse or finger: minutes snap to 5 and passing 12 carries the hour by one, the hour hand keeps the current minutes and half of the day, and the set time follows the drag. The target is announced as both 24-hour readings (`01:00 / 13:00`). On level 1 the digital display shows the set time in the same two-reading format; on levels 2–3 the display is hidden while buttons, dragging and auto-check keep working. The level affects only readout visibility: targets stay multiples of 5, and mode 3 has no hearts or penalties. Match the announced target; after success the message stays until **Дальше**.
4. Score increments only on a correct answer; **Сброс** zeroes it and deals a new task.
5. After any valid answer (correct or wrong, or a success in «Поставь время») the message and the **Дальше** button stay until the child presses it: there is no auto-advance, no countdown and no answer cooldown. Until «Дальше» the options, **Проверить** and the clock buttons are disabled.
6. **Помощь** — the header button opens `clock_help.png` full-screen over the app; the whole image is contained, a click/tap anywhere or `Esc` closes it. Opening or closing help must not change the task, hands, typed values, score, hearts, visible feedback or «Дальше»; page scroll is locked while it is open.

Check the console for errors after changing `app.js` — there is no other safety net.

## Architecture and Data Flow

`app.js` is a single IIFE in strict mode with all state in module scope. Load order: `index.html` must include `app.js` after the markup (it is a plain `<script>` at the end of `<body>`, not deferred), because the IIFE queries `#ticks`, `#numbers`, `#hourHand`, etc. immediately at startup.

**Clock rendering.** The face is not static HTML: 60 tick `<line>`s and 12 numeral `<text>`s are generated once into `#ticks` / `#numbers` using `document.createElementNS`. Angles are computed with `sin`/`cos` around center `(100, 100)`, using `y = 100 - r·cos θ`. Hands rotate via inline `transform: rotate(...)`; CSS supplies `transform-box: view-box` and `transform-origin: 100px 100px` so rotation happens about the center.

**Hand animation.** `hAngle` / `mAngle` are cumulative, not absolute. `setClock()` adds `shortestDelta(current, target)` so hands always take the short way around instead of unwinding backwards, and the CSS transition animates the difference. If you ever reset these accumulators, the hands will visibly spin.

**Task state.** A single `{ mode, level, answer, score, mistakes, locked, heartsDown }` object. `answer` is *total minutes since midnight* (0–1439). `level` (1–3) is shared by all three modes and is described by the `LEVELS` table (`step`, `minutes`, `penaltyEvery`); modes 1–2 use the step and penalty fields, while mode 3 only uses it to decide whether the digital readout is visible. `locked` blocks further answers until `nextTask()` runs from «Дальше», a tab switch, a level change or «Сброс». `mistakes` counts consecutive failures and is shared by both leveled quiz modes; `heartsDown` keeps the hearts burned after a penalty until `nextTask()` refills them. `awardPoint()` resets the streak; `registerMistake()` burns hearts and owns the penalty rules.

**Set-time presentation.** Mode 3's target and digital readout both use `dualLabel(t)`, which returns `pairLabel(t).h24a + ' / ' + pairLabel(t).h24b` (for example `01:00 / 13:00`). `.digital` contains two `hh:mm` groups updated by `renderDigital()`. `syncLevelUi()` toggles `#panel3.readout-off` when `state.mode === 3 && state.level > 1`; CSS hides only `.digital`, so the buttons, hands and auto-check keep working. Mode 3 still deals `randomTime(5)` and never renders hearts.

**Hand dragging.** Mode 3 accepts pointer input on `#clock`: `pointerdown` maps the pointer into the 200×200 viewBox, computes the angle from 12 o'clock, and picks the hand with the smaller angular distance (18° threshold, dead zone r<18; overlapped hands split at r=45 — minute outside, hour inside). Minute drags snap `dM` to the nearest 5 and carry the hour by ±1 whenever the snapped minutes wrap past 60/0 (a full turn of the minute hand); hour drags take the sector `floor(angle / 30) % 12` and keep the current half of the day. Every move calls `renderDigital()`, so the display, hands and auto-check share the buttons' path. `#clock.drag-on` (mode 3 only) enables `touch-action:none` and the grab cursor; `.dragging` disables the hand transition.

**Manual round advance.** After an answer the handlers set `state.locked`, show `#feedback` and unhide `#next`, then disable the answer controls with `setAnswerControls(false)`. `#next` is the only way to continue after an answer; `nextTask()` hides the message and the button, unlocks the round, re-enables the controls and refills hearts. There are no task timers or cooldowns.

**Help overlay.** `#helpOpen` is a header button outside the tabs; `#helpOverlay` sits after `.card` with `role="dialog"`, the single `clock_help.png` image and `tabindex="-1"`. `openHelp()` adds `.open` and `body.help-open`, marks `header`, `.tabs` and `.card` with `inert`, sets `aria-expanded` and focuses the overlay. `closeHelp()` is bound to a `click` anywhere on `#helpOverlay` (the image click bubbles to it) and to `Escape`; it adds `.closing`, hides the layer on the `help-out` `animationend` or a 260 ms fallback timer, then removes the classes, `inert` and the scroll lock and returns focus to `#helpOpen`. The overlay touches none of the task state and is not a mode.

## Domain Invariant: the 720-Minute Cycle (read this before touching answer logic)

The app deliberately mixes a **12-hour analog face** with **24-hour answers**.

- `visualKey(t)` returns `t % 720` — the key of the *physical hand position*.
- `pairLabel(t)` returns the 12-hour label plus both 24-hour readings that look identical on the dial (`hh:mm` and `hh±12:mm`).
- Therefore any time and its +12 h counterpart are **the same question**, and **both must be accepted**.

Consequences already encoded in the code:

- `randomTime(step)` picks hours from 0–23, so tasks are always announced in 24-hour form (needed for mode 3's target); `step` is `LEVELS[state.level].step` for modes 1–2 (5 on levels 1–2, 1 on level 3) and 5 for mode 3.
- Mode 2 (`checkTyped`) is correct when `typed === answer` **or** `visualKey(typed) === visualKey(answer)`.
- `buildOptions()` deduplicates distractors by `visualKey`, not by raw value, so two options can never occupy the same visible hand position.
- `nextTask()` for mode 3 re-rolls the starting position while `visualKey(start) === visualKey(answer)`, otherwise the task would be solved before the first click.
- Success messages always state all equivalent readings: `12ч = 24чa или 24чb`.

If you add a rule that compares times, compare `visualKey`s or explicitly justify why the 12-hour twin should be rejected.

## Conventions

**JavaScript.** ES5-flavored style throughout: `var`, `function`, no modules, no `let`/`const`, no arrow functions, no template literals, no classes. No dependencies. Small named helpers at the top of the IIFE (`$`, `pad`, `shortestDelta`, `randomTime`, `shuffle`, `showNext`, `hideNext`, `setAnswerControls`). Inline handlers are attached with `addEventListener`; loops over `NodeList` use `Array.prototype.forEach.call`. Keep new code consistent with this unless you deliberately migrate the whole file.

**Number formatting.** Minutes are always zero-padded via `pad()`; angular values in SVG attributes are `.toFixed(2)`.

**CSS.** Compact single-line rule blocks, no spaces after property colons (`display:flex;`), lowercase hex, colors drawn from a slate/indigo/violet palette (`#6366f1`, `#8b5cf6`, `#1e293b`, `#f8fafc`). Layout is centered, `max-width: 520px`, mobile-first with the clock sized `min(280px, 70vw)`. Interactive elements use `:active` scale-down feedback rather than hover.

**Content.** All user-facing strings are Russian and informal second person singular ("Введи часы и минуты", "Который час показывают стрелки?"). Keep new copy in Russian and in that voice; keep code comments Russian or English as the surrounding lines do.

**No persistence.** The score lives only in memory — there is no `localStorage` usage. Do not add it silently; it would change the reset/parental expectations of the app.

## Adding a Fourth Mode

Four touch points, in order:

1. `index.html` — add `<button class="tab" data-mode="4">…</button>` and `<div class="panel" id="panel4">…</div>`.
2. `app.js` — add an `else if (state.mode === 4)` branch in `nextTask()` that sets `state.answer`, renders the clock/digital display, and clears `state.locked`.
3. `app.js` — add the answer handler; it must set `state.locked = true`, award via `awardPoint()`, show feedback, call `showNext()` and `setAnswerControls(false)`; the shared `#next` button then calls `nextTask()`; a wrong answer uses `registerMistake()` for the shared penalty rules.
4. `styles.css` — only if the new panel needs layout beyond `.panel` / `.q` / `.btn`.

Mode switching is generic (`data-mode`, `#panelN`, `state.mode`), so no extra wiring is needed for the tab itself.

## Gotchas

- There are no task timers or answer cooldowns: after an answer `state.locked` stays true until `nextTask()` runs from «Дальше», a tab switch, a level change or «Сброс».
- After an answer `setAnswerControls(false)` disables `.opt`, `#check2` and `[data-act]`; invalid input must not call it, and `nextTask()` calls `setAnswerControls(true)`.
- `#clock.minutes-on` belongs to level 1 of modes 1 and 2 — `syncLevelUi()` checks `state.mode` and `LEVELS[state.level].minutes`, so switching tabs or levels hides the minute labels and returning to level 1 restores them.
- `state.level` and `state.mistakes` are shared across the modes; all three panels contain the same `.lvl` markup, and every `.lvl` is wired once at startup, so new level buttons must be static markup above `<script>`. Mode 3 uses only the readout-visibility side of the level; it must not gain hearts or a minute-step change.
- `#mistakes` and `#mistakes2` are filled with hearts only by `syncLevelUi()` through `syncHearts()`; keep that single writer so the two panels cannot drift. A correct answer sets `state.mistakes` to 0 (all hearts back) — it no longer decrements the streak by one.
- `heartsDown` keeps the last heart burned while the result is on screen; only `nextTask()`, `setLevel()` and «Сброс» clear it and refill the row.
- In mode 2 after an answer `#check2` is disabled while `#hh` and `#mm` stay editable; `checkTyped()` guards both the button and `Enter` via `state.locked`.
- Option labels on levels 1–2 must use `pairLabel().h24alt`, never `.h24`: for hours 1–12 the plain 24-hour reading repeats the 12-hour line.
- Re-clicking the already-active mode tab returns early in the tab handler: it must not deal a new task, hide the feedback or «Дальше», reset the score or mistakes. Only a click on a different tab calls `nextTask()`; switching away and back still deals a new task.
- Dragging must stay mode-3-only and never leak: `syncLevelUi()` toggles `#clock.drag-on`, `pointerdown` returns early in other modes, and `nextTask()` calls `endDrag()` so a tab switch or a scored target cannot leave `dragHand` or `.dragging` stuck.
- `#hh` autofocus in mode 2 is gated on `matchMedia('(min-width: 700px)')` to avoid popping the mobile keyboard.
- The digital colon blinks via a CSS `steps(1)` animation — parent-visibility changes restart it, which is harmless but can look like a flicker on mode entry.
- `.digital` uses `width:max-content` plus `margin:0 auto`; the dual line relies on `font-size:clamp(26px,7.6vw,40px)` and `white-space:nowrap` to stay on one row at 360–380px. Verify both corners before changing its padding or letter-spacing.
- `#panel3.readout-off` is the only switch that hides the set-time readout; keep the class on the panel (not `body`) and keep `renderDigital()` updating the digits while hidden so returning to «Легко» and auto-check stay correct.
- The set-time target must always go through `dualLabel()`, never `pairLabel().h24`: the single reading hides the +12-hour twin, and both readings name the same hand position.
- Help is not a mode: do not call `nextTask()`, `syncLevelUi()`, `awardPoint()` or `registerMistake()` from the help handlers, and do not let the overlay's click handler reach the tab or answer controls.
- The help overlay hides via `.open`/`.closing`, not the `hidden` attribute, and `body.help-open` carries `overflow:hidden`; keep `resetHelp()` as the single place that clears the classes, `inert`, `aria-expanded` and the scroll lock.
- If `prefers-reduced-motion:reduce` is set, `closeHelp()` skips the closing animation and hides the overlay immediately; a new animation name must not break the `help-out` check in the `animationend` handler.
- The header becomes two rows below 440px so the third pill («Помощь») does not squeeze the title; keep new header controls inside `.hgroup` so that breakpoint still applies.
