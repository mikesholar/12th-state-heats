# Heat Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page, phone-first heat/lane tracker for the 12th State comp (2026-09-13) that highlights the heat on the floor, the next heat, and the viewer's own next heat.

**Architecture:** Pure core in `src/core/` takes `(schedule, now)` and returns status objects; `src/ui/` renders them to the DOM with template strings and re-renders every 15 s. Schedule is a typed constant in `src/data/schedule.ts`, validated by a test. No frameworks; Vite bundles to `dist/`.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vite 7, Vitest 3 + jsdom, ESLint 9 (typescript-eslint), GitHub Pages via Actions.

Spec: `docs/superpowers/specs/2026-09-10-heat-tracker-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `src/data/schedule.ts` | The transcribed schedule constant, typed `Schedule` |
| `src/data/schedule.test.ts` | Runs `validateSchedule` on the real data; spot-checks known lanes |
| `src/core/types.ts` | `Lane`, `Heat`, `Event`, `Schedule` types |
| `src/core/comp-time.ts` | `heatInstants(schedule, heat)` → `{start: Date, end: Date}` in comp TZ; `compDayOf(now, tz)` |
| `src/core/validate-schedule.ts` | `validateSchedule(schedule): string[]` |
| `src/core/resolve-heats.ts` | `resolveHeats(schedule, now): HeatStatus` and `heatPhase` |
| `src/core/resolve-team.ts` | `resolveTeam(schedule, team, now): TeamStatus` |
| `src/core/format.ts` | `formatClock(hhmm)`, `formatCountdown(minutes)` |
| `src/core/*.test.ts` | Behaviour tests for each of the above |
| `src/test/factories.ts` | `makeSchedule`, `makeEvent`, `makeHeat`, `makeLane`, `at("09:15")` |
| `src/ui/render.ts` | `render(root, schedule, now, selectedTeam)` builds the whole page |
| `src/ui/render.test.ts` | jsdom tests for picker, my-heat card, banner text, row highlight |
| `src/ui/team-store.ts` | `loadTeam()` / `saveTeam()` around localStorage with try/catch |
| `src/main.ts` | Wires root, store, interval, scroll-to-current |
| `src/styles.css` | Dark/gold styles |
| `index.html`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `package.json`, `.gitignore`, `.github/workflows/deploy.yml` | Tooling copied from `fotc_12th`, minus React |

## Timezone approach

Convert a comp-local `"HH:MM"` on `compDate` to a UTC instant without a library:
build a `Date` from the ISO string as if it were UTC, then subtract the zone
offset that `Intl.DateTimeFormat(tz).formatToParts` reports for that instant.
Iterate once more to absorb a DST edge. The comp day is well inside EDT
(offset −04:00), so this is stable.

---

### Task 1: Scaffold project

**Files:** `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.gitignore`, `index.html`, `src/vite-env.d.ts`, `src/test/setup.ts`

- [ ] Copy tooling from `../fotc_12th`, dropping React deps and plugin. `package.json` name `12th-state-heats`. `tsconfig` without `jsx`; `types: ["node","vitest/globals","@testing-library/jest-dom"]`. `vite.config.ts` `base: "/12th-state-heats/"`, no plugins, vitest `environment: "jsdom"`, `globals: true`, `setupFiles: ["./src/test/setup.ts"]`.
- [ ] `index.html` with viewport meta, `<title>12 Years of 12th State — Heats</title>`, `<div id="root">`, `<script type="module" src="/src/main.ts">`, Archivo Google font.
- [ ] `npm install`; `npm run lint && npm run typecheck && npm test` pass (no tests yet → vitest `--passWithNoTests` or add a trivial test in Task 2 first).
- [ ] Commit `chore: scaffold vite + vitest + eslint`.

### Task 2: Types and factories

**Files:** `src/core/types.ts`, `src/test/factories.ts`

- [ ] Types per spec. Factories return complete objects with `Partial` overrides:

```ts
export const makeLane = (o?: Partial<Lane>): Lane => ({ lane: 1, team: "Team A", athletes: "A One + A Two", division: "F/M Scaled", ...o });
export const makeHeat = (o?: Partial<Heat>): Heat => ({ number: 1, start: "08:00", end: "08:08", lanes: [makeLane()], ...o });
export const makeEvent = (o?: Partial<Event>): Event => ({ number: 1, title: "Test Event", format: "AMRAP 1", rx: "rx", scaled: "scaled", heats: [makeHeat()], ...o });
export const makeSchedule = (o?: Partial<Schedule>): Schedule => ({ compDate: "2026-09-13", timeZone: "America/New_York", events: [makeEvent()], ...o });
export const at = (hhmm: string, date = "2026-09-13"): Date => new Date(`${date}T${hhmm}:00-04:00`);
```

- [ ] Commit `chore: schedule types and test factories`.

### Task 3: Comp-time conversion

**Files:** `src/core/comp-time.ts`, `src/core/comp-time.test.ts`

- [ ] Tests: `heatInstants(schedule, makeHeat({start:"09:10", end:"09:20"}))` → start equals `new Date("2026-09-13T13:10:00Z")`, end `13:20Z`. `compDayOf(new Date("2026-09-14T02:00:00Z"), "America/New_York")` → `"2026-09-13"` (10 PM Eastern on the 13th).
- [ ] Implement `zoneOffsetMinutes(instant, tz)` via `Intl.DateTimeFormat` parts, `localToInstant(date, hhmm, tz)`, `heatInstants`, `compDayOf` (uses `Intl` with `en-CA` to get `YYYY-MM-DD`).
- [ ] Commit `feat: convert comp-local heat times to instants`.

### Task 4: Validate schedule

**Files:** `src/core/validate-schedule.ts`, `src/core/validate-schedule.test.ts`

- [ ] Tests: valid factory schedule → `[]`; duplicate lane in a heat → message includes `"Event 1 Heat 1"` and `"lane 3"`; team present in event 1 but not event 2 → message names the team and `"Event 2"`; overlapping heats (`08:00–08:08`, `08:05–08:13`) → message; heat with 6 lanes → message.
- [ ] Implement with `flatMap` over events/heats; returns `readonly string[]`.
- [ ] Commit `feat: schedule validation`.

### Task 5: Transcribe schedule

**Files:** `src/data/schedule.ts`, `src/data/schedule.test.ts`

- [ ] Test: `validateSchedule(schedule)` is `[]`; 3 events × 5 heats; Event 1 Heat 2 lane 5 is "12th State Dumpys"; "Fast but Questionable" is E1 H2 L8, E2 H1 L8, E3 H5 L2; 37 distinct teams.
- [ ] Transcribe all three PDFs (Dumpys → lane 5). Event 3 heat 5 is `"12:48"`–`"13:00"`.
- [ ] Commit `feat: transcribe heat schedule from PDFs`.

### Task 6: resolveHeats + heatPhase

**Files:** `src/core/resolve-heats.ts`, `src/core/resolve-heats.test.ts`

```ts
export type HeatRef = { readonly event: Event; readonly heat: Heat; readonly start: Date; readonly end: Date };
export type HeatStatus =
  | { readonly phase: "not-comp-day" }
  | { readonly phase: "before"; readonly next: HeatRef }
  | { readonly phase: "during"; readonly current: HeatRef | undefined; readonly next: HeatRef | undefined }
  | { readonly phase: "between-events"; readonly next: HeatRef }
  | { readonly phase: "finished" };
export type HeatPhase = "past" | "current" | "upcoming";
```

- [ ] Tests against real `schedule`: 07:59 before/next E1H1; 08:00 during current E1H1 next E1H2; 08:08 during current undefined next E1H2; 08:34 during current undefined next E1H4; 10:20 between-events next E3H1; 12:59 during current E3H5 next undefined; 13:00 finished; `at("09:15","2026-09-12")` not-comp-day; UTC input `new Date("2026-09-13T13:15:00Z")` → current E2H1.
- [ ] `heatPhase(schedule, heat, now)`: 08:07 for E1H1 → current; 08:08 → past; 07:59 → upcoming.
- [ ] Implement: flatten all heats to `HeatRef[]` sorted by start; `current = find(start<=now<end)`; `next = find(start>now)`; phase: not comp day → `not-comp-day`; `now < first.start` → before; `!next && !current` → finished; no current and next belongs to a different event than the last-ended heat → between-events; else during.
- [ ] Commit `feat: resolve current and next heat from clock time`.

### Task 7: resolveTeam

**Files:** `src/core/resolve-team.ts`, `src/core/resolve-team.test.ts`

```ts
export type TeamStatus =
  | { readonly kind: "on-floor"; readonly ref: HeatRef; readonly lane: number }
  | { readonly kind: "upcoming"; readonly ref: HeatRef; readonly lane: number; readonly minutesUntilStart: number }
  | { readonly kind: "done" };
```

- [ ] Tests: "Fast but Questionable" at 08:30 → upcoming E2H1 L8 40 min; 09:15 → on-floor L8; 13:00 → done; 08:20 → upcoming E1H2? no — 08:13–08:21 is on-floor L8. Unknown team → done. Not comp day at 09:15 Sept 12 → upcoming E1H1 (first appearance) with minutesUntilStart computed from actual date (large) — assert kind and lane only.
- [ ] Implement: team's HeatRefs sorted; on-floor if any contains now; else first with start > now; else done. `minutesUntilStart = Math.floor((start - now)/60000)`.
- [ ] Commit `feat: resolve a team's next heat and lane`.

### Task 8: Formatting

**Files:** `src/core/format.ts`, `src/core/format.test.ts`

- [ ] Tests: `formatClock("08:00")` → `"8:00"`, `"12:48"` → `"12:48"`, `"13:00"` → `"1:00"`. `formatCountdown(0)` → `"starting now"`, `42` → `"in 42 min"`, `72` → `"in 1 h 12 min"`, `120` → `"in 2 h"`. `formatRange("08:13","08:21")` → `"8:13 – 8:21"`.
- [ ] Implement. Commit `feat: clock and countdown formatting`.

### Task 9: Team store

**Files:** `src/ui/team-store.ts`, `src/ui/team-store.test.ts`

- [ ] Tests (jsdom): `saveTeam("X")` then `loadTeam()` → `"X"`; fresh → `undefined`; when `localStorage.getItem` throws → `undefined` (stub via `vi.spyOn(Storage.prototype,"getItem").mockImplementation(() => { throw new Error() })`).
- [ ] Implement with key `"team"`. Commit `feat: remember chosen team`.

### Task 10: Render

**Files:** `src/ui/render.ts`, `src/ui/render.test.ts`, `src/styles.css`

`render({ root, schedule, now, selectedTeam, onTeamChange })`. Builds header (title, clock via `Intl` in comp TZ, `<select id="team-picker">`), my-heat card (`[data-testid="my-heat"]`), banner (`[data-testid="banner"]`), schedule sections. Heat cards get `data-heat="E1H2"` and class `past|current|upcoming` and `NOW`/`NEXT` tags; lane rows get `data-team` and class `mine` when selected.

- [ ] Tests via `@testing-library/dom`:
  - at 07:59 banner text contains `"First heat 8:00"`.
  - at 08:03 banner contains `"NOW"`, `"Event 1"`, `"Heat 1"` and `"NEXT"`, `"Heat 2"`, `"in 10 min"`.
  - at 10:20 banner contains `"Event 3 starts 11:40"`, `"in 1 h 20 min"`.
  - at 13:00 banner contains `"Comp complete"`.
  - Sept 12 banner contains `"Saturday, September 13"`.
  - no team: `queryByTestId("my-heat")` null.
  - team "Fast but Questionable" at 08:30: my-heat contains `"Event 2"`, `"Heat 1"`, `"Lane 8"`, `"9:10"`, `"in 40 min"`; every row `[data-team="Fast but Questionable"]` has class `mine` (3 rows).
  - team at 09:15: my-heat contains `"ON THE FLOOR"`, `"Lane 8"`, `"ends 9:20"`.
  - team at 13:00: my-heat contains `"You're done"`.
  - selecting a team in the picker calls `onTeamChange("Glizzy Gals")`.
  - heat card `[data-heat="E1H1"]` at 08:10 has class `past`; `E1H2` has class `current`.
- [ ] Implement in slices, each test red → green. Use `el.textContent = ...` / template literals with an `esc()` helper for names containing `&`/`'`.
- [ ] Styles: dark `#111`, gold `#c9a24a`, sticky header, big lane digit, dimmed past heats.
- [ ] Commit per slice; final `feat: render schedule, banner and my-heat card`.

### Task 11: main.ts wiring

**Files:** `src/main.ts`

- [ ] Read root, `loadTeam()`, `render` with `new Date()`; on `onTeamChange` save + re-render; `setInterval(15_000)` re-render; after first render `document.querySelector(".current, .upcoming")?.scrollIntoView({block:"start"})`, accounting for sticky header via `scroll-margin-top` in CSS.
- [ ] `npm run build`, `npm run preview`, open on phone-width and eyeball at a fake time (temporarily override `now` via `?at=2026-09-13T08:30` query param — include this as a real feature: `readNowOverride(location.search)` with a test, useful for demoing).
- [ ] Commit `feat: wire app, live refresh, ?at= preview override`.

### Task 12: Deploy

**Files:** `.github/workflows/deploy.yml`, `README.md`

- [ ] Workflow copied from `fotc_12th` (no 404 copy needed). README: what it is, how to edit `src/data/schedule.ts`, `?at=` trick, dev commands.
- [ ] `gh repo create mikesholar/12th-state-heats --public --source=. --push`; enable Pages (source: GitHub Actions) via `gh api`; wait for run; verify URL.
- [ ] Commit `docs: readme` and `ci: github pages deploy`.

## Self-review

- Spec coverage: data ✔ T5, core ✔ T3–T8, UI ✔ T10–T11, storage ✔ T9, validation-in-tests ✔ T4/T5, deploy ✔ T12, not-comp-day ✔ T6/T10. `?at=` override is an addition beyond spec — small, aids testing on the day-before; noted in README.
- Type names consistent: `HeatRef`, `HeatStatus`, `TeamStatus`, `HeatPhase`.
