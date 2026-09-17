# Divisions Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team size is a property of the division, not the comp: a `Divisions` tab (`division`, `teamSize`) replaces `Settings.teamSize` + the comma-separated `divisions` cell, so individuals and teams can share a heat and the sign-up form grows the right name fields once a division is picked.

**Architecture:** `Schedule.divisions` becomes `readonly Division[]` (`{ name, teamSize }`); `Schedule.teamSize` is removed. The decoder reads a list of objects; validation checks each `teamSize ≥ 1` and unique names. `validateClaim` takes the team size from the chosen division. The renderer puts the division select first and renders `teamSize` athlete fields (plus a team-name field when `teamSize > 1`) for the selected division, reporting `onDraftChange` when the division changes so the controller redraws. `Code.gs` gains a `Divisions` tab and serves it.

**Tech Stack:** unchanged (TypeScript strict, Vitest, Apps Script).

**Spec:** `docs/superpowers/specs/2026-09-17-sheet-schedule-and-signup-design.md` — updated in Task 6.

**Conventions:** as the previous plans — TDD, factories, no comments/`any`/assertions, `readonly`, options objects, three checks before every commit, trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File map

| Path | Change |
|---|---|
| `src/core/types.ts` | `Division`; `Schedule.divisions: readonly Division[]`; drop `teamSize` |
| `src/core/schedule-schema.ts` | decode `divisions` as objects (`Divisions:` messages) |
| `src/core/validate-schedule.ts` | division `teamSize ≥ 1`, unique names; drop the `teamSize` rule |
| `src/test/factories.ts` | `DIVISIONS` objects, `DIVISION_NAMES`, raw factories, `makeDivision` |
| `src/data/schedule-snapshot.json` | migrated (one-off) |
| `src/data/schedule.test.ts` | pins |
| `src/core/signup.ts` | `validateClaim({ draft, divisions })`, `teamSizeOf`, `emptyDraft()` |
| `src/ui/render-signup.ts` | division-first form, `onDraftChange`, `readClaimDraft({ root, fallback })` |
| `src/ui/signup-page.ts` | `draftFor` without reslicing; `onDraftChange` |
| `apps-script/Code.gs` | `Divisions` tab; `readSchedule.divisions`; claim check by name |
| `docs/deploy.md`, `README.md`, spec | docs |

---

### Task 1: Types, decoder, validation, snapshot

**Files:** `src/core/types.ts`, `src/core/schedule-schema.ts`, `src/core/schedule-schema.test.ts`, `src/core/validate-schedule.ts`, `src/core/validate-schedule.test.ts`, `src/test/factories.ts`, `src/data/schedule-snapshot.json`, `src/data/schedule.test.ts`.

- [ ] **Step 1: Types and factories**

`src/core/types.ts`: add

```ts
export type Division = {
  readonly name: string;
  readonly teamSize: number;
};
```

and in `Schedule` replace `readonly teamSize: number;` + `readonly divisions: readonly string[];` with `readonly divisions: readonly Division[];`.

`src/test/factories.ts`: replace the `DIVISIONS` constant and the `teamSize` lines in `makeSchedule`/`makeRawSchedule`:

```ts
export const DIVISION_NAMES = ["F/F RX", "F/F Scaled", "F/M RX", "F/M Scaled", "M/M RX", "M/M Scaled"];

export const makeDivision = (overrides?: Partial<Division>): Division => ({ name: "F/M Scaled", teamSize: 2, ...overrides });

export const DIVISIONS: readonly Division[] = DIVISION_NAMES.map((name) => makeDivision({ name }));
```

(import `Division` from `../core/types`); `makeSchedule` → `divisions: DIVISIONS` (no `teamSize`); `makeRawSchedule` → `divisions: DIVISIONS.map((d) => ({ ...d }))` (no `teamSize`).

- [ ] **Step 2: Migrate the snapshot** (one-off):

