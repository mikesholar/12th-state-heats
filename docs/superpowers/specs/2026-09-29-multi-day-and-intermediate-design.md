# Multi-day heats and an Intermediate workout — Design

**Date:** 2026-09-29
**Builds on:** `2026-09-17-sheet-schedule-and-signup-design.md`
**Live target:** https://12thstatecomp.com/

## Purpose

Two changes the 12th State organisers asked for:

1. **An event's heats can span days.** Today the whole comp runs on one
   date, `Settings → compDate`. Each heat gets its own date, and the site
   separates days within an event, more lightly than it separates events.
2. **A third workout version, Intermediate**, next to RX and Scaled.

Heat times stay 24-hour `HH:MM` in the Sheet (`13:30`, not `1:30 PM`); the
site keeps showing them 12-hour without AM/PM.

## Decisions

- **A heat's date is optional; blank means `compDate`.** The live Sheet, the
  bundled snapshot and single-day comps keep working with no edits.
  `compDate` stays required in `Settings`.
- **Comp days are the distinct heat dates.** Status on the spectator page
  only considers today's heats.
- **The day break is a thin labelled rule** (`── FRI OCT 1 ──`) between
  heat cards, drawn only inside an event whose heats cover more than one
  date.
- **Intermediate is optional per event**; a blank Intermediate is hidden.
  RX and Scaled are unchanged (always shown).
- **The judge page picks the highlighted version from the division name**,
  as it does now: a division name containing the word `Intermediate`
  highlights Intermediate.

## Sheet

### `Heats` tab: new `date` column

- Header `date`. Columns are read by header name, so on an existing Sheet
  the organiser inserts it anywhere; a missing column means every heat
  uses `compDate`.
- New Sheets (`setup()`): `HEAT_HEADERS = ["event", "heat", "date", "start", "end"]`,
  columns C:E formatted as plain text (`@`), and the A1 note gains
  "date is YYYY-MM-DD; leave blank for Settings → compDate".
- `Code.gs` `readHeat` adds `date: asDateString(row.date, sheetZone)`, so a
  cell Sheets auto-converted to a date still yields `YYYY-MM-DD`; blank
  stays `""`.

### `Events` tab: new `intermediate` column

- Header `intermediate`, read by name like `rx`/`scaled`.
- New Sheets: `EVENT_HEADERS = ["event", "title", "format", "scoring", "capSeconds", "rx", "intermediate", "scaled", "lanes"]`.
  The scoring validation stays on column D.
- `Code.gs` `readEvents` adds `intermediate: asText(row.intermediate)`.

`setup()` still only creates missing tabs; `docs/deploy.md` tells
organisers to add both headers by hand to an existing Sheet.

## Types and decoding (`src/core`)

- `Heat` gains `readonly date: string` — always a real `YYYY-MM-DD` after
  decoding.
- `Event` gains `readonly intermediate: string` (`""` when blank).
- `decodeSchedule`: a heat's `date` that is missing, blank or not a string
  resolves to `compDate`. A non-blank value must match `YYYY-MM-DD` and be
  a real date, reusing the `compDate` checks, with errors in the existing
  style:
  - `Heats: Event 1 Heat 3: date "2027-13-01" must be YYYY-MM-DD`
  - `Heats: Event 1 Heat 3: date "2027-02-30" is not a real date`
  `intermediate` decodes with `optionalText` like `rx`/`scaled`.
- `heatInstants(schedule, heat)` uses `heat.date` instead of
  `schedule.compDate`.
- New `compDays(schedule): readonly string[]` — sorted distinct heat dates.
  With no heats, `[compDate]`.
- `scripts/snapshot.ts` needs no change; the decoded snapshot carries dates.
  `src/data/schedule-snapshot.json` and `src/test/comp-2026.json` have no
  `date` and keep decoding (every heat gets `compDate`).

## Spectator status (`resolveHeats`)

1. Today (in the comp time zone) not in `compDays` → `not-comp-day`.
2. Otherwise only today's heats are considered, sorted by start:
   - before today's first heat → `before` (next = today's first heat);
   - running / between heats / gap between events → unchanged `during` /
     `between-events` rules, over today's heats;
   - after today's last heat: if any heat falls on a later comp day →
     new phase `day-finished` with `next` = the earliest later heat;
     otherwise `finished`.

Banners:

