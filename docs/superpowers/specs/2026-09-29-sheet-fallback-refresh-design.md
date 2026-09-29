# Sheet-triggered fallback refresh — Design

**Date:** 2026-09-29
**Builds on:** `2026-09-17-sheet-schedule-and-signup-design.md`
**Live target:** https://mikesholar.github.io/12th-state-heats/

## Purpose

`src/data/schedule-snapshot.json` is bundled into the site as the fallback
for a phone that has never loaded the site and cannot reach the Sheet. Today
it only changes when a developer runs `npm run snapshot`, commits and pushes,
so it goes stale as soon as the organisers edit the Sheet.

The 12th State staff have access to the Google Sheet and the site — not to
GitHub or a terminal. They need to refresh the deployed fallback themselves,
from the Sheet, in one click.

## Decisions

- **Trigger:** a custom Sheet menu, **12th State → Update site fallback**.
  No site page, nothing in the public bundle.
- **Mechanism:** the menu asks GitHub to run the existing deploy workflow
  (`workflow_dispatch`). The deploy workflow pulls a fresh snapshot before
  building. Nothing is committed back to the repo.
- **Credential:** a fine-grained GitHub token scoped to this repo only, with
  *Actions: Read and write* and nothing else, stored in Apps Script Script
  Properties as `GITHUB_TOKEN`. Accepted risk: anyone who can edit the Sheet
  can open the script project and read it. Its worst use is triggering
  extra deploys.
- **Failure policy:** a broken or unreachable Sheet never blocks a deploy.
  The build falls back to the committed snapshot and logs a warning.

## Components

### 1. `apps-script/Code.gs`

**`onOpen()`** adds the menu:

```
12th State ▾
  Update site fallback      → refreshFallback()
```

**`refreshFallback()`** — runs as the clicking user, from the menu:

1. Read `GITHUB_TOKEN` from Script Properties. Missing → toast
   *"Fallback updates aren't set up — see docs/deploy.md §1g."* and stop.
2. Take the script lock directly (`LockService.getScriptLock().tryLock(LOCK_WAIT_MS)`,
   released in `finally`), so two quick clicks can't both pass the rate
   limit. Not `withLock`, which returns web-app replies rather than showing
   a toast. Lock not acquired → toast *"The sheet is busy — try again."*
3. Read `lastFallbackRefreshAt` (epoch ms) from Script Properties. Less than
   5 minutes ago → toast *"An update started less than 5 minutes ago — try
   again at HH:MM."* (Sheet time zone) and stop.
4. `clearScheduleCache()`, so the snapshot sees edits made seconds ago
   rather than a reply up to `SCHEDULE_CACHE_SECONDS` old.
5. `UrlFetchApp.fetch` with `muteHttpExceptions: true`:
   `POST https://api.github.com/repos/mikesholar/12th-state-heats/actions/workflows/deploy.yml/dispatches`,
   headers `Authorization: Bearer <token>`,
   `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`,
   body `{"ref":"main"}`.
6. `204` → store `lastFallbackRefreshAt = now`, toast *"Site fallback update
   started — live in about 2 minutes."*
   Anything else → toast *"GitHub refused the update (<status>): <message>"*
   using the `message` field of GitHub's JSON reply when present. The
   timestamp is not stored, so staff can retry immediately after a fix.

New constants sit with the others at the top of the file:
`GITHUB_REPO = "mikesholar/12th-state-heats"`,
`DEPLOY_WORKFLOW = "deploy.yml"`, `FALLBACK_REFRESH_COOLDOWN_MS = 5 * 60 * 1000`.

The first click by each user prompts Google's authorisation dialog for
"connect to an external service" (`UrlFetchApp`). This is expected.

No web-app change: the menu runs the script's head code inside the Sheet,
not through `doGet`/`doPost`, so the `/exec` deployment does not need a new
version for this feature (§4 of the deploy doc still applies to other edits).

### 2. `.github/workflows/deploy.yml`

In the `verify` job, after `npm test` and before `npx vite build`:

```yaml
- name: Refresh schedule fallback
  run: npm run snapshot || echo "::warning::Could not refresh the schedule fallback from the Sheet; building with the committed snapshot"
```

`scripts/snapshot.ts` is unchanged: it already fetches, validates, strips
emails, overwrites `src/data/schedule-snapshot.json`, and exits non-zero on
any failure before writing — so on failure the committed file is untouched.

Side effect: every push to `main` also refreshes the fallback. That is
desirable.

Pages concurrency is `cancel-in-progress: true`; a refresh overlapping a
push deploy cancels the older run. Both build from `main`, so the result is
the same.

### 3. `docs/deploy.md`

- New **§1g. Let staff update the site fallback** (one-time, developer):
  create the fine-grained token (repo-only, *Actions: Read and write*,
  expiry up to 1 year — note the renewal date), add it as the `GITHUB_TOKEN`
  Script Property, paste the updated `Code.gs`, reload the Sheet, click the
  menu once to authorise, confirm a run in the Actions tab.
- **§2 / §3** (organiser flow): after finishing schedule edits, use
  **12th State → Update site fallback**.
- **§5 Troubleshooting:** the menu is missing (reload the Sheet); "isn't set
  up" (token property missing); "GitHub refused (401)" (token expired or
  wrong — create a new one); the run succeeded but the fallback didn't change
  (look for the snapshot warning in the Actions log — the Sheet failed
  validation).

`README.md`'s schedule paragraph mentions the menu alongside
`npm run snapshot`.

## Out of scope

- A scheduled (cron) refresh. Easy to add later as a `schedule:` trigger.
- Committing the refreshed snapshot back to the repo. The committed file is
  now only the last-resort fallback for builds and for local dev.
- A site page for the refresh.
- Showing staff whether the deploy finished; the toast says "about 2
  minutes" and that is enough.

## Testing

`Code.gs` has no automated harness (it is pasted into Apps Script by hand),
and no TypeScript production code changes, so there are no new automated
tests. This is a deliberate deviation from test-first. Verification:

1. **Workflow fallback path, locally:** `SHEET_ENDPOINT=https://invalid.example npm run snapshot || echo warning` then `npx vite build` —
   build succeeds, `git status` shows the snapshot unchanged.
2. **Workflow happy path:** push the workflow change; the run's snapshot step
   logs `Wrote src/data/schedule-snapshot.json — …` and the deploy succeeds.
3. **Menu, end to end (after the token and script are in place):** click the
   menu → success toast → a `workflow_dispatch` run appears in Actions → the
   deployed bundle contains a schedule detail edited just before clicking.
4. **Menu guards:** a second click within 5 minutes shows the cooldown toast;
   with `GITHUB_TOKEN` removed it shows the "isn't set up" toast; with a bad
   token it shows "GitHub refused the update (401)".
