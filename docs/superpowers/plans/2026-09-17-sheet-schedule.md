# Sheet-Driven Schedule (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app reads its schedule (settings, events, heats, claimed lanes) from the Google Sheet via the Apps Script `doGet`, caches it on the phone, and falls back to a committed JSON snapshot — so organisers define the comp in the Sheet and never touch code.

**Architecture:** A hand-rolled decoder in `src/core/schedule-schema.ts` is the trust boundary (`unknown` → `Result<Schedule>`), followed by the existing `validateSchedule`. `src/ui/schedule-client.ts` fetches, `src/ui/schedule-store.ts` caches in `localStorage`, `src/data/snapshot.ts` decodes the committed JSON, and pure `chooseSchedule` in `src/core/load-schedule.ts` picks live > cached > snapshot. `main.ts` loads first, then routes. `Code.gs` gains `Settings`/`Events`/`Heats`/`Slots` tabs and a `doGet` that assembles the schedule. Judge codes become a fixed 6×12 grid so the Sheet can change freely.

**Tech Stack:** TypeScript strict, Vite, Vitest + @testing-library/dom, `tsx` scripts, Google Apps Script. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-sheet-schedule-and-signup-design.md` (this plan covers "Plan A"; sign-up is Plan B, a later plan).

**Conventions (read before starting):**
- Every test uses factories from `src/test/factories.ts` — no `let`/`beforeEach` state. `at("08:03")` gives a comp-day instant in Eastern.
- Test files sit beside the code (`foo.ts` / `foo.test.ts`); `describe` names describe behaviour; `it` names are sentences.
- No comments in code. No `any`. No type assertions. `readonly` on all type fields. Options objects for functions with more than one parameter.
- Run `npm test`, `npm run typecheck`, `npm run lint` before every commit. All three must be clean.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `Result<T>` is `{ success: true; data: T } | { success: false; error: string }` (defined in `src/core/score.ts` today; Task 2 moves it to `src/core/result.ts`).

---

## File map

| Path | Responsibility |
|---|---|
| `src/core/types.ts` | `Event.lanes`, `Lane.email?`, `Schedule.teamSize/divisions/signupsOpen` |
| `src/core/validate-schedule.ts` | semantic rules on a decoded schedule (updated set) |
| `src/core/result.ts` | `Result<T>` (moved out of `score.ts`) |
| `src/core/schedule-schema.ts` | `decodeSchedule(unknown)` — the trust boundary |
| `src/core/load-schedule.ts` | `FetchOutcome`, `LoadedSchedule`, `chooseSchedule`, `sourceNotice` |
| `src/data/schedule-snapshot.json` | committed fallback, written by `npm run snapshot` |
| `src/data/snapshot.ts` | `snapshotSchedule` — the decoded snapshot |
| `src/data/sheet-endpoint.ts` | deployed script URL (renamed from `scoring-endpoint.ts`) |
| `src/data/judge-codes.ts` | generated 6×12 grid + head + `signupCode` |
| `src/ui/schedule-client.ts` | `fetchSchedule` with injected fetch |
| `src/ui/schedule-store.ts` | `loadCachedSchedule`, `saveCachedSchedule` |
| `src/ui/now-override.ts` | takes `timeZone` instead of importing the schedule |
| `src/ui/render.ts` | open lanes, picker label by `teamSize`, source pill |
| `src/ui/render-head.ts` | cards only for lanes that exist in the event |
| `src/main.ts` | load → route |
| `src/styles.css` | `.source-notice`, `tr.open`, `.loading` |
| `src/test/factories.ts` | new fields, `makeRawSchedule` |
| `scripts/judge-links.ts` | grid generation, snapshot-aware printout |
| `scripts/snapshot.ts` | `npm run snapshot` |
| `apps-script/Code.gs` | new tabs, `doGet`, `Overall` columns from `Events` |
| `docs/deploy.md` | replaces `docs/scoring-deploy.md` |
| `README.md` | schedule lives in the Sheet |

Deleted: `src/data/schedule.ts` (Task 9), `src/data/scoring-endpoint.ts` (Task 9), `docs/scoring-deploy.md` (Task 12).

---

### Task 1: New schedule fields and validation rules

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/test/factories.ts`
- Modify: `src/data/schedule.ts` (add the new fields so it keeps compiling; deleted in Task 9)
- Modify: `src/core/validate-schedule.ts`
- Modify: `src/core/validate-schedule.test.ts`

- [ ] **Step 1: Add the fields to the types**

Replace `src/core/types.ts` with:

```ts
export type Lane = {
  readonly lane: number;
  readonly team: string;
  readonly athletes: string;
  readonly division: string;
  readonly email?: string;
};

export type Heat = {
  readonly number: number;
  readonly start: string;
  readonly end: string;
  readonly lanes: readonly Lane[];
};

export type ScoringFormat = "time-or-rounds" | "rounds-reps";

export type Event = {
  readonly number: number;
  readonly title: string;
  readonly format: string;
  readonly scoring: ScoringFormat;
  readonly capSeconds?: number;
  readonly rx: string;
  readonly scaled: string;
  readonly lanes: number;
  readonly heats: readonly Heat[];
};

export type Schedule = {
  readonly compDate: string;
  readonly timeZone: string;
  readonly teamSize: number;
  readonly divisions: readonly string[];
  readonly signupsOpen: boolean;
  readonly events: readonly Event[];
};
```

- [ ] **Step 2: Update the factories**

In `src/test/factories.ts`, change `makeEvent` and `makeSchedule`:

```ts
export const makeEvent = (overrides?: Partial<Event>): Event => ({
  number: 1,
  title: "Test Event",
  format: "AMRAP 1",
  scoring: "rounds-reps",
  rx: "rx",
  scaled: "scaled",
  lanes: 8,
  heats: [makeHeat()],
  ...overrides,
});

export const DIVISIONS = ["F/F RX", "F/F Scaled", "F/M RX", "F/M Scaled", "M/M RX", "M/M Scaled"];

export const makeSchedule = (overrides?: Partial<Schedule>): Schedule => ({
  compDate: "2026-09-12",
  timeZone: "America/New_York",
  teamSize: 2,
  divisions: DIVISIONS,
  signupsOpen: true,
  events: [makeEvent()],
  ...overrides,
});
```

- [ ] **Step 3: Give the shipped schedule the new fields**

In `src/data/schedule.ts`, add `lanes: 8,` after `scaled:` in each of the three event literals, and add to the top of the `schedule` object:

```ts
export const schedule: Schedule = {
  compDate: "2026-09-12",
  timeZone: "America/New_York",
  teamSize: 2,
  divisions: ["F/F RX", "F/F Scaled", "F/M RX", "F/M Scaled", "M/M RX", "M/M Scaled"],
  signupsOpen: false,
  events: [
```

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Rewrite the validation tests for the new rule set**

Replace `src/core/validate-schedule.test.ts` with:

```ts
import { validateSchedule } from "./validate-schedule";
import { makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

const lanes = (count: number) => Array.from({ length: count }, (_, i) => makeLane({ lane: i + 1, team: `Team ${i + 1}` }));

describe("schedule validation", () => {
  it("accepts a well-formed schedule", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({ number: 1, heats: [makeHeat({ lanes: lanes(7) })] }),
        makeEvent({ number: 2, heats: [makeHeat({ start: "09:10", end: "09:20", lanes: lanes(8) })] }),
      ],
    });

    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("accepts a heat with no lanes claimed yet", () => {
    const schedule = makeSchedule({ events: [makeEvent({ heats: [makeHeat({ lanes: [] })] })] });

    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("rejects two teams sharing a lane in the same heat", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ heats: [makeHeat({ lanes: [...lanes(6), makeLane({ lane: 3, team: "Team 7" })] })] })],
    });

    expect(validateSchedule(schedule)).toEqual(["Event 1 Heat 1: lane 3 is assigned to more than one team"]);
  });

  it("rejects a lane number outside the event's lane count", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ lanes: 8, heats: [makeHeat({ lanes: [makeLane({ lane: 9 }), makeLane({ lane: 0, team: "Zero" })] })] })],
    });

    expect(validateSchedule(schedule)).toEqual([
      "Event 1 Heat 1: lane 9 is outside 1–8",
      "Event 1 Heat 1: lane 0 is outside 1–8",
    ]);
  });

  it("allows a team to skip an event", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({ number: 1, heats: [makeHeat({ lanes: lanes(2) })] }),
        makeEvent({ number: 2, heats: [makeHeat({ lanes: [makeLane({ lane: 1, team: "Team 1" })] })] }),
      ],
    });

    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("rejects overlapping heats within an event", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({
          heats: [makeHeat({ number: 1, start: "08:00", end: "08:08" }), makeHeat({ number: 2, start: "08:05", end: "08:13" })],
        }),
      ],
    });

    expect(validateSchedule(schedule)).toEqual(["Event 1 Heat 2: starts 08:05, overlaps Heat 1 ending 08:08"]);
  });

  it("rejects a heat that ends before it starts", () => {
    const schedule = makeSchedule({ events: [makeEvent({ heats: [makeHeat({ number: 3, start: "08:26", end: "08:21" })] })] });

    expect(validateSchedule(schedule)).toEqual(["Event 1 Heat 3: end 08:21 is not after start 08:26"]);
  });

  it("rejects an event with no heats", () => {
    const schedule = makeSchedule({ events: [makeEvent({ number: 1, heats: [] })] });

    expect(validateSchedule(schedule)).toEqual(["Event 1: has no heats"]);
  });

  it("rejects duplicate heat numbers within an event", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ heats: [makeHeat({ number: 2, start: "08:00", end: "08:08" }), makeHeat({ number: 2, start: "08:13", end: "08:21" })] })],
    });

    expect(validateSchedule(schedule)).toEqual(["Event 1: Heat 2 appears more than once"]);
  });

  it("rejects duplicate event numbers", () => {
    const schedule = makeSchedule({ events: [makeEvent({ number: 2 }), makeEvent({ number: 2 })] });

    expect(validateSchedule(schedule)).toEqual(["Event 2 appears more than once"]);
  });

  it("rejects a team size below one", () => {
    expect(validateSchedule(makeSchedule({ teamSize: 0 }))).toEqual(["teamSize must be at least 1"]);
  });

  it("rejects an empty division list", () => {
    const schedule = makeSchedule({ divisions: [], events: [makeEvent({ heats: [makeHeat({ lanes: [] })] })] });

    expect(validateSchedule(schedule)).toEqual(["divisions must list at least one division"]);
  });

  it("rejects a lane whose division is not in the list", () => {
    const schedule = makeSchedule({
      divisions: ["RX", "Scaled"],
      events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ lane: 3, division: "Open" })] })] })],
    });

    expect(validateSchedule(schedule)).toEqual(['Event 1 Heat 1: lane 3 division "Open" is not one of RX, Scaled']);
  });
});

describe("scoring configuration", () => {
  it("rejects a time-or-rounds event with no cap", () => {
    const schedule = makeSchedule({ events: [makeEvent({ number: 1, scoring: "time-or-rounds" })] });

    expect(validateSchedule(schedule)).toContain("Event 1: scoring is time-or-rounds but capSeconds is missing");
  });

  it("rejects a rounds-reps event that has a cap", () => {
    const schedule = makeSchedule({ events: [makeEvent({ number: 2, scoring: "rounds-reps", capSeconds: 600 })] });

    expect(validateSchedule(schedule)).toContain("Event 2: scoring is rounds-reps but capSeconds is set");
  });

  it("accepts a time-or-rounds event with a cap", () => {
    const schedule = makeSchedule({ events: [makeEvent({ scoring: "time-or-rounds", capSeconds: 480 })] });

    expect(validateSchedule(schedule)).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the tests to see the new rules fail**

Run: `npx vitest run src/core/validate-schedule.test.ts`
Expected: FAIL — "outside 1–8", "not after start", "appears more than once", "teamSize", "divisions", "is not one of" tests fail; "allows a team to skip an event" and "accepts a heat with no lanes" fail on the old missing-team / lane-count rules.

- [ ] **Step 6: Rewrite the validator**

Replace `src/core/validate-schedule.ts` with:

```ts
import type { Event, Heat, Schedule } from "./types";

