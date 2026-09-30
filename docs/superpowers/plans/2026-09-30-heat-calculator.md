# Heat Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Calculator** tab in the Sheet plans one event's heats (one input row per block: date, first start, heat length, buffer, number of heats), previews them live, and writes them into `Heats` from the **12th State** menu.

**Architecture:** Three pure functions in `apps-script/Code.gs` — `planHeats` (inputs → numbered heats or an error), `writeSummary` (confirm-dialog text, including sign-ups that would be affected), `heatsTableAfter` (the new `Heats` table) — tested by Vitest through a `vm` sandbox that loads `Code.gs`. Thin Apps Script wiring (`onEdit` preview, menu item, `setupCalculator`) is checked by hand.

**Tech Stack:** Google Apps Script (V8), Vitest, Node `vm`, TypeScript strict (test file only).

**Spec:** `docs/superpowers/specs/2026-09-30-heat-calculator-design.md` (Task 5 corrects two details found while planning).

**Conventions:** no comments in code; immutable data; `Code.gs` style is plain `function` declarations, `const` and string concatenation (Apps Script V8 supports spread, arrow functions and `flat`). Tests: behaviour through the functions `Code.gs` defines, factories with overrides, no `let`/`beforeEach`, no `any`, no type assertions. Run one test file with `npx vitest run src/sheet-script/calculator.test.ts`; full checks `npm run lint && npm run typecheck && npm test`. Commit after each green; trailer `Co-Authored-By: <model> <noreply@anthropic.com>`.

**Dates used in tests:** 2027-10-02 is a Saturday, 2027-10-03 a Sunday.

---

## File map

| File | Change |
|---|---|
| `src/sheet-script/calculator.test.ts` (new) | loads `Code.gs` in a `vm` context; tests the three pure functions |
| `apps-script/Code.gs` | constants; `planHeats`, `writeSummary`, `heatsTableAfter` + helpers; `setupCalculator`, `onEdit`, `showCalculatorPreview`, `calculatorPlan`, `writeCalculatorHeats`, `writeHeatsTable`; menu item |
| `docs/deploy.md`, spec | docs |

---

### Task 1: `planHeats`

**Files:**
- Create: `src/sheet-script/calculator.test.ts`
- Modify: `apps-script/Code.gs` (constants after `FALLBACK_REFRESH_COOLDOWN_MS`; functions after `githubMessage`)

- [ ] **Step 1: Test harness and the first failing tests**

Create `src/sheet-script/calculator.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

const loadScript = (): Readonly<Record<string, unknown>> => {
  const context: Record<string, unknown> = {};
  createContext(context);
  runInContext(readFileSync(resolve(process.cwd(), "apps-script/Code.gs"), "utf8"), context);
  return context;
};

const script = loadScript();

const scriptFunction =
  (name: string) =>
  (input: unknown): unknown => {
    const fn = script[name];
    if (typeof fn !== "function") throw new Error(`Code.gs has no function ${name}`);
    return Reflect.apply(fn, undefined, [input]);
  };

const planHeats = scriptFunction("planHeats");

type CalculatorRow = {
  readonly row: number;
  readonly date: string;
  readonly start: string;
  readonly length: number | string;
  readonly buffer: number | string;
  readonly heats: number | string;
};

const makeRow = (overrides?: Partial<CalculatorRow>): CalculatorRow => ({
  row: 4,
  date: "2027-10-02",
  start: "18:00",
  length: 12,
  buffer: 3,
  heats: 2,
  ...overrides,
});

type PlanInput = {
  readonly event: unknown;
  readonly eventNumbers: readonly (number | string)[];
  readonly rows: readonly CalculatorRow[];
};

const makePlanInput = (overrides?: Partial<PlanInput>): PlanInput => ({
  event: 1,
  eventNumbers: [1, 2],
  rows: [makeRow()],
  ...overrides,
});

describe("planning an event's heats", () => {
  it("spaces heats by their length plus the buffer", () => {
    expect(planHeats(makePlanInput())).toEqual({
      ok: true,
      heats: [
        { heat: 1, date: "2027-10-02", start: "18:00", end: "18:12" },
        { heat: 2, date: "2027-10-02", start: "18:15", end: "18:27" },
      ],
    });
  });

  it("keeps numbering heats across days, restarting the times each day", () => {
    const rows = [makeRow(), makeRow({ row: 5, date: "2027-10-03", start: "08:00", heats: 1 })];

    expect(planHeats(makePlanInput({ rows }))).toEqual({
      ok: true,
      heats: [
        { heat: 1, date: "2027-10-02", start: "18:00", end: "18:12" },
        { heat: 2, date: "2027-10-02", start: "18:15", end: "18:27" },
        { heat: 3, date: "2027-10-03", start: "08:00", end: "08:12" },
      ],
    });
  });

  it("allows a second block later the same day", () => {
    const rows = [makeRow({ start: "08:00" }), makeRow({ row: 5, start: "13:00", heats: 1 })];
    const result = planHeats(makePlanInput({ rows }));

    expect(result).toMatchObject({ ok: true, heats: [{ heat: 1 }, { heat: 2 }, { heat: 3, start: "13:00", end: "13:12" }] });
  });

  it("reads the event number whether the sheet gives a number or text", () => {
    expect(planHeats(makePlanInput({ event: " 1 " }))).toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sheet-script/calculator.test.ts`
