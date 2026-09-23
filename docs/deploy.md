# Deployment guide — Sheet, script and site

Organisers define the comp in a Google Sheet: `Settings`, `Events`, `Heats`
and `Slots` tabs. A script on the Sheet serves that schedule to the site and
records scores. This guide is everything the organiser does, in order.
Budget 30 minutes the first time, 10 minutes in later years.

## 1. One-time setup (do this at least a week out)

### 1a. Create the Sheet

1. Go to https://sheets.new and create a blank spreadsheet. Name it
   something like `12th State 2027 Scores`.
2. Leave the default `Sheet1` alone for now; the script adds its own tabs.

### 1b. Add the script

1. In the Sheet: **Extensions → Apps Script**. A new tab opens with an
   empty `Code.gs`.
2. Delete everything in the editor and paste the full contents of
   `apps-script/Code.gs` from this repo.
3. **File → Save** (or Ctrl/Cmd-S). Name the project when asked
   (`12th State Scoring`).

### 1c. Create the tabs

1. In the function dropdown in the toolbar pick `setup`, then press **Run**.
2. The first run asks for authorisation: **Review permissions → your
   account → Advanced → Go to 12th State Scoring (unsafe) → Allow**. It is
   "unsafe" only in the sense that you wrote it; it can touch this Sheet
   and nothing else.
3. Back in the Sheet you now have eight tabs: `Settings`, `Divisions`,
   `Events`, `Heats`, `Slots`, `Log`, `Results` and `Overall`. `setup()`
   only creates a tab if it is missing — running it again never clears data
   you have already entered. `Results` and `Overall` are formula-driven and
   empty until scores arrive. Delete `Sheet1`.

### 1d. Deploy the web app

1. In the script editor: **Deploy → New deployment**.
2. Click the gear next to *Select type* and choose **Web app**.
3. Fill in:
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**  ← this is the one people get wrong
4. **Deploy**, authorise again if asked, then **copy the Web app URL**. It
   ends in `/exec`.

### 1e. Point the site at it

1. In this repo open `src/data/sheet-endpoint.ts` and paste the URL:

   ```ts
   export const sheetEndpoint = "https://script.google.com/macros/s/AKfyc.../exec";
   ```

2. `npm test && npm run build`, commit, push to `main`. GitHub Actions
   deploys in about a minute.

### 1f. Smoke test

From a terminal (substitute your URL):

```bash
curl -sL 'https://script.google.com/macros/s/AKfyc.../exec'
```

Expected output: `{"ok":true,"schedule":{"compDate":…`. If it prints
`{"ok":false,"error":"Run setup() in the script editor first (missing …)"}`
instead, a tab is missing — go back to 1c. If it prints an HTML login page,
the deployment is not set to *Anyone* — redo 1d.

Now the score endpoint (same URL, still substitute yours):

```bash
curl -sL 'https://script.google.com/macros/s/AKfyc.../exec' \
  --data '{"clientId":"smoke-1","submittedAt":"2026-09-12T13:15:00.000Z","judge":"Smoke Test","event":2,"heat":1,"lane":7,"team":"Rays of Glory","division":"F/M Scaled","scoreKind":"rounds-reps","seconds":"","rounds":4,"reps":7}'
```

Do not add `-X POST`: `--data` already makes this a POST, and with `-L` an
explicit `-X POST` re-POSTs on the 302 that Apps Script answers with,
whereas browsers (and curl without `-X`) switch to GET as the script expects.

Expected output: `{"ok":true}`. Run it again: `{"ok":true,"duplicate":true}`.
The `Log` tab has one new row; `Results` shows `Rays of Glory · 4 + 7 ·
placing 1`; `Overall` shows them with the matching event column = 1.

Now the real thing: open a judge link on your phone (get it from
`npm run judge-links`), enter your name, submit a score. It should appear in
`Log` within a couple of seconds.

