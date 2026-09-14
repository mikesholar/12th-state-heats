# Scoring — deployment guide

Judges enter scores on their phones via per-lane links on the heat tracker
site. Scores land in a Google Sheet. This guide is everything the organiser
does, in order. Budget 30 minutes the first time, 5 minutes in later years.

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
3. Back in the Sheet you now have `Log`, `Results` and `Overall` tabs with
   bold frozen headers. `Results` and `Overall` are formula-driven and
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

1. In this repo open `src/data/scoring-endpoint.ts` and paste the URL:

   ```ts
   export const scoringEndpoint = "https://script.google.com/macros/s/AKfyc.../exec";
   ```

2. `npm test && npm run build`, commit, push to `main`. GitHub Actions
   deploys in about a minute.

### 1f. Smoke test

From a terminal (substitute your URL):

```bash
curl -sL 'https://script.google.com/macros/s/AKfyc.../exec' \
  --data '{"clientId":"smoke-1","submittedAt":"2026-09-12T13:15:00.000Z","judge":"Smoke Test","event":2,"heat":1,"lane":7,"team":"Rays of Glory","division":"F/M Scaled","scoreKind":"rounds-reps","seconds":"","rounds":4,"reps":7}'
```

Do not add `-X POST`: `--data` already makes this a POST, and with `-L` an
explicit `-X POST` re-POSTs on the 302 that Apps Script answers with,
whereas browsers (and curl without `-X`) switch to GET as the script expects.

Expected output: `{"ok":true}`. Run it again: `{"ok":true,"duplicate":true}`.
The `Log` tab has one new row; `Results` shows `Rays of Glory · 4 + 7 ·
placing 1`; `Overall` shows them with E2 = 1.

Now the real thing: open a judge link on your phone (get it from
`npm run judge-links`), enter your name, submit a score. It should appear in
`Log` within a couple of seconds.

**Then delete the smoke-test rows from `Log`** (right-click the row number →
Delete row). `Results` and `Overall` update themselves.

If the curl prints an HTML login page instead of JSON, the deployment is not
set to *Anyone* — redo 1d.

## 2. Each year: schedule and links

1. Edit `src/data/schedule.ts` with the new heats. For each event set
   `scoring` (`"time-or-rounds"` for anything with a time cap,
   `"rounds-reps"` for an AMRAP) and `capSeconds` where applicable.
2. If the number of events or lanes changed, also update `EVENTS` at the
   top of `Code.gs` and redeploy the script (section 4).
3. `npm run judge-links` — prints every judge URL. Existing codes are kept
   so last year's links still work; add `-- --regenerate` to issue fresh
   ones (do this if a link was posted somewhere public).
4. `npm test` — the suite fails if any event×lane lacks a code or the
   scoring config is inconsistent.
5. Commit and push.

## 3. Comp day

**Night before**
- Open the head-judge link (the `HEAD JUDGE` line from `npm run judge-links`)
  on the head judge's phone and bookmark it. It shows a QR card for every
  event × lane.
- Open the Sheet on the laptop at the scorer's table. Keep `Overall` visible.
- Check the site loads on the gym Wi-Fi and on cellular.

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

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Red "Scoring not configured" bar on the judge page | `scoringEndpoint` is empty in the deployed site | Section 1e |
| Every submission stays pending, even on good Wi-Fi | Script not deployed as *Anyone*, or wrong URL | Section 1d; check the curl in 1f |
| curl returns HTML | Same as above | Same |
| `{"ok":false,"error":"Run setup() in the script editor first"}` | `Log` tab missing | Section 1c |
| Script asks to re-authorise | Google expires grants after a long idle period | Run `setup` once from the editor and accept |
| `Results` shows `#ERROR` right after `setup()` | Sheet locale is not United States; the formulas are written in en-US syntax | File → Settings → Locale → United States, then delete `Results` and `Overall` and run `setup` again |
| `Results` shows `#ERROR` | Formulas edited by hand | Delete the `Results` and `Overall` tabs and run `setup` again |
| Judge link says "This link isn't valid" | Code not in `src/data/judge-codes.ts` — regenerated after the link was shared | Re-run `npm run judge-links` and hand out the new link |
| Submit does nothing on a phone pointed at a LAN dev server (http://192.168…) | `crypto.randomUUID` needs a secure context | Test against the deployed https site, or use `npm run dev -- --host` with `localhost` on the same machine |