Expected: FAIL — `Code.gs has no function planHeats`. If instead loading throws a `ReferenceError` (top-level `Code.gs` code touching a Google service), add the minimal stub for that name to `context` in `loadScript` and report it.

- [ ] **Step 3: Implement the happy path**

In `apps-script/Code.gs`, after `const FALLBACK_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;`:

```js
const CALCULATOR = "Calculator";
const CALCULATOR_FIRST_ROW = 4;
const CALCULATOR_INPUT_HEADERS = ["date", "start", "length", "buffer", "heats"];
const CALCULATOR_PREVIEW_HEADERS = ["heat", "date", "start", "end"];
const MINUTES_PER_DAY = 24 * 60;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TEXT = /^(\d{1,2}):(\d{2})$/;
```

After the `githubMessage` function:

```js
function clockMinutes(text) {
  const match = CLOCK_TEXT.exec(asText(text));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function clockText(minutes) {
  return pad2(Math.floor(minutes / 60)) + ":" + pad2(minutes % 60);
}

function blockHeats(row) {
  const start = clockMinutes(row.start);
  const length = Number(row.length);
  const step = length + Number(row.buffer);
  return Array.from({ length: Number(row.heats) }, (_, i) => ({
    row: row.row,
    date: row.date,
    startMinutes: start + i * step,
    endMinutes: start + i * step + length,
  }));
}

function planHeats(input) {
  const blocks = input.rows.map(blockHeats);
  const heats = blocks.flat().map((h, i) => ({ heat: i + 1, date: h.date, start: clockText(h.startMinutes), end: clockText(h.endMinutes) }));
  return { ok: true, heats: heats };
}
```

Run the file → PASS.

- [ ] **Step 4: Failing tests for bad input**

Append inside the `describe`:

```ts
  it("asks for an event and at least one row", () => {
    expect(planHeats(makePlanInput({ event: "" }))).toEqual({ ok: false, error: "Calculator: pick an event number in B1" });
    expect(planHeats(makePlanInput({ event: 7 }))).toEqual({ ok: false, error: "Calculator: event 7 is not in the Events tab" });
    expect(planHeats(makePlanInput({ rows: [] }))).toEqual({ ok: false, error: "Calculator: add at least one row of heats" });
  });

  it("names the row and the value that is wrong", () => {
    const errorFor = (overrides: Partial<CalculatorRow>) => planHeats(makePlanInput({ rows: [makeRow({ row: 5, ...overrides })] }));

    expect(errorFor({ date: "10/02/2027" })).toEqual({ ok: false, error: 'Row 5: date "10/02/2027" must be YYYY-MM-DD' });
    expect(errorFor({ date: "2027-02-30" })).toEqual({ ok: false, error: 'Row 5: date "2027-02-30" is not a real date' });
    expect(errorFor({ start: "8am" })).toEqual({ ok: false, error: 'Row 5: start "8am" must be HH:MM' });
    expect(errorFor({ length: 0 })).toEqual({ ok: false, error: "Row 5: length must be a whole number of at least 1" });
    expect(errorFor({ buffer: -1 })).toEqual({ ok: false, error: "Row 5: buffer must be a whole number of at least 0" });
    expect(errorFor({ heats: "two" })).toEqual({ ok: false, error: "Row 5: heats must be a whole number of at least 1" });
  });
```

