# 12 Years of 12th State — Heat Tracker

**Date:** 2026-09-10
**Comp:** Saturday 2026-09-12, 12th State CrossFit, Eastern time
**Live target:** https://mikesholar.github.io/12th-state-heats/

## Purpose

A phone-first, single-page web app that shows the heat and lane assignments for
the three events of the 12th State in-house competition, and answers two
questions at a glance:

1. **Which heat is on the floor right now, and which is up next?** (gym-wide)
2. **When and in which lane am I next?** (per athlete, once they pick their team)

Everyone gets the same URL. No accounts, no network calls after load.

## Source data

Three PDFs (`HEAT TIMES - Event {1,2,3} Heat.pdf`) transcribed by hand into
`src/data/schedule.ts`. One correction: Event 1 Heat 2 lists both "12th State
Dumpys" and "Couple of Cooters" in lane 6 with no lane 5 — Dumpys is lane 5
(confirmed by Mike).

| Event | Workout | Heats | Heat length | Cadence |
|---|---|---|---|---|
| 1 | 12th Gear · 12 rounds · 8:00 cap | 5 · 8:00–9:00 | 8 min | every 13 min |
| 2 | AMRAP 10 | 5 · 9:10–10:20 | 10 min | every 15 min |
| 3 | 2 rounds · 12:00 cap | 5 · 11:40–1:00 PM | 12 min | every 17 min |

37 teams, 7 or 8 lanes per heat. Every team appears in exactly one heat per
event. Team name is the join key across events.

## Data model

```ts
type Lane = {
  readonly lane: number;
  readonly team: string;
  readonly athletes: string;          // "Caroline Ortiz + Mike Sholar"
  readonly division: string;          // "F/M Scaled"
};

type Heat = {
  readonly number: number;
  readonly start: string;             // "09:10" 24-hour, local to comp timezone
  readonly end: string;               // "09:20"
  readonly lanes: readonly Lane[];
};

type Event = {
  readonly number: number;
  readonly title: string;             // "12th Gear"
  readonly format: string;            // "12 Rounds · 8:00 cap"
  readonly rx: string;
  readonly scaled: string;
  readonly heats: readonly Heat[];
};

type Schedule = {
  readonly compDate: string;          // "2026-09-12"
  readonly timeZone: string;          // "America/New_York"
  readonly events: readonly Event[];
};
```

Heat start/end are strings in the comp's local time. The core converts them to
absolute instants using `compDate` + `timeZone`, so a phone set to another zone
still sees the right heat.

## Core (pure, fully tested)

`src/core/`. No DOM, no `Date.now()` — every function takes `now: Date`.

- `validateSchedule(schedule): ValidationError[]` — unique lane numbers within a
  heat, heats within an event ordered and non-overlapping, every team present
  in all three events with the same spelling, every heat 7–8 lanes.
  Run as a test so a transcription slip fails CI rather than showing wrong
  lanes on the day.
- `resolveHeats(schedule, now): HeatStatus` returns
  `{ phase, current?, next? }` where `phase` is
  `"before" | "during" | "between-events" | "finished" | "not-comp-day"`,
  `current` is the heat whose `[start, end)` contains `now`, and `next` is the
  first heat with `start > now`. Each carries its event and event/heat numbers.
- `resolveTeam(schedule, team, now): TeamStatus` returns the team's current heat
  if one is running, else its next heat, else `"done"`. Includes event, heat,
  lane, start, and `minutesUntilStart` (rounded down, `0` when on the floor).
- `heatPhase(heat, now)` → `"past" | "current" | "upcoming"` for row dimming.

`not-comp-day` is any calendar date in the comp's timezone other than
`compDate`. On that day, `before` is before the first heat's start, `finished`
is at/after the last heat's end, `between-events` is a gap with no current heat
(e.g. 10:20–11:40).

## UI (`src/ui/`)

One screen, vertical scroll, dark background, gold accents to match the PDFs.
Renders from a single `render(state)` call; a 15-second `setInterval` re-runs
the core with a fresh `now` and re-renders. No frameworks.

**Header** — "12 Years of 12th State", live clock (Eastern), and a
`<select>` labelled **"I'm on…"** listing all teams alphabetically plus a
"— pick your team —" placeholder. Selection is written to
`localStorage["team"]`; reads are wrapped in try/catch and fall back to
unselected.

**My heat card** (only when a team is chosen) —
`Fast but Questionable · Event 2 · Heat 1 · LANE 8 · 9:10 · in 42 min`.
During the heat: `ON THE FLOOR · LANE 8 · ends 9:20`. After the team's last
heat: `You're done — nice work`. The lane number is the largest thing on the
card.

**Up-next banner** — gym-wide. `NOW · Event 1 · Heat 3 · ends 8:34` stacked
with `NEXT · Heat 4 · 8:39 · in 7 min`. In `before`: `First heat 8:00 AM`. In
`between-events`: `Event 3 starts 11:40 · in 1 h 12 min`. In `finished`:
`Comp complete`. In `not-comp-day`: `Saturday, September 12` with no countdown.
On first render the page scrolls so the current (or next) heat card is at the
top of the viewport, just below the sticky header.

**Schedule** — Event sections in order, each with title, format, RX and Scaled
lines, then one card per heat: `HEAT 2 · 8:13 – 8:21`, and a table of
lane · team · athletes · division. Past heats are dimmed, the current heat has a
gold border and a `NOW` tag, the next heat has a `NEXT` tag. The chosen team's
row is highlighted in every heat it appears in.

**Times** are displayed 12-hour without seconds, matching the PDFs (`12:48`,
`1:00`). Countdowns show `in 42 min`, `in 1 h 12 min`, `starting now`.

## Error handling

- Data problems are caught by `validateSchedule` in the test suite; the built
  page never sees invalid data.
- `localStorage` unavailable → team picker still works for the session, just
  isn't remembered.
- No fetches, so no loading or offline states.

## Testing

Vitest. Tests live beside the core and test behaviour through `resolveHeats`,
`resolveTeam`, `heatPhase`, and `validateSchedule` with the real schedule plus
small factory-built schedules for edge cases:

- 07:59 → `before`, next = E1 H1
- 08:00 → `during`, current = E1 H1, next = E1 H2
- 08:08 → E1 H1 is `past`, no current, next = E1 H2 (still `during` phase)
- 10:20 → `between-events`, next = E3 H1
- 12:59 → current = E3 H5; 13:00 → `finished`
- Any other date → `not-comp-day`
- `now` supplied in UTC resolves correctly to Eastern
- Team lookups: "Fast but Questionable" at 08:30 → E2 H1 L8, 40 min;
  at 09:15 → on the floor L8; at 13:00 → done
- Validation catches a duplicate lane and a team missing from an event

The DOM layer is exercised by a small set of tests using jsdom: choosing a team
shows the my-heat card and highlights rows; the banner text for each phase.

## Build & deploy

- TypeScript strict, Vite, Vitest, ESLint — copied from `fotc_12th`.
- `vite.config.ts` sets `base: "/12th-state-heats/"` (project-page subpath).
- `.github/workflows/deploy.yml`: on push to `main` run lint, typecheck, test,
  build; deploy `dist/` to GitHub Pages. A failure blocks the deploy.
- Repo: `mikesholar/12th-state-heats`, public.

## Out of scope

Scores, leaderboards, editing heats in the browser, push notifications, and
anything to do with Fittest of the Coast (that lives in `fotc_12th`).
