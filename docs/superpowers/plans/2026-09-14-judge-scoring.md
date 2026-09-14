# Judge Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per event×lane judge links on the existing static site that accept a score for the heat on the floor and append it to a Google Sheet, plus a hidden QR assignment page and a deploy guide.

**Architecture:** `main.ts` becomes a tiny router on `?j=<code>`. New pure logic in `src/core/` (score validation, heat auto-pick, code lookup, submission record) takes explicit `now`/inputs and never touches the clock, storage or network. `src/ui/` holds localStorage stores, a fetch-injected score client, a retry queue, and two new renderers. The backend is a ~60-line Apps Script `doPost` appending to a `Log` tab; ranking is sheet formulas created by `setup()`.

**Tech Stack:** TypeScript strict, Vite, Vitest + @testing-library/dom, `qrcode` (SVG), `tsx` for the code-generation script, Google Apps Script.

**Spec:** `docs/superpowers/specs/2026-09-14-judge-scoring-design.md`

**Conventions (read before starting):**
- Every test uses factories from `src/test/factories.ts` — no `let`/`beforeEach` state. `at("08:03")` gives a comp-day instant in Eastern.
- Test files sit beside the code (`foo.ts` / `foo.test.ts`), `describe` names describe behaviour, `it` names are sentences.
- No comments in code. No `any`. No type assertions. `readonly` on all type fields. Options objects for multi-param functions.
- Run `npm test`, `npm run typecheck`, `npm run lint` before every commit. All three must be clean.
- Commit messages end with the attribution lines already used in this repo's history (`git log -1 --format=%B` to see them).

---

## File map

| Path | Responsibility |
|---|---|
| `src/core/types.ts` | add `ScoringFormat`, `scoring`, `capSeconds` to `Event` |
| `src/core/validate-schedule.ts` | new rule: `capSeconds` iff `time-or-rounds` |
| `src/core/score.ts` | `Score`, `validateScore`, `formatScore` |
| `src/core/judge-codes.ts` | `JudgeAssignment`, `resolveJudgeCode` |
| `src/core/resolve-judge-heat.ts` | which heat a judge should be looking at |
| `src/core/submission.ts` | `Submission`, `buildSubmission` |
| `src/data/schedule.ts` | scoring config on the three events |
| `src/data/judge-codes.ts` | generated code table |
| `src/data/scoring-endpoint.ts` | deployed Apps Script URL |
| `src/ui/judge-store.ts` | name, sent marks, queue in localStorage |
| `src/ui/score-client.ts` | `postScore` with injected fetch |
| `src/ui/submit-queue.ts` | `enqueue`, `flush` |
| `src/ui/judge-route.ts` | read `?j=` from a search string |
| `src/ui/render-judge.ts` | judge page |
| `src/ui/render-head.ts` | QR assignment page |
| `src/ui/render-invalid.ts` | unknown-code page |
| `src/main.ts` | router |
| `src/styles.css` | judge/head page styles |
| `src/test/factories.ts` | `makeScore`, `makeSubmission` |
| `scripts/judge-links.ts` | generate codes + print URLs |
| `apps-script/Code.gs` | `doPost`, `setup` |
| `docs/scoring-deploy.md` | deployment guide |
| `README.md` | pointer to the guide |

---

### Task 1: Dependencies and tooling

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `eslint.config.js`

- [ ] **Step 1: Install packages**

```bash
npm install --save-dev qrcode @types/qrcode tsx
```

Expected: `package.json` devDependencies gain `qrcode`, `@types/qrcode`, `tsx`. (`qrcode` is used at runtime in the browser but bundled by Vite, so devDependency is fine — everything in this repo is.)

- [ ] **Step 2: Add the script entry**

In `package.json` `scripts`, add:

```json
"judge-links": "tsx scripts/judge-links.ts"
```

- [ ] **Step 3: Include `scripts/` in typecheck and lint**

`tsconfig.json` → `"include": ["src", "scripts", "vite.config.ts", "eslint.config.js"]`.

`eslint.config.js` already lints `**/*.{ts,tsx}` with node globals — no change needed there, but create the directory so tsc doesn't complain about an empty include: `mkdir -p scripts`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass (no new files yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: add qrcode and tsx; judge-links script entry"
```

---

### Task 2: Event scoring config

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/validate-schedule.ts`
- Modify: `src/data/schedule.ts`
- Modify: `src/test/factories.ts`
- Test: `src/core/validate-schedule.test.ts`

- [ ] **Step 1: Extend the types**

In `src/core/types.ts`, add before `Event`:

```ts
export type ScoringFormat = "time-or-rounds" | "rounds-reps";
```

and add to `Event`:

```ts
  readonly scoring: ScoringFormat;
  readonly capSeconds?: number;
```

- [ ] **Step 2: Update the factory**

In `src/test/factories.ts`, `makeEvent` default gains `scoring: "rounds-reps",` (no cap) so existing tests stay valid.

- [ ] **Step 3: Update the shipped schedule**

In `src/data/schedule.ts` add to each event object, after `format:`:

- Event 1: `scoring: "time-or-rounds", capSeconds: 480,`
- Event 2: `scoring: "rounds-reps",`
- Event 3: `scoring: "time-or-rounds", capSeconds: 720,`

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: pass — every `Event` literal now has `scoring`.

- [ ] **Step 5: Write the failing validation tests**

Append to `src/core/validate-schedule.test.ts` (check the existing `describe` and imports at the top of the file; add `makeEvent`/`makeSchedule` to the import from `../test/factories` if missing):

```ts
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

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/core/validate-schedule.test.ts`
Expected: first two FAIL (message not in array).

- [ ] **Step 7: Implement the rule**

In `src/core/validate-schedule.ts` add:

```ts
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
```

and add `...schedule.events.flatMap(scoringErrors),` as the last entry of the array returned by `validateSchedule`.

- [ ] **Step 8: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass. (`src/data/schedule.test.ts` still expects exactly the one Jointly Unstable error — confirms the shipped config is valid.)

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/core/validate-schedule.ts src/core/validate-schedule.test.ts src/data/schedule.ts src/test/factories.ts
git commit -m "feat: scoring format and time cap on events"
```

---

### Task 3: Score type, validation and formatting

**Files:**
- Create: `src/core/score.ts`
- Test: `src/core/score.test.ts`
- Modify: `src/test/factories.ts`

- [ ] **Step 1: Add a factory**

Append to `src/test/factories.ts`:

```ts
import type { Score } from "../core/score";

export const makeScore = (overrides?: Partial<Extract<Score, { kind: "rounds-reps" }>>): Score => ({
  kind: "rounds-reps",
  rounds: 4,
  reps: 7,
  ...overrides,
});
```

(Put the import at the top with the others.)

- [ ] **Step 2: Write the failing tests**

Create `src/core/score.test.ts`:

```ts
import { formatScore, validateScore, type Score } from "./score";
import { makeScore } from "../test/factories";

const time = (seconds: number): Score => ({ kind: "time", seconds });

describe("validating a score for a time-or-rounds event", () => {
  const capped = { scoring: "time-or-rounds", capSeconds: 480 } as const;

  it("accepts a finish time under the cap", () => {
    expect(validateScore({ ...capped, score: time(462) })).toEqual({ success: true, data: time(462) });
  });

  it("accepts a finish time exactly at the cap", () => {
    expect(validateScore({ ...capped, score: time(480) }).success).toBe(true);
  });

  it("rejects a finish time over the cap and points at Capped", () => {
    expect(validateScore({ ...capped, score: time(481) })).toEqual({
      success: false,
      error: "Time can't exceed the 8:00 cap — use Capped",
    });
  });

  it("rejects a zero time", () => {
    expect(validateScore({ ...capped, score: time(0) })).toEqual({ success: false, error: "Enter a time" });
  });

  it("accepts rounds and reps when capped", () => {
    expect(validateScore({ ...capped, score: makeScore({ rounds: 9, reps: 14 }) }).success).toBe(true);
  });

  it("rejects zero rounds and zero reps", () => {
    expect(validateScore({ ...capped, score: makeScore({ rounds: 0, reps: 0 }) })).toEqual({
      success: false,
      error: "Enter at least one rep",
    });
  });
});

describe("validating a score for a rounds-reps event", () => {
  const amrap = { scoring: "rounds-reps", capSeconds: undefined } as const;

  it("accepts rounds and reps", () => {
    expect(validateScore({ ...amrap, score: makeScore({ rounds: 0, reps: 3 }) }).success).toBe(true);
  });

  it("rejects a time", () => {
    expect(validateScore({ ...amrap, score: time(300) })).toEqual({
      success: false,
      error: "This event is scored in rounds and reps",
    });
  });

  it("rejects negative reps", () => {
    expect(validateScore({ ...amrap, score: makeScore({ reps: -1 }) })).toEqual({
      success: false,
      error: "Rounds and reps can't be negative",
    });
  });

  it("rejects fractional rounds", () => {
    expect(validateScore({ ...amrap, score: makeScore({ rounds: 1.5 }) })).toEqual({
      success: false,
      error: "Rounds and reps must be whole numbers",
    });
  });
});