```bash
node -e '
const fs = require("fs"); const p = "src/data/schedule-snapshot.json";
const s = JSON.parse(fs.readFileSync(p, "utf8"));
const { teamSize, ...rest } = s;
const out = { ...rest, divisions: s.divisions.map((name) => ({ name, teamSize })) };
fs.writeFileSync(p, JSON.stringify(out, null, 2) + "\n");'
head -12 src/data/schedule-snapshot.json
```

Expected: no `teamSize` key; `divisions` is six `{ "name": …, "teamSize": 2 }` objects. In `src/data/schedule.test.ts` "pins the 2026 settings": replace `expect(schedule.teamSize).toBe(2)` with `expect(schedule.divisions.map((d) => d.teamSize)).toEqual([2, 2, 2, 2, 2, 2])`.

- [ ] **Step 3: Decoder tests** — in `src/core/schedule-schema.test.ts`, the `it.each` "names the setting that is wrong" table: remove the two `teamSize` rows and the `divisions: "RX"` row; add a new test:

```ts
  it.each([
    [{ divisions: "RX" }, "Divisions: must be a list"],
    [{ divisions: [{ name: "", teamSize: 2 }] }, "Divisions: name is missing"],
    [{ divisions: [{ name: "Individual RX", teamSize: "one" }] }, 'Divisions: "Individual RX": teamSize "one" must be a whole number'],
    [{ divisions: [{ name: "Individual RX" }] }, 'Divisions: "Individual RX": teamSize is missing'],
    [{ divisions: ["F/M RX"] }, "Divisions: a division entry is not an object"],
  ])("names the division that is wrong: %j", (override, message) => {
    expect(errorOf(makeRawSchedule(override))).toBe(message);
  });

  it("reads a mixed list of individual and team divisions", () => {
    const raw = makeRawSchedule({ divisions: [{ name: " Individual RX ", teamSize: "1" }, { name: "F/M RX", teamSize: 2 }] });

    const result = decodeSchedule(raw);

    expect(result.success && result.data.divisions).toEqual([{ name: "Individual RX", teamSize: 1 }, { name: "F/M RX", teamSize: 2 }]);
  });
```

The "accepts numbers written as strings" test drops `teamSize: "2"`. Run → FAIL.

- [ ] **Step 4: Decoder** — in `src/core/schedule-schema.ts` replace `decodeDivisions` and the `teamSize` lines in `decodeShape`:

```ts
const decodeDivision = (value: unknown): Result<Division> => {
  if (!isRaw(value)) return fail("Divisions: a division entry is not an object");
  const name = text(value, "name", "Divisions");
  if (!name.success) return name;
  const teamSize = integer(value, "teamSize", `Divisions: "${name.data}"`);
  if (!teamSize.success) return teamSize;
  return ok({ name: name.data, teamSize: teamSize.data });
};

const decodeDivisions = (raw: Raw): Result<readonly Division[]> => {
  if (!Array.isArray(raw.divisions)) return fail("Divisions: must be a list");
  return all(raw.divisions.map(decodeDivision));
};
```

(import `Division`; `decodeShape` no longer reads `teamSize` and passes `divisions: divisions.data`.) The lane-division message in `validate-schedule.ts` must now list names.

- [ ] **Step 5: Validation tests** — in `src/core/validate-schedule.test.ts`: delete "rejects a team size below one"; change "rejects a lane whose division is not in the list" to `divisions: [makeDivision({ name: "RX" }), makeDivision({ name: "Scaled" })]` (message unchanged: `… is not one of RX, Scaled`); add:

```ts
  it("rejects a division with a team size below one", () => {
    const schedule = makeSchedule({ divisions: [makeDivision({ name: "Solo", teamSize: 0 })], events: [makeEvent({ heats: [makeHeat({ lanes: [] })] })] });

    expect(validateSchedule(schedule)).toEqual(['Divisions: "Solo" teamSize must be at least 1']);
  });

  it("rejects duplicate division names", () => {
    const schedule = makeSchedule({ divisions: [makeDivision({ name: "RX" }), makeDivision({ name: "RX" })], events: [makeEvent({ heats: [makeHeat({ lanes: [] })] })] });

    expect(validateSchedule(schedule)).toEqual(['Divisions: "RX" appears more than once']);
  });
```

