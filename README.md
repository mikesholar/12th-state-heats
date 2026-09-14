# 12 Years of 12th State — Heat Tracker

Phone-first heat and lane tracker for the 12th State CrossFit in-house comp,
**Saturday, September 12, 2026**, 8:00 AM – 1:00 PM Eastern.

**Live:** https://mikesholar.github.io/12th-state-heats/

Open it on comp day and it shows the heat on the floor, the heat up next, and —
once you pick your team from the **"I'm on…"** dropdown — your own next event,
heat and lane with a countdown. The pick is remembered on your phone. The page
refreshes itself every 15 seconds; no reload needed.

## Scoring

Lane judges get a per-event link (`?j=<code>`) that shows the team in their
lane for the heat on the floor and posts the score to a Google Sheet. The
head judge's link shows a QR code for every lane. Setup, comp-day steps and
troubleshooting: **[docs/scoring-deploy.md](docs/scoring-deploy.md)**.

## Editing the schedule

Everything is in **`src/data/schedule.ts`**: three events, each with heats,
each heat with lanes (`lane`, `team`, `athletes`, `division`). Team names are
the join key across events, so spell them identically everywhere.

Push to `main` and GitHub Actions runs lint, typecheck and tests, then deploys.
The test suite validates the data — duplicate lanes, overlapping heats, wrong
lane counts and a team missing from an event all fail the build.

### Known deviations from the source PDFs

- **Event 1 Heat 2** listed two teams in lane 6. 12th State Dumpys is lane 5.
- **Jointly Unstable** (Gail Ho + Kelly Monroe) does not appear anywhere in
  the Event 3 PDF. The test pins this as the one allowed gap; if they get a
  lane, add them and change the expectation in `src/data/schedule.test.ts` to
  `[]`.
- **Event 2 Scaled** says *20 Ring Rows* (from the gym's workout post); the heat
  PDF header says *20 Pull Ups*.

## Previewing a different time

Append `?at=YYYY-MM-DDTHH:MM` (Eastern) to see the page as it will look then:

- `?at=2026-09-12T07:45` — before the first heat
- `?at=2026-09-12T08:30` — Event 1 Heat 3 on the floor
- `?at=2026-09-12T10:30` — break between Events 2 and 3
- `?at=2026-09-12T13:05` — done

## Development

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

Pure logic lives in `src/core/` (all functions take `now: Date`; nothing reads
the clock); DOM rendering in `src/ui/`. Design spec and plan are under
`docs/superpowers/`.

`npm run judge-links` regenerates `src/data/judge-codes.ts` (keeping existing
codes) and prints every judge URL. `apps-script/Code.gs` is the Sheet
backend; it is pasted into Apps Script by hand, not built. `flush` in
`submit-queue.ts` is not serialised; concurrent flushes (tick, `online`,
post-submit) can double-post, which is safe only because `Code.gs` dedups by
`clientId` under `LockService`.