Run → both FAIL (they get `ok: true`).

- [ ] **Step 5: Implement input checks**

Add before `planHeats`:

```js
function isRealDateText(text) {
  const date = new Date(text + "T00:00:00Z");
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function isWholeNumberFrom(value, least) {
  const text = asText(value);
  const number = Number(text);
  return text !== "" && Number.isInteger(number) && number >= least;
}

function planRowError(row) {
  const where = "Row " + row.row;
  if (!DATE_TEXT.test(row.date)) return where + ': date "' + row.date + '" must be YYYY-MM-DD';
  if (!isRealDateText(row.date)) return where + ': date "' + row.date + '" is not a real date';
  if (clockMinutes(row.start) === null) return where + ': start "' + row.start + '" must be HH:MM';
  if (!isWholeNumberFrom(row.length, 1)) return where + ": length must be a whole number of at least 1";
  if (!isWholeNumberFrom(row.buffer, 0)) return where + ": buffer must be a whole number of at least 0";
  if (!isWholeNumberFrom(row.heats, 1)) return where + ": heats must be a whole number of at least 1";
  return "";
}

function planInputError(input) {
  const event = asNumberOrText(input.event);
  if (event === "") return "Calculator: pick an event number in B1";
  if (input.eventNumbers.indexOf(event) === -1) return "Calculator: event " + event + " is not in the Events tab";
  if (input.rows.length === 0) return "Calculator: add at least one row of heats";
  return input.rows.map(planRowError).find((error) => error !== "") || "";
}
```

and make `planHeats` start with:

```js
  const inputError = planInputError(input);
  if (inputError) return { ok: false, error: inputError };
```

Run → PASS.

- [ ] **Step 6: Failing tests for impossible schedules**

```ts
  it("refuses a heat that would end after midnight", () => {
    const rows = [makeRow({ start: "23:40" })];

    expect(planHeats(makePlanInput({ rows }))).toEqual({ ok: false, error: "Row 4: heat 2 would end after midnight (24:07)" });
  });

  it("refuses two blocks that overlap on the same day", () => {
    const rows = [makeRow(), makeRow({ row: 5, start: "18:20" })];

    expect(planHeats(makePlanInput({ rows }))).toEqual({ ok: false, error: "Row 5 starts 18:20, before row 4's last heat ends 18:27" });
  });
```

Run → both FAIL.

- [ ] **Step 7: Implement them**

Add before `planHeats`:

```js
function lateHeatError(heats) {
  const late = heats.find((h) => h.endMinutes >= MINUTES_PER_DAY);
  return late ? "Row " + late.row + ": heat " + late.heat + " would end after midnight (" + clockText(late.endMinutes) + ")" : "";
}

function overlapError(blocks) {
  return blocks
    .map((block, i) => {
      const first = block[0];
      const clash = blocks.slice(0, i).find((earlier) => earlier[0].date === first.date && first.startMinutes < earlier[earlier.length - 1].endMinutes);
      if (!clash) return "";
      return "Row " + first.row + " starts " + clockText(first.startMinutes) + ", before row " + clash[0].row + "'s last heat ends " + clockText(clash[clash.length - 1].endMinutes);
    })
    .find((error) => error !== "") || "";
}
```

Replace `planHeats` with:

```js
function planHeats(input) {
  const inputError = planInputError(input);
  if (inputError) return { ok: false, error: inputError };
  const blocks = input.rows.map(blockHeats);
  const numbered = blocks.flat().map((h, i) => Object.assign({}, h, { heat: i + 1 }));
  const scheduleError = lateHeatError(numbered) || overlapError(blocks);
  if (scheduleError) return { ok: false, error: scheduleError };
  return {
    ok: true,
    heats: numbered.map((h) => ({ heat: h.heat, date: h.date, start: clockText(h.startMinutes), end: clockText(h.endMinutes) })),
  };
}
```

