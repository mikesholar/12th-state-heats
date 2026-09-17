# Sheet-driven schedule and sign-up — Design

**Date:** 2026-09-17
**Builds on:** `2026-09-10-heat-tracker-design.md`, `2026-09-14-judge-scoring-design.md`
**Live target:** https://mikesholar.github.io/12th-state-heats/

## Purpose

Today the schedule is a TypeScript file in this repo, and sign-ups happen on
SignUpGenius. This change moves both into the Google Sheet the scoring
already writes to:

1. The 12th State team defines the comp — date, events, heats, lane counts,
   divisions — in the Sheet. No code edits, no redeploy.
2. Members claim a lane per event on a sign-up page in this app, SignUpGenius
   style. Lanes are empty until someone signs up.

The site stays static on GitHub Pages; the Apps Script web app bound to the
Sheet is still the only backend. Access control is by obscure URL only, as
it is for judge links.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Sign-up model | Slot-picking: a member claims a specific heat × lane, **per event** (a comp may have one event or several). |
| What a slot captures | Email, team name (when team size > 1), one name per athlete, division from a Sheet-defined list. No separate team-name field for individuals — the athlete's name is the team. |
| Team vs. individual | A comp-level `teamSize` setting (1 = individual). The form adapts. Team name is **required** when `teamSize > 1`. |
| Identity | Email, typed once and remembered on the device. Never shown on public pages. |
| Cancelling | Only your own slots (email match), from the sign-up page. Organisers fix anything else in the Sheet. |
| Sign-up window | A `signupsOpen` TRUE/FALSE cell in the Sheet. |
| Schedule source | Runtime fetch from Apps Script `doGet`, cached in `localStorage`, with a committed JSON snapshot as the final fallback. |
| Judge codes | Stay in the repo, pre-generated for events 1–6 × lanes 1–12 so the Sheet can change without regenerating. |
| Sign-up link | `?s=<code>`, same obscurity scheme as the head-judge link. |

## The Sheet

`setup()` in `Code.gs` creates the tabs below if missing (it never clears an
organiser-edited tab; it still rebuilds the formula tabs `Results` and
`Overall`). Existing `Log`, `Results`, `Overall` remain.

### `Settings` — key / value, one per row

| key | example | notes |
|---|---|---|
| `compDate` | `2027-09-11` | ISO date |
| `timeZone` | `America/New_York` | IANA name |
| `teamSize` | `2` | 1 = individual comp |
| `divisions` | `F/F RX, F/F Scaled, F/M RX, F/M Scaled, M/M RX, M/M Scaled` | comma-separated; order is the dropdown order |
| `signupsOpen` | `TRUE` | checkbox cell |

### `Events` — one row per event

`event` (1, 2, …), `title`, `format` (free text shown under the title),
`scoring` (`time-or-rounds` or `rounds-reps`; data-validation dropdown),
`capSeconds` (blank for `rounds-reps`), `rx`, `scaled`, `lanes` (lane count
for every heat in this event).

### `Heats` — one row per heat

`event`, `heat`, `start`, `end` — times as `HH:MM` text in the comp time
zone. Organisers add and delete rows freely.

### `Slots` — one row per claimed lane

`event`, `heat`, `lane`, `email`, `team`, `athletes`, `division`,
`signedUpAt`. Written by the sign-up endpoint; organisers may also type,
edit or delete rows. An empty lane is the absence of a row. `athletes` is one
cell, athletes joined with ` + ` (for an individual, the same as `team`).

A header note explains: rows whose event/heat/lane no longer exist are
ignored by the site; if two rows claim the same lane, the earlier
`signedUpAt` wins and the other is ignored.

### `Results` and `Overall`