const heatLabel = (event: Event, heat: Heat): string => `Event ${event.number} Heat ${heat.number}`;

const duplicateLaneErrors = (event: Event, heat: Heat): readonly string[] =>
  heat.lanes
    .filter((lane, index) => heat.lanes.findIndex((other) => other.lane === lane.lane) !== index)
    .map((lane) => `${heatLabel(event, heat)}: lane ${lane.lane} is assigned to more than one team`);

const laneRangeErrors = (event: Event, heat: Heat): readonly string[] =>
  heat.lanes
    .filter((lane) => lane.lane < 1 || lane.lane > event.lanes)
    .map((lane) => `${heatLabel(event, heat)}: lane ${lane.lane} is outside 1–${event.lanes}`);

const divisionErrors = (schedule: Schedule, event: Event, heat: Heat): readonly string[] =>
  heat.lanes
    .filter((lane) => !schedule.divisions.includes(lane.division))
    .map(
      (lane) =>
        `${heatLabel(event, heat)}: lane ${lane.lane} division "${lane.division}" is not one of ${schedule.divisions.join(", ")}`,
    );

const heatTimeErrors = (event: Event, heat: Heat): readonly string[] =>
  heat.end > heat.start ? [] : [`${heatLabel(event, heat)}: end ${heat.end} is not after start ${heat.start}`];

const overlapErrors = (event: Event): readonly string[] =>
  event.heats.flatMap((heat, index) => {
    const previous = event.heats[index - 1];
    if (!previous || heat.start >= previous.end) return [];
    return [`${heatLabel(event, heat)}: starts ${heat.start}, overlaps Heat ${previous.number} ending ${previous.end}`];
  });

const duplicateHeatErrors = (event: Event): readonly string[] =>
  event.heats
    .filter((heat, index) => event.heats.findIndex((other) => other.number === heat.number) !== index)
    .map((heat) => `Event ${event.number}: Heat ${heat.number} appears more than once`);

const duplicateEventErrors = (schedule: Schedule): readonly string[] =>
  schedule.events
    .filter((event, index) => schedule.events.findIndex((other) => other.number === event.number) !== index)
    .map((event) => `Event ${event.number} appears more than once`);

const noHeatErrors = (event: Event): readonly string[] =>
  event.heats.length === 0 ? [`Event ${event.number}: has no heats`] : [];

const scoringErrors = (event: Event): readonly string[] => {
  const hasCap = event.capSeconds !== undefined;
  if (event.scoring === "time-or-rounds" && !hasCap) {
    return [`Event ${event.number}: scoring is time-or-rounds but capSeconds is missing`];
  }
  if (event.scoring === "rounds-reps" && hasCap) {
    return [`Event ${event.number}: scoring is rounds-reps but capSeconds is set`];
  }
  return [];
};

const settingsErrors = (schedule: Schedule): readonly string[] => [
  ...(schedule.teamSize < 1 ? ["teamSize must be at least 1"] : []),
  ...(schedule.divisions.length === 0 ? ["divisions must list at least one division"] : []),
];

const heatErrors = (schedule: Schedule, event: Event, heat: Heat): readonly string[] => [
  ...duplicateLaneErrors(event, heat),
  ...laneRangeErrors(event, heat),
  ...(schedule.divisions.length === 0 ? [] : divisionErrors(schedule, event, heat)),
  ...heatTimeErrors(event, heat),
];

export const validateSchedule = (schedule: Schedule): readonly string[] => [
  ...settingsErrors(schedule),
  ...duplicateEventErrors(schedule),
  ...schedule.events.flatMap((event) => event.heats.flatMap((heat) => heatErrors(schedule, event, heat))),
  ...schedule.events.flatMap(overlapErrors),
  ...schedule.events.flatMap(duplicateHeatErrors),
  ...schedule.events.flatMap(scoringErrors),
  ...schedule.events.flatMap(noHeatErrors),
];
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/core/validate-schedule.test.ts`
Expected: all PASS.

- [ ] **Step 8: Fix the shipped-schedule test expectation**

`src/data/schedule.test.ts` expects `['"Jointly Unstable" is missing from Event 3']`. That rule is gone. Change the first test to:

```ts
  it("passes validation", () => {
    expect(validateSchedule(schedule)).toEqual([]);
  });
```

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/test/factories.ts src/data/schedule.ts src/core/validate-schedule.ts src/core/validate-schedule.test.ts src/data/schedule.test.ts
git commit -m "feat: schedule carries team size, divisions, lane count; validation rules for a sign-up world

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The decoder — `decodeSchedule`

**Files:**
- Create: `src/core/result.ts`
- Modify: `src/core/score.ts` (import `Result` from `./result`, re-export it)
- Create: `src/core/schedule-schema.ts`
- Create: `src/core/schedule-schema.test.ts`
- Modify: `src/test/factories.ts` (`makeRawSchedule`)

- [ ] **Step 1: Move `Result` to its own module**

Create `src/core/result.ts`:

```ts
export type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string };

export const ok = <T>(data: T): Result<T> => ({ success: true, data });

export const fail = <T>(error: string): Result<T> => ({ success: false, error });
```

In `src/core/score.ts`, delete the `export type Result<T> = …` line and its local `fail`/`ok` helpers, and add at the top:

```ts
import { fail, ok, type Result } from "./result";

export type { Result } from "./result";
```

The local helpers were typed `Result<Score>`; the generic ones infer the same. Run `npm run typecheck && npm test` — clean, nothing else changes.

- [ ] **Step 2: Add a raw-JSON factory**

Append to `src/test/factories.ts`:

```ts
export type RawObject = Readonly<Record<string, unknown>>;

export const makeRawLane = (overrides?: RawObject): RawObject => ({
  lane: 1,
  email: "a@example.com",
  team: "Team A",
  athletes: "A One + A Two",
  division: "F/M Scaled",
  ...overrides,
});

export const makeRawHeat = (overrides?: RawObject): RawObject => ({
  number: 1,
  start: "08:00",
  end: "08:08",
  lanes: [makeRawLane()],
  ...overrides,
});

export const makeRawEvent = (overrides?: RawObject): RawObject => ({
  number: 1,
  title: "Test Event",
  format: "AMRAP 1",
  scoring: "rounds-reps",
  rx: "rx",
  scaled: "scaled",
  lanes: 8,
  heats: [makeRawHeat()],
  ...overrides,
});

export const makeRawSchedule = (overrides?: RawObject): RawObject => ({
  compDate: "2026-09-12",
  timeZone: "America/New_York",
  teamSize: 2,
  divisions: DIVISIONS,
  signupsOpen: true,
  events: [makeRawEvent()],
  ...overrides,
});
```

- [ ] **Step 3: Write the decoder tests**

Create `src/core/schedule-schema.test.ts`:

```ts
import { decodeSchedule } from "./schedule-schema";
import { makeRawEvent, makeRawHeat, makeRawLane, makeRawSchedule, makeSchedule, makeEvent, makeHeat, makeLane } from "../test/factories";

const errorOf = (value: unknown): string => {
  const result = decodeSchedule(value);
  return result.success ? "" : result.error;
};

describe("decoding the schedule JSON", () => {
  it("turns the documented shape into a Schedule", () => {
    const result = decodeSchedule(makeRawSchedule());

    expect(result).toEqual({
      success: true,
      data: makeSchedule({
        events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ email: "a@example.com" })] })] })],
      }),
    });
  });

  it("omits email and capSeconds when they are blank", () => {
    const raw = makeRawSchedule({
      events: [makeRawEvent({ capSeconds: "", heats: [makeRawHeat({ lanes: [makeRawLane({ email: "" })] })] })],
    });

    const result = decodeSchedule(raw);

    expect(result.success && result.data.events[0]?.heats[0]?.lanes[0]).toEqual(makeLane());
    expect(result.success && "capSeconds" in (result.data.events[0] ?? {})).toBe(false);
  });

  it("accepts numbers written as strings and trims text", () => {
    const raw = makeRawSchedule({
      teamSize: "2",
      events: [makeRawEvent({ number: "1", lanes: "8", capSeconds: "480", scoring: "time-or-rounds", title: "  12th Gear " })],
    });

    const result = decodeSchedule(raw);

    expect(result.success && result.data.events[0]?.capSeconds).toBe(480);
    expect(result.success && result.data.events[0]?.title).toBe("12th Gear");
  });

  it("rejects anything that is not an object", () => {
    expect(errorOf(null)).toBe("Schedule is not an object");
    expect(errorOf([])).toBe("Schedule is not an object");
  });

  it("names the setting that is wrong", () => {
    expect(errorOf(makeRawSchedule({ compDate: "9/11/27" }))).toBe('Settings: compDate "9/11/27" must be YYYY-MM-DD');
    expect(errorOf(makeRawSchedule({ timeZone: "" }))).toBe("Settings: timeZone is missing");
    expect(errorOf(makeRawSchedule({ teamSize: "two" }))).toBe('Settings: teamSize "two" must be a whole number');
    expect(errorOf(makeRawSchedule({ divisions: "RX" }))).toBe("Settings: divisions must be a list");
    expect(errorOf(makeRawSchedule({ signupsOpen: "yes" }))).toBe("Settings: signupsOpen must be TRUE or FALSE");
    expect(errorOf(makeRawSchedule({ events: {} }))).toBe("Events: must be a list");
  });

  it("names the event that is wrong", () => {
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ number: "" })] }))).toBe('Events: number "" must be a whole number');
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ title: " " })] }))).toBe("Events: Event 1: title is missing");
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ number: 2, scoring: "amrap" })] }))).toBe(
      'Events: Event 2: scoring "amrap" must be time-or-rounds or rounds-reps',
    );
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ lanes: "eight" })] }))).toBe('Events: Event 1: lanes "eight" must be a whole number');
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats: "none" })] }))).toBe("Events: Event 1: heats must be a list");
  });

  it("names the heat that is wrong", () => {
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats: [makeRawHeat({ number: "x" })] })] }))).toBe(
      'Heats: Event 1: number "x" must be a whole number',
    );
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats: [makeRawHeat({ number: 3, end: "8:21" })] })] }))).toBe(
      'Heats: Event 1 Heat 3: end "8:21" must be HH:MM',
    );
  });

  it("names the lane that is wrong", () => {
    const heats = [makeRawHeat({ number: 2, lanes: [makeRawLane({ lane: 4, team: "" })] })];

    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats })] }))).toBe("Slots: Event 1 Heat 2 lane 4: team is missing");
  });

  it("reports every semantic problem after the shape is right", () => {
    const heats = [makeRawHeat({ start: "08:26", end: "08:21", lanes: [makeRawLane({ lane: 9 })] })];

    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats })] }))).toBe(
      "Event 1 Heat 1: lane 9 is outside 1–8; Event 1 Heat 1: end 08:21 is not after start 08:26",
    );
  });
});
```

- [ ] **Step 4: Run to see it fail**

Run: `npx vitest run src/core/schedule-schema.test.ts`
Expected: FAIL — cannot resolve `./schedule-schema`.

- [ ] **Step 5: Write the decoder**

Create `src/core/schedule-schema.ts`:

```ts
import { fail, ok, type Result } from "./result";
import type { Event, Heat, Lane, Schedule, ScoringFormat } from "./types";
import { validateSchedule } from "./validate-schedule";