- [ ] **Step 8: Run, check, commit**

Run the file → PASS; `npm run lint && npm run typecheck && npm test`.

Refactor assessment: `planHeats` reads as validate → build → check → shape; helpers are single-purpose. No change expected.

```bash
git add src/sheet-script/calculator.test.ts apps-script/Code.gs
git commit -m "feat: Sheet script plans an event's heats from blocks of inputs"
```

---

### Task 2: `writeSummary` and `heatsTableAfter`

**Files:**
- Modify: `apps-script/Code.gs`, `src/sheet-script/calculator.test.ts`

- [ ] **Step 1: Failing `writeSummary` tests**

Append to the test file:

```ts
const writeSummary = scriptFunction("writeSummary");

const threeHeats = [
  { heat: 1, date: "2027-10-02", start: "18:00", end: "18:12" },
  { heat: 2, date: "2027-10-02", start: "18:15", end: "18:27" },
  { heat: 3, date: "2027-10-03", start: "08:00", end: "08:12" },
];

type Claim = { readonly heat: number | string; readonly lane: number | string; readonly team: string };

const makeClaim = (overrides?: Partial<Claim>): Claim => ({ heat: 1, lane: 1, team: "Rays of Glory", ...overrides });

describe("the confirm message before writing heats", () => {
  it("says how many heats replace how many, day by day", () => {
    expect(writeSummary({ event: 1, heats: threeHeats, existingHeatCount: 6, claims: [] })).toEqual({
      title: "Write Event 1's heats?",
      message: "Replace Event 1's 6 heats with 3 heats (Sat Oct 2: 2, Sun Oct 3: 1)?",
    });
  });

  it("reads naturally for an event with no heats yet and for one heat", () => {
    const one = [{ heat: 1, date: "2027-10-02", start: "18:00", end: "18:12" }];

    expect(writeSummary({ event: 2, heats: one, existingHeatCount: 0, claims: [] })).toMatchObject({
      message: "Event 2 has no heats yet. Write 1 heat (Sat Oct 2: 1)?",
    });
  });

  it("lists sign-ups in heats that won't exist, and warns that times change", () => {
    const claims = [makeClaim(), makeClaim({ heat: 7, lane: 2 }), makeClaim({ heat: 8, lane: 1, team: "Glizzy Gals" })];
    const summary = writeSummary({ event: 1, heats: threeHeats, existingHeatCount: 8, claims });

    expect(summary).toMatchObject({
      message: expect.stringContaining(
        "2 sign-ups are in heats that won't exist and will disappear from the site: Heat 7 lane 2 (Rays of Glory), Heat 8 lane 1 (Glizzy Gals).",
      ),
    });
    expect(summary).toMatchObject({
      message: expect.stringContaining("Teams already signed up keep their heat and lane number, but the times change."),
    });
  });

  it("only warns about times when every sign-up's heat still exists", () => {
    const summary = writeSummary({ event: 1, heats: threeHeats, existingHeatCount: 3, claims: [makeClaim({ heat: 3 })] });

    expect(summary).toEqual({
      title: "Write Event 1's heats?",
      message:
        "Replace Event 1's 3 heats with 3 heats (Sat Oct 2: 2, Sun Oct 3: 1)?\n\nTeams already signed up keep their heat and lane number, but the times change.",
    });
  });

  it("uses the singular for one dropped sign-up", () => {
    const summary = writeSummary({ event: 1, heats: threeHeats, existingHeatCount: 4, claims: [makeClaim({ heat: 4 })] });

    expect(summary).toMatchObject({
      message: expect.stringContaining("1 sign-up is in a heat that won't exist and will disappear from the site: Heat 4 lane 1 (Rays of Glory)."),
    });
  });
});
```

Run → FAIL (`Code.gs has no function writeSummary`).

- [ ] **Step 2: Implement `writeSummary`**

Constants (with the other calculator constants):

```js
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
```

Functions (after `planHeats`):

