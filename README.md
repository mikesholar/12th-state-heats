# 12 Years of 12th State — Heat Tracker

Phone-first heat and lane tracker for the 12th State CrossFit in-house comp.
The comp's name, date, events, heats and lanes all come from a Google Sheet.

**Live:** https://12thstatecomp.com/

Open it on comp day and it shows the heat on the floor, the heat up next, and
every event's heats and lanes. The page refreshes itself every 15 seconds; no
reload needed.

## Scoring

Lane judges get a per-event link (`?j=<code>`) that shows the team in their
lane for the heat on the floor and posts the score to a Google Sheet. The
head judge's link has a **Generate QR codes** button that draws a QR code for
every lane in the browser. Setup, comp-day steps and
troubleshooting: **[docs/deploy.md](docs/deploy.md)**.

## The schedule lives in the Sheet

Organisers define the comp in the Google Sheet — `Settings`, `Divisions`,
`Events`, `Heats` and `Slots` tabs — and the site reads it through the Apps Script
endpoint on every load (re-checked every minute). Phones cache the last
good copy, and `src/data/schedule-snapshot.json` (refreshed with
`npm run snapshot`) is the fallback for a phone that has never loaded the
site. Everything the organiser does is in **[docs/deploy.md](docs/deploy.md)**.

A lane nobody has claimed shows as *— open —*. `laneLabel` in `Settings`
renames "Lane" everywhere the site shows it (`Position`, `Spot`…), and
`compName` is the title on every page. The 2026 comp lives on as a test
fixture (`src/test/comp-2026.json`) that the behaviour tests run against.

## Sign-up

Members use the sign-up link (`?s=<code>`, printed by `npm run judge-links`)
to claim one lane per event: email once, then per lane a division first,
then the team name and one name per athlete the division calls for. Their
own claims show a **Cancel**. Organisers open and close the window with the
`signupsOpen` checkbox in `Settings` and can fix anything by editing
`Slots`.

## Previewing a different time

Append `?at=YYYY-MM-DDTHH:MM` (in the comp's time zone) to see the page as it
will look then — for a comp on 2027-09-25 with an 8:00 first heat:

- `?at=2027-09-25T07:45` — before the first heat
- `?at=2027-09-25T08:30` — a heat on the floor
- `?at=2027-09-25T13:05` — done

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

`npm run judge-links` regenerates `src/data/judge-codes.ts` (a fixed 6-event
× 12-lane grid plus head and sign-up codes; existing codes are kept) and
prints the URLs for the events and lanes currently in the Sheet. `npm run snapshot` pulls the
Sheet into `src/data/schedule-snapshot.json`, emails stripped.
`apps-script/Code.gs` is the Sheet backend; it is pasted into Apps Script by
hand, not built. `flush` in `submit-queue.ts` is not serialised; concurrent
flushes (tick, `online`, post-submit) can double-post, which is safe only
because `Code.gs` dedups by `clientId` under `LockService`.

### Gotchas

- `score-client.ts` posts a string body with **no** headers on purpose. A
  `Content-Type: application/json` header triggers a CORS preflight that
  Apps Script cannot answer, and every score sticks at "pending".
- `Code.gs` converts date/time cells using the *spreadsheet's* time zone
  (File → Settings), which is why `setup()` formats those columns as plain
  text — a pasted time-formatted cell in a Pacific-zoned sheet would
  otherwise come out three hours off.
- In jsdom tests, `toBeInTheDocument` needs the root attached
  (`document.body.append(root)`); otherwise every such assertion fails with
  an unhelpful message. See `render-judge.test.ts`.
- Keys in `src/data/judge-codes.ts` are quoted because codes may start with
  a digit. The generator writes them; don't hand-edit.
