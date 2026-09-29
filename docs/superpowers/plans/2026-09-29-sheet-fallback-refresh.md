# Sheet-Triggered Fallback Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 12th State staff refresh the site's bundled schedule fallback from a Google Sheet menu, with no GitHub or terminal access.

**Architecture:** The deploy workflow pulls a fresh snapshot (`npm run snapshot`) before `vite build`, falling back to the committed file if the Sheet fails. A new Apps Script menu item, **12th State → Update site fallback**, calls GitHub's `workflow_dispatch` API for `deploy.yml` using a repo-scoped token held in Script Properties, rate-limited to one run per 5 minutes.

**Tech Stack:** GitHub Actions, Google Apps Script (V8), existing `tsx scripts/snapshot.ts`.

**Spec:** `docs/superpowers/specs/2026-09-29-sheet-fallback-refresh-design.md`

**TDD note:** No TypeScript production code changes. `apps-script/Code.gs` has no test harness in the repo (it is pasted into Apps Script by hand). This is an agreed deviation: Task 2 exercises the new Apps Script functions against stubbed Google services in a throwaway Node script outside the repo, and Task 4 verifies end to end.

---

## File map

| File | Change |
|---|---|
| `.github/workflows/deploy.yml` | New "Refresh schedule fallback" step before `npx vite build` |
| `apps-script/Code.gs` | New constants; `onOpen`, `refreshFallback`, `fallbackRefreshMessage`, `cooldownEndsAt`, `dispatchDeploy`, `githubMessage` |
| `docs/deploy.md` | New §1g; §2, §2a night-before steps use the menu; §5 rows |
| `README.md` | Schedule paragraph mentions the menu |
| `docs/superpowers/specs/2026-09-29-sheet-fallback-refresh-design.md` | Add the "couldn't reach GitHub" message (found while planning) |

---

### Task 1: Deploy workflow refreshes the fallback