```js
function counted(n, noun) {
  return n + " " + noun + (n === 1 ? "" : "s");
}

function dayLabel(date) {
  const day = new Date(date + "T12:00:00Z");
  return WEEKDAY_NAMES[day.getUTCDay()] + " " + MONTH_NAMES[day.getUTCMonth()] + " " + day.getUTCDate();
}

function heatsPerDay(heats) {
  const dates = heats.map((h) => h.date).filter((date, i, all) => all.indexOf(date) === i);
  return dates.map((date) => dayLabel(date) + ": " + heats.filter((h) => h.date === date).length).join(", ");
}

function replaceQuestion(input) {
  const plan = counted(input.heats.length, "heat") + " (" + heatsPerDay(input.heats) + ")?";
  if (input.existingHeatCount === 0) return "Event " + input.event + " has no heats yet. Write " + plan;
  return "Replace Event " + input.event + "'s " + counted(input.existingHeatCount, "heat") + " with " + plan;
}

function droppedClaimsNote(claims, heats) {
  const kept = heats.map((h) => h.heat);
  const dropped = claims.filter((c) => kept.indexOf(asNumberOrText(c.heat)) === -1);
  if (dropped.length === 0) return "";
  const lead = dropped.length === 1 ? "1 sign-up is in a heat" : dropped.length + " sign-ups are in heats";
  const list = dropped.map((c) => "Heat " + c.heat + " lane " + c.lane + " (" + c.team + ")").join(", ");
  return lead + " that won't exist and will disappear from the site: " + list + ".";
}

function writeSummary(input) {
  const notes = [
    replaceQuestion(input),
    droppedClaimsNote(input.claims, input.heats),
    input.claims.length > 0 ? "Teams already signed up keep their heat and lane number, but the times change." : "",
  ];
  return { title: "Write Event " + input.event + "'s heats?", message: notes.filter((note) => note !== "").join("\n\n") };
}
```

Run → PASS.

- [ ] **Step 3: Failing `heatsTableAfter` tests**

```ts
const heatsTableAfter = scriptFunction("heatsTableAfter");

const HEADER = ["event", "heat", "date", "start", "end", "notes"];

describe("the Heats table after writing", () => {
  it("keeps other events' rows as they are and replaces this event's", () => {
    const values = [HEADER, [1, 1, "", "08:00", "08:08", "old"], [2, 1, "", "09:00", "09:10", "keep me"], ["", "", "", "", "", ""]];

    expect(heatsTableAfter({ values, event: 1, heats: threeHeats.slice(0, 2), zone: "UTC" })).toEqual({
      ok: true,
      removed: 1,
      values: [
        HEADER,
        [2, 1, "", "09:00", "09:10", "keep me"],
        [1, 1, "2027-10-02", "18:00", "18:12", ""],
        [1, 2, "2027-10-02", "18:15", "18:27", ""],
      ],
    });
  });

  it("matches the event whether the sheet has a number or text", () => {
    const values = [HEADER, ["1", 1, "", "08:00", "08:08", ""]];

    expect(heatsTableAfter({ values, event: 1, heats: [], zone: "UTC" })).toMatchObject({ ok: true, removed: 1 });
  });

  it("refuses to write when the Heats tab has no date column", () => {
    const values = [["event", "heat", "start", "end"], [1, 1, "08:00", "08:08"]];

    expect(heatsTableAfter({ values, event: 1, heats: threeHeats, zone: "UTC" })).toEqual({
      ok: false,
      error: "The Heats tab needs a date column first — see docs/deploy.md §4b.",
    });
  });
});
```

Run → FAIL (no function).

- [ ] **Step 4: Implement `heatsTableAfter`**