| Phase | Text |
|---|---|
| `not-comp-day` | `COMP DAY` + the comp days: one day `Sat Oct 2`; consecutive `Fri Oct 1 – Sat Oct 2`; otherwise joined, `Fri Oct 1 & Sun Oct 3` (three or more: `Fri Oct 1, Sat Oct 2 & Sun Oct 3`) |
| `before` | `FIRST HEAT` First heat 8:00 · in 25 min (drops the hard-coded " AM", which was wrong for afternoon starts) |
| `day-finished` | `DAY DONE` Next heat Sat 8:00 · Event 2 |
| `finished` | unchanged `DONE` Comp complete 🎉 |

`heatPhase` (past/current/upcoming card styling) already uses real
instants, so it is correct across days once it uses `heat.date`. On a
non-comp day every card shows as "upcoming", as now. The evening of day 1
is still a comp day: the banner shows `day-finished` and day 1's cards are
dimmed as past. The morning of day 2 shows `before`.

The page footer and the sign-up header show the comp-days label instead of
the single `compDate` (`Times are Eastern · Fri Oct 1 – Sat Oct 2`).

## Day breaks (spectator and sign-up pages)

Within an event, heats render in Sheet order. When an event's heats cover
more than one date, a divider is drawn before the first heat and before
every heat whose date differs from the previous heat's:

```html
<div class="day-break" role="separator"><span>Fri Oct 1</span></div>
```

Style: a 1px rule in the muted border colour with the label in small caps,
muted text, tight vertical margin — visibly lighter than the gap and
header between events. Events whose heats share one date get no divider,
so a single-day comp looks exactly as today.

## Judge and head judge pages

- `resolveJudgeHeat` already chooses the heat on the floor from real
  instants; with `heat.date` it works across days unchanged.
- When `compDays` has more than one day, the judge heat selector and the
  head-judge heat labels prefix the weekday: `Heat 3 · Sat 8:00 – 8:12`.
  Single-day comps are unchanged.

## Intermediate

`workoutHtml` (judge and head judge), the spectator event header and the
sign-up event header list **RX, Intermediate, Scaled** in that order;
Intermediate is omitted when blank.

`versionForDivision` checks in order: `\bscaled\b` → Scaled,
`\bintermediate\b` → Intermediate, `\brx\b` → RX (all case-insensitive). A
division matching none highlights nothing, as now.

Organisers name Intermediate divisions accordingly in `Divisions`
(e.g. `F/F Intermediate`).

## Docs

- `docs/deploy.md` §2: the `Heats` step documents `date` (optional,
  `YYYY-MM-DD`, blank = `compDate`, type as text or the Sheet's date
  format is fine) and reiterates 24-hour `HH:MM`; the `Events` step
  documents `intermediate`; the `Divisions` step says a name containing
  "Intermediate" gets the Intermediate workout highlighted on the judge
  page.
- `docs/deploy.md` §4a-style migration note: add `date` to `Heats` and
  `intermediate` to `Events` by hand on an existing Sheet; paste `Code.gs`
  and deploy a new version.
- §5 rows for the two new date errors.
- `README.md` preview section: `?at=` examples still work; note the date
  part picks the comp day.

## Rollout

Backward compatible both ways: the new site decodes the old script's reply
(no `date`/`intermediate` → defaults), and the old site's decoder ignores
the new fields. Deploy the script as a **new version** (not a new
deployment) and push the site in either order; heats only move off
`compDate` once dates are typed into the Sheet.

## Out of scope

- Reordering heats by date (the Sheet order is the display order).
- Per-day `Overall` or results.
- Retiring `compDate`.
- Per-heat time zones.

## Testing

Test-first, through the existing public entry points and factories
(`src/test/factories.ts` gains `date`/`intermediate` defaults):

- `decodeSchedule`: blank/missing date → compDate; valid date kept;
  malformed and impossible dates → the error strings above; intermediate
  blank → `""`, text kept; the committed snapshot and the 2026 fixture
  still decode.
- `resolveHeats` on a two-day schedule: day before → `not-comp-day`; day 1
  before/during/between-events; day 1 after last heat → `day-finished`
  with day 2's first heat; day 2 before → `before`; day 2 after last →
  `finished`; a date between non-consecutive comp days → `not-comp-day`.
- Render (spectator, sign-up): dividers appear only in multi-date events,
  before each date change, with the weekday label; the banner and footer
  texts above; Intermediate line present/absent.
- Judge page: weekday prefix only on multi-day comps; a division
  "F/F Intermediate" highlights the Intermediate line; resolved heat is
  correct on day 2.
- `Code.gs`: verified by hand after pasting (curl the endpoint; heats show
  `date`, events show `intermediate`).