describe("formatting a score", () => {
  it("shows a time as m:ss", () => {
    expect(formatScore(time(462))).toBe("7:42");
  });

  it("pads seconds", () => {
    expect(formatScore(time(605))).toBe("10:05");
  });

  it("shows rounds plus reps", () => {
    expect(formatScore(makeScore({ rounds: 9, reps: 14 }))).toBe("9 + 14");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/core/score.test.ts`
Expected: FAIL — cannot resolve `./score`.

- [ ] **Step 4: Implement**

Create `src/core/score.ts`:

```ts
import type { ScoringFormat } from "./types";

export type Score =
  | { readonly kind: "time"; readonly seconds: number }
  | { readonly kind: "rounds-reps"; readonly rounds: number; readonly reps: number };

export type ScoreKind = Score["kind"];

export type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string };

type ValidateScoreOptions = {
  readonly scoring: ScoringFormat;
  readonly capSeconds: number | undefined;
  readonly score: Score;
};

const SECONDS_PER_MINUTE = 60;

const fail = (error: string): Result<Score> => ({ success: false, error });
const ok = (score: Score): Result<Score> => ({ success: true, data: score });

const formatSeconds = (seconds: number): string => {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const remainder = seconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
};

const validateTime = (seconds: number, capSeconds: number | undefined): Result<Score> => {
  if (!Number.isInteger(seconds)) return fail("Time must be whole seconds");
  if (seconds <= 0) return fail("Enter a time");
  if (capSeconds !== undefined && seconds > capSeconds) {
    return fail(`Time can't exceed the ${formatSeconds(capSeconds)} cap — use Capped`);
  }
  return ok({ kind: "time", seconds });
};

const validateRoundsReps = (rounds: number, reps: number): Result<Score> => {
  if (!Number.isInteger(rounds) || !Number.isInteger(reps)) return fail("Rounds and reps must be whole numbers");
  if (rounds < 0 || reps < 0) return fail("Rounds and reps can't be negative");
  if (rounds === 0 && reps === 0) return fail("Enter at least one rep");
  return ok({ kind: "rounds-reps", rounds, reps });
};

export const validateScore = ({ scoring, capSeconds, score }: ValidateScoreOptions): Result<Score> => {
  if (score.kind === "time") {
    if (scoring === "rounds-reps") return fail("This event is scored in rounds and reps");
    return validateTime(score.seconds, capSeconds);
  }
  return validateRoundsReps(score.rounds, score.reps);
};

export const formatScore = (score: Score): string =>
  score.kind === "time" ? formatSeconds(score.seconds) : `${score.rounds} + ${score.reps}`;
```

- [ ] **Step 5: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/score.ts src/core/score.test.ts src/test/factories.ts
git commit -m "feat: score validation and formatting"
```

---

### Task 4: Judge code table, lookup, and generator script

**Files:**
- Create: `src/core/judge-codes.ts`
- Create: `src/data/judge-codes.ts` (generated)
- Create: `scripts/judge-links.ts`
- Test: `src/core/judge-codes.test.ts`
- Modify: `src/data/schedule.test.ts`

- [ ] **Step 1: Write the failing lookup tests**

Create `src/core/judge-codes.test.ts`:

```ts
import { resolveJudgeCode, type JudgeCodeTable } from "./judge-codes";

const table: JudgeCodeTable = {
  k8v2n: { kind: "lane", event: 2, lane: 5 },
  hq7xm: { kind: "head" },
};

describe("resolving a judge code", () => {
  it("finds a lane assignment", () => {
    expect(resolveJudgeCode({ table, code: "k8v2n" })).toEqual({ kind: "lane", event: 2, lane: 5 });
  });

  it("finds the head judge", () => {
    expect(resolveJudgeCode({ table, code: "hq7xm" })).toEqual({ kind: "head" });
  });

  it("reports an unknown code", () => {
    expect(resolveJudgeCode({ table, code: "nope1" })).toEqual({ kind: "unknown" });
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(resolveJudgeCode({ table, code: " K8V2N " })).toEqual({ kind: "lane", event: 2, lane: 5 });
  });

  it("treats a missing code as unknown", () => {
    expect(resolveJudgeCode({ table, code: undefined })).toEqual({ kind: "unknown" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/judge-codes.test.ts`
Expected: FAIL — cannot resolve `./judge-codes`.

- [ ] **Step 3: Implement the lookup**

Create `src/core/judge-codes.ts`:

```ts
export type JudgeAssignment =
  | { readonly kind: "lane"; readonly event: number; readonly lane: number }
  | { readonly kind: "head" };

export type JudgeCodeTable = Readonly<Record<string, JudgeAssignment>>;

export type JudgeResolution = JudgeAssignment | { readonly kind: "unknown" };

type ResolveJudgeCodeOptions = {
  readonly table: JudgeCodeTable;
  readonly code: string | undefined;
};

export const resolveJudgeCode = ({ table, code }: ResolveJudgeCodeOptions): JudgeResolution => {
  const normalised = code?.trim().toLowerCase();
  if (!normalised) return { kind: "unknown" };
  return table[normalised] ?? { kind: "unknown" };
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/core/judge-codes.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the generator script**

Create `scripts/judge-links.ts`:

```ts
import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { JudgeAssignment } from "../src/core/judge-codes";
import { schedule } from "../src/data/schedule";

const OUTPUT = "src/data/judge-codes.ts";
const SITE = "https://mikesholar.github.io/12th-state-heats/";
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 5;
const regenerate = process.argv.includes("--regenerate");

type Entry = { readonly code: string; readonly assignment: JudgeAssignment };

const assignmentKey = (a: JudgeAssignment): string => (a.kind === "head" ? "head" : `e${a.event}l${a.lane}`);

const randomCode = (): string =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const neededAssignments = (): readonly JudgeAssignment[] => [
  ...schedule.events.flatMap((event) =>
    [...new Set(event.heats.flatMap((heat) => heat.lanes.map((lane) => lane.lane)))]
      .sort((a, b) => a - b)
      .map((lane): JudgeAssignment => ({ kind: "lane", event: event.number, lane })),
  ),
  { kind: "head" },
];

const existingEntries = (): readonly Entry[] => {
  if (regenerate) return [];
  const source = (() => {
    try {
      return readFileSync(OUTPUT, "utf8");
    } catch {
      return "";
    }
  })();
  const lanePattern = /(\w{5}): \{ kind: "lane", event: (\d+), lane: (\d+) \}/g;
  const headPattern = /(\w{5}): \{ kind: "head" \}/;
  const lanes = [...source.matchAll(lanePattern)].map(
    ([, code = "", event = "0", lane = "0"]): Entry => ({
      code,
      assignment: { kind: "lane", event: Number(event), lane: Number(lane) },
    }),
  );
  const head = headPattern.exec(source);
  return head?.[1] ? [...lanes, { code: head[1], assignment: { kind: "head" } }] : lanes;
};

const withCodes = (assignments: readonly JudgeAssignment[], existing: readonly Entry[]): readonly Entry[] =>
  assignments.reduce<readonly Entry[]>((entries, assignment) => {
    const kept = existing.find((e) => assignmentKey(e.assignment) === assignmentKey(assignment));
    const taken = new Set(entries.map((e) => e.code));
    const fresh = (): string => {
      const candidate = randomCode();
      return taken.has(candidate) ? fresh() : candidate;
    };
    return [...entries, kept ?? { code: fresh(), assignment }];
  }, []);

const entryLine = ({ code, assignment }: Entry): string =>
  assignment.kind === "head"
    ? `  ${code}: { kind: "head" },`
    : `  ${code}: { kind: "lane", event: ${assignment.event}, lane: ${assignment.lane} },`;

const fileSource = (entries: readonly Entry[]): string =>
  [
    `import type { JudgeCodeTable } from "../core/judge-codes";`,
    ``,
    `export const judgeCodes: JudgeCodeTable = {`,
    ...entries.map(entryLine),
    `};`,
    ``,
  ].join("\n");

const linkLine = ({ code, assignment }: Entry): string =>
  assignment.kind === "head"
    ? `HEAD JUDGE            ${SITE}?j=${code}`
    : `Event ${assignment.event}  Lane ${assignment.lane}       ${SITE}?j=${code}`;

const entries = withCodes(neededAssignments(), existingEntries());
writeFileSync(OUTPUT, fileSource(entries));
console.log(entries.map(linkLine).join("\n"));
console.log(`\nWrote ${entries.length} codes to ${OUTPUT}`);
```

- [ ] **Step 6: Generate the table**

Run: `npm run judge-links`
Expected: prints 25 lines (Event 1 Lane 1 … Event 3 Lane 8, HEAD JUDGE) and `Wrote 25 codes to src/data/judge-codes.ts`. Inspect `src/data/judge-codes.ts`: it should look like

```ts
import type { JudgeCodeTable } from "../core/judge-codes";

export const judgeCodes: JudgeCodeTable = {
  xxxxx: { kind: "lane", event: 1, lane: 1 },
  ...
  xxxxx: { kind: "head" },
};
```

Run it a second time and confirm the file is unchanged (`git diff --stat` after the first run has it; run again, `git status` shows no new change).

- [ ] **Step 7: Write the failing data test**

Append to `src/data/schedule.test.ts` (add `import { judgeCodes } from "./judge-codes";` at the top):

```ts
describe("the shipped judge codes", () => {
  const laneAssignments = Object.values(judgeCodes).filter((a) => a.kind === "lane");

  it("cover every event and lane in the schedule exactly once", () => {
    const expected = schedule.events.flatMap((event) =>
      [...new Set(event.heats.flatMap((h) => h.lanes.map((l) => l.lane)))].map((lane) => `e${event.number}l${lane}`),
    );
    const actual = laneAssignments.map((a) => (a.kind === "lane" ? `e${a.event}l${a.lane}` : ""));

    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it("have exactly one head judge code", () => {
    expect(Object.values(judgeCodes).filter((a) => a.kind === "head")).toHaveLength(1);
  });

  it("are five lowercase alphanumerics", () => {
    Object.keys(judgeCodes).forEach((code) => expect(code).toMatch(/^[a-z0-9]{5}$/));
  });
});
```

- [ ] **Step 8: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass (24 lane codes + 1 head).

- [ ] **Step 9: Commit**

```bash
git add src/core/judge-codes.ts src/core/judge-codes.test.ts src/data/judge-codes.ts src/data/schedule.test.ts scripts/judge-links.ts
git commit -m "feat: judge code table, lookup and link generator"
```

---

### Task 5: Heat auto-selection for a judge

**Files:**
- Create: `src/core/resolve-judge-heat.ts`
- Test: `src/core/resolve-judge-heat.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/core/resolve-judge-heat.test.ts`:

```ts
import { resolveJudgeHeat } from "./resolve-judge-heat";
import { at, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

const event = makeEvent({
  number: 2,
  heats: [
    makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 5, team: "Rays of Glory" })] }),
    makeHeat({ number: 2, start: "09:25", end: "09:35", lanes: [makeLane({ lane: 4, team: "Browne" })] }),
    makeHeat({ number: 3, start: "09:40", end: "09:50", lanes: [makeLane({ lane: 5, team: "C&C" })] }),
  ],
});
const schedule = makeSchedule({ events: [event] });

const resolve = (now: Date, manual?: { heat: number; at: Date }) =>
  resolveJudgeHeat({ schedule, event, lane: 5, now, manual });

describe("choosing which heat a lane judge should be looking at", () => {
  it("picks the first heat before the event starts", () => {
    expect(resolve(at("08:00")).heat.number).toBe(1);
  });

  it("picks the heat on the floor", () => {
    expect(resolve(at("09:27")).heat.number).toBe(2);
  });

  it("picks the next heat during the gap between heats", () => {
    expect(resolve(at("09:22")).heat.number).toBe(2);
  });

  it("stays on the last heat after the event is over", () => {
    expect(resolve(at("10:30")).heat.number).toBe(3);
  });

  it("gives the team in the judge's lane", () => {
    expect(resolve(at("09:12")).lane?.team).toBe("Rays of Glory");
  });

  it("reports an empty lane", () => {
    expect(resolve(at("09:27")).lane).toBeUndefined();
  });

  it("honours a manual pick made in the last ten minutes", () => {
    expect(resolve(at("09:42"), { heat: 1, at: at("09:35") }).heat.number).toBe(1);
  });

  it("drops a manual pick older than ten minutes", () => {
    expect(resolve(at("09:46"), { heat: 1, at: at("09:35") }).heat.number).toBe(3);
  });

  it("ignores a manual pick for a heat that does not exist", () => {
    expect(resolve(at("09:42"), { heat: 9, at: at("09:41") }).heat.number).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/resolve-judge-heat.test.ts`
Expected: FAIL — cannot resolve `./resolve-judge-heat`.

- [ ] **Step 3: Implement**

Create `src/core/resolve-judge-heat.ts`:

```ts
import { heatInstants } from "./comp-time";
import type { Event, Heat, Lane, Schedule } from "./types";

export type ManualPick = { readonly heat: number; readonly at: Date };

export type JudgeHeat = {
  readonly heat: Heat;
  readonly index: number;
  readonly lane: Lane | undefined;
};

type ResolveJudgeHeatOptions = {
  readonly schedule: Schedule;
  readonly event: Event;
  readonly lane: number;
  readonly now: Date;
  readonly manual: ManualPick | undefined;
};

const MANUAL_PICK_TTL_MS = 10 * 60_000;

const manualStillFresh = (manual: ManualPick | undefined, now: Date): manual is ManualPick =>
  manual !== undefined && now.getTime() - manual.at.getTime() < MANUAL_PICK_TTL_MS;

const autoHeat = (schedule: Schedule, event: Event, now: Date): Heat | undefined => {
  const timed = event.heats.map((heat) => ({ heat, ...heatInstants(schedule, heat) }));
  const running = timed.find(({ start, end }) => start <= now && now < end);
  const next = timed.find(({ start }) => start > now);
  return (running ?? next)?.heat ?? event.heats.at(-1);
};

export const resolveJudgeHeat = ({ schedule, event, lane, now, manual }: ResolveJudgeHeatOptions): JudgeHeat => {
  const manualHeat = manualStillFresh(manual, now) ? event.heats.find((h) => h.number === manual.heat) : undefined;
  const heat = manualHeat ?? autoHeat(schedule, event, now);
  if (!heat) throw new Error(`Event ${event.number} has no heats`);
  return {
    heat,
    index: event.heats.indexOf(heat),
    lane: heat.lanes.find((l) => l.lane === lane),
  };
};
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/resolve-judge-heat.ts src/core/resolve-judge-heat.test.ts
git commit -m "feat: resolve which heat a lane judge should score"
```

---

### Task 6: Submission record

**Files:**
- Create: `src/core/submission.ts`
- Test: `src/core/submission.test.ts`
- Modify: `src/test/factories.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/submission.test.ts`:

```ts
import { buildSubmission } from "./submission";
import { at, makeEvent, makeHeat, makeLane, makeScore } from "../test/factories";

describe("building a submission record", () => {
  const base = {
    judge: "Kim",
    event: makeEvent({ number: 2 }),
    heat: makeHeat({ number: 3 }),
    lane: makeLane({ lane: 5, team: "Rays of Glory", division: "F/M Scaled" }),
    now: at("09:45"),
    clientId: "abc-123",
  };

  it("flattens a rounds-reps score with blank seconds", () => {
    expect(buildSubmission({ ...base, score: makeScore({ rounds: 4, reps: 7 }) })).toEqual({
      clientId: "abc-123",
      submittedAt: "2026-09-12T13:45:00.000Z",
      judge: "Kim",
      event: 2,
      heat: 3,
      lane: 5,
      team: "Rays of Glory",
      division: "F/M Scaled",
      scoreKind: "rounds-reps",
      seconds: "",
      rounds: 4,
      reps: 7,
    });
  });

  it("flattens a time score with blank rounds and reps", () => {
    const record = buildSubmission({ ...base, score: { kind: "time", seconds: 462 } });

    expect(record.scoreKind).toBe("time");
    expect(record.seconds).toBe(462);
    expect(record.rounds).toBe("");
    expect(record.reps).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/submission.test.ts`
Expected: FAIL — cannot resolve `./submission`.

- [ ] **Step 3: Implement**

Create `src/core/submission.ts`:

```ts
import type { Score, ScoreKind } from "./score";
import type { Event, Heat, Lane } from "./types";

export type Submission = {
  readonly clientId: string;
  readonly submittedAt: string;
  readonly judge: string;
  readonly event: number;
  readonly heat: number;
  readonly lane: number;
  readonly team: string;
  readonly division: string;
  readonly scoreKind: ScoreKind;
  readonly seconds: number | "";
  readonly rounds: number | "";
  readonly reps: number | "";
};

type BuildSubmissionOptions = {
  readonly judge: string;
  readonly event: Event;
  readonly heat: Heat;
  readonly lane: Lane;
  readonly score: Score;
  readonly now: Date;
  readonly clientId: string;
};

export const buildSubmission = ({ judge, event, heat, lane, score, now, clientId }: BuildSubmissionOptions): Submission => ({
  clientId,
  submittedAt: now.toISOString(),
  judge,
  event: event.number,
  heat: heat.number,
  lane: lane.lane,
  team: lane.team,
  division: lane.division,
  scoreKind: score.kind,
  seconds: score.kind === "time" ? score.seconds : "",
  rounds: score.kind === "rounds-reps" ? score.rounds : "",
  reps: score.kind === "rounds-reps" ? score.reps : "",
});
```

- [ ] **Step 4: Add a factory**

Append to `src/test/factories.ts` (import `Submission` type from `../core/submission` at the top):

```ts
export const makeSubmission = (overrides?: Partial<Submission>): Submission => ({
  clientId: "sub-1",
  submittedAt: "2026-09-12T13:45:00.000Z",
  judge: "Kim",
  event: 2,
  heat: 3,
  lane: 5,
  team: "Rays of Glory",
  division: "F/M Scaled",
  scoreKind: "rounds-reps",
  seconds: "",
  rounds: 4,
  reps: 7,
  ...overrides,
});
```

- [ ] **Step 5: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/submission.ts src/core/submission.test.ts src/test/factories.ts
git commit -m "feat: build the submission record sent to the sheet"
```

---

### Task 7: Judge store (name, sent marks, queue)

**Files:**
- Create: `src/ui/judge-store.ts`
- Test: `src/ui/judge-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/judge-store.test.ts`:

```ts
import { loadJudgeName, saveJudgeName, loadSentHeats, markHeatSent, loadQueue, saveQueue } from "./judge-store";
import { makeSubmission } from "../test/factories";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("remembering the judge's name", () => {
  it("has no name until one is saved", () => {
    expect(loadJudgeName()).toBeUndefined();
  });

  it("returns the saved name", () => {
    saveJudgeName("Kim");
    expect(loadJudgeName()).toBe("Kim");
  });

  it("forgets the name when cleared", () => {
    saveJudgeName("Kim");
    saveJudgeName(undefined);
    expect(loadJudgeName()).toBeUndefined();
  });
});

describe("remembering which heats were sent from this phone", () => {
  it("starts empty for an event and lane", () => {
    expect(loadSentHeats({ event: 2, lane: 5 })).toEqual([]);
  });

  it("records heats per event and lane without duplicates", () => {
    markHeatSent({ event: 2, lane: 5, heat: 3 });
    markHeatSent({ event: 2, lane: 5, heat: 1 });
    markHeatSent({ event: 2, lane: 5, heat: 3 });

    expect(loadSentHeats({ event: 2, lane: 5 })).toEqual([1, 3]);
    expect(loadSentHeats({ event: 2, lane: 4 })).toEqual([]);
  });
});

describe("the pending submission queue", () => {
  it("starts empty", () => {
    expect(loadQueue()).toEqual([]);
  });

  it("round-trips submissions in order", () => {
    const a = makeSubmission({ clientId: "a" });
    const b = makeSubmission({ clientId: "b" });
    saveQueue([a, b]);

    expect(loadQueue()).toEqual([a, b]);
  });

  it("treats corrupt storage as empty", () => {
    localStorage.setItem("judge:queue", "{not json");

    expect(loadQueue()).toEqual([]);
  });
});

describe("when storage is unavailable", () => {
  it("degrades silently", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => saveJudgeName("Kim")).not.toThrow();
    expect(() => markHeatSent({ event: 1, lane: 1, heat: 1 })).not.toThrow();
    expect(() => saveQueue([makeSubmission()])).not.toThrow();
    expect(loadJudgeName()).toBeUndefined();
    expect(loadSentHeats({ event: 1, lane: 1 })).toEqual([]);
    expect(loadQueue()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/judge-store.test.ts`
Expected: FAIL — cannot resolve `./judge-store`.

- [ ] **Step 3: Implement**

Create `src/ui/judge-store.ts`:

```ts
import type { Submission } from "../core/submission";

const NAME_KEY = "judge:name";
const QUEUE_KEY = "judge:queue";

type LaneKey = { readonly event: number; readonly lane: number };

const sentKey = ({ event, lane }: LaneKey): string => `judge:sent:${event}:${lane}`;

const readRaw = (key: string): string | undefined => {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

const writeRaw = (key: string, value: string | undefined): void => {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
};

const readJson = <T>(key: string, isValid: (value: unknown) => value is T): T | undefined => {
  const raw = readRaw(key);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const isNumberArray = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every((item) => typeof item === "number");

const isSubmissionArray = (value: unknown): value is readonly Submission[] =>
  Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && "clientId" in item);

export const loadJudgeName = (): string | undefined => readRaw(NAME_KEY);

export const saveJudgeName = (name: string | undefined): void => writeRaw(NAME_KEY, name);

export const loadSentHeats = (key: LaneKey): readonly number[] => readJson(sentKey(key), isNumberArray) ?? [];

export const markHeatSent = ({ event, lane, heat }: LaneKey & { readonly heat: number }): void => {
  const current = loadSentHeats({ event, lane });
  const next = current.includes(heat) ? current : [...current, heat].sort((a, b) => a - b);
  writeRaw(sentKey({ event, lane }), JSON.stringify(next));
};

export const loadQueue = (): readonly Submission[] => readJson(QUEUE_KEY, isSubmissionArray) ?? [];

export const saveQueue = (queue: readonly Submission[]): void => writeRaw(QUEUE_KEY, JSON.stringify(queue));
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/judge-store.ts src/ui/judge-store.test.ts
git commit -m "feat: judge name, sent marks and pending queue storage"
```

---

### Task 8: Score client

**Files:**
- Create: `src/ui/score-client.ts`
- Test: `src/ui/score-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/score-client.test.ts`:

```ts
import { postScore } from "./score-client";
import { makeSubmission } from "../test/factories";

const ENDPOINT = "https://script.google.com/macros/s/abc/exec";

const fetchReplying = (status: number, body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("posting a score to the sheet", () => {
  it("sends the submission as a JSON body with no content-type header", async () => {
    const fetchFn = fetchReplying(200, { ok: true });
    const submission = makeSubmission();

    await postScore({ endpoint: ENDPOINT, submission, fetchFn });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual(submission);
  });

  it("reports acceptance", async () => {
    const result = await postScore({ endpoint: ENDPOINT, submission: makeSubmission(), fetchFn: fetchReplying(200, { ok: true }) });

    expect(result).toEqual({ kind: "accepted" });
  });

  it("treats a duplicate as accepted", async () => {
    const result = await postScore({
      endpoint: ENDPOINT,
      submission: makeSubmission(),
      fetchFn: fetchReplying(200, { ok: true, duplicate: true }),
    });

    expect(result).toEqual({ kind: "accepted" });
  });

  it("reports a server rejection with its message", async () => {
    const result = await postScore({
      endpoint: ENDPOINT,
      submission: makeSubmission(),
      fetchFn: fetchReplying(200, { ok: false, error: "Unknown scoreKind" }),
    });

    expect(result).toEqual({ kind: "rejected", error: "Unknown scoreKind" });
  });

  it("reports a network failure when fetch throws", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await postScore({ endpoint: ENDPOINT, submission: makeSubmission(), fetchFn });

    expect(result).toEqual({ kind: "unreachable" });
  });

  it("reports a network failure on a non-2xx status", async () => {
    const result = await postScore({ endpoint: ENDPOINT, submission: makeSubmission(), fetchFn: fetchReplying(502, "bad gateway") });

    expect(result).toEqual({ kind: "unreachable" });
  });

  it("reports a network failure when the body is not the expected JSON", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>login</html>", { status: 200 }));

    const result = await postScore({ endpoint: ENDPOINT, submission: makeSubmission(), fetchFn });

    expect(result).toEqual({ kind: "unreachable" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/score-client.test.ts`
Expected: FAIL — cannot resolve `./score-client`.

- [ ] **Step 3: Implement**

Create `src/ui/score-client.ts`:

```ts
import type { Submission } from "../core/submission";

export type PostResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly error: string }
  | { readonly kind: "unreachable" };

type PostScoreOptions = {
  readonly endpoint: string;
  readonly submission: Submission;
  readonly fetchFn: typeof fetch;
};

const isReply = (value: unknown): value is { readonly ok: boolean; readonly error?: string } =>
  typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";

const readReply = async (response: Response): Promise<PostResult> => {
  if (!response.ok) return { kind: "unreachable" };
  const body: unknown = await response.json();
  if (!isReply(body)) return { kind: "unreachable" };
  return body.ok ? { kind: "accepted" } : { kind: "rejected", error: body.error ?? "Rejected by the sheet" };
};

export const postScore = async ({ endpoint, submission, fetchFn }: PostScoreOptions): Promise<PostResult> => {
  try {
    const response = await fetchFn(endpoint, { method: "POST", body: JSON.stringify(submission) });
    return await readReply(response);
  } catch {
    return { kind: "unreachable" };
  }
};
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/score-client.ts src/ui/score-client.test.ts
git commit -m "feat: post a score to the Apps Script endpoint"
```

---

### Task 9: Submit queue

**Files:**
- Create: `src/ui/submit-queue.ts`
- Test: `src/ui/submit-queue.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/submit-queue.test.ts`:

```ts
import { enqueue, flush } from "./submit-queue";
import { loadQueue } from "./judge-store";
import type { PostResult } from "./score-client";
import { makeSubmission } from "../test/factories";

afterEach(() => localStorage.clear());

const ENDPOINT = "https://script.google.com/macros/s/abc/exec";

const poster = (...results: readonly PostResult[]) => {
  const post = vi.fn<(submission: { clientId: string }) => Promise<PostResult>>();
  results.forEach((r) => post.mockResolvedValueOnce(r));
  return post;
};

describe("queueing and flushing submissions", () => {
  it("enqueue persists the record at the back of the queue", () => {
    enqueue(makeSubmission({ clientId: "a" }));
    enqueue(makeSubmission({ clientId: "b" }));

    expect(loadQueue().map((s) => s.clientId)).toEqual(["a", "b"]);
  });

  it("flush posts in order and empties the queue when everything is accepted", async () => {
    enqueue(makeSubmission({ clientId: "a" }));
    enqueue(makeSubmission({ clientId: "b" }));
    const post = poster({ kind: "accepted" }, { kind: "accepted" });

    const outcome = await flush({ endpoint: ENDPOINT, post });

    expect(post.mock.calls.map(([s]) => s.clientId)).toEqual(["a", "b"]);
    expect(loadQueue()).toEqual([]);
    expect(outcome).toEqual({ pending: 0, rejected: [] });
  });

  it("flush stops at the first unreachable and keeps the rest queued", async () => {
    enqueue(makeSubmission({ clientId: "a" }));
    enqueue(makeSubmission({ clientId: "b" }));
    enqueue(makeSubmission({ clientId: "c" }));
    const post = poster({ kind: "accepted" }, { kind: "unreachable" });

    const outcome = await flush({ endpoint: ENDPOINT, post });

    expect(post).toHaveBeenCalledTimes(2);
    expect(loadQueue().map((s) => s.clientId)).toEqual(["b", "c"]);
    expect(outcome).toEqual({ pending: 2, rejected: [] });
  });

  it("flush drops a rejected record, reports it, and continues", async () => {
    enqueue(makeSubmission({ clientId: "a" }));
    enqueue(makeSubmission({ clientId: "b" }));
    const post = poster({ kind: "rejected", error: "Unknown scoreKind" }, { kind: "accepted" });

    const outcome = await flush({ endpoint: ENDPOINT, post });

    expect(loadQueue()).toEqual([]);
    expect(outcome).toEqual({ pending: 0, rejected: [{ clientId: "a", error: "Unknown scoreKind" }] });
  });

  it("flush does nothing without an endpoint", async () => {
    enqueue(makeSubmission({ clientId: "a" }));
    const post = poster();

    const outcome = await flush({ endpoint: "", post });

    expect(post).not.toHaveBeenCalled();
    expect(outcome).toEqual({ pending: 1, rejected: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/submit-queue.test.ts`
Expected: FAIL — cannot resolve `./submit-queue`.

- [ ] **Step 3: Implement**

Create `src/ui/submit-queue.ts`:

```ts
import type { Submission } from "../core/submission";
import { loadQueue, saveQueue } from "./judge-store";
import { postScore, type PostResult } from "./score-client";

export type Rejection = { readonly clientId: string; readonly error: string };

export type FlushOutcome = { readonly pending: number; readonly rejected: readonly Rejection[] };

type Poster = (submission: Submission) => Promise<PostResult>;

type FlushOptions = {
  readonly endpoint: string;
  readonly post?: Poster;
};

export const enqueue = (submission: Submission): void => saveQueue([...loadQueue(), submission]);

const defaultPoster =
  (endpoint: string): Poster =>
  (submission) =>
    postScore({ endpoint, submission, fetchFn: fetch });

const drain = async (queue: readonly Submission[], post: Poster, rejected: readonly Rejection[]): Promise<FlushOutcome> => {
  const [head, ...rest] = queue;
  if (!head) {
    saveQueue([]);
    return { pending: 0, rejected };
  }
  const result = await post(head);
  if (result.kind === "unreachable") {
    saveQueue(queue);
    return { pending: queue.length, rejected };
  }
  const nextRejected = result.kind === "rejected" ? [...rejected, { clientId: head.clientId, error: result.error }] : rejected;
  saveQueue(rest);
  return drain(rest, post, nextRejected);
};

export const flush = async ({ endpoint, post }: FlushOptions): Promise<FlushOutcome> => {
  const queue = loadQueue();
  if (!endpoint) return { pending: queue.length, rejected: [] };
  return drain(queue, post ?? defaultPoster(endpoint), []);
};
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/submit-queue.ts src/ui/submit-queue.test.ts
git commit -m "feat: pending submission queue with ordered retry"
```

---

### Task 10: Route parsing, endpoint config, invalid-link page

**Files:**
- Create: `src/ui/judge-route.ts`
- Create: `src/data/scoring-endpoint.ts`
- Create: `src/ui/render-invalid.ts`
- Test: `src/ui/judge-route.test.ts`
- Test: `src/ui/render-invalid.test.ts`

- [ ] **Step 1: Write the failing route tests**

Create `src/ui/judge-route.test.ts`:

```ts
import { readJudgeCode } from "./judge-route";

describe("reading the judge code from the URL", () => {
  it("returns the j parameter", () => {
    expect(readJudgeCode("?j=k8v2n")).toBe("k8v2n");
  });

  it("returns nothing when there is no j parameter", () => {
    expect(readJudgeCode("?at=2026-09-12T08:30")).toBeUndefined();
  });

  it("returns nothing for an empty j", () => {
    expect(readJudgeCode("?j=")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/judge-route.test.ts`
Expected: FAIL — cannot resolve `./judge-route`.

- [ ] **Step 3: Implement**

Create `src/ui/judge-route.ts`:

```ts
export const readJudgeCode = (search: string): string | undefined => {
  const value = new URLSearchParams(search).get("j");
  return value ? value : undefined;
};
```

Create `src/data/scoring-endpoint.ts`:

```ts
export const scoringEndpoint = "";
```

- [ ] **Step 4: Write the failing invalid-page test**

Create `src/ui/render-invalid.test.ts`:

```ts
import { renderInvalid } from "./render-invalid";

describe("an unknown judge link", () => {
  it("tells the judge to get a new link from the head judge", () => {
    const root = document.createElement("div");

    renderInvalid({ root });

    expect(root.textContent).toContain("This link isn't valid");
    expect(root.textContent).toContain("head judge");
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/ui/render-invalid.test.ts`
Expected: FAIL — cannot resolve `./render-invalid`.

- [ ] **Step 6: Implement**

Create `src/ui/render-invalid.ts`:

```ts
type RenderInvalidOptions = { readonly root: HTMLElement };

export const renderInvalid = ({ root }: RenderInvalidOptions): void => {
  root.innerHTML = `
    <main class="main judge-invalid">
      <h1>This link isn't valid</h1>
      <p>Ask the head judge for a new one.</p>
    </main>`;
};
```

- [ ] **Step 7: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/ui/judge-route.ts src/ui/judge-route.test.ts src/data/scoring-endpoint.ts src/ui/render-invalid.ts src/ui/render-invalid.test.ts
git commit -m "feat: judge link routing, endpoint config, invalid-link page"
```

---

### Task 11: Judge page view — name gate and main layout

The view is a pure function of its options: it writes `root.innerHTML` and attaches listeners that call back out. It holds no state. The controller (Task 13) owns state and re-renders.

**Files:**
- Create: `src/ui/render-judge.ts`
- Test: `src/ui/render-judge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/render-judge.test.ts`:

```ts
import { fireEvent, getByLabelText, getByRole, getByTestId, getByText, queryByRole, queryByTestId } from "@testing-library/dom";
import { renderJudge, type RenderJudgeOptions } from "./render-judge";
import { at, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

const amrap = makeEvent({
  number: 2,
  title: "Extra Credit",
  scoring: "rounds-reps",
  heats: [
    makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 5, team: "Rays of Glory", athletes: "David + Shelby", division: "F/M Scaled" })] }),
    makeHeat({ number: 2, start: "09:25", end: "09:35", lanes: [makeLane({ lane: 4, team: "Browne" })] }),
  ],
});
const capped = makeEvent({
  number: 1,
  title: "12th Gear",
  scoring: "time-or-rounds",
  capSeconds: 480,
  heats: [makeHeat({ number: 1, start: "08:00", end: "08:08", lanes: [makeLane({ lane: 5, team: "Glizzy Gals" })] })],
});

const renderWith = (overrides?: Partial<RenderJudgeOptions>) => {
  const root = document.createElement("div");
  const options: RenderJudgeOptions = {
    root,
    schedule: makeSchedule({ events: [capped, amrap] }),
    event: amrap,
    lane: 5,
    now: at("09:12"),
    judgeName: "Kim",
    sentHeats: [],
    manual: undefined,
    draft: undefined,
    pending: 0,
    notice: undefined,
    endpointConfigured: true,
    onNameSubmit: vi.fn(),
    onNameClear: vi.fn(),
    onHeatChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  renderJudge(options);
  return { root, options };
};

describe("the name gate", () => {
  it("asks for a name when none is stored and shows nothing else", () => {
    const { root } = renderWith({ judgeName: undefined });

    expect(getByLabelText(root, "Your name")).toBeInTheDocument();
    expect(queryByTestId(root, "team-card")).toBeNull();
  });

  it("hands the trimmed name back on Continue", () => {
    const { root, options } = renderWith({ judgeName: undefined });

    fireEvent.input(getByLabelText(root, "Your name"), { target: { value: "  Kim " } });
    fireEvent.submit(getByTestId(root, "name-form"));

    expect(options.onNameSubmit).toHaveBeenCalledWith("Kim");
  });

  it("does not continue with a blank name", () => {
    const { root, options } = renderWith({ judgeName: undefined });

    fireEvent.submit(getByTestId(root, "name-form"));

    expect(options.onNameSubmit).not.toHaveBeenCalled();
  });

  it("offers to change the name from the footer", () => {
    const { root, options } = renderWith();

    fireEvent.click(getByText(root, "Not you? Change name"));

    expect(options.onNameClear).toHaveBeenCalled();
  });
});

describe("the header", () => {
  it("names the event, lane and judge", () => {
    const { root } = renderWith();

    const header = getByTestId(root, "judge-header").textContent ?? "";
    expect(header).toContain("Event 2");
    expect(header).toContain("Extra Credit");
    expect(header).toContain("Lane 5");
    expect(header).toContain("Kim");
  });

  it("shows a pending badge only while submissions are queued", () => {
    expect(queryByTestId(renderWith().root, "pending")).toBeNull();
    expect(getByTestId(renderWith({ pending: 2 }).root, "pending")).toHaveTextContent("2 pending");
  });

  it("warns when scoring is not configured", () => {
    const { root } = renderWith({ endpointConfigured: false });

    expect(root.textContent).toContain("Scoring not configured");
  });
});

describe("the heat selector", () => {
  it("shows the auto-selected heat and its position", () => {
    expect(getByTestId(renderWith().root, "heat-label")).toHaveTextContent("Heat 1 of 2");
  });

  it("moves to the next heat", () => {
    const { root, options } = renderWith();

    fireEvent.click(getByRole(root, "button", { name: "Next heat" }));

    expect(options.onHeatChange).toHaveBeenCalledWith(2);
  });

  it("disables previous on the first heat and next on the last", () => {
    expect(getByRole(renderWith().root, "button", { name: "Previous heat" })).toBeDisabled();
    expect(getByRole(renderWith({ manual: { heat: 2, at: at("09:12") } }).root, "button", { name: "Next heat" })).toBeDisabled();
  });

  it("ticks heats already sent from this phone", () => {
    const { root } = renderWith({ sentHeats: [1] });

    expect(getByTestId(root, "heat-label")).toHaveTextContent("✓");
  });
});

describe("the team card", () => {
  it("shows the team in the judge's lane for the selected heat", () => {
    const card = getByTestId(renderWith().root, "team-card").textContent ?? "";

    expect(card).toContain("Rays of Glory");
    expect(card).toContain("David + Shelby");
    expect(card).toContain("F/M Scaled");
  });

  it("says when the lane is empty and disables the form", () => {
    const { root } = renderWith({ manual: { heat: 2, at: at("09:12") } });

    expect(getByTestId(root, "team-card")).toHaveTextContent("No team in lane 5 for this heat");
    expect(queryByRole(root, "button", { name: "Submit score" })).toBeNull();
  });
});

describe("the score form", () => {
  it("shows rounds and reps for an AMRAP", () => {
    const { root } = renderWith();

    expect(getByLabelText(root, "Rounds")).toBeInTheDocument();
    expect(getByLabelText(root, "Reps")).toBeInTheDocument();
    expect(queryByRole(root, "button", { name: "Finished" })).toBeNull();
  });

  it("shows Finished and Capped for a time-capped event, starting on Finished with a time input", () => {
    const { root } = renderWith({ event: capped, now: at("08:02") });

    expect(getByRole(root, "button", { name: "Finished" })).toHaveAttribute("aria-pressed", "true");
    expect(getByLabelText(root, "Minutes")).toBeInTheDocument();
    expect(getByLabelText(root, "Seconds")).toBeInTheDocument();
  });

  it("shows rounds and reps when the draft is on Capped", () => {
    const { root } = renderWith({
      event: capped,
      now: at("08:02"),
      draft: { mode: "rounds-reps", minutes: "", seconds: "", rounds: "9", reps: "14" },
    });

    expect(getByRole(root, "button", { name: "Capped" })).toHaveAttribute("aria-pressed", "true");
    expect(getByLabelText(root, "Rounds")).toHaveValue(9);
    expect(getByLabelText(root, "Reps")).toHaveValue(14);
  });

  it("submits rounds and reps as a score", () => {
    const { root, options } = renderWith();

    fireEvent.input(getByLabelText(root, "Rounds"), { target: { value: "4" } });
    fireEvent.input(getByLabelText(root, "Reps"), { target: { value: "7" } });
    fireEvent.submit(getByTestId(root, "score-form"));

    expect(options.onSubmit).toHaveBeenCalledWith({ kind: "rounds-reps", rounds: 4, reps: 7 });
  });

  it("submits minutes and seconds as a time", () => {
    const { root, options } = renderWith({ event: capped, now: at("08:02") });

    fireEvent.input(getByLabelText(root, "Minutes"), { target: { value: "7" } });
    fireEvent.input(getByLabelText(root, "Seconds"), { target: { value: "42" } });
    fireEvent.submit(getByTestId(root, "score-form"));

    expect(options.onSubmit).toHaveBeenCalledWith({ kind: "time", seconds: 462 });
  });

  it("steppers adjust the value", () => {
    const { root } = renderWith({ draft: { mode: "rounds-reps", minutes: "", seconds: "", rounds: "4", reps: "7" } });

    fireEvent.click(getByRole(root, "button", { name: "More reps" }));
    fireEvent.click(getByRole(root, "button", { name: "Fewer rounds" }));

    expect(getByLabelText(root, "Reps")).toHaveValue(8);
    expect(getByLabelText(root, "Rounds")).toHaveValue(3);
  });

  it("labels the button Update score once this heat has been sent", () => {
    expect(getByRole(renderWith({ sentHeats: [1] }).root, "button", { name: "Update score" })).toBeInTheDocument();
  });
});

describe("notices", () => {
  it("shows a recorded banner", () => {
    const { root } = renderWith({ notice: { kind: "recorded", text: "Recorded ✓ — Rays of Glory: 4 + 7" } });

    expect(getByTestId(root, "notice")).toHaveTextContent("Recorded ✓ — Rays of Glory: 4 + 7");
    expect(getByTestId(root, "notice")).toHaveClass("recorded");
  });

  it("shows a retrying banner", () => {
    expect(getByTestId(renderWith({ notice: { kind: "retrying" } }).root, "notice")).toHaveTextContent("Saved on this phone — will retry");
  });

  it("shows an error banner", () => {
    expect(getByTestId(renderWith({ notice: { kind: "error", text: "Enter a time" } }).root, "notice")).toHaveClass("error");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/render-judge.test.ts`
Expected: FAIL — cannot resolve `./render-judge`.

- [ ] **Step 3: Implement the view**

Create `src/ui/render-judge.ts`:

```ts
import { resolveJudgeHeat, type ManualPick } from "../core/resolve-judge-heat";
import type { Score } from "../core/score";
import type { Event, Lane, Schedule } from "../core/types";

export type ScoreDraft = {
  readonly mode: Score["kind"];
  readonly minutes: string;
  readonly seconds: string;
  readonly rounds: string;
  readonly reps: string;
};

export type Notice =
  | { readonly kind: "recorded"; readonly text: string }
  | { readonly kind: "retrying" }
  | { readonly kind: "error"; readonly text: string };

export type RenderJudgeOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly event: Event;
  readonly lane: number;
  readonly now: Date;
  readonly judgeName: string | undefined;
  readonly sentHeats: readonly number[];
  readonly manual: ManualPick | undefined;
  readonly draft: ScoreDraft | undefined;
  readonly pending: number;
  readonly notice: Notice | undefined;
  readonly endpointConfigured: boolean;
  readonly onNameSubmit: (name: string) => void;
  readonly onNameClear: () => void;
  readonly onHeatChange: (heat: number) => void;
  readonly onSubmit: (score: Score) => void;
};

const SECONDS_PER_MINUTE = 60;

const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const emptyDraft = (event: Event): ScoreDraft => ({
  mode: event.scoring === "time-or-rounds" ? "time" : "rounds-reps",
  minutes: "",
  seconds: "",
  rounds: "",
  reps: "",
});

const nameGateHtml = (): string => `
  <main class="main judge-gate">
    <form id="name-form" data-testid="name-form" class="name-form">
      <label for="judge-name">Your name</label>
      <input id="judge-name" name="name" type="text" autocomplete="name" autofocus required />
      <button type="submit" class="primary">Continue</button>
    </form>
  </main>`;

const headerHtml = ({ event, lane, judgeName, pending, endpointConfigured }: RenderJudgeOptions): string => `
  <header class="header judge-header" data-testid="judge-header">
    <div class="header-row">
      <div>
        <div class="event-kicker">Event ${event.number} · ${esc(event.title)}</div>
        <h1 class="title judge-lane">Lane ${lane}</h1>
      </div>
      <div class="judge-meta">
        <div class="judge-name">${esc(judgeName ?? "")}</div>
        ${pending > 0 ? `<div class="pending" data-testid="pending">${pending} pending</div>` : ""}
      </div>
    </div>
    ${endpointConfigured ? "" : `<div class="config-warning">Scoring not configured — scores will stay on this phone</div>`}
  </header>`;

const heatSelectorHtml = (options: RenderJudgeOptions, index: number, sent: boolean): string => {
  const total = options.event.heats.length;
  return `
  <div class="heat-selector">
    <button type="button" id="prev-heat" aria-label="Previous heat" ${index === 0 ? "disabled" : ""}>◀</button>
    <div class="heat-label" data-testid="heat-label">Heat ${options.event.heats[index]?.number ?? ""} of ${total}${sent ? " ✓" : ""}</div>
    <button type="button" id="next-heat" aria-label="Next heat" ${index === total - 1 ? "disabled" : ""}>▶</button>
  </div>`;
};

const teamCardHtml = (lane: Lane | undefined, laneNumber: number): string =>
  lane
    ? `<section class="team-card" data-testid="team-card">
        <div class="team-card-name">${esc(lane.team)}</div>
        <div class="team-card-athletes">${esc(lane.athletes)}</div>
        <div class="team-card-division">${esc(lane.division)}</div>
      </section>`
    : `<section class="team-card empty" data-testid="team-card">No team in lane ${laneNumber} for this heat</section>`;

const stepperHtml = (id: string, label: string, value: string): string => `
  <div class="stepper">
    <label for="${id}">${label}</label>
    <div class="stepper-row">
      <button type="button" class="step" data-step="-1" data-target="${id}" aria-label="Fewer ${label.toLowerCase()}">−</button>
      <input id="${id}" name="${id}" type="number" inputmode="numeric" min="0" step="1" value="${esc(value)}" />
      <button type="button" class="step" data-step="1" data-target="${id}" aria-label="More ${label.toLowerCase()}">+</button>
    </div>
  </div>`;

const timeFieldsHtml = (draft: ScoreDraft): string => `
  <div class="time-fields">
    <div><label for="minutes">Minutes</label><input id="minutes" name="minutes" type="number" inputmode="numeric" min="0" step="1" value="${esc(draft.minutes)}" /></div>
    <span class="time-colon">:</span>
    <div><label for="seconds">Seconds</label><input id="seconds" name="seconds" type="number" inputmode="numeric" min="0" max="59" step="1" value="${esc(draft.seconds)}" /></div>
  </div>`;

const modeToggleHtml = (mode: Score["kind"]): string => `
  <div class="mode-toggle" role="group" aria-label="Result">
    <button type="button" class="mode" data-mode="time" aria-pressed="${mode === "time"}">Finished</button>
    <button type="button" class="mode" data-mode="rounds-reps" aria-pressed="${mode === "rounds-reps"}">Capped</button>
  </div>`;

const scoreFormHtml = (event: Event, draft: ScoreDraft, sent: boolean): string => {
  const fields =
    draft.mode === "time" ? timeFieldsHtml(draft) : stepperHtml("rounds", "Rounds", draft.rounds) + stepperHtml("reps", "Reps", draft.reps);
  return `
  <form id="score-form" data-testid="score-form" class="score-form">
    ${event.scoring === "time-or-rounds" ? modeToggleHtml(draft.mode) : ""}
    ${fields}
    <button type="submit" class="primary submit">${sent ? "Update score" : "Submit score"}</button>
  </form>`;
};

const noticeHtml = (notice: Notice | undefined): string => {
  if (!notice) return "";
  const text = notice.kind === "retrying" ? "Saved on this phone — will retry" : notice.text;
  return `<div class="notice ${notice.kind}" data-testid="notice">${esc(text)}</div>`;
};

const numberOr = (value: string, fallback: number): number => (value.trim() === "" ? fallback : Number(value));

export const readDraft = (root: HTMLElement, fallback: ScoreDraft): ScoreDraft => {
  const value = (id: string, current: string): string => root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? current;
  const pressed = root.querySelector<HTMLButtonElement>('.mode[aria-pressed="true"]')?.dataset.mode;
  return {
    mode: pressed === "time" || pressed === "rounds-reps" ? pressed : fallback.mode,
    minutes: value("minutes", fallback.minutes),
    seconds: value("seconds", fallback.seconds),
    rounds: value("rounds", fallback.rounds),
    reps: value("reps", fallback.reps),
  };
};

const scoreFromDraft = (draft: ScoreDraft): Score =>
  draft.mode === "time"
    ? { kind: "time", seconds: numberOr(draft.minutes, 0) * SECONDS_PER_MINUTE + numberOr(draft.seconds, 0) }
    : { kind: "rounds-reps", rounds: numberOr(draft.rounds, 0), reps: numberOr(draft.reps, 0) };

const wireNameGate = (root: HTMLElement, onNameSubmit: (name: string) => void): void => {
  root.querySelector("#name-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = root.querySelector<HTMLInputElement>("#judge-name")?.value.trim() ?? "";
    if (name) onNameSubmit(name);
  });
};

const wireMain = (options: RenderJudgeOptions, draft: ScoreDraft, heatNumbers: readonly number[], index: number): void => {
  const { root, onHeatChange, onSubmit, onNameClear } = options;
  root.querySelector("#prev-heat")?.addEventListener("click", () => onHeatChange(heatNumbers[index - 1] ?? heatNumbers[0] ?? 1));
  root.querySelector("#next-heat")?.addEventListener("click", () => onHeatChange(heatNumbers[index + 1] ?? heatNumbers.at(-1) ?? 1));
  root.querySelector("#change-name")?.addEventListener("click", (e) => {
    e.preventDefault();
    onNameClear();
  });
  root.querySelectorAll<HTMLButtonElement>(".mode").forEach((button) =>
    button.addEventListener("click", () => {
      const mode = button.dataset.mode === "time" ? "time" : "rounds-reps";
      renderJudge({ ...options, draft: { ...readDraft(root, draft), mode } });
    }),
  );
  root.querySelectorAll<HTMLButtonElement>(".step").forEach((button) =>
    button.addEventListener("click", () => {
      const input = root.querySelector<HTMLInputElement>(`#${button.dataset.target ?? ""}`);
      if (!input) return;
      input.value = String(Math.max(0, numberOr(input.value, 0) + Number(button.dataset.step ?? "0")));
    }),
  );
  root.querySelector("#score-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    onSubmit(scoreFromDraft(readDraft(root, draft)));
  });
};

export const renderJudge = (options: RenderJudgeOptions): void => {
  const { root, schedule, event, lane, now, judgeName, sentHeats, manual, notice } = options;

  if (!judgeName) {
    root.innerHTML = nameGateHtml();
    wireNameGate(root, options.onNameSubmit);
    return;
  }

  const draft = options.draft ?? emptyDraft(event);
  const selected = resolveJudgeHeat({ schedule, event, lane, now, manual });
  const sent = sentHeats.includes(selected.heat.number);
  const heatNumbers = event.heats.map((h) => h.number);

  root.innerHTML = `
    ${headerHtml(options)}
    <main class="main judge-main">
      ${heatSelectorHtml(options, selected.index, sent)}
      ${teamCardHtml(selected.lane, lane)}
      ${noticeHtml(notice)}
      ${selected.lane ? scoreFormHtml(event, draft, sent) : ""}
    </main>
    <footer class="footer"><a href="#" id="change-name">Not you? Change name</a></footer>`;

  wireMain(options, draft, heatNumbers, selected.index);
};
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass. If the "steppers adjust the value" test fails on `toHaveValue(8)`, check that `jest-dom` compares numeric inputs as numbers — it does for `type="number"`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/render-judge.ts src/ui/render-judge.test.ts
git commit -m "feat: judge page view — name gate, heat selector, team card, score form"
```

---

### Task 12: Judge page controller — state, submit flow, retry

The controller owns page state (`manual`, `draft`, `notice`), reads the stores, validates, enqueues, flushes, and re-renders via `renderJudge`. It is tested end-to-end through the DOM with a fake `fetch`.

**Files:**
- Create: `src/ui/judge-page.ts`
- Test: `src/ui/judge-page.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/judge-page.test.ts`:

```ts
import { fireEvent, getByLabelText, getByRole, getByTestId, queryByTestId } from "@testing-library/dom";
import { startJudgePage } from "./judge-page";
import { loadQueue } from "./judge-store";
import { at, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

afterEach(() => localStorage.clear());

const ENDPOINT = "https://script.google.com/macros/s/abc/exec";

const event = makeEvent({
  number: 2,
  title: "Extra Credit",
  scoring: "rounds-reps",
  heats: [
    makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 5, team: "Rays of Glory", division: "F/M Scaled" })] }),
    makeHeat({ number: 2, start: "09:25", end: "09:35", lanes: [makeLane({ lane: 5, team: "Browne", division: "F/M Scaled" })] }),
  ],
});

const replying = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const start = (options?: { fetchFn?: typeof fetch; endpoint?: string; now?: Date }) => {
  const root = document.createElement("div");
  const fetchFn = options?.fetchFn ?? vi.fn<typeof fetch>().mockResolvedValue(replying({ ok: true }));
  const page = startJudgePage({
    root,
    schedule: makeSchedule({ events: [event] }),
    event,
    lane: 5,
    endpoint: options?.endpoint ?? ENDPOINT,
    now: () => options?.now ?? at("09:12"),
    fetchFn,
    newClientId: () => "cid-1",
  });
  return { root, fetchFn, page };
};

const enterName = (root: HTMLElement, name = "Kim") => {
  fireEvent.input(getByLabelText(root, "Your name"), { target: { value: name } });
  fireEvent.submit(getByTestId(root, "name-form"));
};

const enterRoundsReps = (root: HTMLElement, rounds: string, reps: string) => {
  fireEvent.input(getByLabelText(root, "Rounds"), { target: { value: rounds } });
  fireEvent.input(getByLabelText(root, "Reps"), { target: { value: reps } });
  fireEvent.submit(getByTestId(root, "score-form"));
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a judge opening their link", () => {
  it("is asked for a name once, then sees the scoring page", async () => {
    const { root } = start();

    enterName(root);

    expect(getByTestId(root, "judge-header")).toHaveTextContent("Kim");
    expect(getByTestId(root, "team-card")).toHaveTextContent("Rays of Glory");
  });

  it("can change the name later", () => {
    const { root } = start();
    enterName(root);

    fireEvent.click(getByRole(root, "link", { name: "Not you? Change name" }));

    expect(getByLabelText(root, "Your name")).toBeInTheDocument();
  });
});

describe("submitting a score", () => {
  it("posts the record, shows it as recorded and ticks the heat", async () => {
    const { root, fetchFn } = start();
    enterName(root);

    enterRoundsReps(root, "4", "7");
    await flushPromises();

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      clientId: "cid-1",
      judge: "Kim",
      event: 2,
      heat: 1,
      lane: 5,
      team: "Rays of Glory",
      division: "F/M Scaled",
      scoreKind: "rounds-reps",
      rounds: 4,
      reps: 7,
      seconds: "",
    });
    expect(getByTestId(root, "notice")).toHaveTextContent("Recorded ✓ — Rays of Glory: 4 + 7");
    expect(getByTestId(root, "heat-label")).toHaveTextContent("✓");
    expect(getByRole(root, "button", { name: "Update score" })).toBeInTheDocument();
    expect(loadQueue()).toEqual([]);
  });

  it("shows a validation error and posts nothing", async () => {
    const { root, fetchFn } = start();
    enterName(root);

    enterRoundsReps(root, "0", "0");
    await flushPromises();

    expect(getByTestId(root, "notice")).toHaveTextContent("Enter at least one rep");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(queryByTestId(root, "pending")).toBeNull();
  });

  it("keeps the score on the phone and retries when the sheet is unreachable", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(replying({ ok: true }));
    const { root, page } = start({ fetchFn });
    enterName(root);

    enterRoundsReps(root, "4", "7");
    await flushPromises();

    expect(getByTestId(root, "notice")).toHaveTextContent("Saved on this phone — will retry");
    expect(getByTestId(root, "pending")).toHaveTextContent("1 pending");
    expect(getByTestId(root, "heat-label")).toHaveTextContent("✓");

    await page.tick();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(queryByTestId(root, "pending")).toBeNull();
    expect(queryByTestId(root, "notice")).toBeNull();
  });

  it("shows a rejection from the sheet and does not retry it", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(replying({ ok: false, error: "Unknown scoreKind" }));
    const { root, page } = start({ fetchFn });
    enterName(root);

    enterRoundsReps(root, "4", "7");
    await flushPromises();
    await page.tick();

    expect(getByTestId(root, "notice")).toHaveTextContent("Unknown scoreKind");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(loadQueue()).toEqual([]);
  });

  it("flags an unconfigured endpoint and keeps scores queued", async () => {
    const { root, fetchFn } = start({ endpoint: "" });
    enterName(root);

    expect(root.textContent).toContain("Scoring not configured");

    enterRoundsReps(root, "4", "7");
    await flushPromises();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(getByTestId(root, "pending")).toHaveTextContent("1 pending");
  });
});