type Raw = Readonly<Record<string, unknown>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

const shown = (value: unknown): string => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : shown(value));

const text = (raw: Raw, key: string, where: string): Result<string> => {
  const value = trimmed(raw[key]);
  return value === "" ? fail(`${where}: ${key} is missing`) : ok(value);
};

const optionalText = (raw: Raw, key: string): string => trimmed(raw[key]);

const integer = (raw: Raw, key: string, where: string): Result<number> => {
  const value = trimmed(raw[key]);
  const parsed = value === "" ? NaN : Number(value);
  return Number.isInteger(parsed) ? ok(parsed) : fail(`${where}: ${key} "${shown(raw[key])}" must be a whole number`);
};

const optionalInteger = (raw: Raw, key: string, where: string): Result<number | undefined> =>
  trimmed(raw[key]) === "" ? ok(undefined) : integer(raw, key, where);

const boolean = (raw: Raw, key: string, where: string): Result<boolean> => {
  const value = raw[key];
  if (typeof value === "boolean") return ok(value);
  const upper = trimmed(value).toUpperCase();
  if (upper === "TRUE") return ok(true);
  if (upper === "FALSE") return ok(false);
  return fail(`${where}: ${key} must be TRUE or FALSE`);
};

const list = (raw: Raw, key: string, where: string): Result<readonly unknown[]> =>
  Array.isArray(raw[key]) ? ok(raw[key]) : fail(`${where}: ${key} must be a list`);

const all = <T>(results: readonly Result<T>[]): Result<readonly T[]> => {
  const failure = results.find((result) => !result.success);
  if (failure && !failure.success) return fail(failure.error);
  return ok(results.flatMap((result) => (result.success ? [result.data] : [])));
};

const clock = (raw: Raw, key: string, where: string): Result<string> => {
  const value = text(raw, key, where);
  if (!value.success) return value;
  return TIME_PATTERN.test(value.data) ? value : fail(`${where}: ${key} "${value.data}" must be HH:MM`);
};

const scoringFormat = (raw: Raw, where: string): Result<ScoringFormat> => {
  const value = trimmed(raw.scoring);
  if (value === "time-or-rounds" || value === "rounds-reps") return ok(value);
  return fail(`${where}: scoring "${shown(raw.scoring)}" must be time-or-rounds or rounds-reps`);
};

const decodeLane = (where: string) => (value: unknown): Result<Lane> => {
  if (!isRaw(value)) return fail(`Slots: ${where}: a lane entry is not an object`);
  const lane = integer(value, "lane", `Slots: ${where}`);
  if (!lane.success) return fail(lane.error);
  const laneWhere = `Slots: ${where} lane ${lane.data}`;
  const team = text(value, "team", laneWhere);
  if (!team.success) return fail(team.error);
  const athletes = text(value, "athletes", laneWhere);
  if (!athletes.success) return fail(athletes.error);
  const division = text(value, "division", laneWhere);
  if (!division.success) return fail(division.error);
  const email = optionalText(value, "email");
  return ok({
    lane: lane.data,
    team: team.data,
    athletes: athletes.data,
    division: division.data,
    ...(email === "" ? {} : { email }),
  });
};

const decodeHeat = (eventNumber: number) => (value: unknown): Result<Heat> => {
  if (!isRaw(value)) return fail(`Heats: Event ${eventNumber}: a heat entry is not an object`);
  const number = integer(value, "number", `Heats: Event ${eventNumber}`);
  if (!number.success) return fail(number.error);
  const where = `Event ${eventNumber} Heat ${number.data}`;
  const start = clock(value, "start", `Heats: ${where}`);
  if (!start.success) return fail(start.error);
  const end = clock(value, "end", `Heats: ${where}`);
  if (!end.success) return fail(end.error);
  const lanes = list(value, "lanes", `Heats: ${where}`);
  if (!lanes.success) return fail(lanes.error);
  const decodedLanes = all(lanes.data.map(decodeLane(where)));
  if (!decodedLanes.success) return fail(decodedLanes.error);
  return ok({ number: number.data, start: start.data, end: end.data, lanes: decodedLanes.data });
};

const decodeEvent = (value: unknown): Result<Event> => {
  if (!isRaw(value)) return fail("Events: an event entry is not an object");
  const number = integer(value, "number", "Events");
  if (!number.success) return fail(number.error);
  const where = `Events: Event ${number.data}`;
  const title = text(value, "title", where);
  if (!title.success) return fail(title.error);
  const scoring = scoringFormat(value, where);
  if (!scoring.success) return fail(scoring.error);
  const capSeconds = optionalInteger(value, "capSeconds", where);
  if (!capSeconds.success) return fail(capSeconds.error);
  const lanes = integer(value, "lanes", where);
  if (!lanes.success) return fail(lanes.error);
  const heats = list(value, "heats", where);
  if (!heats.success) return fail(heats.error);
  const decodedHeats = all(heats.data.map(decodeHeat(number.data)));
  if (!decodedHeats.success) return fail(decodedHeats.error);
  return ok({
    number: number.data,
    title: title.data,
    format: optionalText(value, "format"),
    scoring: scoring.data,
    ...(capSeconds.data === undefined ? {} : { capSeconds: capSeconds.data }),
    rx: optionalText(value, "rx"),
    scaled: optionalText(value, "scaled"),
    lanes: lanes.data,
    heats: decodedHeats.data,
  });
};

const decodeDivisions = (raw: Raw): Result<readonly string[]> => {
  const value = list(raw, "divisions", "Settings");
  if (!value.success) return fail(value.error);
  return ok(value.data.map(trimmed).filter((division) => division !== ""));
};

const decodeShape = (raw: Raw): Result<Schedule> => {
  const compDate = text(raw, "compDate", "Settings");
  if (!compDate.success) return fail(compDate.error);
  if (!DATE_PATTERN.test(compDate.data)) return fail(`Settings: compDate "${compDate.data}" must be YYYY-MM-DD`);
  const timeZone = text(raw, "timeZone", "Settings");
  if (!timeZone.success) return fail(timeZone.error);
  const teamSize = integer(raw, "teamSize", "Settings");
  if (!teamSize.success) return fail(teamSize.error);
  const divisions = decodeDivisions(raw);
  if (!divisions.success) return fail(divisions.error);
  const signupsOpen = boolean(raw, "signupsOpen", "Settings");
  if (!signupsOpen.success) return fail(signupsOpen.error);
  if (!Array.isArray(raw.events)) return fail("Events: must be a list");
  const decodedEvents = all(raw.events.map(decodeEvent));
  if (!decodedEvents.success) return fail(decodedEvents.error);
  return ok({
    compDate: compDate.data,
    timeZone: timeZone.data,
    teamSize: teamSize.data,
    divisions: divisions.data,
    signupsOpen: signupsOpen.data,
    events: decodedEvents.data,
  });
};

export const decodeSchedule = (value: unknown): Result<Schedule> => {
  if (!isRaw(value)) return fail("Schedule is not an object");
  const shape = decodeShape(value);
  if (!shape.success) return shape;
  const problems = validateSchedule(shape.data);
  return problems.length === 0 ? shape : fail(problems.join("; "));
};
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/core/schedule-schema.test.ts`
Expected: all PASS. If a message differs by a character, fix the decoder (the test strings are the contract).

- [ ] **Step 7: Full check and commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/core/result.ts src/core/score.ts src/core/schedule-schema.ts src/core/schedule-schema.test.ts src/test/factories.ts
git commit -m "feat: decode schedule JSON at the trust boundary with organiser-readable errors

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The snapshot and `snapshotSchedule`

**Files:**
- Create: `src/data/schedule-snapshot.json` (generated from the current TS data)
- Create: `src/data/snapshot.ts`
- Modify: `src/data/schedule.test.ts`
- Modify: `src/ui/render.test.ts`, `src/core/resolve-heats.test.ts`, `src/core/resolve-team.test.ts` (import path only)

- [ ] **Step 1: Generate the snapshot from the 2026 data**

```bash
node --import tsx -e 'import("./src/data/schedule.ts").then((m) => process.stdout.write(JSON.stringify(m.schedule, null, 2) + "\n"))' > src/data/schedule-snapshot.json
head -20 src/data/schedule-snapshot.json
```

Expected: a JSON object starting with `"compDate": "2026-09-12"`, `"teamSize": 2`, `"divisions": [...]`, `"signupsOpen": false`, then `"events"`.

- [ ] **Step 2: Write the shipped-snapshot test**

Replace the `describe("the shipped schedule", …)` block in `src/data/schedule.test.ts` with (leave the judge-codes block for Task 4):

```ts
import { snapshotSchedule as schedule } from "./snapshot";
import { judgeCodes } from "./judge-codes";

const laneFor = (team: string) =>
  schedule.events.map((event) => {
    const heat = event.heats.find((h) => h.lanes.some((l) => l.team === team));
    const lane = heat?.lanes.find((l) => l.team === team);
    return { event: event.number, heat: heat?.number, lane: lane?.lane };
  });

describe("the committed snapshot", () => {
  it("pins the 2026 settings", () => {
    expect(schedule.compDate).toBe("2026-09-12");
    expect(schedule.teamSize).toBe(2);
  });

  it("has three events of five heats each, eight lanes wide", () => {
    expect(schedule.events.map((e) => e.heats.length)).toEqual([5, 5, 5]);
    expect(schedule.events.map((e) => e.lanes)).toEqual([8, 8, 8]);
  });

  it("has 37 distinct teams, 36 of which appear in Event 3", () => {
    const teamsIn = (eventIndex: number) =>
      new Set(schedule.events[eventIndex]?.heats.flatMap((h) => h.lanes.map((l) => l.team)));
    expect(teamsIn(0).size).toBe(37);
    expect(teamsIn(1).size).toBe(37);
    expect(teamsIn(2).size).toBe(36);
  });

  it("puts 12th State Dumpys in lane 5 of Event 1 Heat 2 (correcting the PDF's duplicate lane 6)", () => {
    expect(laneFor("12th State Dumpys")[0]).toEqual({ event: 1, heat: 2, lane: 5 });
    expect(laneFor("Couple of Cooters")[0]).toEqual({ event: 1, heat: 2, lane: 6 });
  });

  it("places Fast but Questionable as transcribed", () => {
    expect(laneFor("Fast but Questionable")).toEqual([
      { event: 1, heat: 2, lane: 8 },
      { event: 2, heat: 1, lane: 8 },
      { event: 3, heat: 5, lane: 2 },
    ]);
  });

  it("ends the day at 1:00 PM", () => {
    expect(schedule.events[2]?.heats[4]?.end).toBe("13:00");
  });
});
```

Remove the old `import { schedule } from "./schedule";` and `import { validateSchedule } …` lines.

- [ ] **Step 3: Run to see it fail**

Run: `npx vitest run src/data/schedule.test.ts`
Expected: FAIL — cannot resolve `./snapshot`.

- [ ] **Step 4: Create the snapshot module**

Create `src/data/snapshot.ts`:

```ts
import { decodeSchedule } from "../core/schedule-schema";
import type { Schedule } from "../core/types";
import raw from "./schedule-snapshot.json";

