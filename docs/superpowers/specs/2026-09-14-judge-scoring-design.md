# Judge Scoring — Design

**Date:** 2026-09-14
**Builds on:** `2026-09-10-heat-tracker-design.md`
**Live target:** https://mikesholar.github.io/12th-state-heats/

## Purpose

Scorekeeping at the 2026 comp was done on paper and went badly. This adds
phone-based score entry for lane judges: each **event × lane** judge gets a
link, opens it on their phone, sees the team in their lane for the heat on the
floor, enters the score, and taps Submit. Every submission is appended to a
Google Sheet that tallies per-event results and overall placing.

Everything stays a static site on GitHub Pages. The only backend is a Google
Apps Script web app bound to the Sheet.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Judge assignment | Per **event × lane** (judges rotate between events). 3 events × 8 lanes = 24 judge links. |
| Score format | E1 and E3: finished **time**, or **rounds + reps** if capped. E2: **rounds + reps**. No tiebreaks. |
| Link protection | Obscurity only — short random code in the URL, no server-side auth. |
| Sheet layout | **Append-only log**; results and overall placing are formula tabs. |
| Judge page flow | Heat auto-selected from the clock, one score at a time, prev/next to correct. |
| Submitted marks | Remembered on the phone; ✓ on heats already sent. |
| Offline | Failed submissions queue on the phone and retry. |
| Judge identity | Name required once per device, logged with every score. |
| Backend | Google Apps Script web app, source in this repo. |
| Assignment page | Hidden page with a QR code per judge link, for the head judge. |
| Overall placing | Sum of per-event placings within division; lowest wins. |

## Data model

### Event scoring config

`Event` gains two fields:

```ts
type ScoringFormat = "time-or-rounds" | "rounds-reps";

type Event = {
  // ...existing
  readonly scoring: ScoringFormat;
  readonly capSeconds?: number;   // required iff scoring === "time-or-rounds"
};
```

| Event | scoring | capSeconds |
|---|---|---|
| 1 · 12th Gear | `time-or-rounds` | 480 |
| 2 · Extra Credit | `rounds-reps` | — |
| 3 · Double Trouble | `time-or-rounds` | 720 |

`validate-schedule` fails the build if `capSeconds` is missing for a
`time-or-rounds` event or present for a `rounds-reps` event.

### Score

```ts
type Score =
  | { readonly kind: "time"; readonly seconds: number }
  | { readonly kind: "rounds-reps"; readonly rounds: number; readonly reps: number };
```

`validateScore({ scoring, capSeconds, score })` returns a `Result`:

- `time-or-rounds` accepts `time` with `0 < seconds <= capSeconds`, or
  `rounds-reps` with `rounds >= 0`, `reps >= 0`, not both zero.
- `rounds-reps` accepts only `rounds-reps` with the same range rules.
- Integers only. Any other combination is rejected with a human message
  ("Time can't exceed the 8:00 cap — use Capped").

`formatScore(score)` renders `7:42` or `9 + 14`.

### Judge codes

`src/data/judge-codes.ts` is a checked-in table:

```ts
export const judgeCodes: Readonly<Record<string, JudgeAssignment>> = {
  k8v2n: { kind: "lane", event: 2, lane: 5 },
  // ...24 lane entries
  hq7xm: { kind: "head" },
};
```

Codes are 5 lowercase alphanumerics, random, generated once by
`scripts/judge-links.ts` (`npm run judge-links`). The script is also what
prints the full URL list. Re-running it does **not** regenerate codes unless
`--regenerate` is passed, so links stay stable once handed out.

`resolveJudgeCode(code)` → `{ kind: "lane", event, lane } | { kind: "head" } | { kind: "unknown" }`.

The schedule data test asserts: every event × lane that appears in the
schedule has exactly one code; codes are unique; exactly one head code.

### Submission record

One per Submit tap. This is the wire format and the Sheet's `Log` row.

| Field | Type | Notes |
|---|---|---|
| `clientId` | string | random per submission; dedupe key for retries |
| `submittedAt` | ISO string | client clock at tap |
| `judge` | string | name from device |
| `event` | number | |
| `heat` | number | |
| `lane` | number | |
| `team` | string | copied from schedule at submit time |
| `division` | string | copied from schedule |
| `scoreKind` | `"time"` \| `"rounds-reps"` | |
| `seconds` | number \| "" | present iff `time` |
| `rounds` | number \| "" | present iff `rounds-reps` |
| `reps` | number \| "" | present iff `rounds-reps` |

## Routing

`main.ts` reads `?j=<code>` from the URL at load.

- No `j` → existing spectator page, unchanged.
- `j` resolves to `lane` → judge page.
- `j` resolves to `head` → QR assignment page.
- `j` unknown → "This link isn't valid — ask the head judge for a new one."