```js
function heatsTableAfter(input) {
  const headers = headerRow(input.values);
  const missing = HEAT_HEADERS.filter((name) => headers.indexOf(name) === -1);
  if (missing.length > 0) return { ok: false, error: "The Heats tab needs a " + missing.join(", ") + " column first — see docs/deploy.md §4b." };
  const column = (name) => headers.indexOf(name);
  const isBlank = (row) => row.every((cell) => cell === "" || cell === null);
  const rows = input.values.slice(1).filter((row) => !isBlank(row));
  const isThisEvent = (row) => asNumberOrText(row[column("event")]) === asNumberOrText(input.event);
  const tidied = (row) =>
    row.map((cell, i) => {
      if (i === column("date")) return asDateString(cell, input.zone);
      if (i === column("start") || i === column("end")) return asClock(cell, input.zone);
      return cell;
    });
  const written = (heat) => {
    const cells = { event: asNumberOrText(input.event), heat: heat.heat, date: heat.date, start: heat.start, end: heat.end };
    return headers.map((name) => (name in cells ? cells[name] : ""));
  };
  return {
    ok: true,
    removed: rows.filter(isThisEvent).length,
    values: [input.values[0], ...rows.filter((row) => !isThisEvent(row)).map(tidied), ...input.heats.map(written)],
  };
}
```

Run → PASS.

- [ ] **Step 5: Check and commit**

`npm run lint && npm run typecheck && npm test`. Refactor assessment: `heatsTableAfter` is ~25 lines with small named closures; acceptable. No change expected.

```bash
git add src/sheet-script/calculator.test.ts apps-script/Code.gs
git commit -m "feat: Sheet script words the heat-write confirmation and builds the new Heats table"
```

---

### Task 3: Sheet wiring

**Files:**
- Modify: `apps-script/Code.gs`

No automated test (Apps Script services); `npm test` must still pass (the vm harness loads the whole file). Verified by hand in Task 6.

- [ ] **Step 1: Menu item**

Replace `onOpen`:

```js
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE)
    .addItem("Update site fallback", "refreshFallback")
    .addItem("Write heats to Heats tab", "writeCalculatorHeats")
    .addToUi();
}
```

- [ ] **Step 2: Reading the tab and the live preview**

After `heatsTableAfter`:

```js
function calculatorEvent(sheet) {
  return asNumberOrText(sheet.getRange("B1").getValue());
}

function calculatorPlan(ss, sheet) {
  const zone = ss.getSpreadsheetTimeZone();
  const count = Math.max(sheet.getLastRow() - CALCULATOR_FIRST_ROW + 1, 1);
  const rows = sheet
    .getRange(CALCULATOR_FIRST_ROW, 1, count, CALCULATOR_INPUT_HEADERS.length)
    .getValues()
    .map((cells, i) => ({
      row: CALCULATOR_FIRST_ROW + i,
      date: asDateString(cells[0], zone),
      start: asClock(cells[1], zone),
      length: cells[2],
      buffer: cells[3],
      heats: cells[4],
    }))
    .filter((row) => [row.date, row.start, asText(row.length), asText(row.buffer), asText(row.heats)].some((value) => value !== ""));
  const eventNumbers = readTable(ss.getSheetByName(EVENTS_TAB)).map((row) => asNumberOrText(row.event));
  return planHeats({ event: calculatorEvent(sheet), eventNumbers: eventNumbers, rows: rows });
}

function ensureRows(sheet, lastRow) {
  if (sheet.getMaxRows() < lastRow) sheet.insertRowsAfter(sheet.getMaxRows(), lastRow - sheet.getMaxRows());
}

function showCalculatorPreview(ss, sheet) {
  const plan = calculatorPlan(ss, sheet);
  const previewColumn = CALCULATOR_INPUT_HEADERS.length + 3;
  sheet.getRange(CALCULATOR_FIRST_ROW, previewColumn, sheet.getMaxRows() - CALCULATOR_FIRST_ROW + 1, CALCULATOR_PREVIEW_HEADERS.length).clearContent();
  if (!plan.ok) {
    sheet.getRange(CALCULATOR_FIRST_ROW, previewColumn).setValue(plan.error);
    return;
  }
  ensureRows(sheet, CALCULATOR_FIRST_ROW + plan.heats.length - 1);
  sheet
    .getRange(CALCULATOR_FIRST_ROW, previewColumn, plan.heats.length, CALCULATOR_PREVIEW_HEADERS.length)
    .setValues(plan.heats.map((h) => [h.heat, h.date, h.start, h.end]));
}

function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== CALCULATOR) return;
  showCalculatorPreview(e.source, e.range.getSheet());
}
```

(`previewColumn` = 8 = column H.)

- [ ] **Step 3: Writing**

