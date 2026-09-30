# Heat calculator — Design

**Date:** 2026-09-30
**Builds on:** `2026-09-29-multi-day-and-intermediate-design.md`
**Live target:** https://12thstatecomp.com/

## Purpose

Organisers type every heat's start and end by hand in the `Heats` tab. A
**Calculator** tab in the Sheet works them out instead: pick an event, give
one row per block of heats (date, first start, heat length, buffer, number
of heats), check the preview, and write the result into `Heats` with one
menu click. A single event can run over several days.

## Decisions

- **Sheet tab, not a site page.** Staff already work in the Sheet.
- **One event at a time, one input row per block.** A block is usually a
  day; two blocks on the same date also work (e.g. a break).
- **Heat count is typed**, not derived from teams or an end time.
- **The calculation lives in `Code.gs`**, not in Sheet formulas, so the
  preview and the write use the same code. An `onEdit` simple trigger keeps
  the preview live.
- **Writing replaces only the chosen event's rows in `Heats`**, after a
  confirm dialog that warns about sign-ups the change would affect.
- **The calculation gets a real test file in the repo**, run by Vitest,
  loading `Code.gs` in a Node `vm` sandbox.

## The Calculator tab

```
     A        B       C       D       E        F   G   H      I           J       K
1    event    1
2
3    date     start   length  buffer  heats            heat   date        start   end
4    2027-10-02 18:00 12      3       5                1      2027-10-02  18:00   18:12
5    2027-10-03 08:00 12      3       3                2      2027-10-02  18:15   18:27
6                                                      …
```

- `B1`: the event number (must exist in `Events`).
- Input rows are A4:E downwards. Every row with anything in A–E is an
  input; fully blank rows are skipped.
  - `date` — `YYYY-MM-DD` (text or a Sheets date).
  - `start` — the first heat's start, 24-hour `HH:MM` (text or a Sheets
    time).
  - `length` — minutes a heat runs on the floor (whole number ≥ 1).
  - `buffer` — minutes between one heat's end and the next heat's start
    (whole number ≥ 0).
  - `heats` — how many heats in this block (whole number ≥ 1).
- Preview: `H3:K3` headers, rows from `H4` down. When the inputs have a
  problem, `H4` shows the error text instead of rows.
- `setup()` creates the tab if missing (headers, `B1` blank, columns A–D
  and I–K formatted as plain text, an A1 note explaining the columns). On
  the live Sheet, run `setup()` once — it only creates missing tabs.

## The plan (`planHeats`)

A pure function in `Code.gs`:

```
planHeats({ event, rows }) → { ok: true, heats: [{ heat, date, start, end }] }
                           | { ok: false, error }
```

`rows` are the input rows after cell normalisation (`asDateString`,
`asClock` for date/start; numbers or numeric text for the rest), each with
its sheet row number.

- Heat numbers run 1, 2, 3… across rows, in row order.
- Within a row, heat *n* (0-based) starts at `start + n × (length + buffer)`
  and ends `length` minutes later. Times are `HH:MM`, zero-padded.
- Errors (first one wins, sheet row numbers):
  - `Calculator: pick an event number in B1` / `Calculator: event 7 is not in the Events tab`
  - `Calculator: add at least one row of heats`
  - `Row 5: date "…" must be YYYY-MM-DD` (or `is not a real date`)
  - `Row 5: start "…" must be HH:MM`
  - `Row 5: length must be a whole number of at least 1` (same shape for
    `heats`; `buffer` "at least 0")
  - `Row 5: heat 8 would end after midnight (24:07)` — a heat may not end
    after 23:59 on its date.
  - `Row 6 starts 08:30, before row 5's last heat ends 08:42` — rows on the
    same date must not overlap (compared in row order; a later row may not
    start before any earlier same-date row's last heat ends).

## Live preview (`onEdit`)

`onEdit(e)` — a simple trigger, so no authorisation — returns immediately
unless the edited sheet is `Calculator`. Otherwise it reads `B1` and
`A4:E`, runs `planHeats`, clears `H4:K`, and writes either the heat rows
or the error in `H4`. Script edits don't fire `onEdit`, so writing the
preview can't loop.

## Writing (`12th State → Write heats to Heats tab`)

Added to the existing menu below **Update site fallback**.

1. Take the document lock (as the fallback refresh does); busy → toast
   *"The sheet is busy — try again."*
2. Recompute the plan from the inputs (never trust the preview). Error →
   alert with the error, stop.
3. Build the confirm message:
   - *"Replace Event 1's 6 heats with 8 heats (Sat Oct 2: 5, Sun Oct 3: 3)?"*
   - If `Slots` has claims for this event in heat numbers the new plan
     doesn't have: *"2 sign-ups are in heats that won't exist and will
     disappear from the site: Heat 7 lane 2 (Rays of Glory), Heat 8 lane
     1 (Glizzy Gals)."*
   - If `Slots` has any claims for this event: *"Teams already signed up
     keep their heat and lane number, but the times change."*
   - `SpreadsheetApp.getUi().alert(title, message, OK_CANCEL)`; Cancel →
     toast *"Nothing changed."*, stop.
4. Rewrite `Heats`: keep the header row and every row whose `event` isn't
   this event (all columns, untouched); append the new rows, filling
   `event`, `heat`, `date`, `start`, `end` by header name (other columns
   blank). Set the data range's `date`/`start`/`end` columns to plain text
   before writing so Sheets doesn't convert them. Clear then write in one
   `setValues`.
5. `clearScheduleCache()`, then toast *"Wrote 8 heats for Event 1. Check
   the site, then 12th State → Update site fallback."*

The Slots check and the message text come from a pure helper,
`writeSummary({ event, plan, existingHeatCount, claims })`, so they are
tested alongside `planHeats`.

## Testing

New `src/sheet-script/calculator.test.ts` (under `src/` so it is
type-checked and linted; `apps-script/` is excluded from both). It reads
`apps-script/Code.gs`, runs it in a `vm` context with the Google services
stubbed as empty objects (top-level code only declares constants and
functions), and calls the exported-by-global functions:

- `planHeats`: one row → numbered heats with buffer spacing; two rows on
  two dates → numbering continues, times restart; two rows on one date
  with a gap → fine; overlapping same-date rows → the overlap error;
  midnight overflow; each input error message; event missing/unknown.
- `writeSummary`: counts per day in the question; claims in dropped heats
  listed with team names; the times-change note only when the event has
  claims; nothing extra when there are none.

Types in the test are narrow local types for what the functions return
(the functions come from untyped JS), validated with small type guards
rather than assertions.

`onEdit` wiring, the menu, the confirm dialog and the `Heats` rewrite are
checked by hand in the Sheet (Task list in the plan).

## Docs

- `docs/deploy.md` §2: a **Calculator** step before **Heats**: fill `B1`
  and the rows, check the preview, **12th State → Write heats to Heats
  tab**, then **Update site fallback**.
- A §4c migration note: paste `Code.gs`, run `setup()` once to create the
  tab, reload the Sheet for the new menu item. No web-app redeploy is
  needed for the Calculator itself (menu and trigger run in the Sheet),
  but deploy a new version anyway since `Code.gs` changed.
- §5 rows for the calculator's error texts that aren't self-explanatory
  (overlap, midnight) and "preview doesn't update" (edit a cell on the
  Calculator tab; `onEdit` only runs on manual edits).

## Out of scope

- Planning several events at once.
- Deriving heat counts from sign-ups or an end time.
- Moving existing sign-ups between heats.
- A site page for the calculator.