The `?at=` preview override keeps working on all pages. The 15-second refresh
tick drives the clock on the judge page too.

## Judge page

### Name gate

If no judge name is stored on the device, the page shows only a "Your name"
field and Continue. Stored under `judge:name` in `localStorage`. A small
"Not you? Change name" link in the footer clears it.

### Layout (top to bottom)

1. **Header strip** — `Event 2 · Extra Credit · Lane 5`, judge name, and a
   `N pending` badge while the retry queue is non-empty. If the scoring
   endpoint is not configured, a red "Scoring not configured" bar sits here.
2. **Heat selector** — `◀ Heat 3 of 5 ▶`. Heats already submitted from this
   phone show ✓.
3. **Team card** — team, athletes, division. If this lane has no team in the
   selected heat: "No team in lane 5 for this heat" and the form is disabled.
4. **Score form** — depends on `event.scoring`:
   - `time-or-rounds`: two large toggle buttons **Finished** / **Capped**.
     Finished shows `mm` : `ss` numeric inputs. Capped shows Rounds and Reps
     steppers (− / value / +, numeric input).
   - `rounds-reps`: Rounds and Reps steppers only.
5. **Submit** — full width. Reads "Update score" if this heat already has a
   submission from this phone.

### Heat auto-selection

`resolveJudgeHeat({ event, schedule, now, manual })` where
`manual` is `{ heat: number, at: Date } | undefined`:

- If `manual` is set and `now - manual.at < 10 minutes` → `manual.heat`.
- Otherwise: the heat running now; else the next heat to start; else the last
  heat (event over); before the event starts, the first heat.

Prev/next taps set `manual`. The 10-minute window means a judge fixing an old
score isn't yanked forward, but a phone left idle catches up.

### Submit flow

1. Build `Score` from the form; `validateScore`. On failure show the message
   inline under the form and stop.
2. Build the submission record (`clientId` = `crypto.randomUUID()`).
3. Mark the heat as submitted on this phone (`judge:sent:<event>:<lane>` →
   array of heat numbers) and show the green banner
   `Recorded ✓ — Rays of Glory: 4 + 7` immediately.
4. Enqueue and `flush()`.

Resubmitting a heat is allowed; it's a new log row and the Sheet takes the
latest by `submittedAt`.

### Queue and errors

`submit-queue.ts` keeps pending records under `judge:queue`.

- `flush()` posts records in order. A network error (fetch throws, or
  non-2xx) stops the flush; remaining records stay queued. The banner turns
  amber: "Saved on this phone — will retry".
- A `{ ok: false, error }` reply means the server rejected the record. It is
  removed from the queue and the error shown in red. Not retried.
- A `{ ok: true }` (including `duplicate: true`) removes the record.
- `flush()` runs after every enqueue, on the `online` event, and on every
  refresh tick. The banner clears when the queue empties.

`score-client.ts` exposes `postScore({ endpoint, submission, fetch })` with
`fetch` injected for tests.

## Head judge (QR assignment) page

Rendered for the head code. Grouped by event, one card per lane:

```
Lane 5
[QR]
k8v2n
https://mikesholar.github.io/12th-state-heats/?j=k8v2n
```

QR is an inline SVG from the `qrcode` npm package (no network). Cards are
large enough to scan from a phone screen at arm's length. Page is printable.

## Backend — Apps Script

`apps-script/Code.gs`, deployed by the organiser as a web app
(*Execute as: Me · Who has access: Anyone*). Two functions:

**`setup()`** — run once from the editor. Creates tabs `Log`, `Results`,
`Overall` with headers, frozen header rows, and the formulas below.

**`doPost(e)`**:

1. `JSON.parse(e.postData.contents)`. Missing required field or `scoreKind`
   not in `{time, rounds-reps}` → `{ ok: false, error }`.
2. If `clientId` already exists in `Log` → `{ ok: true, duplicate: true }`.
3. Append row: `receivedAt` (server time), then every field of the submission
   record in the table order above.
4. Return `{ ok: true }`.

Uses `LockService` around the dedupe-check + append so concurrent judges
can't both append the same `clientId`.

**CORS:** the page posts with `fetch(url, { method: "POST", body })` and no
`Content-Type` header. That is a simple request (no preflight), Apps Script
302-redirects to the result, and the final response carries
`Access-Control-Allow-Origin: *`. No `mode: "no-cors"` — we need to read the
reply.

**Endpoint config:** `src/data/scoring-endpoint.ts` exports the deployed
script URL. Empty string → judge page shows "Scoring not configured".

## Sheet tabs

### `Log`

Append-only. Columns: `receivedAt, submittedAt, judge, event, heat, lane,
team, division, scoreKind, seconds, rounds, reps, clientId`.