**Files:**
- Modify: `.github/workflows/deploy.yml` (the `verify` job's steps)

- [ ] **Step 1: Prove the failure path leaves the committed snapshot untouched**

`scripts/snapshot.ts` only writes after every check passes. Confirm before relying on it:

Run:
```bash
SHEET_ENDPOINT=https://invalid.example npm run snapshot || echo "fell back"; git status --short src/data/schedule-snapshot.json
```
Expected: an error line from the fetch, then `fell back`, and **no** `git status` output (file unchanged).

- [ ] **Step 2: Prove the build still succeeds with the committed snapshot**

Run: `npx vite build`
Expected: `✓ built in …`, exit 0.

- [ ] **Step 3: Add the workflow step**

In `.github/workflows/deploy.yml`, replace:

```yaml
      - run: npm test
      - run: npx vite build
```

with:

```yaml
      - run: npm test
      - name: Refresh schedule fallback
        run: npm run snapshot || echo "::warning::Could not refresh the schedule fallback from the Sheet; building with the committed snapshot"
      - run: npx vite build
```

- [ ] **Step 4: Run the new step locally against the real Sheet**

Run: `npm run snapshot`
Expected: `Wrote src/data/schedule-snapshot.json — <compDate>, E1: N heats, …`.

Then discard the local refresh so this commit contains only the workflow change:

Run: `git checkout -- src/data/schedule-snapshot.json`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: refresh the schedule fallback from the Sheet on every deploy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Do **not** push yet — Task 4 pushes everything together after the docs are in.

---

### Task 2: Sheet menu dispatches the deploy

**Files:**
- Modify: `apps-script/Code.gs` (constants after line 46 `const CACHE_REFILL_WAIT_MS = 20000;`; functions after `clearScheduleCache()` at line ~93)
- Throwaway check (not committed): `$SCRATCH/refresh-fallback-check.mjs` where `SCRATCH=/private/tmp/claude-501/-Users-mikesholar-git-12th-state-heats/e5d6aae5-5761-447b-8072-93ad1de5ee7e/scratchpad` (any directory outside the repo works)

- [ ] **Step 1: Write the throwaway check first (it fails: functions don't exist)**

Create `$SCRATCH/refresh-fallback-check.mjs`:

```js
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = readFileSync(process.argv[2], "utf8");

const run = ({ token, lastRefreshAt, status = 204, body = "", lockFree = true, fetchThrows = false, nowMs = Date.now() }) => {
  const props = new Map(Object.entries({ GITHUB_TOKEN: token, lastFallbackRefreshAt: lastRefreshAt }).filter(([, v]) => v !== undefined));
  const calls = { fetch: [], cacheCleared: 0, toasts: [] };
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ remove: () => { calls.cacheCleared += 1; } }) },
    UrlFetchApp: {
      fetch: (url, options) => {
        if (fetchThrows) throw new Error("DNS error");
        calls.fetch.push({ url, options });
        return { getResponseCode: () => status, getContentText: () => body };
      },
    },
    SpreadsheetApp: {
      getActive: () => ({ toast: (msg) => calls.toasts.push(msg), getSpreadsheetTimeZone: () => "UTC" }),
      getUi: () => ({ createMenu: () => ({ addItem: () => ({ addToUi: () => {} }) }) }),
    },
    Utilities: { formatDate: (d) => d.toISOString().slice(11, 16) },
    ContentService: {},
    Date: class extends Date {
      static now() { return nowMs; }
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.refreshFallback();
  return { toast: calls.toasts[0], calls, props };
};

const noToken = run({});
assert.equal(noToken.toast, "Fallback updates aren't set up — see docs/deploy.md §1g.");
assert.equal(noToken.calls.fetch.length, 0);

const ok = run({ token: "t0k" });
assert.equal(ok.toast, "Site fallback update started — live in about 2 minutes.");
assert.equal(ok.calls.cacheCleared, 1);
assert.equal(ok.calls.fetch[0].url, "https://api.github.com/repos/mikesholar/12th-state-heats/actions/workflows/deploy.yml/dispatches");
assert.equal(ok.calls.fetch[0].options.method, "post");
assert.equal(ok.calls.fetch[0].options.headers.Authorization, "Bearer t0k");
assert.equal(ok.calls.fetch[0].options.payload, JSON.stringify({ ref: "main" }));
assert.equal(ok.calls.fetch[0].options.muteHttpExceptions, true);
assert.ok(Number(ok.props.get("lastFallbackRefreshAt")) > 0);

const recent = new Date(Date.UTC(2026, 8, 29, 14, 30)).getTime();
const cooling = run({ token: "t0k", lastRefreshAt: String(recent), nowMs: recent + 60_000 });
assert.equal(cooling.toast, "An update started less than 5 minutes ago — try again at 14:35.");
assert.equal(cooling.calls.fetch.length, 0);

const expired = run({ token: "t0k", lastRefreshAt: String(Date.now() - 6 * 60_000) });
assert.equal(expired.toast, "Site fallback update started — live in about 2 minutes.");

const refused = run({ token: "bad", status: 401, body: JSON.stringify({ message: "Bad credentials" }) });
assert.equal(refused.toast, "GitHub refused the update (401): Bad credentials");
assert.equal(refused.props.get("lastFallbackRefreshAt"), undefined);

const plainRefusal = run({ token: "t0k", status: 500, body: "oops" });
assert.equal(plainRefusal.toast, "GitHub refused the update (500): oops");

const busy = run({ token: "t0k", lockFree: false });
assert.equal(busy.toast, "The sheet is busy — try again.");
assert.equal(busy.calls.fetch.length, 0);

const unreachable = run({ token: "t0k", fetchThrows: true });
assert.equal(unreachable.toast, "Couldn't reach GitHub — try again: DNS error");
assert.equal(unreachable.props.get("lastFallbackRefreshAt"), undefined);

console.log("refresh-fallback checks passed");
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node "$SCRATCH/refresh-fallback-check.mjs" apps-script/Code.gs`
Expected: FAIL — `TypeError: context.refreshFallback is not a function`.

- [ ] **Step 3: Add the constants**

In `apps-script/Code.gs`, directly after `const CACHE_REFILL_WAIT_MS = 20000;`:

```js
const MENU_TITLE = "12th State";
const GITHUB_REPO = "mikesholar/12th-state-heats";
const DEPLOY_WORKFLOW = "deploy.yml";
const GITHUB_TOKEN_PROPERTY = "GITHUB_TOKEN";
const LAST_FALLBACK_REFRESH_PROPERTY = "lastFallbackRefreshAt";
const FALLBACK_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
```

- [ ] **Step 4: Add the functions**

In `apps-script/Code.gs`, directly after the `clearScheduleCache()` function:

```js
function onOpen() {
  SpreadsheetApp.getUi().createMenu(MENU_TITLE).addItem("Update site fallback", "refreshFallback").addToUi();
}

function refreshFallback() {
  SpreadsheetApp.getActive().toast(fallbackRefreshMessage(), MENU_TITLE, 10);
}

function fallbackRefreshMessage() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty(GITHUB_TOKEN_PROPERTY);
  if (!token) return "Fallback updates aren't set up — see docs/deploy.md §1g.";
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return "The sheet is busy — try again.";
  try {
    const retryAt = cooldownEndsAt(props);
    if (retryAt) {
      const clock = Utilities.formatDate(retryAt, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "HH:mm");
      return "An update started less than 5 minutes ago — try again at " + clock + ".";
    }
    clearScheduleCache();
    const response = dispatchDeploy(token);
    const status = response.getResponseCode();
    if (status !== 204) return "GitHub refused the update (" + status + "): " + githubMessage(response);
    props.setProperty(LAST_FALLBACK_REFRESH_PROPERTY, String(Date.now()));
    return "Site fallback update started — live in about 2 minutes.";
  } catch (err) {
    return "Couldn't reach GitHub — try again: " + String((err && err.message) || err);
  } finally {
    lock.releaseLock();
  }
}

function cooldownEndsAt(props) {
  const last = Number(props.getProperty(LAST_FALLBACK_REFRESH_PROPERTY));
  if (!last) return null;
  const endsAt = last + FALLBACK_REFRESH_COOLDOWN_MS;
  return endsAt > Date.now() ? new Date(endsAt) : null;
}

function dispatchDeploy(token) {
  const url = "https://api.github.com/repos/" + GITHUB_REPO + "/actions/workflows/" + DEPLOY_WORKFLOW + "/dispatches";
  return UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    payload: JSON.stringify({ ref: "main" }),
    muteHttpExceptions: true,
  });
}

function githubMessage(response) {
  const text = response.getContentText();
  try {
    return JSON.parse(text).message || text.slice(0, 200);
  } catch (err) {
    return text.slice(0, 200);
  }
}
```

- [ ] **Step 5: Run the check to confirm it passes**

Run: `node --check apps-script/Code.gs && node "$SCRATCH/refresh-fallback-check.mjs" apps-script/Code.gs`
Expected: `refresh-fallback checks passed`.

- [ ] **Step 6: Refactor assessment**

`fallbackRefreshMessage` is ~20 lines with one responsibility (decide and report); the guard/lock/cooldown/dispatch steps are each one line or a named helper. No duplicated knowledge — the lock pattern differs from `withLock` on purpose (toast, not web reply; spec §1). Expected: no refactor. If anything is changed, re-run Step 5.

- [ ] **Step 7: Commit**

```bash
git add apps-script/Code.gs
git commit -m "feat: Sheet menu starts a deploy that refreshes the site fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Docs

**Files:**
- Modify: `docs/deploy.md` (new §1g before `## 2.`; §2 "Night before"; §2a step 5; §5 table)
- Modify: `README.md` (schedule paragraph, lines ~22-27)
- Modify: `docs/superpowers/specs/2026-09-29-sheet-fallback-refresh-design.md` (step 6 of `refreshFallback()`)

- [ ] **Step 1: Add §1g to `docs/deploy.md`**

Insert immediately before the line `## 2. Each year: define the comp in the Sheet`:

```markdown
### 1g. Let staff update the site fallback

The site bundles a copy of the schedule for phones that have never loaded
it and can't reach the Sheet. Staff refresh that copy from the Sheet with
**12th State → Update site fallback**. The menu asks GitHub to redeploy the
site, and every deploy pulls a fresh copy from the Sheet. One-time setup
(needs someone with admin on the GitHub repo):

1. On GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories** →
     `mikesholar/12th-state-heats`.
   - Permissions → Repository permissions → **Actions: Read and write**.
     Nothing else.
   - Expiration: up to a year. Put the expiry date in the calendar.
2. In the script editor: **Project Settings (⚙) → Script Properties → Add
   script property** — name `GITHUB_TOKEN`, value the token.
3. Paste the current `apps-script/Code.gs` (section 1b). The menu runs
   inside the Sheet, so it does not need a new web-app deployment — but
   deploy a new version anyway if `Code.gs` changed in other ways
   (section 4).
4. Reload the Sheet. A **12th State** menu appears next to *Help*.
5. **12th State → Update site fallback**. The first click asks you to
   authorise "connect to an external service" — accept. Each staff member
   sees this once.
6. Expected toast: *Site fallback update started — live in about 2
   minutes.* On GitHub, **Actions** shows a *Build and deploy* run
   triggered by `workflow_dispatch`.

Anyone who can edit the Sheet can open the script and read the token. It
can only start this repo's workflows, so the worst it allows is extra
deploys. If it leaks, delete it on GitHub and create a new one.

`npm run snapshot` still works for developers, but its output only reaches
the site if committed.
```

- [ ] **Step 2: Replace the §2 "Night before" snapshot bullets**

In `docs/deploy.md` §2, replace:

```markdown
- `npm run snapshot` — pulls the Sheet into
  `src/data/schedule-snapshot.json`, the fallback a phone uses if it has
  never loaded the site before. It never contains lane emails; the script
  strips them before writing the file.
- `npm test`, commit, push.
```

with:

```markdown
- **12th State → Update site fallback** in the Sheet — the site's copy of
  the schedule for phones that have never loaded it is refreshed in about
  2 minutes. It never contains lane emails. (Setup: section 1g.)
```

- [ ] **Step 3: Replace §2a step 5**

Replace:

```markdown
5. The night before: untick `signupsOpen`, `npm run snapshot`, commit,
   push.
```

with:

```markdown
5. The night before: untick `signupsOpen`, then **12th State → Update site
   fallback**.
```

- [ ] **Step 4: Add troubleshooting rows**

Append to the §5 table (after the last `Divisions` row):

```markdown
| No **12th State** menu in the Sheet | Sheet opened before the script was pasted, or `Code.gs` is out of date | Reload the Sheet; paste the current `Code.gs` (1b) |
| "Fallback updates aren't set up" | No `GITHUB_TOKEN` Script Property | Section 1g, steps 1–2 |
| "GitHub refused the update (401): Bad credentials" | Token expired, deleted, or pasted wrong | Create a new token (1g step 1) and replace the Script Property |
| "GitHub refused the update (403) / (404)" | Token lacks *Actions: Read and write*, or isn't scoped to this repo | Edit the token's permissions on GitHub (1g step 1) |
| "An update started less than 5 minutes ago" | Rate limit — one update per 5 minutes | Wait until the time shown |
| Update started but the fallback didn't change | The Sheet failed validation during the deploy; the site kept the previous copy | On GitHub, **Actions** → the latest run → look for the *Could not refresh the schedule fallback* warning; fix the Sheet (the amber pill on the site names the problem) and update again |
```

- [ ] **Step 5: Update the README schedule paragraph**

In `README.md`, replace:

```markdown
good copy, and `src/data/schedule-snapshot.json` (refreshed with
`npm run snapshot`) is the fallback for a phone that has never loaded the
site. Everything the organiser does is in **[docs/deploy.md](docs/deploy.md)**.
```

with:

```markdown
good copy, and `src/data/schedule-snapshot.json` is the fallback for a
phone that has never loaded the site. Every deploy refreshes it from the
Sheet (keeping the committed copy if the Sheet fails), and staff trigger a
deploy from the Sheet's **12th State → Update site fallback** menu.
Everything the organiser does is in **[docs/deploy.md](docs/deploy.md)**.
```

- [ ] **Step 6: Record the network-error message in the spec**

In the spec, after the line beginning `Anything else → toast *"GitHub refused the update`… paragraph (ends "…retry immediately after a fix."), add:

```markdown
   `UrlFetchApp.fetch` throwing (DNS, timeout) → toast *"Couldn't reach
   GitHub — try again: <error>"*; the timestamp is not stored.
```

- [ ] **Step 7: Check and commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass (no code under `src/` changed; this guards against accidental edits).

```bash
git add docs/deploy.md README.md docs/superpowers/specs/2026-09-29-sheet-fallback-refresh-design.md
git commit -m "docs: staff update the site fallback from the Sheet menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ship and verify end to end

Steps marked **(you)** need the repo owner; the rest can be done by the agent.

- [ ] **Step 1: Push**

Run: `git push origin main`

- [ ] **Step 2: Confirm the push deploy refreshed the fallback**

Run: `gh run watch --exit-status $(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')`
Expected: success. Then:

Run: `gh run view --log $(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId') | grep -E "Wrote src/data/schedule-snapshot.json|Could not refresh"`
Expected: `Wrote src/data/schedule-snapshot.json — …` (no warning).

- [ ] **Step 3 (you): One-time setup** — `docs/deploy.md` §1g steps 1–5.

- [ ] **Step 4 (you): End-to-end click**

Change something visible in the Sheet (e.g. a heat's `end` time), click **12th State → Update site fallback**.
Expected toast: *Site fallback update started — live in about 2 minutes.*

- [ ] **Step 5: Confirm the dispatched run and the live bundle**

Run: `gh run list --workflow deploy.yml --limit 1 --json event,status,conclusion`
Expected: `"event":"workflow_dispatch"`, eventually `"conclusion":"success"`.

Then confirm the change is in the deployed bundle (substitute the edited value, e.g. the new end time):

```bash
curl -s https://mikesholar.github.io/12th-state-heats/ | grep -o 'assets/index-[^"]*\.js' | head -1 \
  | xargs -I{} curl -s https://mikesholar.github.io/12th-state-heats/{} | grep -c '<edited value>'
```
Expected: `1` or more.

- [ ] **Step 6 (you): Guards**

1. Click the menu again at once → *An update started less than 5 minutes ago — try again at HH:MM.*
2. Temporarily rename the `GITHUB_TOKEN` property → *Fallback updates aren't set up…*; rename it back.

- [ ] **Step 7 (you): Revert the test edit in the Sheet**, then (after 5 minutes) click the menu once more so the fallback matches the real schedule.