const decoded = decodeSchedule(raw);
if (!decoded.success) throw new Error(`schedule-snapshot.json: ${decoded.error}`);

export const snapshotSchedule: Schedule = decoded.data;
```

- [ ] **Step 5: Point the other shipped-data tests at the snapshot**

In `src/ui/render.test.ts`, `src/core/resolve-heats.test.ts` and `src/core/resolve-team.test.ts`, replace

```ts
import { schedule } from "../data/schedule";
```

with

```ts
import { snapshotSchedule as schedule } from "../data/snapshot";
```

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean (the snapshot is byte-for-byte the old data).

- [ ] **Step 7: Commit**

```bash
git add src/data/schedule-snapshot.json src/data/snapshot.ts src/data/schedule.test.ts src/ui/render.test.ts src/core/resolve-heats.test.ts src/core/resolve-team.test.ts
git commit -m "feat: committed schedule snapshot decoded through the schema

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Judge code grid and snapshot-aware head page

**Files:**
- Modify: `scripts/judge-links.ts`
- Modify: `src/data/judge-codes.ts` (regenerated)
- Modify: `src/data/schedule.test.ts` (judge-codes block)
- Modify: `src/ui/render-head.ts`, `src/ui/render-head.test.ts`

- [ ] **Step 1: Write the head-page test for lanes beyond the event's width**

Add to `src/ui/render-head.test.ts`, inside the existing `describe`:

```ts
  it("skips codes for lanes the event does not have", async () => {
    const root = document.createElement("div");
    const narrow = makeSchedule({ events: [makeEvent({ number: 1, lanes: 1 })] });

    await renderHead({ root, schedule: narrow, table, siteUrl: "https://example.test/heats/" });

    expect(getAllByTestId(root, "judge-card")).toHaveLength(1);
    expect(root.textContent).toContain("Lane 1");
    expect(root.textContent).not.toContain("Lane 2");
  });
```

Run: `npx vitest run src/ui/render-head.test.ts`
Expected: FAIL — 2 cards rendered.

- [ ] **Step 2: Filter cards by the event's lane count**

In `src/ui/render-head.ts`, change `LaneCardsOptions` and `laneCards` to take the event:

```ts
type LaneCardsOptions = {
  readonly table: JudgeCodeTable;
  readonly event: Event;
  readonly siteUrl: string;
};

const laneCards = async ({ table, event, siteUrl }: LaneCardsOptions): Promise<readonly LaneCard[]> => {
  const entries = Object.entries(table)
    .flatMap(([code, a]) => (a.kind === "lane" && a.event === event.number && a.lane <= event.lanes ? [{ code, lane: a.lane }] : []))
    .sort((a, b) => a.lane - b.lane);
```

and in `renderHead`:

```ts
    schedule.events.map(async (event) => ({ event, cards: await laneCards({ table, event, siteUrl }) })),
```

Run: `npx vitest run src/ui/render-head.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the code-table tests**

Replace the `describe("the shipped judge codes", …)` block in `src/data/schedule.test.ts` with:

```ts
describe("the shipped judge codes", () => {
  const laneKeys = Object.values(judgeCodes).flatMap((a) => (a.kind === "lane" ? [`e${a.event}l${a.lane}`] : []));

  it("cover every event and lane in the snapshot", () => {
    const needed = schedule.events.flatMap((event) => Array.from({ length: event.lanes }, (_, i) => `e${event.number}l${i + 1}`));

    needed.forEach((key) => expect(laneKeys).toContain(key));
  });

  it("cover a 6-event by 12-lane grid so the Sheet can grow without regenerating", () => {
    expect(laneKeys).toHaveLength(6 * 12);
    expect(laneKeys).toContain("e6l12");
  });

  it("have exactly one head judge code", () => {
    expect(Object.values(judgeCodes).filter((a) => a.kind === "head")).toHaveLength(1);
  });

  it("have a sign-up code that is not also a judge code", () => {
    expect(signupCode).toMatch(/^[a-z0-9]{5}$/);
    expect(Object.keys(judgeCodes)).not.toContain(signupCode);
  });

  it("are five lowercase alphanumerics", () => {
    Object.keys(judgeCodes).forEach((code) => expect(code).toMatch(/^[a-z0-9]{5}$/));
  });
});
```

and change the import to `import { judgeCodes, signupCode } from "./judge-codes";`.

Run: `npx vitest run src/data/schedule.test.ts`
Expected: FAIL — `signupCode` not exported; grid length 24.

- [ ] **Step 4: Rewrite the generator**

Replace `scripts/judge-links.ts` with:

```ts
import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { JudgeAssignment, JudgeCodeTable } from "../src/core/judge-codes";
import { snapshotSchedule } from "../src/data/snapshot";

const OUTPUT = "src/data/judge-codes.ts";
const SITE = "https://mikesholar.github.io/12th-state-heats/";
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 5;
const GRID_EVENTS = 6;
const GRID_LANES = 12;
const regenerate = process.argv.includes("--regenerate");

type Entry = { readonly code: string; readonly assignment: JudgeAssignment };

type Existing = { readonly entries: readonly Entry[]; readonly signupCode: string | undefined };

const assignmentKey = (a: JudgeAssignment): string => (a.kind === "head" ? "head" : `e${a.event}l${a.lane}`);

const randomCode = (): string =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const range = (count: number): readonly number[] => Array.from({ length: count }, (_, i) => i + 1);

const neededAssignments = (): readonly JudgeAssignment[] => [
  ...range(GRID_EVENTS).flatMap((event) => range(GRID_LANES).map((lane): JudgeAssignment => ({ kind: "lane", event, lane }))),
  { kind: "head" },
];

const existing = async (): Promise<Existing> => {
  if (regenerate) return { entries: [], signupCode: undefined };
  const module = await import("../src/data/judge-codes").catch(
    (): { judgeCodes: JudgeCodeTable; signupCode?: string } => ({ judgeCodes: {} }),
  );
  return {
    entries: Object.entries(module.judgeCodes).map(([code, assignment]) => ({ code, assignment })),
    signupCode: module.signupCode,
  };
};

const freshCode = (taken: ReadonlySet<string>): string => {
  const candidate = randomCode();
  return taken.has(candidate) ? freshCode(taken) : candidate;
};

const withCodes = (assignments: readonly JudgeAssignment[], kept: readonly Entry[], reserved: readonly string[]): readonly Entry[] =>
  assignments.reduce<readonly Entry[]>((entries, assignment) => {
    const existingEntry = kept.find((e) => assignmentKey(e.assignment) === assignmentKey(assignment));
    const taken = new Set([...reserved, ...kept.map((e) => e.code), ...entries.map((e) => e.code)]);
    return [...entries, existingEntry ?? { code: freshCode(taken), assignment }];
  }, []);

const entryLine = ({ code, assignment }: Entry): string =>
  assignment.kind === "head"
    ? `  "${code}": { kind: "head" },`
    : `  "${code}": { kind: "lane", event: ${assignment.event}, lane: ${assignment.lane} },`;

const fileSource = (entries: readonly Entry[], signupCode: string): string =>
  [
    `import type { JudgeCodeTable } from "../core/judge-codes";`,
    ``,
    `export const judgeCodes: JudgeCodeTable = {`,
    ...entries.map(entryLine),
    `};`,
    ``,
    `export const signupCode = "${signupCode}";`,
    ``,
  ].join("\n");

const inSnapshot = (assignment: JudgeAssignment): boolean =>
  assignment.kind === "head" ||
  snapshotSchedule.events.some((event) => event.number === assignment.event && assignment.lane <= event.lanes);

const linkLine = ({ code, assignment }: Entry): string =>
  assignment.kind === "head"
    ? `HEAD JUDGE            ${SITE}?j=${code}`
    : `Event ${assignment.event}  Lane ${String(assignment.lane).padStart(2)}      ${SITE}?j=${code}`;

const previous = await existing();
const signupCode = previous.signupCode ?? freshCode(new Set(previous.entries.map((e) => e.code)));
const entries = withCodes(neededAssignments(), previous.entries, [signupCode]);
writeFileSync(OUTPUT, fileSource(entries, signupCode));

const used = entries.filter((e) => inSnapshot(e.assignment));
console.log(used.map(linkLine).join("\n"));
console.log(`SIGN-UP               ${SITE}?s=${signupCode}`);
console.log(`\nWrote ${entries.length} codes to ${OUTPUT} (${entries.length - used.length} spare for events/lanes not in the snapshot)`);
```

- [ ] **Step 5: Regenerate, keeping the 25 existing codes**

```bash
npm run judge-links
grep -c "kind: \"lane\"" src/data/judge-codes.ts
grep '"uahme"' src/data/judge-codes.ts
grep signupCode src/data/judge-codes.ts
```

Expected: `72`; the head line `"uahme": { kind: "head" },` still present (and e.g. `"e9c4m": { kind: "lane", event: 1, lane: 1 }` unchanged); a `signupCode` export.

- [ ] **Step 6: Run everything and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: clean.

```bash
git add scripts/judge-links.ts src/data/judge-codes.ts src/data/schedule.test.ts src/ui/render-head.ts src/ui/render-head.test.ts
git commit -m "feat: judge codes cover a 6x12 grid; head page shows only lanes the event has

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `chooseSchedule` and `sourceNotice`

**Files:**
- Create: `src/core/load-schedule.ts`
- Create: `src/core/load-schedule.test.ts`

- [ ] **Step 1: Write the tests**

Create `src/core/load-schedule.test.ts`:

```ts
import { chooseSchedule, sourceNotice } from "./load-schedule";
import { makeSchedule } from "../test/factories";

const live = makeSchedule({ compDate: "2027-09-11" });
const cached = makeSchedule({ compDate: "2027-09-10" });
const snapshot = makeSchedule({ compDate: "2026-09-12" });

describe("choosing which schedule to draw", () => {
  it("uses the live schedule when the fetch succeeded", () => {
    const loaded = chooseSchedule({ fetched: { kind: "loaded", schedule: live }, cached, snapshot });

    expect(loaded).toEqual({ schedule: live, source: "live" });
  });

  it("falls back to the cached schedule when the sheet is unreachable", () => {
    const loaded = chooseSchedule({ fetched: { kind: "unreachable" }, cached, snapshot });

    expect(loaded).toEqual({ schedule: cached, source: "cached", reason: "unreachable" });
  });

  it("falls back to the snapshot when there is no cache", () => {
    const loaded = chooseSchedule({ fetched: { kind: "unreachable" }, cached: undefined, snapshot });

    expect(loaded).toEqual({ schedule: snapshot, source: "snapshot", reason: "unreachable" });
  });

  it("keeps the last good schedule and carries the reason when the sheet is invalid", () => {
    const loaded = chooseSchedule({ fetched: { kind: "invalid", reason: "Event 1: has no heats" }, cached, snapshot });

    expect(loaded).toEqual({ schedule: cached, source: "cached", reason: "Event 1: has no heats" });
  });
});

describe("the source notice", () => {
  it("is absent for a live schedule", () => {
    expect(sourceNotice({ schedule: live, source: "live" })).toBeUndefined();
  });

  it("says offline when the sheet could not be reached", () => {
    expect(sourceNotice({ schedule: cached, source: "cached", reason: "unreachable" })).toBe("Offline — showing last known schedule");
  });

  it("names the sheet problem", () => {
    expect(sourceNotice({ schedule: snapshot, source: "snapshot", reason: "Event 1: has no heats" })).toBe(
      "Sheet has a problem: Event 1: has no heats — showing last known schedule",
    );
  });
});
```