**Then delete the smoke-test rows from `Log`** (right-click the row number →
Delete row). `Results` and `Overall` update themselves.

Now the sign-up endpoint (same URL again):

```bash
curl -sL '<url>' --data '{"action":"claim","event":1,"heat":1,"lane":1,"email":"smoke@example.com","team":"Smoke Test","athletes":"A + B","division":"F/M Scaled"}'
```

Expected `{"ok":true,"schedule":{…}}` — or `{"ok":false,"error":"Sign-ups
are closed"}` if the `signupsOpen` box is unticked (tick it first). The
`division` must be one of the names listed in the `Divisions` tab. `Slots`
gains a row. Then:

```bash
curl -sL '<url>' --data '{"action":"release","event":1,"heat":1,"lane":1,"email":"smoke@example.com"}'
```

Expected `{"ok":true,…}`; the row is gone.

## 2. Each year: define the comp in the Sheet

1. **Settings** — set `compName` (the title shown on every page and in the
   browser tab), `compDate` (`YYYY-MM-DD`) and `timeZone` (an IANA name,
   e.g. `America/New_York`). `laneLabel` is the word the site uses
   for a lane — `Lane`, `Position`, `Spot` — everywhere it is shown
   (blank means `Lane`). Tick `signupsOpen` when you're ready to share the
   sign-up link; untick it to freeze the field — members can still see the
   heats but not change anything.
2. **Divisions** — one row per division, in the order you want them
   displayed: `division` (the name) and `teamSize` — `1` for individuals,
   `2` for pairs, and so on. Mixed sizes are fine in the same heat (an
   individual and a pair can share lanes); the sign-up form asks for
   however many names the chosen division's `teamSize` calls for. Division
   names here must match exactly what any hand-typed `Slots` rows use.
3. **Events** — one row per event: `scoring` is `time-or-rounds` for
   anything with a time cap (fill in `capSeconds`) or `rounds-reps` for an
   AMRAP (leave `capSeconds` blank); `lanes` is the number of lanes per
   heat.
4. **Heats** — one row per event × heat, `start`/`end` as `HH:MM` text
   (e.g. `08:00`).
5. Run `setup()` again. It only fills in what's missing, but it always
   rebuilds `Overall`'s columns to match the current `Events` tab — do this
   any time the number of events changes.
6. Open the site and check it against the Sheet. If a cell is wrong, the
   header shows an amber pill naming the problem (e.g. `Sheet has a
   problem: Events: Event 2: scoring "amrap" must be time-or-rounds or
   rounds-reps`) — fix the cell. Changes show on phones within about a
   minute and a half while sign-ups are open (the script caches replies for
   30 s and phones re-fetch about every 60 s); once `signupsOpen` is
   unticked phones re-fetch about every 3 minutes, so on comp day allow up
   to ~4 minutes for a `Slots` fix to reach every phone.
7. **Slots** — filled in by the sign-up page as members claim lanes. Rows
   can also be typed by hand: one row per claimed lane (`event`, `heat`,
   `lane`, `team`, `athletes`, `division`; `email` and `signedUpAt` are
   optional). `division` must be one of the names in the `Divisions` tab.
   Leave `email` blank for a hand-typed row — then nobody can cancel it
   from the sign-up page. A member's row carries their email, so only they
   can cancel it.
8. Either start a fresh Sheet for the year (repeat section 1 — a new
   deployment gives a new `/exec` URL for `src/data/sheet-endpoint.ts`) or
   clear last year's rows from `Slots` and `Log` in the same Sheet.
9. `npm run judge-links` — reads the Sheet and prints a judge URL for every
   event × lane it has, plus the head-judge link.
   It also prints the `SIGN-UP` link — share that with members. It is
   obscure, not secret: anyone with the link can sign up. Codes are stable
   across years, so existing links keep working; pass `--regenerate` to
   issue fresh ones (do this if a link was posted somewhere public).