Unchanged in behaviour. `team` remains the join key (for individuals it is
the athlete's name). `Overall` no longer hard-codes `EVENTS = [1, 2, 3]`:
`setup()` reads the `Events` tab to decide how many `E<n>` columns to build.
`setup()` is idempotent, so the organiser runs it once to create the tabs
and once more after filling `Events` (documented in the deploy guide).

## The endpoint (`Code.gs`)

### `doGet`

Returns the schedule assembled from `Settings`, `Events`, `Heats`, `Slots`:

```json
{ "ok": true,
  "schedule": {
    "compDate": "2027-09-11", "timeZone": "America/New_York",
    "teamSize": 2, "divisions": ["F/F RX", "F/F Scaled"], "signupsOpen": true,
    "events": [
      { "number": 1, "title": "12th Gear", "format": "12 Rounds · 8:00 Cap",
        "scoring": "time-or-rounds", "capSeconds": 480, "rx": "…", "scaled": "…",
        "lanes": 8,
        "heats": [
          { "number": 1, "start": "08:00", "end": "08:08",
            "lanes": [
              { "lane": 1, "email": "a@b.c", "team": "Resting WOD Face",
                "athletes": "Nicole Duncan + Cindy Sholar", "division": "F/F Scaled" } ] } ] } ] } }
```

- Only claimed lanes appear; the client knows the count from `lanes`.
- `capSeconds` is omitted when blank. `email` is omitted when blank (a
  hand-typed row).
- Orphan and duplicate `Slots` rows are dropped as described above.
- Values are passed through as the Sheet holds them; the client decoder is
  the validator. `doGet` does not fail on a bad row — a broken Sheet should
  produce a clear message in the app, not a 500.

### `doPost`

Dispatches on `action` in the JSON body. Every reply is `{ ok: true, … }` or
`{ ok: false, error }`. Writes run under `LockService`. Same no-headers POST
(a `Content-Type` header would trigger a CORS preflight Apps Script cannot
answer).

- **No `action` or `action: "score"`** — the existing score log, unchanged.
- **`action: "claim"`** — body: `clientId, event, heat, lane, email, team,
  athletes, division`. Refused (`ok: false`) when: `signupsOpen` is false;
  the event/heat doesn't exist or `lane` is outside `1..lanes`; the slot is
  held by a different email; this email already holds a slot in this
  event; `division` is not in the list; `team` or `athletes` is blank.
  Emails are compared trimmed and case-insensitively. The same `clientId`
  twice → `{ ok: true, duplicate: true }`. On success appends the `Slots`
  row with `signedUpAt` = server time.
- **`action: "release"`** — body: `event, heat, lane, email`. Deletes the
  matching row only if the email matches; otherwise
  `{ ok: false, error: "That slot isn't yours" }`. A slot that is already
  empty → `{ ok: true }` (idempotent). Refused when `signupsOpen` is false.

`claim` and `release` replies include the fresh `schedule` (same shape as
`doGet`) so the page redraws without a second round trip.

Smoke tests in the deploy guide: `curl` a `claim`, see the `Slots` row; the
same `curl` again returns `duplicate: true`; a `release` removes it.

## The app

### Types

```ts
type Lane = {
  readonly lane: number;
  readonly team: string;
  readonly athletes: string;
  readonly division: string;
  readonly email?: string;
};

type Heat = {
  readonly number: number;
  readonly start: string;
  readonly end: string;
  readonly lanes: readonly Lane[];      // claimed lanes only
};

type Event = {
  // existing fields…
  readonly lanes: number;               // lane count per heat
};

type Schedule = {
  readonly compDate: string;
  readonly timeZone: string;
  readonly teamSize: number;
  readonly divisions: readonly string[];
  readonly signupsOpen: boolean;
  readonly events: readonly Event[];
};
```

Renderers iterate `1..event.lanes` and look up the claimed lane by number.
`Heat.lanes` never contains holes.

### Decoding and validation — `src/core/schedule-schema.ts`

The trust boundary. A hand-rolled decoder (the project has no runtime
dependencies and keeps it that way) takes `unknown` and returns
`Result<Schedule, string>`. Messages name the tab and the entity so an
organiser can find the row (nested JSON carries no sheet row numbers):
`Heats: Event 1 Heat 3: end "08:21" is not after start 08:26`,
`Events: Event 2: scoring "amrap" must be time-or-rounds or rounds-reps`,
`Settings: compDate "9/11/27" must be YYYY-MM-DD`. The decoder stops at the
first structural problem; `validateSchedule` then reports every semantic
problem at once.

`validateSchedule` runs on the decoded value and changes to match the new
model:

- Keeps: duplicate lane in a heat, overlapping heats within an event, event
  with no heats, scoring/capSeconds consistency.
- Adds: heat end not after start; lane number outside `1..event.lanes`;
  `teamSize < 1`; empty `divisions`; a lane whose `division` is not in the
  list; duplicate heat numbers within an event; duplicate event numbers.
- Drops: the 7–8 lane count constant and "team missing from an event"
  (sign-up is per event; a team may skip one).

### Fetching and choosing — `src/ui/schedule-client.ts`, `src/ui/schedule-store.ts`, `src/core/load-schedule.ts`

- `fetchSchedule({ endpoint, fetchFn })` →
  `{ kind: "loaded", schedule } | { kind: "unreachable" } | { kind: "invalid", reason }`.
- `schedule-store` keeps the last good raw JSON under `schedule:cache` in
  `localStorage` and imports `src/data/schedule-snapshot.json` as the final
  fallback. Both go through the decoder when read.
- `chooseSchedule({ fetched, cached, snapshot })` (pure) picks live, else
  cached, else snapshot, and returns `{ schedule, source, reason? }` with
  `source: "live" | "cached" | "snapshot"` and, when not live, the reason
  (`unreachable` or the decoder message).

The header shows a small amber pill when `source !== "live"`: "Offline —
showing last known schedule" or "Sheet has a problem: <reason> — showing
last known schedule". If nothing decodes at all the page shows only
"Couldn't load the schedule — check your connection and reload" (with the
reason underneath when it is a Sheet problem).

The spectator page re-fetches every 60 s; the sign-up page every 30 s. The
judge page fetches once when opened (judges open it fresh before each event
by scanning the QR; a reload picks up any change). The existing 15 s clock
tick stays local. `?at=` preview keeps working.

### Snapshot — `scripts/snapshot.ts` (`npm run snapshot`)

Fetches `doGet`, decodes and validates, writes the reply's `schedule`
object to `src/data/schedule-snapshot.json` (fails loudly on any error).
`src/data/snapshot.ts` decodes that file at import time and exports
`snapshotSchedule`; the app, the tests and the link script all use it, and
the test suite decodes the committed snapshot, so a bad one fails the build.
`src/data/schedule.ts` and its hand-written data are deleted; the 2026 data
becomes the first snapshot.

### Endpoint config

`src/data/scoring-endpoint.ts` becomes `src/data/sheet-endpoint.ts`
exporting `sheetEndpoint`; it serves reads and writes. Empty string → the
app runs on cache/snapshot with the offline pill, and the judge page keeps
its "Scoring not configured" bar.

### Routing (`main.ts`)

Load schedule → route:

- no code → spectator page
- `?j=` lane / head / unknown → as today
- `?s=<signup code>` → sign-up page; unknown → the existing invalid-link page

### Codes

`scripts/judge-links.ts` no longer reads the schedule. It generates lane
codes for events 1–6 × lanes 1–12, one head code and one sign-up code,
keeping existing codes unless `--regenerate`. Output: `src/data/judge-codes.ts`
(table as today) and `signupCode` exported from the same file. The head
page shows QR cards only for event × lane pairs in the live schedule. The
link printout groups by event and marks which pairs the current snapshot
uses.

The schedule data test becomes: the snapshot decodes; every event × lane in
the snapshot has a code; codes are unique; exactly one head code; a sign-up
code exists.

### Spectator page changes

- Lanes with no claim render as `— open —`.
- The team picker lists claimed lanes across all events, deduped by team
  name. Its label is "I'm on…" when `teamSize > 1`, "I'm…" when 1.
- Offline/problem pill as above.

### Judge page changes

- An empty lane shows "No team in lane N for this heat" and disables the
  form (already the behaviour for a missing lane).
- `scoring`/`capSeconds` now come from the Sheet; score validation is
  unchanged.

### Sign-up page (`?s=<code>`)

Phone-first, same styling family as the rest.

1. **Header** — comp date, an "Sign-ups open" / "Sign-ups closed" pill, and
   a "Your email" field remembered on the device under `signup:email`.
   Nothing below is interactive until an email is entered. "Not you?
   Change email" clears it.
2. **One section per event** — title, format, then each heat with its time
   and a row of lane chips:
   - **open** — `Lane 4 · open`, tappable.
   - **taken** — team name (or athlete name for individuals) and division;
     not tappable.
   - **yours** — highlighted, with a **Cancel** button.
   If your email holds a slot in this event, the event's open chips are
   dimmed and labelled "You're in Heat 3".
3. **Claim form** — tapping an open chip opens an inline form under that
   heat: team name (only when `teamSize > 1`), `teamSize` name fields
   (labelled "Your name" when `teamSize` is 1, else "Athlete 1…N"), a
   division select from `divisions`, **Claim lane N** and **Never mind**.
   Fields are pre-filled from this device's last claim (`signup:last`).
   The client joins the names with ` + ` into `athletes`; for individuals
   `team` = the name. Blank fields are rejected inline before posting.
4. **Submit** — posts `claim` with a fresh `clientId`; on `ok` the page
   redraws from the returned schedule and the chip is now **yours**. A
   rejection shows the server's message inline under the heat (e.g. "Lane 4
   was just taken") and the redrawn heat shows the slot taken.
   Unreachable → "Couldn't reach the sheet — try again".
5. **Cancel** — posts `release`; on `ok` redraws. No confirm dialog: the slot
   is one tap to reclaim.
6. **Closed** — when `signupsOpen` is false everything is read-only, Cancel
   is hidden and the pill says closed.

No offline queue for sign-ups: they happen at home, and a claim that lands
minutes later against a taken slot would only confuse.

## Code layout

```
src/core/schedule-schema.ts       decode unknown → Result<Schedule>
src/core/validate-schedule.ts     updated rules
src/core/load-schedule.ts         chooseSchedule
src/core/signup.ts                claim/release request builders, form → athletes
src/ui/schedule-client.ts         fetchSchedule, postClaim, postRelease
src/ui/schedule-store.ts          localStorage cache + snapshot import
src/ui/signup-store.ts            email, last claim (localStorage)
src/ui/signup-route.ts            ?s= parsing
src/ui/render-signup.ts           sign-up page
src/ui/signup-page.ts             controller: load, claim, release, refresh
src/data/schedule-snapshot.json   committed fallback (npm run snapshot)
src/data/sheet-endpoint.ts        deployed script URL
src/data/judge-codes.ts           generated codes + signupCode
scripts/snapshot.ts               npm run snapshot
scripts/judge-links.ts            grid generation
apps-script/Code.gs               doGet, doPost (score | claim | release), setup
docs/deploy.md                    replaces scoring-deploy.md
```

## Testing

Vitest, behaviour-level, factories extended (`makeSchedule` gains
`teamSize`, `divisions`, `signupsOpen`; `makeLane` gains `email`).

- **schedule-schema**: decodes the documented JSON; each malformed shape is
  rejected with a message naming tab and row; the committed snapshot
  decodes.
- **validate-schedule**: each new rule; dropped rules no longer fire.
- **load-schedule**: live beats cached beats snapshot; source and reason
  reported; nothing available → error.
- **schedule-client**: loaded / unreachable / invalid; claim and release
  map `ok`, `ok+error`, network failure.
- **spectator**: open lanes render as `— open —`; picker label by
  `teamSize`; offline pill when not live.
- **sign-up page** (Testing Library, fake `fetchFn`): email gate; chip
  states open/taken/yours; one-slot-per-event dimming; claim form fields by
  `teamSize`; pre-fill; blank-field rejection; successful claim redraws from
  reply; server rejection shown inline; cancel releases; closed mode
  read-only; unknown code → invalid page.
- **codes**: grid covers snapshot; unique; one head; one sign-up code.
- **Apps Script**: not unit-tested; `curl` smoke tests in the deploy guide.

## Deployment guide (`docs/deploy.md`)

Replaces `scoring-deploy.md`. Sections:

1. **One-time setup** — create Sheet, paste `Code.gs`, run `setup()`,
   deploy as web app (*Execute as Me · Anyone*), paste the `/exec` URL into
   `sheet-endpoint.ts`, push. Smoke tests: `doGet` returns the schedule; a
   `claim` and a `release`; a `score`.
2. **Each year** — new Sheet (or clear `Slots` and `Log`), fill `Settings`,
   `Events`, `Heats`, run `setup()` again, flip `signupsOpen`, share the
   sign-up link (`npm run judge-links` prints it). Night before: flip
   `signupsOpen` off, `npm run snapshot`, commit, push. Update the date in
   README and `index.html`.
3. **Comp day** — as today, plus: the amber pill means the phone is showing
   a cached schedule.
4. **Redeploying the script** — unchanged.
5. **Troubleshooting** — existing rows plus: "Sheet has a problem: …"
   (fix the named row), sign-ups refused with "closed" (`signupsOpen`),
   slot shows on the page but not in `Slots` (cached — wait 60 s), judge
   page shows no team in a lane that was just filled (reload the page).

## Delivery

One spec, two implementation plans:

- **Plan A — schedule from the Sheet**: `Settings`/`Events`/`Heats`/`Slots`
  tabs, `doGet`, decoder, cache, snapshot, code grid, spectator/judge
  updates, `deploy.md`. Independently useful; the 2026 data becomes the
  first snapshot and nothing user-visible changes.
- **Plan B — sign-up**: `claim`/`release`, sign-up page, sign-up code.

## Out of scope

- Confirmation emails, waitlists, per-division capacity.
- Any organiser UI beyond the Sheet.
- Authentication beyond obscure URLs and a remembered email.
- Showing results on the spectator page.