Run: `npx vitest run src/core/load-schedule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

Create `src/core/load-schedule.ts`:

```ts
import type { Schedule } from "./types";

export type FetchOutcome =
  | { readonly kind: "loaded"; readonly schedule: Schedule }
  | { readonly kind: "unreachable" }
  | { readonly kind: "invalid"; readonly reason: string };

export type ScheduleSource = "live" | "cached" | "snapshot";

export type LoadedSchedule = {
  readonly schedule: Schedule;
  readonly source: ScheduleSource;
  readonly reason?: string;
};

type ChooseScheduleOptions = {
  readonly fetched: FetchOutcome;
  readonly cached: Schedule | undefined;
  readonly snapshot: Schedule;
};

const UNREACHABLE = "unreachable";

export const chooseSchedule = ({ fetched, cached, snapshot }: ChooseScheduleOptions): LoadedSchedule => {
  if (fetched.kind === "loaded") return { schedule: fetched.schedule, source: "live" };
  const reason = fetched.kind === "unreachable" ? UNREACHABLE : fetched.reason;
  return cached ? { schedule: cached, source: "cached", reason } : { schedule: snapshot, source: "snapshot", reason };
};

export const sourceNotice = (loaded: LoadedSchedule): string | undefined => {
  if (loaded.source === "live") return undefined;
  if (loaded.reason === UNREACHABLE || loaded.reason === undefined) return "Offline — showing last known schedule";
  return `Sheet has a problem: ${loaded.reason} — showing last known schedule`;
};
```

Run: `npx vitest run src/core/load-schedule.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/core/load-schedule.ts src/core/load-schedule.test.ts
git commit -m "feat: choose live, cached or snapshot schedule with a user-facing notice

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `fetchSchedule`

**Files:**
- Create: `src/ui/schedule-client.ts`
- Create: `src/ui/schedule-client.test.ts`

- [ ] **Step 1: Write the tests**

Create `src/ui/schedule-client.test.ts`:

```ts
import { fetchSchedule } from "./schedule-client";
import { makeRawSchedule, makeSchedule, makeEvent, makeHeat, makeLane } from "../test/factories";

const ENDPOINT = "https://script.example/exec";

const replying = (status: number, body: unknown): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("fetching the schedule from the sheet", () => {
  it("decodes a good reply", async () => {
    const fetchFn = replying(200, { ok: true, schedule: makeRawSchedule() });

    const outcome = await fetchSchedule({ endpoint: ENDPOINT, fetchFn });

    expect(outcome).toEqual({
      kind: "loaded",
      schedule: makeSchedule({ events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ email: "a@example.com" })] })] })] }),
    });
    expect(fetchFn).toHaveBeenCalledWith(ENDPOINT);
  });

  it("is unreachable when the endpoint is not configured, without fetching", async () => {
    const fetchFn = replying(200, {});

    expect(await fetchSchedule({ endpoint: "", fetchFn })).toEqual({ kind: "unreachable" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is unreachable when fetch throws", async () => {
    const fetchFn: typeof fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn })).toEqual({ kind: "unreachable" });
  });

  it("is unreachable on a non-2xx status or a non-JSON body", async () => {
    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn: replying(500, { ok: true }) })).toEqual({ kind: "unreachable" });

    const html: typeof fetch = vi.fn(async () => new Response("<html>login</html>", { status: 200 }));
    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn: html })).toEqual({ kind: "unreachable" });
  });

  it("is invalid with the script's error when the script says no", async () => {
    const fetchFn = replying(200, { ok: false, error: "Run setup() in the script editor first" });

    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn })).toEqual({ kind: "invalid", reason: "Run setup() in the script editor first" });
  });

  it("is invalid with the decoder's message when the sheet content is wrong", async () => {
    const fetchFn = replying(200, { ok: true, schedule: makeRawSchedule({ compDate: "soon" }) });

    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn })).toEqual({
      kind: "invalid",
      reason: 'Settings: compDate "soon" must be YYYY-MM-DD',
    });
  });

  it("is invalid when the reply has no schedule", async () => {
    expect(await fetchSchedule({ endpoint: ENDPOINT, fetchFn: replying(200, { ok: true }) })).toEqual({
      kind: "invalid",
      reason: "Unexpected reply from the sheet",
    });
  });
});
```

Run: `npx vitest run src/ui/schedule-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

Create `src/ui/schedule-client.ts`:

```ts
import type { FetchOutcome } from "../core/load-schedule";
import { decodeSchedule } from "../core/schedule-schema";

type FetchScheduleOptions = {
  readonly endpoint: string;
  readonly fetchFn: typeof fetch;
};

type Reply = { readonly ok: boolean; readonly error?: string; readonly schedule?: unknown };

const isReply = (value: unknown): value is Reply =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  typeof value.ok === "boolean" &&
  (!("error" in value) || typeof value.error === "string");

const outcomeOf = (body: unknown): FetchOutcome => {
  if (!isReply(body)) return { kind: "invalid", reason: "Unexpected reply from the sheet" };
  if (!body.ok) return { kind: "invalid", reason: body.error ?? "Rejected by the sheet" };
  if (body.schedule === undefined) return { kind: "invalid", reason: "Unexpected reply from the sheet" };
  const decoded = decodeSchedule(body.schedule);
  return decoded.success ? { kind: "loaded", schedule: decoded.data } : { kind: "invalid", reason: decoded.error };
};

export const fetchSchedule = async ({ endpoint, fetchFn }: FetchScheduleOptions): Promise<FetchOutcome> => {
  if (endpoint === "") return { kind: "unreachable" };
  try {
    const response = await fetchFn(endpoint);
    if (!response.ok) return { kind: "unreachable" };
    return outcomeOf(await response.json());
  } catch {
    return { kind: "unreachable" };
  }
};
```

Run: `npx vitest run src/ui/schedule-client.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/ui/schedule-client.ts src/ui/schedule-client.test.ts
git commit -m "feat: fetch and decode the schedule from the sheet endpoint

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The `localStorage` cache

**Files:**
- Create: `src/ui/schedule-store.ts`
- Create: `src/ui/schedule-store.test.ts`

- [ ] **Step 1: Write the tests**

Create `src/ui/schedule-store.test.ts`:

```ts
import { loadCachedSchedule, saveCachedSchedule } from "./schedule-store";
import { makeSchedule } from "../test/factories";

afterEach(() => localStorage.clear());

describe("the cached schedule", () => {
  it("is absent on a fresh phone", () => {
    expect(loadCachedSchedule()).toBeUndefined();
  });

  it("round-trips a saved schedule", () => {
    const schedule = makeSchedule({ compDate: "2027-09-11" });

    saveCachedSchedule(schedule);

    expect(loadCachedSchedule()).toEqual(schedule);
  });

  it("ignores a cache that no longer decodes", () => {
    localStorage.setItem("schedule:cache", JSON.stringify({ compDate: "soon" }));

    expect(loadCachedSchedule()).toBeUndefined();
  });

  it("ignores a cache that is not JSON", () => {
    localStorage.setItem("schedule:cache", "{not json");

    expect(loadCachedSchedule()).toBeUndefined();
  });
});
```

Run: `npx vitest run src/ui/schedule-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

Create `src/ui/schedule-store.ts`:

```ts
import { decodeSchedule } from "../core/schedule-schema";
import type { Schedule } from "../core/types";

const KEY = "schedule:cache";

const parse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const loadCachedSchedule = (): Schedule | undefined => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return undefined;
    const decoded = decodeSchedule(parse(raw));
    return decoded.success ? decoded.data : undefined;
  } catch {
    return undefined;
  }
};

export const saveCachedSchedule = (schedule: Schedule): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(schedule));
  } catch {
    return;
  }
};
```

Run: `npx vitest run src/ui/schedule-store.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/ui/schedule-store.ts src/ui/schedule-store.test.ts
git commit -m "feat: cache the last good schedule on the phone

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Spectator page — open lanes, picker label, source pill

**Files:**
- Modify: `src/ui/render.ts`
- Modify: `src/ui/render.test.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write the tests**

In `src/ui/render.test.ts`, change `renderAt` so it passes the new option, and add a second helper for custom schedules:

```ts
import { makeEvent, makeHeat, makeLane, makeSchedule, at } from "../test/factories";
import type { Schedule } from "../core/types";

const renderAt = (now: Date, selectedTeam?: string, onTeamChange = vi.fn()) => {
  const root = document.createElement("div");
  render({ root, schedule, now, selectedTeam, onTeamChange, sourceNotice: undefined });
  return { root, onTeamChange };
};

const renderSchedule = (custom: Schedule, sourceNotice?: string) => {
  const root = document.createElement("div");
  render({ root, schedule: custom, now: at("08:15"), selectedTeam: undefined, onTeamChange: vi.fn(), sourceNotice });
  return root;
};
```

Add a new `describe` at the end:

```ts
describe("lanes nobody has claimed", () => {
  it("are listed as open so the heat is always eight rows", () => {
    const { root } = renderAt(at("08:15"));

    const rows = root.querySelectorAll('[data-heat="E1H3"] tbody tr');
    expect(rows).toHaveLength(8);
    expect(rows[7]).toHaveClass("open");
    expect(rows[7]?.textContent).toContain("8");
    expect(rows[7]?.textContent).toContain("open");
  });

  it("are not offered in the team picker", () => {
    const custom = makeSchedule({ events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ team: "Only Team" })] })] })] });

    const picker = getByLabelText<HTMLSelectElement>(renderSchedule(custom), /i'm on/i);

    expect([...picker.options].map((o) => o.textContent)).toEqual(["— pick your team —", "Only Team"]);
  });
});

describe("an individual comp", () => {
  it("asks who you are rather than which team you are on", () => {
    const custom = makeSchedule({ teamSize: 1, events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ team: "Mike Sholar" })] })] })] });

    const root = renderSchedule(custom);

    expect(getByLabelText(root, /^i'm…$/i)).toBeInTheDocument();
    expect(root.textContent).toContain("pick your name");
  });
});