10. Update the date in `README.md` and the `<meta name="description">` in
    `index.html`.

**Night before**
- Uncheck `signupsOpen` in `Settings` (if it was ever checked).
- `npm run snapshot` — pulls the Sheet into
  `src/data/schedule-snapshot.json`, the fallback a phone uses if it has
  never loaded the site before. It never contains lane emails; the script
  strips them before writing the file.
- `npm test`, commit, push.

## 2a. Sign-up window

1. Tick `signupsOpen` in `Settings`.
2. Share the sign-up link (`npm run judge-links` prints the `SIGN-UP`
   line).
3. Members claim one lane per event: email once, then per lane a division
   first, then the team name and one name per athlete the division calls
   for. They can Cancel their own claim from the page.
4. Watch `Slots` as claims come in; fix anything wrong by editing or
   deleting rows directly.
5. The night before: untick `signupsOpen`, `npm run snapshot`, commit,
   push.

## 3. Comp day

**Night before**
- Open the head-judge link (the `HEAD JUDGE` line from `npm run judge-links`)
  on the head judge's phone and bookmark it. Tap **Generate QR codes** to
  draw a QR card for every event × lane the Sheet has right now (made in the
  browser, no script to run).
- Open the Sheet on the laptop at the scorer's table. Keep `Overall` visible.
- Check the site loads on the gym Wi-Fi and on cellular.
- The sign-up link keeps working on comp day only if `signupsOpen` is
  ticked; leave it unticked so nobody moves lanes mid-comp.

**Before each event**
- Head judge walks the lanes; each lane judge scans the QR card for their
  lane. First scan asks for their name once.
- The page picks the heat on the floor automatically. ◀ ▶ moves between
  heats if needed.

**During**
- Judge enters the score and taps **Submit score**. Green "Recorded ✓"
  means it is in the Sheet.
- Amber "Saved on this phone — will retry" with an *N pending* badge means
  the phone could not reach Google. Keep the page open; it retries every
  15 seconds and as soon as the phone is back online. Do not close the tab.
- A red message means the score was refused (a validation problem such as a
  time over the cap). Fix and resubmit.
- An amber pill in the header (`Offline — showing last known schedule` or
  `Sheet has a problem: … — showing last known schedule`) means the page is
  showing a cached copy of the schedule, not live data. Reload once Wi-Fi is
  back to pick up whatever changed.
- A `Slots` edit shows on spectator phones within about a minute and a half
  (30 s cache + 60 s re-fetch). Judge phones only read the schedule when the
  page is opened — reload a judge's phone to pick up a change.

**Fixing a wrong score**
- Judge goes ◀ to the heat and submits again. The latest submission wins.
- Or edit the row directly in `Log`. Never edit `Results` or `Overall` —
  they are formulas.

**Reading results**
- `Results`: one row per event × team, latest score, placing within
  division.
- `Overall`: per division, placing in each event, total, place. Lowest
  total wins; ties share a place; a team with no score in an event gets
  one worse than last.

## 4. Changing the script later

Any edit to `Code.gs` needs a new version: **Deploy → Manage deployments →
✎ (edit) → Version: New version → Deploy**. The `/exec` URL stays the same,
so the site does not need a rebuild.

## 4a. Migrating an existing Sheet to the `Divisions` tab

If your Sheet was set up before team size moved to the `Divisions` tab, it
still has `teamSize` and `divisions` rows in `Settings` instead.

1. In the script editor, paste the current `apps-script/Code.gs` (section
   1b) and run `setup()`. It creates the `Divisions` tab with six default
   rows (`F/F RX`, `F/F Scaled`, `F/M RX`, `F/M Scaled`, `M/M RX`,
   `M/M Scaled`, each `teamSize` 2) without touching anything else.
2. Edit those rows to match your comp — add, remove or rename divisions,
   and set each `teamSize`.
3. Delete the old `teamSize` and `divisions` rows from `Settings`. Leaving
   them is harmless; the script no longer reads them.
