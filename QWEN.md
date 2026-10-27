# QWEN.md

Instructional context for working in this repository.

## Project Overview

A single-page, dependency-free web app for teaching children to read an analog clock. The UI is entirely in Russian (`<html lang="ru">`, title "Учимся читать время").

There is no framework, no bundler, no package manager, and no network calls. It is three static files loaded directly by the browser:

| File | Role |
| --- | --- |
| `index.html` | Static markup for the header, the score pill, the three mode tabs, the SVG clock, and one panel per mode. |
| `app.js` | Everything else: builds the clock face, generates tasks, validates answers, manages score and mode switching. |
| `styles.css` | All styling, animations, and the single `@media (max-width:380px)` breakpoint. |

Git history is a single commit (`initial`), so there is no established commit-message convention to infer.

## Building and Running

No build step exists. Open `index.html` directly, or serve the folder to avoid any file-URL quirks:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

There are no tests, no linter, and no type checker. Verification is manual and performed by the user in a real browser: do not add Playwright, Puppeteer, Selenium, jsdom, DOM harnesses, or any other automated UI tests. Load the page and exercise each tab:

1. **Выбери время** — three difficulty levels chosen in the panel; four options, exactly one is correct; wrong pick highlights the right option and advances after ~2.3 s. Level 1 (easy): minute labels 5–60 on the dial, time always a multiple of 5. Level 2 (medium): no dial labels, time still a multiple of 5, every third mistake costs a point. Level 3 (hard): no minute labels, any minute, at least three options share the same 24-hour hour, every second mistake costs a point; its options show only the 24-hour reading, while feedback still lists both. On levels 1–2 an option pairs its 12-hour reading with a 24-hour one that always differs, using the +12-hour twin when the plain 24-hour form would repeat the first line. On levels 2–3 a correct answer removes one accumulated mistake (never below zero). The score never goes below zero.
2. **Запиши время** — shares the three levels and the selected level with mode 1: level 1 shows minute labels 5–60 and times are multiples of 5, level 2 has no labels and times are still multiples of 5, level 3 has no labels and any minute, so the answer must be exact to the minute. Typing two characters in the hours field jumps focus to minutes; `Enter` submits; both the exact 24-hour reading and its +12-hour twin are accepted. Invalid input shows a validation message without locking the task. Levels 2–3 show the mistake counter and charge the same penalties; every valid answer starts the same 5 s pause, during which **Проверить** is disabled.
3. **Поставь время** — buttons move the digital display by ±1 h / ±5 min and wrap past midnight, and the hour or minute hand can be dragged with mouse or finger: minutes snap to 5 and passing 12 carries the hour by one, the hour hand keeps the current minutes and half of the day, and the digital display follows the drag. Match the announced target.
4. Score increments only on a correct answer; **Сброс** zeroes it and deals a new task.
5. In modes 1–2, answers are accepted at most once every 5 seconds: after each answer the options (mode 1) or **Проверить** (mode 2) are disabled with a visible countdown, while the next task still appears on the usual ~1.1–1.2 s / ~2.3–2.4 s delay.

Check the console for errors after changing `app.js` — there is no other safety net.

## Architecture and Data Flow

`app.js` is a single IIFE in strict mode with all state in module scope. Load order: `index.html` must include `app.js` after the markup (it is a plain `<script>` at the end of `<body>`, not deferred), because the IIFE queries `#ticks`, `#numbers`, `#hourHand`, etc. immediately at startup.

**Clock rendering.** The face is not static HTML: 60 tick `<line>`s and 12 numeral `<text>`s are generated once into `#ticks` / `#numbers` using `document.createElementNS`. Angles are computed with `sin`/`cos` around center `(100, 100)`, using `y = 100 - r·cos θ`. Hands rotate via inline `transform: rotate(...)`; CSS supplies `transform-box: view-box` and `transform-origin: 100px 100px` so rotation happens about the center.

**Hand animation.** `hAngle` / `mAngle` are cumulative, not absolute. `setClock()` adds `shortestDelta(current, target)` so hands always take the short way around instead of unwinding backwards, and the CSS transition animates the difference. If you ever reset these accumulators, the hands will visibly spin.

**Task state.** A single `{ mode, level, answer, score, mistakes, locked }` object. `answer` is *total minutes since midnight* (0–1439). `level` (1–3) is shared by modes 1 and 2 and is described by the `LEVELS` table (`step`, `minutes`, `penaltyEvery`). `locked` prevents double-scoring while the feedback delay is pending. `mistakes` counts failures since the last penalty and is shared by both modes. `awardPoint()` and `registerMistake()` own the scoring and penalty rules for every handler.

**Hand dragging.** Mode 3 accepts pointer input on `#clock`: `pointerdown` maps the pointer into the 200×200 viewBox, computes the angle from 12 o'clock, and picks the hand with the smaller angular distance (18° threshold, dead zone r<18; overlapped hands split at r=45 — minute outside, hour inside). Minute drags snap `dM` to the nearest 5 and carry the hour by ±1 whenever the snapped minutes wrap past 60/0 (a full turn of the minute hand); hour drags take the sector `floor(angle / 30) % 12` and keep the current half of the day. Every move calls `renderDigital()`, so the display, hands and auto-check share the buttons' path. `#clock.drag-on` (mode 3 only) enables `touch-action:none` and the grab cursor; `.dragging` disables the hand transition.