### `Results`

One row per (event, team) — the latest `Log` row by `submittedAt`. Columns:
`event, division, team, scoreKind, seconds, rounds, reps, display, placing`.

Placing is within (event, division):

- `time-or-rounds` events: any `time` beats any `rounds-reps`; times
  ascending; then rounds descending, reps descending.
- `rounds-reps` events: rounds descending, reps descending.
- Ties share a placing (competition ranking: 1, 1, 3).

Implemented with a sort-key column (`time` → `seconds`; `rounds-reps` →
`1_000_000 − rounds·10_000 − reps`, i.e. always larger than any time) and
`RANK`-style formulas. Sort key semantics are documented in a note on the
header cell.

### `Overall`

One row per (division, team): placing in E1, E2, E3, and **total**. Lowest
total wins; ties share a place. A team with no score in an event gets
`(teams in division) + 1` for that event. Teams appear if they have a score
in at least one event.

## Deployment guide

`docs/scoring-deploy.md` is a deliverable, written for someone doing this
once a year. Sections:

1. **Before the comp — one-time setup**
   - Create the Google Sheet (any name), note its URL.
   - Extensions → Apps Script; paste `apps-script/Code.gs`; save.
   - Run `setup()` once; authorise the script when prompted (it touches only
     this Sheet).
   - Deploy → New deployment → Web app · Execute as Me · Anyone → copy the
     `/exec` URL.
   - Put that URL in `src/data/scoring-endpoint.ts`; commit; push. GitHub
     Actions deploys.
   - Smoke test: the guide gives a `curl` command posting a fake record, and
     says what the `Log` row should look like. Then delete that row.
   - Open a judge link on a phone and submit a real test score; confirm it
     appears; delete it.
2. **Updating the schedule for a new year** — edit `schedule.ts`, set
   `scoring`/`capSeconds`, run `npm run judge-links -- --regenerate` if the lane
   count changed, run `npm test`.
3. **Comp day**
   - Head judge opens the head link (bookmark it the night before).
   - Each lane judge scans their event's QR before that event starts.
   - What "pending" means and what to do (keep the page open; it retries).
   - How to fix a wrong score (resubmit — latest wins; or edit `Log`).
   - Where to read results (`Results`, `Overall` tabs).
4. **Redeploying the script** — any change to `Code.gs` needs Deploy →
   Manage deployments → Edit → New version; the URL does not change.
5. **Troubleshooting** — "Scoring not configured", submissions stuck pending
   (script not deployed as Anyone; wrong URL), authorisation expired.

## Code layout

```
src/core/score.ts                  Score type, validateScore, formatScore
src/core/resolve-judge-heat.ts     heat auto-pick with manual override
src/core/judge-codes.ts            resolveJudgeCode
src/core/submission.ts             buildSubmission
src/data/judge-codes.ts            code table (generated)
src/data/scoring-endpoint.ts       deployed script URL
src/ui/judge-store.ts              name, sent marks, queue (localStorage)
src/ui/score-client.ts             postScore with injected fetch
src/ui/submit-queue.ts             enqueue / flush
src/ui/render-judge.ts             judge page
src/ui/render-head.ts              QR assignment page
src/ui/judge-route.ts              ?j= parsing
scripts/judge-links.ts             generate codes, print links
apps-script/Code.gs                doPost + setup
docs/scoring-deploy.md             deployment guide
```

`main.ts` becomes a small router. `render.ts` (spectator) is untouched.

## Testing

Vitest, behaviour-level, factories extended with `makeScore`,
`makeSubmission`, `makeJudgeAssignment`.

- **score**: every rejection path; exactly-at-cap accepted; cap+1 rejected;
  `0 + 0` rejected; formatting.
- **resolve-judge-heat**: before event, during heat, gap between heats, after
  event, manual override honoured within 10 min and released after.
- **judge page** (Testing Library): name gate stores and skips; correct team
  for lane and heat; empty lane disables form; Finished/Capped toggles
  fields; submit posts the right record; ✓ appears; "Update score" label;
  network failure shows retry banner then drains on next tick; server
  rejection shows message and is not retried; unconfigured endpoint bar;
  unknown code page.
- **queue**: preserves order; stops at first network failure; drops
  rejections; removes on `duplicate: true`.
- **head page**: one card per lane code, grouped by event, URL text correct.
- **schedule data**: scoring config valid; code table covers every
  event × lane, codes unique, exactly one head code.
- **Apps Script**: not unit-tested; covered by the curl smoke test in the
  deploy guide. `Code.gs` stays small and does no ranking.

## Out of scope

- Authentication of judges.
- Editing or deleting scores from the site.
- Showing results on the spectator page (a later feature once the Sheet
  is trusted).
- Tiebreak scores.