4. Deploy the script as a new version (section 4) **before** pushing the
   updated site. Until both the script and the site are on the new
   version, phones show the amber "Sheet has a problem: Divisions: …" pill
   over the last known schedule.

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Red "Scoring not configured" bar on the judge page | `sheetEndpoint` is empty in the deployed site | Section 1e |
| Every submission stays pending, even on good Wi-Fi | Script not deployed as *Anyone*, or wrong URL | Section 1d; check the curl in 1f |
| curl returns HTML | Same as above | Same |
| Score submission returns `{"ok":false,"error":"Run setup() in the script editor first"}` | `Log` tab missing | Section 1c |
| Script asks to re-authorise | Google expires grants after a long idle period | Run `setup` once from the editor and accept |
| `Results` shows `#ERROR` right after `setup()` | Sheet locale is not United States; the formulas are written in en-US syntax | File → Settings → Locale → United States, then delete `Results` and `Overall` and run `setup` again |
| `Results` shows `#ERROR` | Formulas edited by hand | Delete the `Results` and `Overall` tabs and run `setup` again |
| Judge link says "This link isn't valid" | Code not in `src/data/judge-codes.ts` — regenerated after the link was shared | Re-run `npm run judge-links` and hand out the new link |
| Submit does nothing on a phone pointed at a LAN dev server (http://192.168…) | `crypto.randomUUID` needs a secure context | Test against the deployed https site, or use `npm run dev -- --host` with `localhost` on the same machine |
| Amber "Offline — showing last known schedule" on every phone, even on good Wi-Fi | Script not deployed as *Anyone* (the browser cannot follow Google's login redirect, so it looks like being offline), or wrong URL | Section 1d; the curl in 1f |
| Amber "Sheet has a problem: Events: Event 2: scoring …" | A cell in the named tab/row | Fix the cell; phones update within about a minute and a half |
| Amber "Sheet has a problem: Run setup() … (missing Heats)" | A tab was deleted or renamed | Run `setup()` again (it recreates only what is missing) |
| `npm run snapshot` fails with "The Sheet has a problem" | Same as above | Fix the Sheet, rerun |
| `npm run snapshot` fails with "Events: must list at least one event" | `Events` tab is empty | Fill `Events`/`Heats` first |
| Heat times show as `#####` or wrong | `start`/`end` cells auto-formatted as times | Type them as text (`'08:00`) or set the column format to Plain text |
| Comp date is off by one | `compDate` cell became a date in a sheet whose time zone differs from the comp's | Type it as text (`'2027-09-11`), or set File → Settings → Time zone to the comp's zone |
| Judge page says "No team in lane N" for a lane that was just filled | Judge page loaded before the change | Reload the judge page |
| `Overall` has the wrong number of `E` columns | Events changed after `setup()` | Run `setup()` again |
| Sign-up page says "Sign-ups are closed" when claiming | `signupsOpen` unticked | Tick it in `Settings` |
| "Lane N was just taken" | Someone else claimed it seconds earlier | Pick another lane |
| "You're already in Heat X of this event" | One lane per email per event | Cancel the other one first (or use the other email) |
| A member can't cancel a slot | The `Slots` row's `email` doesn't match theirs (hand-typed or typo) | Fix the `email` cell or delete the row |
| Member says the page shows old data | Script caches 30 s; the page re-fetches every 30 s | Wait a minute or reload |
| Sign-up link shows "This link isn't valid" | Code doesn't match `signupCode` in `src/data/judge-codes.ts` | `npm run judge-links` and share the printed `SIGN-UP` link |
| Sign-up form shows no name fields | The member hasn't picked a division yet — by design, until then the form doesn't know how many names to ask for | Pick a division |
| Amber "Sheet has a problem: Divisions: …" | A row in the `Divisions` tab has a blank or non-number `teamSize`, or a blank division name | Fix the row in the `Divisions` tab |