**Single shared timer.** `schedule(fn, ms)` calls `clearTimeout` on one shared `timer` variable, so only one pending advance can exist. Every mode transition must cancel/reset it — `nextTask()` does `clearTimeout(timer)` up front.

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

**JavaScript.** ES5-flavored style throughout: `var`, `function`, no modules, no `let`/`const`, no arrow functions, no template literals, no classes. No dependencies. Small named helpers at the top of the IIFE (`$`, `pad`, `shortestDelta`, `schedule`, `randomTime`, `shuffle`). Inline handlers are attached with `addEventListener`; loops over `NodeList` use `Array.prototype.forEach.call`. Keep new code consistent with this unless you deliberately migrate the whole file.

**Number formatting.** Minutes are always zero-padded via `pad()`; angular values in SVG attributes are `.toFixed(2)`.

**CSS.** Compact single-line rule blocks, no spaces after property colons (`display:flex;`), lowercase hex, colors drawn from a slate/indigo/violet palette (`#6366f1`, `#8b5cf6`, `#1e293b`, `#f8fafc`). Layout is centered, `max-width: 520px`, mobile-first with the clock sized `min(280px, 70vw)`. Interactive elements use `:active` scale-down feedback rather than hover.

**Content.** All user-facing strings are Russian and informal second person singular ("Введи часы и минуты", "Который час показывают стрелки?"). Keep new copy in Russian and in that voice; keep code comments Russian or English as the surrounding lines do.

**No persistence.** The score lives only in memory — there is no `localStorage` usage. Do not add it silently; it would change the reset/parental expectations of the app.

## Adding a Fourth Mode

Four touch points, in order:

1. `index.html` — add `<button class="tab" data-mode="4">…</button>` and `<div class="panel" id="panel4">…</div>`.
2. `app.js` — add an `else if (state.mode === 4)` branch in `nextTask()` that sets `state.answer`, renders the clock/digital display, and clears `state.locked`.
3. `app.js` — add the answer handler; it must set `state.locked = true`, award via `awardPoint()`, show feedback, and call `schedule(nextTask, …)`; a wrong answer uses `registerMistake()` for the shared penalty rules.
4. `styles.css` — only if the new panel needs layout beyond `.panel` / `.q` / `.btn`.

Mode switching is generic (`data-mode`, `#panelN`, `state.mode`), so no extra wiring is needed for the tab itself.

## Gotchas

- Task advance uses two magic delays per path (~1.1–1.6 s on success, 2.3–2.4 s on failure); if you change them, keep success shorter than failure.
- The answer cooldown (`cooldownUntil`, 5 s) is shared by modes 1 and 2 and drives its own `setInterval` that toggles `.opt` and `#check2` `disabled` and writes the `#cooldown` / `#cooldown2` text. Never route it through `schedule()`: that would cancel the single shared `timer` and with it the pending task advance.
- `#clock.minutes-on` belongs to level 1 of modes 1 and 2 — `syncLevelUi()` checks `state.mode` and `LEVELS[state.level].minutes`, so switching tabs or levels hides the minute labels and returning to level 1 restores them.
- `state.level` and `state.mistakes` are shared by modes 1 and 2; both panels contain the same `.lvl` markup, and every `.lvl` is wired once at startup, so new level buttons must be static markup above `<script>`.
- `#mistakes` and `#mistakes2` are written only by `syncLevelUi()`; keep that single writer so the two counters cannot drift.
- In mode 2 the pause disables only `#check2`; `#hh` and `#mm` stay editable, and `checkTyped()` guards both the button and `Enter` via `state.locked || coolingDown()`.
- Option labels on levels 1–2 must use `pairLabel().h24alt`, never `.h24`: for hours 1–12 the plain 24-hour reading repeats the 12-hour line.
- Re-clicking the already-active mode tab returns early in the tab handler: it must not deal a new task, clear the feedback message, reset the score or mistakes, or bypass the answer cooldown. Only a click on a different tab calls `nextTask()`; switching away and back still deals a new task.
- Dragging must stay mode-3-only and never leak: `syncLevelUi()` toggles `#clock.drag-on`, `pointerdown` returns early in other modes, and `nextTask()` calls `endDrag()` so a tab switch or a scored target cannot leave `dragHand` or `.dragging` stuck.
- `#hh` autofocus in mode 2 is gated on `matchMedia('(min-width: 700px)')` to avoid popping the mobile keyboard.
- The digital colon blinks via a CSS `steps(1)` animation — parent-visibility changes restart it, which is harmless but can look like a flicker on mode entry.
- `.digital` uses `width:max-content` plus `margin:0 auto`; adding a flex child there can break the centering that the 380px breakpoint relies on.