```js
function writeHeatsTable(sheet, values) {
  const headers = headerRow(values);
  ensureRows(sheet, values.length);
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, sheet.getMaxColumns()).clearContent();
  ["date", "start", "end"].forEach((name) => sheet.getRange(2, headers.indexOf(name) + 1, sheet.getMaxRows() - 1, 1).setNumberFormat("@"));
  if (values.length > 1) sheet.getRange(2, 1, values.length - 1, headers.length).setValues(values.slice(1));
}

function calculatorClaims(ss, event) {
  return readTable(ss.getSheetByName(SLOTS))
    .filter((slot) => asNumberOrText(slot.event) === event)
    .map((slot) => ({ heat: asNumberOrText(slot.heat), lane: asNumberOrText(slot.lane), team: asText(slot.team) }));
}

function writeCalculatorHeats() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getSheetByName(CALCULATOR);
  if (!sheet) {
    ui.alert("There's no Calculator tab yet — run setup() in the script editor first.");
    return;
  }
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    ss.toast("The sheet is busy — try again.", MENU_TITLE, 10);
    return;
  }
  try {
    const plan = calculatorPlan(ss, sheet);
    if (!plan.ok) {
      ui.alert(plan.error);
      return;
    }
    const event = calculatorEvent(sheet);
    const heatsSheet = ss.getSheetByName(HEATS);
    const table = heatsTableAfter({ values: heatsSheet.getDataRange().getValues(), event: event, heats: plan.heats, zone: ss.getSpreadsheetTimeZone() });
    if (!table.ok) {
      ui.alert(table.error);
      return;
    }
    const summary = writeSummary({ event: event, heats: plan.heats, existingHeatCount: table.removed, claims: calculatorClaims(ss, event) });
    if (ui.alert(summary.title, summary.message, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) {
      ss.toast("Nothing changed.", MENU_TITLE, 10);
      return;
    }
    writeHeatsTable(heatsSheet, table.values);
    clearScheduleCache();
    ss.toast("Wrote " + counted(plan.heats.length, "heat") + " for Event " + event + ". Check the site, then 12th State → Update site fallback.", MENU_TITLE, 15);
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 4: Setup**

Add to `setup()` after `setupHeats(ss);`:

```js
  setupCalculator(ss);
```

and after `setupHeats`:

```js
function setupCalculator(ss) {
  if (ss.getSheetByName(CALCULATOR)) return;
  const sheet = ss.insertSheet(CALCULATOR);
  sheet.getRange("A1").setValue("event").setFontWeight("bold");
  sheet.getRange(3, 1, 1, CALCULATOR_INPUT_HEADERS.length).setValues([CALCULATOR_INPUT_HEADERS]).setFontWeight("bold");
  sheet.getRange(3, CALCULATOR_INPUT_HEADERS.length + 3, 1, CALCULATOR_PREVIEW_HEADERS.length).setValues([CALCULATOR_PREVIEW_HEADERS]).setFontWeight("bold");
  sheet.getRange("A4:B").setNumberFormat("@");
  sheet.getRange("I4:K").setNumberFormat("@");
  sheet.setFrozenRows(3);
  sheet.getRange("A1").setNote(
    "Put the event number in B1. From row 4, one row per block of heats: date (YYYY-MM-DD), start of the first heat (24-hour HH:MM), length of a heat in minutes, buffer minutes between heats, and how many heats. Heat numbers carry on from row to row. The preview on the right updates as you type; 12th State → Write heats to Heats tab replaces this event's heats.",
  );
}
```

- [ ] **Step 5: Check and commit**

Run: `cp apps-script/Code.gs "$SCRATCH/Code.js" && node --check "$SCRATCH/Code.js"` (SCRATCH = any directory outside the repo), then `npm run lint && npm run typecheck && npm test` (the vm harness still loads the file).

```bash
git add apps-script/Code.gs
git commit -m "feat: Calculator tab previews heats live and writes them from the menu"
```

---

### Task 4: Docs

**Files:**
- Modify: `docs/deploy.md`

- [ ] **Step 1: §2 — a Calculator step before Heats**

Insert before the **Heats** step (renumber the steps after it):

```markdown
4. **Calculator** (optional) — works out an event's heats for you. Put
   the event number in `B1`. From row 4, one row per block of heats:
   `date` (`YYYY-MM-DD`), `start` of the first heat (24-hour `HH:MM`),
   `length` of a heat in minutes, `buffer` minutes between one heat's end
   and the next start, and how many `heats`. Use one row per day — or two
   rows on the same day for a break. Heat numbers carry on from row to
   row. The preview on the right updates as you type (or shows what's
   wrong). When it looks right: **12th State → Write heats to Heats tab**.
   It asks before replacing that event's rows in `Heats`, and names any
   sign-ups in heats that would no longer exist. Then **12th State →
   Update site fallback**.