describe("the source notice", () => {
  it("is absent when the schedule is live", () => {
    expect(queryByTestId(renderSchedule(makeSchedule()), "source-notice")).toBeNull();
  });

  it("shows the notice when the schedule is stale", () => {
    const root = renderSchedule(makeSchedule(), "Offline — showing last known schedule");

    expect(getByTestId(root, "source-notice")).toHaveTextContent("Offline — showing last known schedule");
  });
});
```

`toBeInTheDocument` needs the root attached: in `renderSchedule`, add `document.body.append(root);` after creating it, and add at top level `afterEach(() => { document.body.innerHTML = ""; });`.

Run: `npx vitest run src/ui/render.test.ts`
Expected: FAIL — typecheck complains about `sourceNotice`; open-lane rows count 7; label mismatch; notice missing.

- [ ] **Step 2: Implement in `render.ts`**

Add `sourceNotice` to the options type:

```ts
export type RenderOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly now: Date;
  readonly selectedTeam: string | undefined;
  readonly onTeamChange: (team: string | undefined) => void;
  readonly sourceNotice: string | undefined;
};
```

Replace `headerHtml`'s type and body:

```ts
type HeaderOptions = {
  readonly schedule: Schedule;
  readonly now: Date;
  readonly selectedTeam: string | undefined;
  readonly teamStatus: TeamStatus | undefined;
  readonly sourceNotice: string | undefined;
};

const pickerLabel = (schedule: Schedule): string => (schedule.teamSize > 1 ? "I'm on…" : "I'm…");

const pickerPlaceholder = (schedule: Schedule): string => (schedule.teamSize > 1 ? "— pick your team —" : "— pick your name —");

const headerHtml = ({ schedule, now, selectedTeam, teamStatus, sourceNotice }: HeaderOptions): string => `
  <header class="header">
    <div class="header-row">
      <h1 class="title"><img class="logo" src="${import.meta.env.BASE_URL}logo.png" alt="12th State CrossFit" /><span class="title-text">12 Years of 12th State</span></h1>
      <div class="clock" aria-label="Current time">${clockLabel(schedule, now)}</div>
    </div>
    ${sourceNotice ? `<div class="source-notice" role="status" data-testid="source-notice">${esc(sourceNotice)}</div>` : ""}
    <label class="picker${selectedTeam ? " compact" : ""}">
      <span>${pickerLabel(schedule)}</span>
      <select id="team-picker">
        <option value="">${pickerPlaceholder(schedule)}</option>
        ${allTeams(schedule)
          .map((team) => `<option value="${esc(team)}"${team === selectedTeam ? " selected" : ""}>${esc(team)}</option>`)
          .join("")}
      </select>
    </label>
    ${selectedTeam && teamStatus ? stripHtml(selectedTeam, teamStatus) : ""}
  </header>`;
```

Replace `laneRowHtml` and the `<tbody>` line in `heatCardHtml`:

```ts
const laneRowHtml = (lane: Lane, selectedTeam: string | undefined): string => `
  <tr data-team="${esc(lane.team)}" class="${lane.team === selectedTeam ? "mine" : ""}">
    <td class="lane-num">${lane.lane}</td>
    <td class="lane-team"><div class="team-name">${esc(lane.team)}</div><div class="athletes">${esc(lane.athletes)}</div></td>
    <td class="lane-div">${esc(lane.division)}</td>
  </tr>`;

const openRowHtml = (laneNumber: number): string => `
  <tr class="open">
    <td class="lane-num">${laneNumber}</td>
    <td class="lane-team"><div class="team-name">— open —</div></td>
    <td class="lane-div"></td>
  </tr>`;

const laneRowsHtml = (event: Event, heat: Heat, selectedTeam: string | undefined): string =>
  Array.from({ length: event.lanes }, (_, i) => i + 1)
    .map((laneNumber) => {
      const lane = heat.lanes.find((l) => l.lane === laneNumber);
      return lane ? laneRowHtml(lane, selectedTeam) : openRowHtml(laneNumber);
    })
    .join("");
```

```ts
      <tbody>${laneRowsHtml(event, heat, selectedTeam)}</tbody>