Run → FAIL. In `validate-schedule.ts`:

```ts
const divisionNames = (schedule: Schedule): readonly string[] => schedule.divisions.map((d) => d.name);

const divisionErrors = (schedule: Schedule, event: Event, heat: Heat): readonly string[] =>
  heat.lanes
    .filter((lane) => !divisionNames(schedule).includes(lane.division))
    .map(
      (lane) =>
        `${heatLabel(event, heat)}: lane ${lane.lane} division "${lane.division}" is not one of ${divisionNames(schedule).join(", ")}`,
    );

const divisionListErrors = (schedule: Schedule): readonly string[] => [
  ...schedule.divisions.filter((d) => d.teamSize < 1).map((d) => `Divisions: "${d.name}" teamSize must be at least 1`),
  ...schedule.divisions
    .filter((d, i) => schedule.divisions.findIndex((other) => other.name === d.name) !== i)
    .map((d) => `Divisions: "${d.name}" appears more than once`),
];

const settingsErrors = (schedule: Schedule): readonly string[] => [
  ...(hasDivisions(schedule) ? divisionListErrors(schedule) : ["divisions must list at least one division"]),
  ...(schedule.events.length === 0 ? ["Events: must list at least one event"] : []),
];
```

- [ ] **Step 6: Run the core tests** — `npx vitest run src/core src/data` should be green. The whole tree will not typecheck until Tasks 2 and 3 remove the remaining `teamSize` uses, so Tasks 1–3 land as **one commit** after Task 3.

---

### Task 2: `validateClaim` by division

**Files:** `src/core/signup.ts`, `src/core/signup.test.ts`.

- [ ] **Tests** — replace the "validating a claim" describe:

```ts
const divisions = [makeDivision({ name: "Individual RX", teamSize: 1 }), makeDivision({ name: "F/M Scaled", teamSize: 2 })];

describe("validating a claim", () => {
  it("joins athlete names and keeps the team name for a team division", () => {
    const result = validateClaim({ draft: makeClaimDraft(), divisions });

    expect(result).toEqual({ success: true, data: { team: "Fast but Questionable", athletes: "Caroline Ortiz + Mike Sholar", division: "F/M Scaled" } });
  });

  it("uses the athlete's name as the team for an individual division", () => {
    const draft = makeClaimDraft({ team: "", athletes: ["  Mike Sholar "], division: "Individual RX" });

    expect(validateClaim({ draft, divisions })).toEqual({ success: true, data: { team: "Mike Sholar", athletes: "Mike Sholar", division: "Individual RX" } });
  });

  it("asks for the division before anything else", () => {
    expect(validateClaim({ draft: makeClaimDraft({ division: "" }), divisions })).toEqual({ success: false, error: "Pick a division" });
    expect(validateClaim({ draft: makeClaimDraft({ division: "Open" }), divisions })).toEqual({ success: false, error: "Pick a division" });
  });

  it("requires a team name for a team division", () => {
    expect(validateClaim({ draft: makeClaimDraft({ team: "  " }), divisions })).toEqual({ success: false, error: "Enter a team name" });
  });

  it("requires every athlete's name", () => {
    expect(validateClaim({ draft: makeClaimDraft({ athletes: ["Caroline Ortiz", ""] }), divisions })).toEqual({ success: false, error: "Enter a name for every athlete" });
    expect(validateClaim({ draft: makeClaimDraft({ athletes: ["Caroline Ortiz"] }), divisions })).toEqual({ success: false, error: "Enter a name for every athlete" });
  });

  it("asks an individual for their name", () => {
    expect(validateClaim({ draft: makeClaimDraft({ athletes: [""], division: "Individual RX" }), divisions })).toEqual({ success: false, error: "Enter your name" });
  });

  it("ignores extra athlete fields beyond the division's team size", () => {
    const result = validateClaim({ draft: makeClaimDraft({ athletes: ["A", "B", "C"] }), divisions });

    expect(result.success && result.data.athletes).toBe("A + B");
  });
});

describe("team size of a division", () => {
  it("looks the division up by name, defaulting to one field when none is chosen", () => {
    expect(teamSizeOf({ divisions, name: "F/M Scaled" })).toBe(2);
    expect(teamSizeOf({ divisions, name: "" })).toBe(0);
  });
});
```