```

- [ ] **Step 2: §4c — adding the Calculator to an existing Sheet**

After §4b:

```markdown
## 4c. Adding the Calculator to an existing Sheet

1. Paste the current `Code.gs` (1b) and deploy a new version (section 4).
2. In the script editor, run `setup()` once. It adds the `Calculator` tab
   and touches nothing else.
3. Reload the Sheet. **12th State** now has **Write heats to Heats tab**.
   The first time you use it, Google asks you to authorise again — accept.
```

- [ ] **Step 3: §5 rows**

```markdown
| Calculator preview doesn't change | The preview only updates when you edit a cell on the Calculator tab by hand | Retype any input cell |
| "Row 5 starts 08:30, before row 4's last heat ends 08:42" | Two rows on the same day overlap | Move row 5's start later, or give row 4 fewer heats |
| "Row 4: heat 9 would end after midnight" | A block runs past 23:59 | Fewer heats, a shorter buffer, or split onto the next day's row |
| "The Heats tab needs a date column first" | The Sheet predates heat dates | Section 4b, step 1 |
```

- [ ] **Step 4: Commit**

```bash
git add docs/deploy.md
git commit -m "docs: the heat calculator"
```

---

### Task 5: Spec corrections

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-heat-calculator-design.md`

- [ ] **Step 1:** In "The Calculator tab", change "columns A–D and I–K formatted as plain text" to "columns A–B (date, start) and I–K formatted as plain text".
- [ ] **Step 2:** In "Writing", step 4, add: "The Heats table is built by a pure `heatsTableAfter({ values, event, heats, zone })`, which also normalises kept rows' date/start/end cells to text and refuses (`The Heats tab needs a date column first — see docs/deploy.md §4b.`) when a required column is missing." In "Testing", add `heatsTableAfter` to the tested functions.
- [ ] **Step 3:** Commit: `git add docs/superpowers/specs/2026-09-30-heat-calculator-design.md && git commit -m "docs: calculator spec matches the plan"`.

---

### Task 6: Ship and verify

Steps marked **(you)** need the Sheet owner.

- [ ] **Step 1:** `git push origin main`; watch the deploy (`gh run watch`) — the site itself is unchanged, this just publishes the docs and script.
- [ ] **Step 2 (you):** `docs/deploy.md` §4c — paste `Code.gs`, deploy a new version, run `setup()`, reload the Sheet.
- [ ] **Step 3 (you):** On **Calculator**: `B1` = an event number; row 4 = `2027-10-02 | 18:00 | 12 | 3 | 5`; row 5 = `2027-10-03 | 08:00 | 12 | 3 | 3`. Expected preview: 8 heats, 1–5 on 2027-10-02 from 18:00 (18:00–18:12 … 19:00–19:12), 6–8 on 2027-10-03 from 08:00. Change row 5's start to `19:00` and date to `2027-10-02` → preview shows the overlap error; put it back.
- [ ] **Step 4 (you):** **12th State → Write heats to Heats tab** → the dialog asks to replace that event's heats with 8 (Sat Oct 2: 5, Sun Oct 3: 3). Cancel → "Nothing changed." Then OK → `Heats` shows the 8 rows for that event, other events untouched.
- [ ] **Step 5:** `curl` the endpoint (see `src/data/sheet-endpoint.ts`) and confirm the event's 8 heats with dates; open https://12thstatecomp.com/ and check the day divider. Then **(you)** restore the real heats if this was a test, and **12th State → Update site fallback**.