```

And in `render`, pass the notice through:

```ts
export const render = ({ root, schedule, now, selectedTeam, onTeamChange, sourceNotice }: RenderOptions): void => {
  const status = resolveHeats(schedule, now);
  const teamStatus = selectedTeam ? resolveTeam({ schedule, team: selectedTeam, now }) : undefined;
  const myHeat = selectedTeam && teamStatus ? myHeatHtml(selectedTeam, teamStatus) : "";

  root.innerHTML = `
    ${headerHtml({ schedule, now, selectedTeam, teamStatus, sourceNotice })}
```

- [ ] **Step 3: Styles**

Append to `src/styles.css` (near the `.picker` rules):

```css
.source-notice { margin-top: 8px; padding: 6px 12px; border-radius: 6px; background: #fef3c7; color: #92400e; font-weight: 700; font-size: 0.85rem; }
tr.open .team-name { color: var(--muted); font-weight: 400; font-style: italic; }
tr.open .lane-num { color: var(--muted); }
```

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/ui/render.test.ts` → PASS. `main.ts` will not typecheck until Task 9 (it doesn't pass `sourceNotice`); add `sourceNotice: undefined,` to the `render({...})` call in `main.ts` now so the tree stays green.

```bash
npm test && npm run typecheck && npm run lint
git add src/ui/render.ts src/ui/render.test.ts src/styles.css src/main.ts
git commit -m "feat: spectator page shows open lanes, adapts to individual comps, flags a stale schedule

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `main.ts` loads the schedule; retire `schedule.ts`

**Files:**
- Modify: `src/ui/now-override.ts`, `src/ui/now-override.test.ts`
- Rename: `src/data/scoring-endpoint.ts` → `src/data/sheet-endpoint.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Delete: `src/data/schedule.ts`

- [ ] **Step 1: `readNowOverride` takes the time zone**

Replace `src/ui/now-override.test.ts` with:

```ts
import { readNowOverride } from "./now-override";

const TZ = "America/New_York";

describe("previewing the page at a chosen time", () => {
  it("uses the real clock when no override is given", () => {
    const real = new Date("2026-09-10T20:00:00Z");

    expect(readNowOverride({ search: "", fallback: real, timeZone: TZ })).toBe(real);
  });

  it("reads a wall-clock time in the comp's zone from ?at=", () => {
    const now = readNowOverride({ search: "?at=2026-09-12T08:30", fallback: new Date(), timeZone: TZ });

    expect(now.toISOString()).toBe("2026-09-12T12:30:00.000Z");
  });

  it("ignores an unparseable override", () => {
    const real = new Date("2026-09-10T20:00:00Z");

    expect(readNowOverride({ search: "?at=yesterday", fallback: real, timeZone: TZ })).toBe(real);
  });
});
```

Run: `npx vitest run src/ui/now-override.test.ts` → FAIL (signature).

Replace `src/ui/now-override.ts` with:

```ts
import { localToInstant } from "../core/comp-time";

const OVERRIDE_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

type ReadNowOverrideOptions = {
  readonly search: string;
  readonly fallback: Date;
  readonly timeZone: string;
};

export const readNowOverride = ({ search, fallback, timeZone }: ReadNowOverrideOptions): Date => {
  const raw = new URLSearchParams(search).get("at");
  const match = raw ? OVERRIDE_PATTERN.exec(raw) : null;
  const [, date, hhmm] = match ?? [];
  if (!date || !hhmm) return fallback;
  return localToInstant({ date, hhmm, timeZone });
};
```

Run: `npx vitest run src/ui/now-override.test.ts` → PASS.

- [ ] **Step 2: Rename the endpoint module**

```bash
git mv src/data/scoring-endpoint.ts src/data/sheet-endpoint.ts
sed -i '' 's/export const scoringEndpoint/export const sheetEndpoint/' src/data/sheet-endpoint.ts
grep -rn "scoringEndpoint\|scoring-endpoint" src scripts docs README.md
```

Expected: only `src/main.ts` (fixed next) and docs (fixed in Task 12).

- [ ] **Step 3: Rewrite `main.ts`**

Replace `src/main.ts` with:

```ts
import "./styles.css";
import { resolveJudgeCode } from "./core/judge-codes";
import { chooseSchedule, sourceNotice, type LoadedSchedule } from "./core/load-schedule";
import type { Event, Schedule } from "./core/types";
import { judgeCodes } from "./data/judge-codes";
import { sheetEndpoint } from "./data/sheet-endpoint";
import { snapshotSchedule } from "./data/snapshot";
import { startJudgePage } from "./ui/judge-page";
import { readJudgeCode } from "./ui/judge-route";
import { readNowOverride } from "./ui/now-override";
import { render } from "./ui/render";
import { renderHead } from "./ui/render-head";
import { renderInvalid } from "./ui/render-invalid";
import { fetchSchedule } from "./ui/schedule-client";
import { loadCachedSchedule, saveCachedSchedule } from "./ui/schedule-store";
import { loadTeam, saveTeam } from "./ui/team-store";

const REFRESH_MS = 15_000;
const RELOAD_SCHEDULE_MS = 60_000;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const loadSchedule = async (): Promise<LoadedSchedule> => {
  const fetched = await fetchSchedule({ endpoint: sheetEndpoint, fetchFn: fetch });
  if (fetched.kind === "loaded") saveCachedSchedule(fetched.schedule);
  return chooseSchedule({ fetched, cached: loadCachedSchedule(), snapshot: snapshotSchedule });
};

const clockFor = (schedule: Schedule): (() => Date) => {
  const previewOffsetMs =
    readNowOverride({ search: location.search, fallback: new Date(), timeZone: schedule.timeZone }).getTime() - Date.now();
  return () => new Date(Date.now() + previewOffsetMs);
};

const startSpectator = (initial: LoadedSchedule): void => {
  let loaded = initial;
  const now = clockFor(initial.schedule);

  const draw = (selectedTeam: string | undefined): void => {
    render({
      root,
      schedule: loaded.schedule,
      now: now(),
      selectedTeam,
      onTeamChange: (team) => {
        saveTeam(team);
        draw(team);
      },
      sourceNotice: sourceNotice(loaded),
    });
  };

  draw(loadTeam());
  root.querySelector(".heat.current, .heat.upcoming")?.scrollIntoView({ block: "start" });
  setInterval(() => draw(loadTeam()), REFRESH_MS);
  setInterval(() => {
    void loadSchedule().then((next) => {
      loaded = next;
      draw(loadTeam());
    });
  }, RELOAD_SCHEDULE_MS);
};

const startJudge = (schedule: Schedule, event: Event, lane: number): void => {
  const page = startJudgePage({
    root,
    schedule,
    event,
    lane,
    endpoint: sheetEndpoint,
    now: clockFor(schedule),
    fetchFn: fetch,
    newClientId: () => crypto.randomUUID(),
  });
  setInterval(() => void page.tick(), REFRESH_MS);
  window.addEventListener("online", () => void page.tick());
};

const route = (loaded: LoadedSchedule): void => {
  const { schedule } = loaded;
  const code = readJudgeCode(location.search);
  const assignment = resolveJudgeCode({ table: judgeCodes, code });
  const laneEvent = assignment.kind === "lane" ? schedule.events.find((e) => e.number === assignment.event) : undefined;

  if (code === undefined) startSpectator(loaded);
  else if (assignment.kind === "lane" && laneEvent && assignment.lane <= laneEvent.lanes) startJudge(schedule, laneEvent, assignment.lane);
  else if (assignment.kind === "head")
    void renderHead({ root, schedule, table: judgeCodes, siteUrl: `${location.origin}${import.meta.env.BASE_URL}` }).catch(() =>
      renderInvalid({ root }),
    );
  else renderInvalid({ root });
};

root.innerHTML = `<main class="main"><p class="loading">Loading schedule…</p></main>`;
void loadSchedule().then(route);
```

Append to `src/styles.css`:

```css
.loading { padding: 32px 16px; text-align: center; color: var(--muted); font-weight: 700; }
```

- [ ] **Step 4: Delete the TypeScript schedule**

```bash
git rm src/data/schedule.ts
grep -rn "data/schedule\"" src scripts
```

Expected: no matches.

- [ ] **Step 5: Verify in the browser**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: clean.

Run `npm run dev`, open `http://localhost:5173/12th-state-heats/`. Because the deployed `doGet` does not exist yet (Task 10), expect the amber "Offline — showing last known schedule" pill and the 2026 schedule from the snapshot. `?at=2026-09-12T08:30` still previews. Open a judge link (`npm run judge-links`) — same pill-less judge page as before.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat: load the schedule from the sheet with cache and snapshot fallback

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `Code.gs` — new tabs and `doGet`

**Files:**
- Modify: `apps-script/Code.gs`

Not unit-tested; verified by the smoke tests in Step 3. Keep `doPost`, `alreadyLogged`, `numberOrBlank`, `toRow`, `setupLog`, `setupResults` exactly as they are.

- [ ] **Step 1: Add the constants and tab setup**

Replace the top of the file (through `const SCORE_KINDS = …`) with:

```js
const LOG = "Log";
const RESULTS = "Results";
const OVERALL = "Overall";
const SETTINGS = "Settings";
const EVENTS_TAB = "Events";
const HEATS = "Heats";
const SLOTS = "Slots";
const LOCK_WAIT_MS = 10000;

const LOG_HEADERS = [
  "receivedAt", "submittedAt", "judge", "event", "heat", "lane",
  "team", "division", "scoreKind", "seconds", "rounds", "reps", "clientId",
];
const CLIENT_ID_COLUMN = LOG_HEADERS.indexOf("clientId") + 1;
const REQUIRED = ["clientId", "submittedAt", "judge", "event", "heat", "lane", "team", "division", "scoreKind"];
const SCORE_KINDS = ["time", "rounds-reps"];

const SETTINGS_ROWS = [
  ["compDate", "2027-09-11"],
  ["timeZone", "America/New_York"],
  ["teamSize", 2],
  ["divisions", "F/F RX, F/F Scaled, F/M RX, F/M Scaled, M/M RX, M/M Scaled"],
  ["signupsOpen", false],
];
const EVENT_HEADERS = ["event", "title", "format", "scoring", "capSeconds", "rx", "scaled", "lanes"];
const HEAT_HEADERS = ["event", "heat", "start", "end"];
const SLOT_HEADERS = ["event", "heat", "lane", "email", "team", "athletes", "division", "signedUpAt"];
const SCORING_FORMATS = ["time-or-rounds", "rounds-reps"];
```

Replace `setup()` and `EVENTS`-dependent code (`eventPlacing`, `setupOverall`) with:

```js
function setup() {
  const ss = SpreadsheetApp.getActive();
  setupSettings(ss);
  setupEvents(ss);
  setupHeats(ss);
  setupSlots(ss);
  setupLog(ss);
  setupResults(ss);
  setupOverall(ss);
}

function createIfMissing(ss, name, headers, fill) {
  if (ss.getSheetByName(name)) return;
  const sheet = ss.insertSheet(name);
  writeHeaders(sheet, headers);
  fill(sheet);
}

function setupSettings(ss) {
  createIfMissing(ss, SETTINGS, ["key", "value"], (sheet) => {
    sheet.getRange(2, 1, SETTINGS_ROWS.length, 2).setValues(SETTINGS_ROWS);
    sheet.getRange(2 + SETTINGS_ROWS.length - 1, 2).insertCheckboxes();
    sheet.getRange("A1").setNote("compDate YYYY-MM-DD · timeZone IANA name · teamSize 1 for individuals · divisions comma-separated · signupsOpen checkbox");
  });
}

function setupEvents(ss) {
  createIfMissing(ss, EVENTS_TAB, EVENT_HEADERS, (sheet) => {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(SCORING_FORMATS, true).build();
    sheet.getRange("D2:D").setDataValidation(rule);
    sheet.getRange("A1").setNote("One row per event. scoring: time-or-rounds needs capSeconds; rounds-reps leaves it blank. lanes = lanes per heat. Re-run setup() after changing the number of events so Overall gets the right columns.");
  });
}

function setupHeats(ss) {
  createIfMissing(ss, HEATS, HEAT_HEADERS, (sheet) => {
    sheet.getRange("C2:D").setNumberFormat("@");
    sheet.getRange("A1").setNote("One row per heat. start/end as HH:MM text in the comp time zone, e.g. 08:00.");
  });
}

function setupSlots(ss) {
  createIfMissing(ss, SLOTS, SLOT_HEADERS, (sheet) => {
    sheet.getRange("A1").setNote("One row per claimed lane; written by the sign-up page, editable by hand. Rows whose event/heat/lane do not exist are ignored by the site. If two rows claim the same lane the earlier signedUpAt wins.");
  });
}

function eventNumbers(ss) {
  const sheet = ss.getSheetByName(EVENTS_TAB);
  const numbers = sheet ? readTable(sheet).map((row) => Number(row.event)).filter((n) => Number.isInteger(n) && n > 0) : [];
  return numbers.length > 0 ? numbers : [1];
}

function eventPlacing(eventNumber) {
  return (
    '=ARRAYFORMULA(IF(B2:B="", "", IFERROR(' +
    "VLOOKUP(" + eventNumber + '&"|"&B2:B, {Results!A2:A&"|"&Results!C2:C, Results!K2:K}, 2, FALSE), ' +
    "COUNTIFS(Results!A2:A, " + eventNumber + ", Results!B2:B, A2:A) + 1)))"
  );
}

function setupOverall(ss) {
  const events = eventNumbers(ss);
  const sheet = sheetNamed(ss, OVERALL);
  sheet.clear();
  const eventHeaders = events.map((n) => "E" + n);
  writeHeaders(sheet, ["division", "team"].concat(eventHeaders, ["total", "place"]));
  const eventColumns = events.map((_, i) => String.fromCharCode("C".charCodeAt(0) + i));
  const totalCol = String.fromCharCode("C".charCodeAt(0) + events.length);
  const formulas = [
    '=IFERROR(SORT(UNIQUE(FILTER({Results!B2:B, Results!C2:C}, Results!C2:C<>""))), "")',
    "",
  ]
    .concat(events.map(eventPlacing))
    .concat([
      '=ARRAYFORMULA(IF(B2:B="", "", ' + eventColumns.map((c) => c + "2:" + c).join(" + ") + "))",
      '=ARRAYFORMULA(IF(B2:B="", "", COUNTIFS(A2:A, A2:A, ' + totalCol + "2:" + totalCol + ', "<"&' + totalCol + "2:" + totalCol + ") + 1))",
    ]);
  sheet.getRange(2, 1, 1, formulas.length).setFormulas([formulas]);
  sheet.getRange(totalCol + "1").setNote("Sum of event placings within division; lowest wins. A missing event counts as one worse than last.");
}
```

- [ ] **Step 2: Add the readers and `doGet`**

Replace the existing `doGet` with, and add the helpers below it:

```js
function doGet() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(SETTINGS)) return reply({ ok: false, error: "Run setup() in the script editor first" });
  return reply({ ok: true, schedule: readSchedule(ss) });
}

function readTable(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = (values[0] || []).map((h) => String(h).trim());
  return values.slice(1)
    .filter((row) => row.some((cell) => cell !== "" && cell !== null))
    .map((row) => headers.reduce((record, header, i) => Object.assign(record, { [header]: row[i] }), {}));
}

function readSettings(ss) {
  const rows = ss.getSheetByName(SETTINGS).getDataRange().getValues().slice(1);
  return rows.reduce((settings, row) => Object.assign(settings, { [String(row[0]).trim()]: row[1] }), {});
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function asClock(value, timeZone) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone, "HH:mm");
  if (typeof value === "number") {
    const minutes = Math.round(value * 24 * 60);
    return pad2(Math.floor(minutes / 60) % 24) + ":" + pad2(minutes % 60);
  }
  return String(value === undefined || value === null ? "" : value).trim();
}

function asDateString(value, timeZone) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone, "yyyy-MM-dd");
  return String(value === undefined || value === null ? "" : value).trim();
}

function asText(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function asNumberOrText(value) {
  const text = asText(value);
  return text !== "" && !isNaN(Number(text)) ? Number(text) : text;
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  return asText(value).toUpperCase() === "TRUE";
}

function readEvents(ss, timeZone) {
  const heats = readTable(ss.getSheetByName(HEATS));
  const slots = readTable(ss.getSheetByName(SLOTS)).slice().sort((a, b) => new Date(a.signedUpAt) - new Date(b.signedUpAt));
  return readTable(ss.getSheetByName(EVENTS_TAB)).map((row) => {
    const number = asNumberOrText(row.event);
    const laneCount = asNumberOrText(row.lanes);
    const capSeconds = asText(row.capSeconds);
    return Object.assign(
      {
        number: number,
        title: asText(row.title),
        format: asText(row.format),
        scoring: asText(row.scoring),
        rx: asText(row.rx),
        scaled: asText(row.scaled),
        lanes: laneCount,
        heats: heats
          .filter((h) => asNumberOrText(h.event) === number)
          .map((h) => readHeat(h, number, laneCount, slots, timeZone)),
      },
      capSeconds === "" ? {} : { capSeconds: asNumberOrText(capSeconds) },
    );
  });
}

function readHeat(row, eventNumber, laneCount, slots, timeZone) {
  const number = asNumberOrText(row.heat);
  const lanes = slots
    .filter((s) => asNumberOrText(s.event) === eventNumber && asNumberOrText(s.heat) === number)
    .map((s) => readLane(s))
    .filter((lane) => typeof lane.lane === "number" && lane.lane >= 1 && (typeof laneCount !== "number" || lane.lane <= laneCount))
    .filter((lane, i, all) => all.findIndex((other) => other.lane === lane.lane) === i);
  return { number: number, start: asClock(row.start, timeZone), end: asClock(row.end, timeZone), lanes: lanes };
}

function readLane(slot) {
  const email = asText(slot.email);
  return Object.assign(
    { lane: asNumberOrText(slot.lane), team: asText(slot.team), athletes: asText(slot.athletes), division: asText(slot.division) },
    email === "" ? {} : { email: email },
  );
}

function readSchedule(ss) {
  const settings = readSettings(ss);
  const timeZone = asText(settings.timeZone) || "America/New_York";
  return {
    compDate: asDateString(settings.compDate, timeZone),
    timeZone: timeZone,
    teamSize: asNumberOrText(settings.teamSize),
    divisions: asText(settings.divisions).split(",").map((d) => d.trim()).filter((d) => d !== ""),
    signupsOpen: asBoolean(settings.signupsOpen),
    events: readEvents(ss, timeZone),
  };
}
```

`doPost` and everything else stay as they are. Paste the whole file into the Apps Script editor, save, run `setup` (it creates the four new tabs and leaves `Log` alone), then **Deploy → Manage deployments → ✎ → Version: New version → Deploy**.

- [ ] **Step 3: Fill the Sheet with the 2026 data and smoke test**

In the Sheet: `Settings` — `compDate` `2026-09-12`, `signupsOpen` unchecked. `Events` — three rows from `src/data/schedule-snapshot.json` (`event`, `title`, `format`, `scoring`, `capSeconds`, `rx`, `scaled`, `lanes`=8). `Heats` — fifteen rows. `Slots` — one row per lane in the snapshot (`email` blank, `signedUpAt` blank is fine). A quick way to get the rows: 

```bash
node --import tsx -e '
import("./src/data/snapshot.ts").then(({ snapshotSchedule: s }) => {
  const tsv = (rows) => rows.map((r) => r.join("\t")).join("\n");
  console.log("EVENTS"); console.log(tsv(s.events.map((e) => [e.number, e.title, e.format, e.scoring, e.capSeconds ?? "", e.rx, e.scaled, e.lanes])));
  console.log("\nHEATS"); console.log(tsv(s.events.flatMap((e) => e.heats.map((h) => [e.number, h.number, h.start, h.end]))));
  console.log("\nSLOTS"); console.log(tsv(s.events.flatMap((e) => e.heats.flatMap((h) => h.lanes.map((l) => [e.number, h.number, l.lane, "", l.team, l.athletes, l.division, ""])))));
});
'
```

Paste each block under its tab's header row. Re-run `setup()` once more so `Overall` gets `E1..E3`.

Then:

```bash
curl -sL "$(sed -n 's/.*"\(https[^"]*\)".*/\1/p' src/data/sheet-endpoint.ts)" | head -c 400
```

Expected: `{"ok":true,"schedule":{"compDate":"2026-09-12","timeZone":"America/New_York","teamSize":2,"divisions":[...`.

And the real check: `npm run dev`, open the site — **no amber pill**, and the schedule matches. Change a team name in `Slots`, wait 60 s (or reload) — it updates.

- [ ] **Step 4: Commit**

```bash
git add apps-script/Code.gs
git commit -m "feat: Apps Script serves the schedule from Settings, Events, Heats and Slots tabs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `npm run snapshot`

**Files:**
- Create: `scripts/snapshot.ts`
- Modify: `package.json`

- [ ] **Step 1: The script**

Create `scripts/snapshot.ts`:

```ts
import { writeFileSync } from "node:fs";
import { decodeSchedule } from "../src/core/schedule-schema";
import type { Schedule } from "../src/core/types";
import { sheetEndpoint } from "../src/data/sheet-endpoint";

const OUTPUT = "src/data/schedule-snapshot.json";

const die = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const hasSchedule = (value: unknown): value is { readonly ok: true; readonly schedule: unknown } =>
  typeof value === "object" && value !== null && "ok" in value && value.ok === true && "schedule" in value;

if (sheetEndpoint === "") die("sheetEndpoint is empty — see docs/deploy.md");

const response = await fetch(sheetEndpoint);
if (!response.ok) die(`Sheet endpoint answered ${response.status}`);
const body: unknown = await response.json();
if (!hasSchedule(body)) die(`Unexpected reply: ${JSON.stringify(body).slice(0, 200)}`);

const decoded = decodeSchedule(body.schedule);
if (!decoded.success) die(`The Sheet has a problem: ${decoded.error}`);

const withoutEmails = (schedule: Schedule): Schedule => ({
  ...schedule,
  events: schedule.events.map((event) => ({
    ...event,
    heats: event.heats.map((heat) => ({
      ...heat,
      lanes: heat.lanes.map(({ email: _email, ...lane }) => lane),
    })),
  })),
});

writeFileSync(OUTPUT, JSON.stringify(withoutEmails(decoded.data), null, 2) + "\n");
const events = decoded.data.events.map((e) => `E${e.number}: ${e.heats.length} heats`).join(", ");
console.log(`Wrote ${OUTPUT} — ${decoded.data.compDate}, ${events}`);
```

Add to `package.json` scripts: `"snapshot": "tsx scripts/snapshot.ts"`.

The snapshot is committed to a public repo and shipped in the bundle, so member emails are stripped before writing (the `_email` destructure is the idiom ESLint accepts for an intentionally unused binding; if `no-unused-vars` still complains, add `{ argsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }`-style config for `varsIgnorePattern: "^_"` in `eslint.config.js`). Add a test `scripts/snapshot.test.ts`? No — the script is glue; instead the existing `schedule.test.ts` gains one assertion in "pins the 2026 settings": `expect(schedule.events.flatMap((e) => e.heats.flatMap((h) => h.lanes)).some((l) => l.email !== undefined)).toBe(false);` — the committed snapshot must never carry an email.

- [ ] **Step 2: Run it against the filled Sheet**

```bash
npm run snapshot && git diff --stat src/data/schedule-snapshot.json && npm test
```

Expected: `Wrote src/data/schedule-snapshot.json — 2026-09-12, E1: 5 heats, E2: 5 heats, E3: 5 heats`; the diff is whitespace/ordering only (or empty); tests pass. If a pinned test in `schedule.test.ts` fails, the Sheet was transcribed wrongly — fix the Sheet, not the test.

- [ ] **Step 3: Commit**

```bash
git add scripts/snapshot.ts package.json src/data/schedule-snapshot.json
git commit -m "feat: npm run snapshot pulls the sheet into the committed fallback

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Docs

**Files:**
- Create: `docs/deploy.md` (from `docs/scoring-deploy.md`)
- Delete: `docs/scoring-deploy.md`
- Modify: `README.md`

- [ ] **Step 1: Move and rewrite the guide**

```bash
git mv docs/scoring-deploy.md docs/deploy.md
```

Rewrite `docs/deploy.md` with these sections (keep the existing text where it still applies — 1b, 1d, 4, and the score-related rows of 5 are unchanged):

```markdown
# Deployment guide — Sheet, script and site

The site reads its schedule from a Google Sheet and writes judges' scores
to it. This guide is everything the organiser does, in order. Budget 30
minutes the first time, 15 minutes in later years.

## 1. One-time setup

### 1a. Create the Sheet
(as before)

### 1b. Add the script
(as before)

### 1c. Create the tabs
1. Function dropdown → `setup` → **Run**; authorise as before.
2. You now have `Settings`, `Events`, `Heats`, `Slots`, `Log`, `Results`,
   `Overall`. Delete `Sheet1`.

### 1d. Deploy the web app
(as before — *Execute as Me · Anyone*)

### 1e. Point the site at it
Paste the `/exec` URL into `src/data/sheet-endpoint.ts`:
    export const sheetEndpoint = "https://script.google.com/macros/s/AKfyc.../exec";
`npm test && npm run build`, commit, push.

### 1f. Smoke test
    curl -sL 'https://script.google.com/macros/s/AKfyc.../exec'
Expected: `{"ok":true,"schedule":{"compDate":...`. Then the score POST as
before (unchanged curl; expected `{"ok":true}` then `duplicate: true`;
delete the rows from `Log` afterwards).

## 2. Each year: define the comp in the Sheet

1. **Settings**: `compDate`, `timeZone`, `teamSize` (1 for an individual
   comp), `divisions` (comma-separated, in the order you want them
   listed), leave `signupsOpen` unchecked for now.
2. **Events**: one row per event. `scoring` is `time-or-rounds` (needs
   `capSeconds`) or `rounds-reps` (leave `capSeconds` blank). `lanes` is
   how many lanes every heat of that event has.
3. **Heats**: one row per heat, `start`/`end` as `08:00` text.
4. Run `setup()` again so `Overall` gets one column per event.
5. Check the site: open it, and if a red-amber pill says "Sheet has a
   problem: …", fix the named row.
6. **Slots**: filled by sign-up (Plan B) or by hand — one row per claimed
   lane: `event`, `heat`, `lane`, `team`, `athletes`, `division`
   (`email` and `signedUpAt` optional).
7. Clear last year's `Log` rows (or start a fresh Sheet and repeat
   section 1 — a new deployment means a new URL in `sheet-endpoint.ts`).
8. `npm run judge-links` prints every judge URL for the lanes the
   snapshot uses plus the head link; codes are stable year to year.
9. Update the date in `README.md` and `index.html`'s description.

**The night before:** `npm run snapshot`, `npm test`, commit, push. The
snapshot is what a phone shows if it cannot reach Google and has never
loaded the site before.

## 3. Comp day
(as before, plus:)
- An amber pill at the top of the spectator page means that phone is
  showing its last-known schedule. Reload once Wi-Fi is back.
- A change to `Slots` shows on spectator phones within a minute. Judge
  phones read the schedule when the page is opened — reload to pick up a
  change.

## 4. Changing the script later
(as before)

## 5. Troubleshooting
(existing rows, replacing "Scoring not configured" cause with
`sheetEndpoint` is empty, plus:)

| Symptom | Cause | Fix |
|---|---|---|
| Amber "Offline — showing last known schedule" on every phone | Script not deployed as *Anyone*, or wrong URL | Section 1d; the curl in 1f |
| Amber "Sheet has a problem: Events: Event 2: scoring …" | A cell in the named tab/row | Fix the cell; phones update within a minute |
| Amber "Sheet has a problem: Run setup() …" | Tabs missing | Section 1c |
| `npm run snapshot` fails with "The Sheet has a problem" | Same as above | Fix the Sheet, rerun |
| Heat times show as `#####` or wrong | `start`/`end` cells auto-formatted as times | Type them as text (`'08:00`) or set the column format to Plain text |
| Judge page says "No team in lane N" for a lane that was just filled | Judge page loaded before the change | Reload the judge page |
| `Overall` has the wrong number of `E` columns | Events changed after `setup()` | Run `setup()` again |
```

- [ ] **Step 2: README**

In `README.md`, replace the "Editing the schedule" section (through "Known deviations…") with:

```markdown
## The schedule lives in the Sheet

Organisers define the comp in the Google Sheet — `Settings`, `Events`,
`Heats` and `Slots` tabs — and the site reads it through the Apps Script
endpoint on every load (re-checked every minute). Phones cache the last
good copy, and `src/data/schedule-snapshot.json` (refreshed with
`npm run snapshot`) is the fallback for a phone that has never loaded the
site. Everything the organiser does is in **[docs/deploy.md](docs/deploy.md)**.

A lane nobody has claimed shows as *— open —*. The 2026 snapshot keeps two
transcription corrections from the source PDFs: Event 1 Heat 2 lane 5 is
12th State Dumpys, and Jointly Unstable has no Event 3 lane.
```

Update the "Scoring" paragraph's link to `docs/deploy.md`, and in "Development" change the sentence about `judge-links` to:

```markdown
`npm run judge-links` regenerates `src/data/judge-codes.ts` (a fixed 6-event
× 12-lane grid plus head and sign-up codes; existing codes are kept) and
prints the URLs the current snapshot uses. `npm run snapshot` pulls the
Sheet into `src/data/schedule-snapshot.json`.
```

- [ ] **Step 3: Commit**

```bash
git add -A docs README.md
git commit -m "docs: deploy guide covers the Sheet-defined schedule and snapshot

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Final verification

- [ ] **Step 1: Full pipeline**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all clean; `dist/` builds.

- [ ] **Step 2: Deployed check**

Push `main`, wait for GitHub Actions, open https://mikesholar.github.io/12th-state-heats/ on a phone: no pill, schedule matches the Sheet. Turn on airplane mode and reload: amber "Offline" pill, schedule still shown. Open a judge link: works as before.

- [ ] **Step 3: Capture learnings**

If anything surprised you (Sheets coercing `08:00` to a Date, Apps Script's `getValues` shapes, a jsdom quirk), add a "Gotchas" bullet to `README.md` in the same style as the existing ones, and commit.