describe("the clock tick", () => {
  it("keeps a half-typed score", async () => {
    const { root, page } = start();
    enterName(root);
    fireEvent.input(getByLabelText(root, "Rounds"), { target: { value: "3" } });

    await page.tick();

    expect(getByLabelText(root, "Rounds")).toHaveValue(3);
  });

  it("clears the form when the judge moves to another heat", () => {
    const { root } = start();
    enterName(root);
    fireEvent.input(getByLabelText(root, "Rounds"), { target: { value: "3" } });

    fireEvent.click(getByRole(root, "button", { name: "Next heat" }));

    expect(getByTestId(root, "team-card")).toHaveTextContent("Browne");
    expect(getByLabelText(root, "Rounds")).toHaveValue(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/judge-page.test.ts`
Expected: FAIL — cannot resolve `./judge-page`.

- [ ] **Step 3: Implement the controller**

Create `src/ui/judge-page.ts`. The controller keeps one closure-local `let state` that is reassigned in exactly one place (`draw`) so that `tick()` and the callbacks always see the latest state. It is never exported or shared — the one permitted piece of local mutable state here.

```ts
import { resolveJudgeHeat, type ManualPick } from "../core/resolve-judge-heat";
import { formatScore, validateScore, type Score } from "../core/score";
import { buildSubmission, type Submission } from "../core/submission";
import type { Event, Schedule } from "../core/types";
import { loadJudgeName, loadQueue, loadSentHeats, markHeatSent, saveJudgeName } from "./judge-store";
import { emptyDraft, readDraft, renderJudge, type Notice, type ScoreDraft } from "./render-judge";
import { postScore } from "./score-client";
import { enqueue, flush, type FlushOutcome } from "./submit-queue";

export type JudgePageOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly event: Event;
  readonly lane: number;
  readonly endpoint: string;
  readonly now: () => Date;
  readonly fetchFn: typeof fetch;
  readonly newClientId: () => string;
};

export type JudgePage = { readonly tick: () => Promise<void> };

type PageState = {
  readonly manual: ManualPick | undefined;
  readonly draft: ScoreDraft | undefined;
  readonly notice: Notice | undefined;
};

const INITIAL: PageState = { manual: undefined, draft: undefined, notice: undefined };

const noticeAfterFlush = (outcome: FlushOutcome, current: Notice | undefined): Notice | undefined => {
  const rejection = outcome.rejected[0];
  if (rejection) return { kind: "error", text: rejection.error };
  if (outcome.pending > 0) return { kind: "retrying" };
  return current?.kind === "retrying" ? undefined : current;
};

export const startJudgePage = (options: JudgePageOptions): JudgePage => {
  const { root, schedule, event, lane, endpoint, now, fetchFn, newClientId } = options;
  let state: PageState = INITIAL;

  const post = (submission: Submission) => postScore({ endpoint, submission, fetchFn });

  const draw = (next: PageState): void => {
    state = next;
    renderJudge({
      root,
      schedule,
      event,
      lane,
      now: now(),
      judgeName: loadJudgeName(),
      sentHeats: loadSentHeats({ event: event.number, lane }),
      manual: next.manual,
      draft: next.draft,
      pending: loadQueue().length,
      notice: next.notice,
      endpointConfigured: endpoint !== "",
      onNameSubmit: (name) => {
        saveJudgeName(name);
        draw(state);
      },
      onNameClear: () => {
        saveJudgeName(undefined);
        draw({ ...state, draft: undefined, notice: undefined });
      },
      onHeatChange: (heat) => draw({ manual: { heat, at: now() }, draft: undefined, notice: undefined }),
      onSubmit: (score) => void submit(score),
    });
  };

  const flushAndDraw = async (): Promise<void> => {
    const outcome = await flush({ endpoint, post });
    draw({ ...state, notice: noticeAfterFlush(outcome, state.notice) });
  };

  const submit = async (score: Score): Promise<void> => {
    const validated = validateScore({ scoring: event.scoring, capSeconds: event.capSeconds, score });
    const draft = readDraft(root, state.draft ?? emptyDraft(event));
    if (!validated.success) {
      draw({ ...state, draft, notice: { kind: "error", text: validated.error } });
      return;
    }
    const selected = resolveJudgeHeat({ schedule, event, lane, now: now(), manual: state.manual });
    if (!selected.lane) return;

    enqueue(
      buildSubmission({
        judge: loadJudgeName() ?? "",
        event,
        heat: selected.heat,
        lane: selected.lane,
        score: validated.data,
        now: now(),
        clientId: newClientId(),
      }),
    );
    markHeatSent({ event: event.number, lane, heat: selected.heat.number });
    draw({
      manual: state.manual,
      draft: undefined,
      notice: { kind: "recorded", text: `Recorded ✓ — ${selected.lane.team}: ${formatScore(validated.data)}` },
    });
    await flushAndDraw();
  };

  const tick = async (): Promise<void> => {
    const draft = loadJudgeName() ? readDraft(root, state.draft ?? emptyDraft(event)) : undefined;
    draw({ ...state, draft });
    if (loadQueue().length > 0) await flushAndDraw();
  };

  draw(INITIAL);
  return { tick };
};
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass. If `prefer-const` complains about `let state`, it is reassigned in `draw` — the lint rule only fires when never reassigned, so it should be quiet.

- [ ] **Step 5: Commit**

```bash
git add src/ui/judge-page.ts src/ui/judge-page.test.ts
git commit -m "feat: judge page controller — validate, record, queue, retry"
```

---

### Task 13: Head judge QR page

**Files:**
- Create: `src/ui/render-head.ts`
- Test: `src/ui/render-head.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/render-head.test.ts`:

```ts
import { getAllByTestId, getByText } from "@testing-library/dom";
import { renderHead } from "./render-head";
import type { JudgeCodeTable } from "../core/judge-codes";
import { makeEvent, makeSchedule } from "../test/factories";

const table: JudgeCodeTable = {
  aaaaa: { kind: "lane", event: 1, lane: 1 },
  bbbbb: { kind: "lane", event: 1, lane: 2 },
  ccccc: { kind: "lane", event: 2, lane: 1 },
  hhhhh: { kind: "head" },
};

const schedule = makeSchedule({
  events: [makeEvent({ number: 1, title: "12th Gear" }), makeEvent({ number: 2, title: "Extra Credit" })],
});

const renderIt = async () => {
  const root = document.createElement("div");
  await renderHead({ root, schedule, table, siteUrl: "https://example.test/heats/" });
  return root;
};

describe("the head judge assignment page", () => {
  it("shows one card per lane code, none for the head code", async () => {
    const root = await renderIt();

    expect(getAllByTestId(root, "judge-card")).toHaveLength(3);
    expect(root.textContent).not.toContain("hhhhh");
  });

  it("groups cards under their event", async () => {
    const root = await renderIt();

    const [first] = getAllByTestId(root, "event-group");
    expect(first).toHaveTextContent("Event 1");
    expect(first).toHaveTextContent("12th Gear");
    expect(first?.querySelectorAll('[data-testid="judge-card"]')).toHaveLength(2);
  });

  it("prints the lane, code, full URL and a QR code on each card", async () => {
    const root = await renderIt();

    const card = getByText(root, "Lane 2").closest('[data-testid="judge-card"]');
    expect(card).toHaveTextContent("bbbbb");
    expect(card).toHaveTextContent("https://example.test/heats/?j=bbbbb");
    expect(card?.querySelector("svg")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/render-head.test.ts`
Expected: FAIL — cannot resolve `./render-head`.

- [ ] **Step 3: Implement**

Create `src/ui/render-head.ts`:

```ts
import { toString as qrToString } from "qrcode";
import type { JudgeCodeTable } from "../core/judge-codes";
import type { Schedule } from "../core/types";

type RenderHeadOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly table: JudgeCodeTable;
  readonly siteUrl: string;
};

type LaneCard = { readonly code: string; readonly lane: number; readonly url: string; readonly svg: string };

const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const laneCards = async (table: JudgeCodeTable, eventNumber: number, siteUrl: string): Promise<readonly LaneCard[]> => {
  const entries = Object.entries(table)
    .flatMap(([code, a]) => (a.kind === "lane" && a.event === eventNumber ? [{ code, lane: a.lane }] : []))
    .sort((a, b) => a.lane - b.lane);
  return Promise.all(
    entries.map(async ({ code, lane }) => {
      const url = `${siteUrl}?j=${code}`;
      return { code, lane, url, svg: await qrToString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
    }),
  );
};

const cardHtml = ({ code, lane, url, svg }: LaneCard): string => `
  <article class="judge-card" data-testid="judge-card">
    <h3>Lane ${lane}</h3>
    <div class="qr">${svg}</div>
    <div class="judge-code">${esc(code)}</div>
    <div class="judge-url">${esc(url)}</div>
  </article>`;

export const renderHead = async ({ root, schedule, table, siteUrl }: RenderHeadOptions): Promise<void> => {
  const groups = await Promise.all(
    schedule.events.map(async (event) => ({ event, cards: await laneCards(table, event.number, siteUrl) })),
  );
  root.innerHTML = `
    <header class="header"><div class="header-row"><h1 class="title">Judge assignments</h1></div></header>
    <main class="main head-main">
      ${groups
        .map(
          ({ event, cards }) => `
        <section class="event-group" data-testid="event-group">
          <h2>Event ${event.number} · ${esc(event.title)}</h2>
          <div class="judge-cards">${cards.map(cardHtml).join("")}</div>
        </section>`,
        )
        .join("")}
    </main>`;
};
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass. If Vitest cannot resolve `qrcode` in jsdom, add to `vite.config.ts` under `test`: `server: { deps: { inline: ["qrcode"] } }`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/render-head.ts src/ui/render-head.test.ts
git commit -m "feat: head judge QR assignment page"
```

---

### Task 14: Router in `main.ts` and styles

`main.ts` is wiring (reads `location`, `Date.now`, `fetch`) and stays untested, as today; every branch it calls is tested. Keep it under 50 lines.

**Files:**
- Modify: `src/main.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Rewrite `src/main.ts`**

```ts
import "./styles.css";
import { resolveJudgeCode } from "./core/judge-codes";
import type { Event } from "./core/types";
import { judgeCodes } from "./data/judge-codes";
import { schedule } from "./data/schedule";
import { scoringEndpoint } from "./data/scoring-endpoint";
import { startJudgePage } from "./ui/judge-page";
import { readJudgeCode } from "./ui/judge-route";
import { readNowOverride } from "./ui/now-override";
import { render } from "./ui/render";
import { renderHead } from "./ui/render-head";
import { renderInvalid } from "./ui/render-invalid";
import { loadTeam, saveTeam } from "./ui/team-store";

const REFRESH_MS = 15_000;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const previewOffsetMs = readNowOverride(location.search, new Date()).getTime() - Date.now();
const now = (): Date => new Date(Date.now() + previewOffsetMs);

const startSpectator = (): void => {
  const draw = (selectedTeam: string | undefined): void => {
    render({
      root,
      schedule,
      now: now(),
      selectedTeam,
      onTeamChange: (team) => {
        saveTeam(team);
        draw(team);
      },
    });
  };

  draw(loadTeam());
  root.querySelector(".heat.current, .heat.upcoming")?.scrollIntoView({ block: "start" });
  setInterval(() => draw(loadTeam()), REFRESH_MS);
};

const startJudge = (event: Event, lane: number): void => {
  const page = startJudgePage({
    root,
    schedule,
    event,
    lane,
    endpoint: scoringEndpoint,
    now,
    fetchFn: fetch,
    newClientId: () => crypto.randomUUID(),
  });
  setInterval(() => void page.tick(), REFRESH_MS);
  window.addEventListener("online", () => void page.tick());
};

const code = readJudgeCode(location.search);
const assignment = resolveJudgeCode({ table: judgeCodes, code });
const laneEvent = assignment.kind === "lane" ? schedule.events.find((e) => e.number === assignment.event) : undefined;

if (code === undefined) startSpectator();
else if (assignment.kind === "lane" && laneEvent) startJudge(laneEvent, assignment.lane);
else if (assignment.kind === "head") void renderHead({ root, schedule, table: judgeCodes, siteUrl: `${location.origin}${import.meta.env.BASE_URL}` });
else renderInvalid({ root });
```

- [ ] **Step 2: Append styles to `src/styles.css`**

```css
/* ---------- judge page ---------- */
.judge-gate { padding-top: 40px; }
.name-form { display: grid; gap: 10px; max-width: 360px; margin: 0 auto; }
.name-form label { font-weight: 700; color: var(--navy); }
.name-form input { font: inherit; font-size: 1.1rem; padding: 12px; border: 1px solid var(--line); border-radius: 8px; }
button.primary { font: inherit; font-weight: 900; font-size: 1.1rem; padding: 14px; border: 0; border-radius: 8px; background: var(--orange); color: #fff; }
button.primary:active { filter: brightness(0.9); }

.judge-header .header-row { align-items: flex-start; }
.judge-lane { font-size: 1.6rem; }
.judge-meta { text-align: right; font-size: 0.85rem; color: var(--muted); }
.pending { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 999px; background: #b45309; color: #fff; font-weight: 700; }
.config-warning { margin-top: 8px; padding: 8px 12px; border-radius: 6px; background: #b91c1c; color: #fff; font-weight: 700; font-size: 0.9rem; }

.judge-main { display: grid; gap: 14px; }
.heat-selector { display: grid; grid-template-columns: 56px 1fr 56px; align-items: center; gap: 8px; }
.heat-selector button { font-size: 1.4rem; padding: 10px 0; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--navy); }
.heat-selector button:disabled { opacity: 0.35; }
.heat-label { text-align: center; font-weight: 900; font-size: 1.3rem; color: var(--navy); }

.team-card { padding: 16px; border-radius: 10px; background: var(--navy); color: #fff; }
.team-card-name { font-weight: 900; font-size: 1.5rem; line-height: 1.15; }
.team-card-athletes { margin-top: 4px; font-size: 1rem; opacity: 0.9; }
.team-card-division { margin-top: 8px; display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--orange); font-weight: 700; font-size: 0.8rem; }
.team-card.empty { background: var(--surface-2); color: var(--muted); font-weight: 700; }

.score-form { display: grid; gap: 14px; }
.mode-toggle { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mode { font: inherit; font-weight: 900; font-size: 1.1rem; padding: 14px; border: 2px solid var(--navy); border-radius: 8px; background: #fff; color: var(--navy); }
.mode[aria-pressed="true"] { background: var(--navy); color: #fff; }

.time-fields { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 8px; }
.time-fields label, .stepper label { display: block; font-weight: 700; color: var(--navy); margin-bottom: 4px; }
.time-fields input, .stepper input { width: 100%; box-sizing: border-box; font: inherit; font-size: 2rem; font-weight: 900; text-align: center; padding: 10px; border: 1px solid var(--line); border-radius: 8px; }
.time-colon { font-size: 2rem; font-weight: 900; padding-bottom: 14px; color: var(--navy); }

.stepper-row { display: grid; grid-template-columns: 64px 1fr 64px; gap: 8px; }
.step { font-size: 1.8rem; font-weight: 900; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--navy); }

.submit { margin-top: 4px; }

.notice { padding: 12px 14px; border-radius: 8px; font-weight: 700; }
.notice.recorded { background: #dcfce7; color: #166534; }
.notice.retrying { background: #fef3c7; color: #92400e; }
.notice.error { background: #fee2e2; color: #991b1b; }

.judge-invalid { text-align: center; padding-top: 60px; color: var(--navy); }

/* ---------- head judge page ---------- */
.head-main { display: grid; gap: 24px; }
.event-group h2 { color: var(--navy); margin: 0 0 12px; }
.judge-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.judge-card { padding: 16px; border: 1px solid var(--line); border-radius: 10px; background: #fff; text-align: center; break-inside: avoid; }
.judge-card h3 { margin: 0 0 8px; font-size: 1.4rem; color: var(--navy); }
.judge-card .qr svg { width: 100%; max-width: 240px; height: auto; }
.judge-code { margin-top: 8px; font-family: ui-monospace, monospace; font-size: 1.3rem; font-weight: 900; letter-spacing: 0.1em; color: var(--orange); }
.judge-url { margin-top: 4px; font-size: 0.75rem; color: var(--muted); word-break: break-all; }
@media print { .header { position: static; } .judge-cards { grid-template-columns: repeat(2, 1fr); } }
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`, then open (substitute a real lane code and the head code from `src/data/judge-codes.ts`):

- `http://localhost:5173/12th-state-heats/` — spectator page unchanged.
- `http://localhost:5173/12th-state-heats/?j=<lane code for event 1>&at=2026-09-12T08:02` — name gate, then Event 1 · Heat 1, Finished/Capped toggle, minute:second inputs.
- `http://localhost:5173/12th-state-heats/?j=<lane code for event 2>&at=2026-09-12T09:27` — Heat 2, Rounds/Reps steppers. Submit a score → "Recorded ✓" then amber "Saved on this phone — will retry" (endpoint is empty) with "1 pending"; red "Scoring not configured" bar in the header.
- `http://localhost:5173/12th-state-heats/?j=<head code>` — 24 QR cards in three groups.
- `http://localhost:5173/12th-state-heats/?j=zzzzz` — invalid-link page.

- [ ] **Step 4: Run all checks and build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass; `dist/` builds.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/styles.css
git commit -m "feat: route judge and head links; judge and QR page styles"
```

---

### Task 15: Apps Script backend

Not unit-tested (Apps Script has no local runtime here); verified by the smoke test in Task 16.

**Files:**
- Create: `apps-script/Code.gs`

- [ ] **Step 1: Write the script**

Create `apps-script/Code.gs`:

```js
const LOG = "Log";
const RESULTS = "Results";
const OVERALL = "Overall";
const EVENTS = [1, 2, 3];
const LOCK_WAIT_MS = 10000;

const LOG_HEADERS = [
  "receivedAt", "submittedAt", "judge", "event", "heat", "lane",
  "team", "division", "scoreKind", "seconds", "rounds", "reps", "clientId",
];
const CLIENT_ID_COLUMN = LOG_HEADERS.indexOf("clientId") + 1;
const REQUIRED = ["clientId", "submittedAt", "judge", "event", "heat", "lane", "team", "division", "scoreKind"];
const SCORE_KINDS = ["time", "rounds-reps"];

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return reply({ ok: true, service: "12th-state-scoring" });
}

function doPost(e) {
  let record;
  try {
    record = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "Body is not JSON" });
  }
  const missing = REQUIRED.filter((key) => record[key] === undefined || record[key] === "");
  if (missing.length > 0) return reply({ ok: false, error: "Missing " + missing.join(", ") });
  if (SCORE_KINDS.indexOf(record.scoreKind) === -1) return reply({ ok: false, error: "Unknown scoreKind" });

  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(LOG);
    if (!sheet) return reply({ ok: false, error: "Run setup() in the script editor first" });
    if (alreadyLogged(sheet, record.clientId)) return reply({ ok: true, duplicate: true });
    sheet.appendRow(toRow(record));
    return reply({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function alreadyLogged(sheet, clientId) {
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return false;
  const ids = sheet.getRange(2, CLIENT_ID_COLUMN, rows, 1).getValues();
  return ids.some((row) => row[0] === clientId);
}

function numberOrBlank(value) {
  return value === "" || value === undefined || value === null ? "" : Number(value);
}

function toRow(record) {
  return [
    new Date().toISOString(),
    String(record.submittedAt),
    String(record.judge),
    Number(record.event),
    Number(record.heat),
    Number(record.lane),
    String(record.team),
    String(record.division),
    String(record.scoreKind),
    numberOrBlank(record.seconds),
    numberOrBlank(record.rounds),
    numberOrBlank(record.reps),
    String(record.clientId),
  ];
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  setupLog(ss);
  setupResults(ss);
  setupOverall(ss);
}

function sheetNamed(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeHeaders(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function setupLog(ss) {
  writeHeaders(sheetNamed(ss, LOG), LOG_HEADERS);
}

function latestField(column) {
  return (
    '=MAP(A2:A, C2:C, LAMBDA(ev, tm, IF(tm="", "", ' +
    "INDEX(SORTN(FILTER(Log!I$2:L, Log!D$2:D=ev, Log!G$2:G=tm), 1, 0, " +
    "FILTER(Log!B$2:B, Log!D$2:D=ev, Log!G$2:G=tm), FALSE), 1, " + column + "))))"
  );
}

function setupResults(ss) {
  const sheet = sheetNamed(ss, RESULTS);
  writeHeaders(sheet, ["event", "division", "team", "scoreKind", "seconds", "rounds", "reps", "display", "sortKey", "placing"]);
  const formulas = [
    '=IFERROR(SORT(UNIQUE(FILTER({Log!D2:D, Log!H2:H, Log!G2:G}, Log!G2:G<>"")), 1, TRUE, 2, TRUE, 3, TRUE), "")',
    "",
    "",
    latestField(1),
    latestField(2),
    latestField(3),
    latestField(4),
    '=MAP(D2:D, E2:E, F2:F, G2:G, LAMBDA(k, s, r, p, IF(k="", "", IF(k="time", INT(s/60)&":"&TEXT(MOD(s,60),"00"), r&" + "&p))))',
    '=MAP(D2:D, E2:E, F2:F, G2:G, LAMBDA(k, s, r, p, IF(k="", "", IF(k="time", s, 1000000 - r*10000 - p))))',
    '=MAP(A2:A, B2:B, I2:I, LAMBDA(ev, dv, key, IF(key="", "", COUNTIFS(A$2:A, ev, B$2:B, dv, I$2:I, "<"&key) + 1)))',
  ];
  sheet.getRange(2, 1, 1, formulas.length).setFormulas([formulas]);
  sheet.getRange("I1").setNote("Lower is better. time → seconds; rounds-reps → 1,000,000 − rounds×10,000 − reps, so any finish beats any capped score.");
}

function eventPlacing(eventNumber) {
  return (
    '=MAP(A2:A, B2:B, LAMBDA(dv, tm, IF(tm="", "", IFERROR(' +
    "INDEX(FILTER(Results!J$2:J, Results!A$2:A=" + eventNumber + ", Results!C$2:C=tm), 1), " +
    "COUNTIFS(Results!A$2:A, " + eventNumber + ", Results!B$2:B, dv) + 1))))"
  );
}

function setupOverall(ss) {
  const sheet = sheetNamed(ss, OVERALL);
  const eventHeaders = EVENTS.map((n) => "E" + n);
  writeHeaders(sheet, ["division", "team"].concat(eventHeaders, ["total", "place"]));
  const totalColumns = EVENTS.map((_, i) => String.fromCharCode("C".charCodeAt(0) + i));
  const totalCol = String.fromCharCode("C".charCodeAt(0) + EVENTS.length);
  const formulas = [
    '=IFERROR(SORT(UNIQUE(FILTER({Results!B2:B, Results!C2:C}, Results!C2:C<>""))), "")',
    "",
  ]
    .concat(EVENTS.map(eventPlacing))
    .concat([
      "=MAP(" + totalColumns.map((c) => c + "2:" + c).join(", ") + ", LAMBDA(" + totalColumns.map((c) => "v" + c).join(", ") +
        ', IF(vC="", "", ' + totalColumns.map((c) => "v" + c).join("+") + ")))",
      "=MAP(A2:A, " + totalCol + "2:" + totalCol + ', LAMBDA(dv, t, IF(t="", "", COUNTIFS(A$2:A, dv, ' + totalCol + '$2:' + totalCol + ', "<"&t) + 1)))',
    ]);
  sheet.getRange(2, 1, 1, formulas.length).setFormulas([formulas]);
  sheet.getRange(totalCol + "1").setNote("Sum of event placings within division; lowest wins. A missing event counts as one worse than last.");
}
```

- [ ] **Step 2: Exclude from lint**

`apps-script/` is plain Apps Script JS, not part of the Vite project. In `eslint.config.js` add `"apps-script"` to the `ignores` array.

- [ ] **Step 3: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps-script/Code.gs eslint.config.js
git commit -m "feat: Apps Script endpoint and sheet setup"
```

---

### Task 16: Deployment guide and README

**Files:**
- Create: `docs/scoring-deploy.md`
- Modify: `README.md`

- [ ] **Step 1: Write the guide**

Create `docs/scoring-deploy.md`:

````markdown
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
curl -sL -X POST 'https://script.google.com/macros/s/AKfyc.../exec' \
  --data '{"clientId":"smoke-1","submittedAt":"2026-09-12T13:45:00.000Z","judge":"Smoke Test","event":2,"heat":3,"lane":5,"team":"Rays of Glory","division":"F/M Scaled","scoreKind":"rounds-reps","seconds":"","rounds":4,"reps":7}'
```

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
| `Results` shows `#ERROR` | Formulas edited by hand | Delete the `Results` and `Overall` tabs and run `setup` again |
| Judge link says "This link isn't valid" | Code not in `src/data/judge-codes.ts` — regenerated after the link was shared | Re-run `npm run judge-links` and hand out the new link |
````

- [ ] **Step 2: Update the README**

In `README.md`, after the **Live:** line's paragraph, add:

```markdown
## Scoring

Lane judges get a per-event link (`?j=<code>`) that shows the team in their
lane for the heat on the floor and posts the score to a Google Sheet. The
head judge's link shows a QR code for every lane. Setup, comp-day steps and
troubleshooting: **[docs/scoring-deploy.md](docs/scoring-deploy.md)**.
```

And in **Development**, after the "Pure logic lives in…" paragraph:

```markdown
`npm run judge-links` regenerates `src/data/judge-codes.ts` (keeping existing
codes) and prints every judge URL. `apps-script/Code.gs` is the Sheet
backend; it is pasted into Apps Script by hand, not built.
```

- [ ] **Step 3: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: pass (docs are lint-ignored).

- [ ] **Step 4: Commit**

```bash
git add docs/scoring-deploy.md README.md
git commit -m "docs: scoring deployment guide"
```

---

## Done criteria

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all clean.
- Spectator page byte-for-byte unchanged in behaviour (`render.ts` untouched, its tests untouched).
- Every judge link in `npm run judge-links` output opens a scoring page; the head link shows 24 QR cards.
- The smoke test in `docs/scoring-deploy.md` §1f has been run against a real deployment at least once before the guide is considered done — that is the organiser's step, not the implementer's, but the implementer should have run `curl` against a throwaway deployment if they have a Google account handy. If not, say so in the final report.