"the empty draft" → `expect(emptyDraft()).toEqual({ team: "", athletes: [], division: "" })`. Import `makeDivision`, `teamSizeOf`.

- [ ] **Implement**:

```ts
type ValidateClaimOptions = { readonly draft: ClaimDraft; readonly divisions: readonly Division[] };

type TeamSizeOfOptions = { readonly divisions: readonly Division[]; readonly name: string };

export const teamSizeOf = ({ divisions, name }: TeamSizeOfOptions): number => divisions.find((d) => d.name === name)?.teamSize ?? 0;

export const emptyDraft = (): ClaimDraft => ({ team: "", athletes: [], division: "" });

export const validateClaim = ({ draft, divisions }: ValidateClaimOptions): Result<ClaimFields> => {
  const division = divisions.find((d) => d.name === draft.division);
  if (!division) return fail("Pick a division");
  const { teamSize } = division;
  const names = draft.athletes.slice(0, teamSize).map((name) => name.trim());
  const team = draft.team.trim();
  if (names.length < teamSize || names.some((name) => name === "")) {
    return fail(teamSize === 1 ? "Enter your name" : "Enter a name for every athlete");
  }
  if (teamSize > 1 && team === "") return fail("Enter a team name");
  return ok({ team: teamSize === 1 ? (names[0] ?? "") : team, athletes: names.join(ATHLETE_SEPARATOR), division: division.name });
};
```

---

### Task 3: Division-first form

**Files:** `src/ui/render-signup.ts`, `src/ui/render-signup.test.ts`, `src/ui/signup-page.ts`, `src/ui/signup-page.test.ts`, `src/ui/render.test.ts` (only if it references `teamSize`).

- [ ] **Renderer tests** — in `render-signup.test.ts`: the fixture schedule gets `divisions: [makeDivision({ name: "Individual RX", teamSize: 1 }), ...DIVISIONS]`; `renderWith` default `draft: emptyDraft()`; add `onDraftChange: vi.fn()` to the options; replace the "claim form" describe:

```ts
describe("the claim form", () => {
  const open = { event: 1, heat: 2, lane: 1 };

  it("asks for the division first and shows no name fields until one is picked", () => {
    const { root } = renderWith({ openForm: open, draft: emptyDraft() });

    expect(getByLabelText(root, "Division")).toBeInTheDocument();
    expect(root.querySelectorAll('[id^="athlete-"]')).toHaveLength(0);
    expect(queryByText(root, "Team name")).toBeNull();
    expect(getByRole(root, "button", { name: "Claim lane 1" })).toBeInTheDocument();
  });

  it("shows team name and one field per athlete for a team division, pre-filled", () => {
    const { root } = renderWith({ openForm: open, draft: makeClaimDraft() });

    expect(getByTestId(root, "claim-form").closest('[data-heat="E1H2"]')).not.toBeNull();
    expect(getByLabelText<HTMLSelectElement>(root, "Division").value).toBe("F/M Scaled");
    expect(getByLabelText<HTMLInputElement>(root, "Team name").value).toBe("Fast but Questionable");
    expect(getByLabelText<HTMLInputElement>(root, "Athlete 1").value).toBe("Caroline Ortiz");
    expect(getByLabelText<HTMLInputElement>(root, "Athlete 2").value).toBe("Mike Sholar");
  });

  it("asks an individual only for their name", () => {
    const { root } = renderWith({ openForm: open, draft: makeClaimDraft({ division: "Individual RX", athletes: [""] }) });

    expect(queryByText(root, "Team name")).toBeNull();
    expect(getByLabelText(root, "Your name")).toBeInTheDocument();
    expect(root.querySelectorAll('[id^="athlete-"]')).toHaveLength(1);
  });

  it("reports the draft when the division changes so the fields can follow", () => {
    const { root, options } = renderWith({ openForm: open, draft: makeClaimDraft() });

    fireEvent.input(getByLabelText(root, "Team name"), { target: { value: "Kept" } });
    fireEvent.change(getByLabelText(root, "Division"), { target: { value: "Individual RX" } });

    expect(options.onDraftChange).toHaveBeenCalledWith({ team: "Kept", athletes: ["Caroline Ortiz", "Mike Sholar"], division: "Individual RX" });
  });

  it("submits what was typed", () => {
    const { root, options } = renderWith({ openForm: open, draft: makeClaimDraft({ team: "", athletes: ["", ""] }) });

    fireEvent.input(getByLabelText(root, "Team name"), { target: { value: "New Team" } });
    fireEvent.input(getByLabelText(root, "Athlete 1"), { target: { value: "A" } });
    fireEvent.input(getByLabelText(root, "Athlete 2"), { target: { value: "B" } });
    fireEvent.submit(getByTestId(root, "claim-form"));

    expect(options.onClaim).toHaveBeenCalledWith({ team: "New Team", athletes: ["A", "B"], division: "F/M Scaled" });
  });

  it("can be dismissed", () => {
    const { root, options } = renderWith({ openForm: open });

    fireEvent.click(getByRole(root, "button", { name: "Never mind" }));

    expect(options.onCloseForm).toHaveBeenCalled();
  });

  it("lists the divisions from the schedule", () => {
    const { root } = renderWith({ openForm: open });

    const labels = [...getByLabelText<HTMLSelectElement>(root, "Division").options].map((o) => o.textContent);
    expect(labels).toEqual(["— pick a division —", "Individual RX", ...DIVISION_NAMES]);
  });

  it("disables the submit while busy", () => {
    const { root } = renderWith({ openForm: open, draft: makeClaimDraft(), busy: true });

    expect(getByRole(root, "button", { name: "Claim lane 1" })).toBeDisabled();
  });
});
```

"reading the draft back": `readClaimDraft({ root, fallback: emptyDraft() })` → `makeClaimDraft()`; fallback case unchanged. Remove the old "asks an individual only for their name" that used `teamSize: 1` on the schedule.

- [ ] **Renderer** — `RenderSignupOptions` gains `readonly onDraftChange: (draft: ClaimDraft) => void;`. Replace `athleteLabel`/`athleteFieldsHtml`/`divisionOptionsHtml`/`claimFormHtml`/`readClaimDraft` and the two `wire` handlers:

```ts
const athleteLabel = (index: number, teamSize: number): string => (teamSize === 1 ? "Your name" : `Athlete ${index + 1}`);

const athleteFieldsHtml = (draft: ClaimDraft, teamSize: number): string =>
  Array.from({ length: teamSize }, (_, i) => {
    const id = `athlete-${i + 1}`;
    return `<label for="${id}">${athleteLabel(i, teamSize)}</label><input id="${id}" name="${id}" type="text" autocomplete="name" value="${esc(draft.athletes[i] ?? "")}" />`;
  }).join("");

const divisionOptionsHtml = (divisions: readonly Division[], selected: string): string =>
  [`<option value="">— pick a division —</option>`]
    .concat(divisions.map((d) => `<option value="${esc(d.name)}"${d.name === selected ? " selected" : ""}>${esc(d.name)}</option>`))
    .join("");

const claimFormHtml = ({ schedule, slot, draft, busy }: FormOptions): string => {
  const teamSize = teamSizeOf({ divisions: schedule.divisions, name: draft.division });
  return `
  <form id="claim-form" data-testid="claim-form" class="claim-form">
    <label for="division">Division</label>
    <select id="division" name="division">${divisionOptionsHtml(schedule.divisions, draft.division)}</select>
    ${teamSize > 1 ? `<label for="team">Team name</label><input id="team" name="team" type="text" value="${esc(draft.team)}" />` : ""}
    ${athleteFieldsHtml(draft, teamSize)}
    <div class="claim-actions">
      <button type="submit" class="primary" ${busy ? "disabled" : ""}>Claim lane ${slot.lane}</button>
      <button type="button" class="link" id="dismiss-claim">Never mind</button>
    </div>
  </form>`;
};

type ReadClaimDraftOptions = { readonly root: HTMLElement; readonly fallback: ClaimDraft };

export const readClaimDraft = ({ root, fallback }: ReadClaimDraftOptions): ClaimDraft => {
  if (!root.querySelector("#claim-form")) return fallback;
  const typed = [...root.querySelectorAll<HTMLInputElement>('[id^="athlete-"]')].map((input) => input.value);
  return {
    team: inputValue(root, "team") ?? fallback.team,
    athletes: typed.length > 0 ? typed : fallback.athletes,
    division: inputValue(root, "division") ?? fallback.division,
  };
};
```

In `wire`: the submit handler calls `readClaimDraft({ root, fallback: draft })`; add

```ts
  root.querySelector("#division")?.addEventListener("change", () => options.onDraftChange(readClaimDraft({ root, fallback: draft })));
```

Note `readClaimDraft` keeps the *fallback's* athletes when no athlete inputs exist (division not yet picked) so names typed under a previous division survive a change — the "reports the draft when the division changes" test relies on the two athlete inputs still being present at change time.

- [ ] **Controller tests** — in `signup-page.test.ts`: schedule fixture gets `divisions: [makeDivision({ name: "Individual RX", teamSize: 1 }), ...DIVISIONS]` (and the raw fixtures `divisions: […]` objects likewise via `makeRawSchedule` defaults — they inherit). `fillForm` picks the division **first**:

```ts
const fillForm = (root: HTMLElement) => {
  fireEvent.change(getByLabelText(root, "Division"), { target: { value: "F/M Scaled" } });
  fireEvent.input(getByLabelText(root, "Team name"), { target: { value: "Fast but Questionable" } });
  fireEvent.input(getByLabelText(root, "Athlete 1"), { target: { value: "Caroline Ortiz" } });
  fireEvent.input(getByLabelText(root, "Athlete 2"), { target: { value: "Mike Sholar" } });
};
```

"rejects a blank form before posting": pick the division, type only the team name, submit → "Enter a name for every athlete", team name kept. Add:

```ts
  it("grows the name fields to fit the chosen division", () => {
    saveSignupEmail(ME);
    const { root } = start();

    openLane2(root);
    expect(root.querySelectorAll('[id^="athlete-"]')).toHaveLength(0);
    fireEvent.change(getByLabelText(root, "Division"), { target: { value: "Individual RX" } });
    expect(getByLabelText(root, "Your name")).toBeInTheDocument();
    fireEvent.change(getByLabelText(root, "Division"), { target: { value: "F/M Scaled" } });

    expect(getByLabelText(root, "Athlete 2")).toBeInTheDocument();
    expect(getByLabelText(root, "Team name")).toBeInTheDocument();
  });
```

- [ ] **Controller** — `draftFor` no longer reslices: `const draftFor = (current: ClaimDraft | undefined): ClaimDraft => current ?? loadLastClaim() ?? emptyDraft();`; `validateClaim({ draft, divisions: state.loaded.schedule.divisions })`; pass `onDraftChange: (draft) => draw({ ...state, draft })` to `renderSignup`.

- [ ] **Green and commit** — `npm test && npm run typecheck && npm run lint`; also `grep -rn "teamSize" src` should show only `Division.teamSize` uses. Commit everything from Tasks 1–3:

```
feat: team size comes from the division — individuals and teams can share a heat

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 4: `Code.gs` — `Divisions` tab

**Files:** `apps-script/Code.gs`.

- [ ] Constants: `const DIVISIONS = "Divisions";`, `const DIVISION_HEADERS = ["division", "teamSize"];`, `const DIVISION_ROWS = [["F/F RX", 2], ["F/F Scaled", 2], ["F/M RX", 2], ["F/M Scaled", 2], ["M/M RX", 2], ["M/M Scaled", 2]];`. `SETTINGS_ROWS` loses the `teamSize` and `divisions` rows; the checkbox index in `setupSettings` still targets the last row (`signupsOpen`) — check the arithmetic and the `setNumberFormat("@")` range (now `SETTINGS_ROWS.length - 1` rows). Update the A1 note.
- [ ] `missingTabs` includes `DIVISIONS`. Add `setupDivisions(ss)` via `createIfMissing(ss, DIVISIONS, DIVISION_HEADERS, (sheet) => { sheet.getRange(2, 1, DIVISION_ROWS.length, 2).setValues(DIVISION_ROWS); sheet.getRange("A1").setNote("One row per division. teamSize 1 for individuals, 2 for pairs, … The sign-up form asks for that many names."); })` and call it from `setup()` after `setupSettings`.
- [ ] `readDivisions(ss)`: `readTable(ss.getSheetByName(DIVISIONS)).map((row) => ({ name: asText(row.division), teamSize: asNumberOrText(row.teamSize) }))`. `readSchedule` → `divisions: readDivisions(ss)` and no `teamSize`. Replace `divisionList(settings)` with `divisionNames(ss)` = `readDivisions(ss).map((d) => d.name)`; `claimSlot` uses it (`"Division must be one of " + names.join(", ")`).
- [ ] Harness (scratchpad, deleted after): `doGet` returns `divisions` as objects and no `teamSize`; the decoder accepts it; a claim with an unknown division is refused naming the tab's divisions; a `Divisions` tab missing → JSON setup error naming it. `node --check`; `grep -c '//'` = 0.
- [ ] Commit: `feat: Divisions tab drives team size per division` (with trailer).

---

### Task 5: Snapshot script and judge-links unaffected — verify

- [ ] `npm run judge-links` prints the same links (no `teamSize` dependency). `SHEET_ENDPOINT=<stub> npm run snapshot` with a stub serving the migrated snapshot shape (as in Plan A Task 11) writes an identical file. No code change expected; if anything references `teamSize`, fix it.

---

### Task 6: Docs, spec, deploy notes

- [ ] `docs/deploy.md`: §1c tab list gains `Divisions`; §2 step 1 drops `teamSize`/`divisions` from Settings and adds a **Divisions** step: one row per division, `teamSize` 1 for individuals, 2 for pairs…; mixed sizes are fine in the same heat; the form asks for that many names. §5 row: "Sign-up form shows no name fields" → the member hasn't picked a division yet (by design) / a division row has a blank `teamSize`. **Migration note** for an existing Sheet: run `setup()` (creates `Divisions` with defaults), edit the rows, delete the old `teamSize` and `divisions` rows from `Settings` (ignored if left), and deploy the script as a new version **before** pushing the site — until both are updated the site shows the amber "Sheet has a problem: Divisions: …" pill over the last known schedule.
- [ ] `README.md` sign-up paragraph: "team name (for team divisions), athlete names and division" → "division first, then the team name and one name per athlete the division calls for".
- [ ] Spec: "The Sheet" — replace the `teamSize`/`divisions` Settings rows with a `Divisions` tab section; JSON example `divisions: [{ name, teamSize }]`; "Types" — `Division`; decoding rules; "Sign-up page" step 3 — division first, fields follow. Decisions table: "Team vs. individual" row → per division.
- [ ] Commit: `docs: Divisions tab, migration note` (with trailer).
