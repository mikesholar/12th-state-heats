# Multi-day Heats and Intermediate Workout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Heats carry their own date (blank = `compDate`) so an event can span days, the site separates days lightly within an event, and events gain an optional Intermediate workout.

**Architecture:** The decoder resolves every heat's `date` (so the rest of the app always has one); `heatInstants` uses it; `resolveHeats` only considers today's heats and adds a `day-finished` phase. A shared `withDayBreaks` helper draws dividers on the spectator and sign-up pages. `Event.intermediate` flows through the decoder into the three workout displays. `Code.gs` reads two new optional columns.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest + Testing Library (jsdom), Vite, Google Apps Script.

**Spec:** `docs/superpowers/specs/2026-09-29-multi-day-and-intermediate-design.md` (Task 8 corrects three details found while planning).

**Conventions (from the repo):** behaviour tests through public entry points (`decodeSchedule`, `validateSchedule`, `resolveHeats`, `resolveJudgeHeat`, `render`, `renderSignup`, `renderJudge`); factories in `src/test/factories.ts`, no `let`/`beforeEach`; no comments; `readonly` types; options objects except where the surrounding code is positional. Run a single file with `npx vitest run <path>`; full checks `npm run lint && npm run typecheck && npm test`. Commit after each green; trailer `Co-Authored-By: <model> <noreply@anthropic.com>`.

**Test dates:** `at(hhmm, date)` in factories uses a `-04:00` offset. 2026-09-12 is a Saturday, 2026-09-13 a Sunday, 2026-09-14 a Monday.

---

## File map

| File | Change |
|---|---|
| `src/core/types.ts` | `Heat.date`, `Event.intermediate` |
| `src/core/schedule-schema.ts` | decode heat `date` (blank → compDate), `intermediate`; shared `calendarDate` |
| `src/core/validate-schedule.ts` | overlap check only within the same date |
| `src/core/comp-time.ts` | `heatInstants` uses `heat.date`; new `compDays` |
| `src/core/resolve-heats.ts` | today's heats only; `day-finished` phase |
| `src/core/format.ts` | `formatDay`, `formatWeekday`, `formatDayList` |
| `src/ui/day-break.ts` (new) | `withDayBreaks` |
| `src/ui/render.ts` | day breaks, comp-days label, banners, Intermediate line |
| `src/ui/render-signup.ts` | day breaks, comp-days label, Intermediate line |
| `src/ui/render-judge.ts` | weekday in heat label on multi-day comps |
| `src/ui/render-workout.ts` | Intermediate line + highlight |
| `src/styles.css` | `.day-break` |
| `src/test/factories.ts` | `date`, `intermediate` defaults; `makeTwoDaySchedule` |
| `apps-script/Code.gs` | read `date`, `intermediate`; setup headers/notes |
| `docs/deploy.md`, `README.md`, spec | docs |

---

### Task 1: Heats carry a date

**Files:**
- Modify: `src/core/types.ts`, `src/core/schedule-schema.ts`, `src/core/validate-schedule.ts`, `src/test/factories.ts`
- Test: `src/core/schedule-schema.test.ts`, `src/core/validate-schedule.test.ts`

- [ ] **Step 1: Give the factory heat a date** (test data only; keeps every existing test's expectations complete)

In `src/test/factories.ts`, `makeHeat`:

```ts
export const makeHeat = (overrides?: Partial<Heat>): Heat => ({
  number: 1,
  date: "2026-09-12",
  start: "08:00",
  end: "08:08",
  lanes: [makeLane()],
  ...overrides,
});
```

And in `src/core/types.ts`:

```ts
export type Heat = {
  readonly number: number;
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly lanes: readonly Lane[];
};
```

- [ ] **Step 2: Write the failing decoder tests**

Append to `src/core/schedule-schema.test.ts`:

```ts
describe("heat dates", () => {
  const heatWith = (overrides: Readonly<Record<string, unknown>>) =>
    makeRawSchedule({ events: [makeRawEvent({ heats: [makeRawHeat({ number: 3, ...overrides })] })] });

  it("runs a heat with no date on the comp date", () => {
    const result = decodeSchedule(heatWith({ date: "" }));

    expect(result.success && result.data.events[0]?.heats[0]?.date).toBe("2026-09-12");
  });

  it("keeps a heat's own date", () => {
    const result = decodeSchedule(heatWith({ date: " 2026-09-13 " }));

    expect(result.success && result.data.events[0]?.heats[0]?.date).toBe("2026-09-13");
  });

  it("names a heat whose date is not a date", () => {
    expect(errorOf(heatWith({ date: "13/09/2026" }))).toBe('Heats: Event 1 Heat 3: date "13/09/2026" must be YYYY-MM-DD');
    expect(errorOf(heatWith({ date: "2026-02-30" }))).toBe('Heats: Event 1 Heat 3: date "2026-02-30" is not a real date');
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run src/core/schedule-schema.test.ts`
Expected: the three new tests FAIL (date is `undefined`; no error for bad dates). The "documented shape" test also fails (decoded heat lacks `date`).

- [ ] **Step 4: Decode the date**

In `src/core/schedule-schema.ts`, add after `clock`:

```ts
const calendarDate = (raw: Raw, key: string, where: string): Result<string> => {
  const value = text(raw, key, where);
  if (!value.success) return value;
  if (!DATE_PATTERN.test(value.data)) return fail(`${where}: ${key} "${value.data}" must be YYYY-MM-DD`);
  if (!isRealDate(value.data)) return fail(`${where}: ${key} "${value.data}" is not a real date`);
  return value;
};

const heatDate = (raw: Raw, compDate: string, where: string): Result<string> =>
  trimmed(raw.date) === "" ? ok(compDate) : calendarDate(raw, "date", where);
```

Change `decodeHeat` to take the comp date and use it:

```ts
const decodeHeat = (eventNumber: number, compDate: string) => (value: unknown): Result<Heat> => {
  if (!isRaw(value)) return fail(`Heats: Event ${eventNumber}: a heat entry is not an object`);
  const number = integer(value, "number", `Heats: Event ${eventNumber}`);
  if (!number.success) return number;
  const where = `Event ${eventNumber} Heat ${number.data}`;
  const date = heatDate(value, compDate, `Heats: ${where}`);
  if (!date.success) return date;
  const start = clock(value, "start", `Heats: ${where}`);
  if (!start.success) return start;
  const end = clock(value, "end", `Heats: ${where}`);
  if (!end.success) return end;
  const lanes = list(value, "lanes", `Heats: ${where}`);
  if (!lanes.success) return lanes;
  const decodedLanes = all(lanes.data.map(decodeLane(where)));
  if (!decodedLanes.success) return decodedLanes;
  return ok({ number: number.data, date: date.data, start: start.data, end: end.data, lanes: decodedLanes.data });
};
```

Make `decodeEvent` curried on the comp date — change its first line and the heats line:

```ts
const decodeEvent = (compDate: string) => (value: unknown): Result<Event> => {
```
```ts
  const decodedHeats = all(heats.data.map(decodeHeat(number.data, compDate)));
```

In `decodeShape`, replace the three `compDate` lines:

```ts
  const compDate = text(raw, "compDate", "Settings");
  if (!compDate.success) return compDate;
  if (!DATE_PATTERN.test(compDate.data)) return fail(`Settings: compDate "${compDate.data}" must be YYYY-MM-DD`);
  if (!isRealDate(compDate.data)) return fail(`Settings: compDate "${compDate.data}" is not a real date`);
```

with:

```ts
  const compDate = calendarDate(raw, "compDate", "Settings");
  if (!compDate.success) return compDate;
```

and the events line:

```ts
  const decodedEvents = all(raw.events.map(decodeEvent(compDate.data)));
```

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run src/core/schedule-schema.test.ts`
Expected: all PASS (including the existing compDate error tests — same messages).

- [ ] **Step 6: Write the failing validation test**

Append inside the `describe("schedule validation", …)` in `src/core/validate-schedule.test.ts`:

```ts
  it("lets heats on different days share a time", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ heats: [makeHeat({ number: 1 }), makeHeat({ number: 2, date: "2026-09-13" })] })],
    });

    expect(validateSchedule(schedule)).toEqual([]);
  });
```

Run: `npx vitest run src/core/validate-schedule.test.ts`
Expected: FAIL — `["Event 1 Heat 2: starts 08:00, overlaps Heat 1 ending 08:08"]`.

- [ ] **Step 7: Compare overlaps within a day**

In `src/core/validate-schedule.ts` replace `blockingHeat` and the `byStart` line of `overlapErrors`:

```ts
const blockingHeat = (earlier: readonly Heat[], heat: Heat): Heat | undefined =>
  [...earlier]
    .filter((other) => other.date === heat.date && other.end > heat.start)
    .sort((a, b) => b.end.localeCompare(a.end))[0];

const startKey = (heat: Heat): string => `${heat.date} ${heat.start}`;

const overlapErrors = (event: Event): readonly string[] => {
  const byStart = [...event.heats].sort((a, b) => startKey(a).localeCompare(startKey(b)));
```

(rest of `overlapErrors` unchanged)

- [ ] **Step 8: Full check and commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass. `typecheck` compiles every `Heat` literal — the only producers are the decoder and `makeHeat`.

```bash
git add src/core/types.ts src/core/schedule-schema.ts src/core/validate-schedule.ts src/test/factories.ts src/core/schedule-schema.test.ts src/core/validate-schedule.test.ts
git commit -m "feat: each heat has a date, defaulting to the comp date"
```

---

### Task 2: Heat times and status follow each heat's date

**Files:**
- Modify: `src/core/comp-time.ts`, `src/core/resolve-heats.ts`, `src/test/factories.ts`, `src/ui/render.ts` (exhaustive switch only)
- Test: `src/core/resolve-judge-heat.test.ts`, `src/core/resolve-heats.test.ts`

- [ ] **Step 1: Add the two-day test schedule factory**

Append to `src/test/factories.ts`:

```ts
export const makeTwoDaySchedule = (overrides?: Partial<Schedule>): Schedule =>
  makeSchedule({
    events: [
      makeEvent({
        number: 1,
        heats: [
          makeHeat({ number: 1, date: "2026-09-12", start: "18:00", end: "18:10" }),
          makeHeat({ number: 2, date: "2026-09-13", start: "08:00", end: "08:10" }),
        ],
      }),
      makeEvent({ number: 2, heats: [makeHeat({ number: 1, date: "2026-09-13", start: "09:00", end: "09:10" })] }),
    ],
    ...overrides,
  });
```

- [ ] **Step 2: Write the failing judge test**

Append to `src/core/resolve-judge-heat.test.ts` (add `makeTwoDaySchedule` to its factories import; keep existing imports):

```ts
describe("a comp over two days", () => {
  it("on the first morning, waits for that day's heat rather than one on a later day at the same time", () => {
    const schedule = makeTwoDaySchedule();
    const event = schedule.events[0];
    if (!event) throw new Error("fixture has no event");

    const picked = resolveJudgeHeat({ schedule, event, lane: 1, now: at("08:05", "2026-09-12"), manual: undefined });

    expect(picked.heat.number).toBe(1);
  });
});
```

Run: `npx vitest run src/core/resolve-judge-heat.test.ts`
Expected: FAIL — `expected 2 to be 1`. Today heat 2 is timed on `compDate` (the 12th), so it looks like it is running at 08:05 on the 12th.

- [ ] **Step 3: Time heats on their own date**

In `src/core/comp-time.ts` replace `heatInstants`:

```ts
export const heatInstants = (
  schedule: Schedule,
  heat: Heat,
): { readonly start: Date; readonly end: Date } => ({
  start: localToInstant({ date: heat.date, hhmm: heat.start, timeZone: schedule.timeZone }),
  end: localToInstant({ date: heat.date, hhmm: heat.end, timeZone: schedule.timeZone }),
});
```

and add:

```ts
export const compDays = (schedule: Schedule): readonly string[] => {
  const dates = schedule.events.flatMap((event) => event.heats.map((heat) => heat.date));
  return dates.length === 0 ? [schedule.compDate] : [...new Set(dates)].sort();
};
```

Run: `npx vitest run src/core/resolve-judge-heat.test.ts` → PASS.

- [ ] **Step 4: Write the failing status tests**

Append to `src/core/resolve-heats.test.ts` (add `makeTwoDaySchedule` and `makeSchedule`, `makeEvent` to the factories import as needed):

```ts
describe("a comp over two days", () => {
  const twoDays = makeTwoDaySchedule();

  it("the day before, it is not a comp day", () => {
    expect(resolveHeats(twoDays, at("12:00", "2026-09-11")).phase).toBe("not-comp-day");
  });

  it("on day one, the first heat is that day's first heat", () => {
    const status = resolveHeats(twoDays, at("17:30", "2026-09-12"));

    expect(status.phase).toBe("before");
    expect(status.phase === "before" && label(status.next)).toBe("E1H1");
  });

  it("during day one's last heat there is no next heat today", () => {
    const status = resolveHeats(twoDays, at("18:05", "2026-09-12"));

    expect(status.phase).toBe("during");
    expect(status.phase === "during" && status.next).toBeUndefined();
  });

  it("after day one's last heat, the day is done and the next heat is tomorrow's first", () => {
    const status = resolveHeats(twoDays, at("18:10", "2026-09-12"));

    expect(status.phase).toBe("day-finished");
    expect(status.phase === "day-finished" && label(status.next)).toBe("E1H2");
  });

  it("on day two's morning, the first heat is day two's first heat", () => {
    const status = resolveHeats(twoDays, at("07:30", "2026-09-13"));

    expect(status.phase).toBe("before");
    expect(status.phase === "before" && label(status.next)).toBe("E1H2");
  });

  it("on day two, the gap between events points at the next event", () => {
    const status = resolveHeats(twoDays, at("08:30", "2026-09-13"));

    expect(status.phase).toBe("between-events");
    expect(status.phase === "between-events" && label(status.next)).toBe("E2H1");
  });

  it("after the last day's last heat, the comp is finished", () => {
    expect(resolveHeats(twoDays, at("09:10", "2026-09-13")).phase).toBe("finished");
  });

  it("a date between two comp days that are not consecutive is not a comp day", () => {
    const gapped = makeTwoDaySchedule({
      events: [makeEvent({ heats: [makeHeat({ number: 1 }), makeHeat({ number: 2, date: "2026-09-14" })] })],
    });

    expect(resolveHeats(gapped, at("09:00", "2026-09-13")).phase).toBe("not-comp-day");
  });
});
```

Run: `npx vitest run src/core/resolve-heats.test.ts`
Expected: new tests FAIL (every date except compDate is `not-comp-day`; `day-finished` doesn't exist).

- [ ] **Step 5: Resolve today's heats only**

In `src/core/resolve-heats.ts`:

```ts
import { compDayOf, compDays, heatInstants } from "./comp-time";
```

Add the phase to `HeatStatus`:

```ts
export type HeatStatus =
  | { readonly phase: "not-comp-day" }
  | { readonly phase: "before"; readonly next: HeatRef }
  | { readonly phase: "during"; readonly current: HeatRef | undefined; readonly next: HeatRef | undefined }
  | { readonly phase: "between-events"; readonly next: HeatRef }
  | { readonly phase: "day-finished"; readonly next: HeatRef }
  | { readonly phase: "finished" };
```

Replace `resolveHeats`:

```ts
const afterToday = (refs: readonly HeatRef[], now: Date): HeatStatus => {
  const later = refs.find((ref) => ref.start > now);
  return later ? { phase: "day-finished", next: later } : { phase: "finished" };
};

export const resolveHeats = (schedule: Schedule, now: Date): HeatStatus => {
  const today = compDayOf(now, schedule.timeZone);
  if (!compDays(schedule).includes(today)) return { phase: "not-comp-day" };

  const refs = allHeatRefs(schedule);
  const todays = refs.filter((ref) => ref.heat.date === today);
  const first = todays[0];
  if (!first) return { phase: "finished" };
  if (now < first.start) return { phase: "before", next: first };

  const current = todays.find((ref) => isRunning(ref, now));
  const next = todays.find((ref) => ref.start > now);
  if (!current && !next) return afterToday(refs, now);

  const lastEnded = [...todays].reverse().find((ref) => ref.end <= now);
  const inGapBetweenEvents = !current && next && lastEnded && lastEnded.event !== next.event;
  if (inGapBetweenEvents) return { phase: "between-events", next };

  return { phase: "during", current, next };
};
```

- [ ] **Step 6: Keep the spectator banner compiling**

`src/ui/render.ts` `bannerHtml`'s `switch` is now non-exhaustive (typecheck fails, `noImplicitReturns`). Add a minimal case now — Task 3 gives it its real text and test:

```ts
    case "day-finished":
      return wrap(`<div class="banner-line"><span class="tag next">DAY DONE</span></div>`);
```

and let `heatTag` tag the next day's first heat as NEXT:

```ts
  const next =
    status.phase === "during" || status.phase === "before" || status.phase === "between-events" || status.phase === "day-finished"
      ? status.next
      : undefined;
```

- [ ] **Step 7: Run, check, commit**

Run: `npx vitest run src/core/resolve-heats.test.ts` → PASS. Then `npm run lint && npm run typecheck && npm test` → all pass (the 2026 fixture is single-day, so its tests are unchanged).

```bash
git add src/core/comp-time.ts src/core/resolve-heats.ts src/test/factories.ts src/ui/render.ts src/core/resolve-heats.test.ts src/core/resolve-judge-heat.test.ts
git commit -m "feat: heats run on their own date; status covers each comp day"
```

---

### Task 3: Spectator page — day labels, banners, day breaks

**Files:**
- Create: `src/ui/day-break.ts`
- Modify: `src/core/format.ts`, `src/ui/render.ts`, `src/styles.css`
- Test: `src/ui/render.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/ui/render.test.ts`, add `makeTwoDaySchedule` to the factories import, then append:

```ts
const renderScheduleAt = (custom: Schedule, now: Date) => {
  const root = document.createElement("div");
  document.body.append(root);
  render({ root, schedule: custom, now, sourceNotice: undefined });
  return root;
};

describe("a comp over two days", () => {
  const twoDays = makeTwoDaySchedule();

  it("on another day, the banner and footer name both days", () => {
    const root = renderScheduleAt(twoDays, at("12:00", "2026-09-11"));

    expect(bannerText(root)).toContain("Sat Sep 12 – Sun Sep 13");
    expect(root.querySelector(".footer")?.textContent).toContain("Sat Sep 12 – Sun Sep 13");
  });

  it("lists comp days that are not consecutive one by one", () => {
    const gapped = makeTwoDaySchedule({
      events: [makeEvent({ heats: [makeHeat({ number: 1 }), makeHeat({ number: 2, date: "2026-09-14" })] })],
    });

    expect(bannerText(renderScheduleAt(gapped, at("12:00", "2026-09-11")))).toContain("Sat Sep 12 & Mon Sep 14");
  });

  it("announces an afternoon first heat without calling it morning", () => {
    const text = bannerText(renderScheduleAt(twoDays, at("17:30", "2026-09-12")));

    expect(text).toContain("First heat 6:00");
    expect(text).not.toContain("AM");
  });

  it("after the day's last heat, says the day is done and when the next heat is", () => {
    const text = bannerText(renderScheduleAt(twoDays, at("18:15", "2026-09-12")));

    expect(text).toContain("DAY DONE");
    expect(text).toContain("Next heat Sun 8:00 · Event 1");
  });

  it("separates an event's heats by day, only in events that span days", () => {
    const root = renderScheduleAt(twoDays, at("12:00", "2026-09-12"));

    const labels = (selector: string) => Array.from(root.querySelectorAll(selector), (el) => el.textContent);
    expect(labels('#event-1 [data-testid="day-break"]')).toEqual(["Sat Sep 12", "Sun Sep 13"]);
    expect(labels('#event-2 [data-testid="day-break"]')).toEqual([]);
  });

  it("a single-day comp has no day breaks", () => {
    expect(renderAt(at("08:15")).root.querySelectorAll('[data-testid="day-break"]')).toHaveLength(0);
  });
});
```

Also add `makeEvent, makeHeat` to that import.

Run: `npx vitest run src/ui/render.test.ts`
Expected: the new tests FAIL (single `compDate` label; " AM"; no DAY DONE text; no dividers). The single-day test passes already.

- [ ] **Step 2: Day formatting**

Append to `src/core/format.ts`:

```ts
const DAY_MS = 86_400_000;

const noonOf = (date: string): Date => new Date(`${date}T12:00:00Z`);

const dayPart = (date: string, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(noonOf(date));

export const formatWeekday = (date: string): string => dayPart(date, { weekday: "short" });

export const formatDay = (date: string): string =>
  `${formatWeekday(date)} ${dayPart(date, { month: "short", day: "numeric" })}`;

const isNextDay = (earlier: string, later: string): boolean => noonOf(later).getTime() - noonOf(earlier).getTime() === DAY_MS;

const areConsecutive = (days: readonly string[]): boolean =>
  days.every((day, i) => i === 0 || isNextDay(days[i - 1] ?? day, day));

export const formatDayList = (days: readonly string[]): string => {
  const labels = days.map(formatDay);
  const first = labels[0] ?? "";
  const last = labels[labels.length - 1] ?? "";
  if (labels.length <= 1) return first;
  if (areConsecutive(days)) return `${first} – ${last}`;
  return `${labels.slice(0, -1).join(", ")} & ${last}`;
};
```

- [ ] **Step 3: The day-break helper**

Create `src/ui/day-break.ts`:

```ts
import { formatDay } from "../core/format";
import type { Heat } from "../core/types";

const spansDays = (heats: readonly Heat[]): boolean => new Set(heats.map((heat) => heat.date)).size > 1;

const dayBreakHtml = (date: string): string =>
  `<div class="day-break" role="separator" data-testid="day-break"><span>${formatDay(date)}</span></div>`;

type WithDayBreaksOptions = {
  readonly heats: readonly Heat[];
  readonly heatHtml: (heat: Heat) => string;
};

export const withDayBreaks = ({ heats, heatHtml }: WithDayBreaksOptions): string => {
  const breaks = spansDays(heats);
  return heats
    .map((heat, i) => `${breaks && heat.date !== heats[i - 1]?.date ? dayBreakHtml(heat.date) : ""}${heatHtml(heat)}`)
    .join("");
};
```

- [ ] **Step 4: Use them in the spectator page**

In `src/ui/render.ts`:

Imports:

```ts
import { compDays } from "../core/comp-time";
import { formatClock, formatCountdown, formatDayList, formatRange, formatWeekday } from "../core/format";
import { withDayBreaks } from "./day-break";
```

Replace `compDateLabel` with:

```ts
const longDay = (schedule: Schedule, date: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

const compDaysLabel = (schedule: Schedule): string => {
  const days = compDays(schedule);
  const only = days.length === 1 ? days[0] : undefined;
  return only === undefined ? formatDayList(days) : longDay(schedule, only);
};
```

and rename its two uses (`not-comp-day` banner, footer) to `compDaysLabel(schedule)`.

In `bannerHtml`, the `before` case drops ` AM`:

```ts
        `<div class="banner-line"><span class="tag next">FIRST HEAT</span> First heat ${formatClock(status.next.heat.start)} · ${formatCountdown(minutesUntil(status.next.start, now))}</div>`,
```

and the `day-finished` case becomes:

```ts
    case "day-finished":
      return wrap(
        `<div class="banner-line"><span class="tag next">DAY DONE</span> Next heat ${formatWeekday(status.next.heat.date)} ${formatClock(status.next.heat.start)} · Event ${status.next.event.number}</div>`,
      );
```

In `eventHtml`, replace the heats line:

```ts
    ${withDayBreaks({ heats: event.heats, heatHtml: (heat) => heatCardHtml({ schedule, event, heat, now, status }) })}
```

- [ ] **Step 5: Style the divider**

Append to `src/styles.css` after the `.heat-time` rule:

```css
.day-break {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0 8px;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.day-break::before,
.day-break::after { content: ""; height: 1px; background: var(--line); }
.day-break::before { width: 12px; }
.day-break::after { flex: 1; }
.event-header + .day-break { margin-top: 4px; }
```

- [ ] **Step 6: Run, check, commit**

Run: `npx vitest run src/ui/render.test.ts` → PASS (existing "Saturday, September 12" and "First heat 8:00" tests still pass). Then `npm run lint && npm run typecheck && npm test`.

Refactor assessment: `longDay` vs the sign-up page's own label (Task 4) differ on purpose (sign-up includes the year) — not duplicated knowledge.

```bash
git add src/core/format.ts src/ui/day-break.ts src/ui/render.ts src/styles.css src/ui/render.test.ts
git commit -m "feat: spectator page separates days and labels multi-day comps"
```

---

### Task 4: Sign-up page — day breaks and label

**Files:**
- Modify: `src/ui/render-signup.ts`
- Test: `src/ui/render-signup.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/ui/render-signup.test.ts` add `makeTwoDaySchedule` to the factories import and append:

```ts
describe("a comp over two days", () => {
  it("names both days and separates an event's heats by day", () => {
    const { root } = renderWith({ schedule: makeTwoDaySchedule() });

    expect(root.querySelector(".footer")?.textContent).toContain("Sat Sep 12 – Sun Sep 13");
    expect(Array.from(root.querySelectorAll('#event-1 [data-testid="day-break"]'), (el) => el.textContent)).toEqual([
      "Sat Sep 12",
      "Sun Sep 13",
    ]);
    expect(root.querySelectorAll('#event-2 [data-testid="day-break"]')).toHaveLength(0);
  });
});
```

Run: `npx vitest run src/ui/render-signup.test.ts` → the new test FAILS.

- [ ] **Step 2: Implement**

In `src/ui/render-signup.ts`:

```ts
import { compDays } from "../core/comp-time";
import { formatDayList, formatRange } from "../core/format";
import { withDayBreaks } from "./day-break";
```

Replace `compDateLabel`:

```ts
const longDay = (schedule: Schedule, date: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: schedule.timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(
    new Date(`${date}T12:00:00Z`),
  );

const compDaysLabel = (schedule: Schedule): string => {
  const days = compDays(schedule);
  const only = days.length === 1 ? days[0] : undefined;
  return only === undefined ? formatDayList(days) : longDay(schedule, only);
};
```

Rename both uses (header `signup-date`, footer) to `compDaysLabel(schedule)`.

In `eventHtml` replace the heats line:

```ts
    ${withDayBreaks({ heats: event.heats, heatHtml: (heat) => heatHtml({ ...options, heat, alreadyIn: mine !== undefined }) })}
```

- [ ] **Step 3: Run, check, commit**

Run: `npx vitest run src/ui/render-signup.test.ts` → PASS; `npm run lint && npm run typecheck && npm test`.

```bash
git add src/ui/render-signup.ts src/ui/render-signup.test.ts
git commit -m "feat: sign-up page separates days and labels multi-day comps"
```

---

### Task 5: Judge page — weekday on multi-day comps

**Files:**
- Modify: `src/ui/render-judge.ts`
- Test: `src/ui/render-judge.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/ui/render-judge.test.ts` add `makeTwoDaySchedule` to the factories import and append:

```ts
describe("a comp over two days", () => {
  it("adds the weekday to the heat label", () => {
    const schedule = makeTwoDaySchedule();
    const event = schedule.events[0];
    if (!event) throw new Error("fixture has no event");

    const { root } = renderWith({ schedule, event, lane: 1, now: at("18:03", "2026-09-12") });

    expect(getByTestId(root, "heat-label")).toHaveTextContent("Heat 1 of 2 · Sat");
  });

  it("leaves the label alone on a single-day comp", () => {
    expect(getByTestId(renderWith().root, "heat-label").textContent).not.toContain("·");
  });
});
```

Run: `npx vitest run src/ui/render-judge.test.ts` → the first FAILS, the second passes.

- [ ] **Step 2: Implement**

In `src/ui/render-judge.ts` import:

```ts
import { compDays } from "../core/comp-time";
import { formatWeekday } from "../core/format";
```

(merge with any existing import from `../core/format`), then replace `heatSelectorHtml`:

```ts
const heatDayLabel = (schedule: Schedule, heat: Heat | undefined): string =>
  heat && compDays(schedule).length > 1 ? ` · ${formatWeekday(heat.date)}` : "";

const heatSelectorHtml = (options: RenderJudgeOptions, index: number, sent: boolean): string => {
  const total = options.event.heats.length;
  const heat = options.event.heats[index];
  return `
  <div class="heat-selector">
    <button type="button" id="prev-heat" aria-label="Previous heat" ${index === 0 ? "disabled" : ""}>◀</button>
    <div class="heat-label" data-testid="heat-label">Heat ${heat?.number ?? ""} of ${total}${heatDayLabel(options.schedule, heat)}${sent ? ' <span aria-label="score sent">✓</span>' : ""}</div>
    <button type="button" id="next-heat" aria-label="Next heat" ${index === total - 1 ? "disabled" : ""}>▶</button>
  </div>`;
};
```

Add `Heat` and `Schedule` to the `../core/types` type import if not already imported.

- [ ] **Step 3: Run, check, commit**

Run: `npx vitest run src/ui/render-judge.test.ts` → PASS; `npm run lint && npm run typecheck && npm test`.

```bash
git add src/ui/render-judge.ts src/ui/render-judge.test.ts
git commit -m "feat: judge heat label shows the weekday on multi-day comps"
```

---

### Task 6: Intermediate workout

**Files:**
- Modify: `src/core/types.ts`, `src/core/schedule-schema.ts`, `src/test/factories.ts`, `src/ui/render-workout.ts`, `src/ui/render.ts`, `src/ui/render-signup.ts`
- Test: `src/core/schedule-schema.test.ts`, `src/ui/render-judge.test.ts`, `src/ui/render.test.ts`, `src/ui/render-signup.test.ts`

- [ ] **Step 1: Type and factory default**

`src/core/types.ts` `Event`: add `readonly intermediate: string;` after `rx`. `src/test/factories.ts` `makeEvent`: add `intermediate: "",` after `rx: "rx",` (leave `makeRawEvent` without it — the Sheet may not have the column).

- [ ] **Step 2: Failing decoder test**

Append to `src/core/schedule-schema.test.ts`:

```ts
describe("the Intermediate workout", () => {
  it("is read from the sheet, and blank when the sheet has none", () => {
    const withIt = decodeSchedule(makeRawSchedule({ events: [makeRawEvent({ intermediate: " 10 Slam Balls (20/14) " })] }));
    const without = decodeSchedule(makeRawSchedule());

    expect(withIt.success && withIt.data.events[0]?.intermediate).toBe("10 Slam Balls (20/14)");
    expect(without.success && without.data.events[0]?.intermediate).toBe("");
  });
});
```

Run: `npx vitest run src/core/schedule-schema.test.ts` → FAILS (and the "documented shape" test fails: decoded event lacks `intermediate`).

- [ ] **Step 3: Decode it**

In `decodeEvent`'s returned object, after `rx`:

```ts
    intermediate: optionalText(value, "intermediate"),
```

Run the file → PASS.

- [ ] **Step 4: Failing workout-card tests (judge page)**

Append inside `describe("the workout", …)` in `src/ui/render-judge.test.ts`, after its existing `highlighted` helper (which returns the text of the `aria-current` lines):

```ts
  it("lists RX, Intermediate and Scaled, and highlights Intermediate for an Intermediate division", () => {
    const wod = makeEvent({
      ...amrap,
      rx: "10 Slam Balls (25/20)",
      intermediate: "10 Slam Balls (20/14)",
      scaled: "10 Slam Balls (15/10)",
      heats: [makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 5, division: "F/F Intermediate" })] })],
    });
    const { root } = renderWith({ event: wod });
    const workout = getByTestId(root, "workout");

    expect(workout.textContent?.replace(/\s+/g, " ")).toMatch(/RX 10 Slam Balls \(25\/20\).*Intermediate 10 Slam Balls \(20\/14\).*Scaled 10 Slam Balls \(15\/10\)/);
    expect(highlighted(root)).toEqual(["Intermediate 10 Slam Balls (20/14)"]);
  });

  it("has no Intermediate line when the event has none", () => {
    expect(getByTestId(renderWith().root, "workout")).not.toHaveTextContent("Intermediate");
  });
```

Rendering doesn't validate divisions, so "F/F Intermediate" needs no entry in the schedule's divisions.

Run: `npx vitest run src/ui/render-judge.test.ts` → the first FAILS.

- [ ] **Step 5: Implement the workout card**

`src/ui/render-workout.ts`:

```ts
type WorkoutVersion = "rx" | "intermediate" | "scaled";

const versionForDivision = (division: string | undefined): WorkoutVersion | undefined => {
  if (division && /\bscaled\b/i.test(division)) return "scaled";
  if (division && /\bintermediate\b/i.test(division)) return "intermediate";
  if (division && /\brx\b/i.test(division)) return "rx";
  return undefined;
};
```

and in `workoutHtml`, between the RX and Scaled lines:

```ts
    ${event.intermediate ? wodLineHtml({ label: "Intermediate", text: event.intermediate, theirs: version === "intermediate" }) : ""}
```

Run the file → PASS.

- [ ] **Step 6: Failing spectator and sign-up tests**

Append to `src/ui/render.test.ts`:

```ts
describe("the Intermediate workout", () => {
  it("is listed between RX and Scaled when the event has one, and absent otherwise", () => {
    const root = renderSchedule(
      makeSchedule({ events: [makeEvent({ number: 1, intermediate: "10 Slam Balls (20/14)" }), makeEvent({ number: 2 })] }),
    );

    expect(root.querySelector("#event-1 .event-header")?.textContent?.replace(/\s+/g, " ")).toMatch(/RX rx Intermediate 10 Slam Balls \(20\/14\) Scaled scaled/);
    expect(root.querySelector("#event-2 .event-header")?.textContent).not.toContain("Intermediate");
  });
});
```

Append to `src/ui/render-signup.test.ts`:

```ts
describe("the Intermediate workout", () => {
  it("is listed in the event header when the event has one", () => {
    const { root } = renderWith({ schedule: makeSchedule({ events: [makeEvent({ intermediate: "10 Slam Balls (20/14)" })] }) });

    expect(root.querySelector("#event-1 .event-header")).toHaveTextContent("Intermediate 10 Slam Balls (20/14)");
  });
});
```

Run both files → the new tests FAIL.

- [ ] **Step 7: Implement the two event headers**

In both `src/ui/render.ts` and `src/ui/render-signup.ts` `eventHtml`, between the RX and Scaled `event-wod` lines:

```ts
      ${event.intermediate ? `<div class="event-wod"><span class="wod-label">Intermediate</span> ${esc(event.intermediate)}</div>` : ""}
```

- [ ] **Step 8: Run, check, commit**

Run both files → PASS; `npm run lint && npm run typecheck && npm test`.

Refactor assessment: the RX/Intermediate/Scaled line list now appears in three places (`workoutHtml`, spectator header, sign-up header). The spectator and sign-up headers are identical knowledge ("how an event header lists its workouts"). If the reviewer agrees, extract `eventWodLinesHtml(event)` into `render-workout.ts` and use it from both headers (not from `workoutHtml`, whose lines carry highlighting). Re-run tests after; commit separately as `refactor:`.

```bash
git add src/core/types.ts src/core/schedule-schema.ts src/test/factories.ts src/ui/render-workout.ts src/ui/render.ts src/ui/render-signup.ts src/core/schedule-schema.test.ts src/ui/render-judge.test.ts src/ui/render.test.ts src/ui/render-signup.test.ts
git commit -m "feat: events can list an Intermediate workout"
```

---

### Task 7: Apps Script reads the new columns

**Files:**
- Modify: `apps-script/Code.gs`

No repo harness for `Code.gs`; verified by syntax check here and by `curl` in Task 9.

- [ ] **Step 1: Headers**

```js
const EVENT_HEADERS = ["event", "title", "format", "scoring", "capSeconds", "rx", "intermediate", "scaled", "lanes"];
const HEAT_HEADERS = ["event", "heat", "date", "start", "end"];
```

- [ ] **Step 2: Read them**

In `readEvents`, after `rx: asText(row.rx),`:

```js
      intermediate: asText(row.intermediate),
```

In `readHeat`, replace the return line:

```js
  return { number: number, date: asDateString(row.date, sheetZone), start: asClock(row.start, sheetZone), end: asClock(row.end, sheetZone), lanes: lanes };
```

- [ ] **Step 3: New-Sheet setup**

In `setupHeats`, replace the body of the callback:

```js
    sheet.getRange("C2:E").setNumberFormat("@");
    sheet.getRange("A1").setNote("One row per heat. date is YYYY-MM-DD; leave it blank to use Settings → compDate. start/end as 24-hour HH:MM text in the comp time zone, e.g. 08:00 or 13:30.");
```

In `setupEvents`, extend the A1 note by appending: ` rx / intermediate / scaled are the workout versions; leave intermediate blank if there is none.` (inside the existing string, before the closing quote).

- [ ] **Step 4: Check and commit**

Run: `cp apps-script/Code.gs "$SCRATCH/Code.js" && node --check "$SCRATCH/Code.js"` (SCRATCH = any directory outside the repo) and `node "$SCRATCH/refresh-fallback-check.mjs" apps-script/Code.gs` if that throwaway check still exists (it should still print `refresh-fallback checks passed`).

```bash
git add apps-script/Code.gs
git commit -m "feat: Sheet script reads heat dates and Intermediate workouts"
```

---

### Task 8: Docs and spec corrections

**Files:**
- Modify: `docs/deploy.md`, `README.md`, `docs/superpowers/specs/2026-09-29-multi-day-and-intermediate-design.md`

- [ ] **Step 1: `docs/deploy.md` §2 (Each year: define the comp in the Sheet)**

- In step 3 (**Events**), append: "`rx`, `intermediate` and `scaled` are the workout versions; leave `intermediate` blank if the event has none."
- Replace step 4 (**Heats**) with:

```markdown
4. **Heats** — one row per event × heat. `date` (`YYYY-MM-DD`) is the day
   the heat runs; leave it blank to use `compDate` from `Settings`, so a
   one-day comp needs no dates at all. An event can have heats on more than
   one day. `start`/`end` are 24-hour `HH:MM` text (e.g. `08:00`, `13:30` —
   not `1:30 PM`). Heats on different days may share a time; heats on the
   same day of the same event must not overlap.
```

- In step 2 (**Divisions**), append: "A division whose name contains `RX`, `Intermediate` or `Scaled` gets that workout highlighted on the judge page (e.g. `F/F Intermediate`)."

- [ ] **Step 2: Migration section**

Add after §4a:

```markdown
## 4b. Adding heat dates and Intermediate to an existing Sheet

1. `Heats`: add a column headed `date` (anywhere — columns are read by
   name). Fill it only for heats that aren't on `compDate`. Format the
   column as Plain text, or type dates as `'2027-10-02`.
2. `Events`: add a column headed `intermediate`.
3. Paste the current `Code.gs` (1b) and deploy a **new version**
   (section 4). The site and script can be updated in either order.
4. **12th State → Update site fallback**.
```

- [ ] **Step 3: Troubleshooting rows** (append to §5):

```markdown
| Amber "Heats: Event 1 Heat 3: date "…" must be YYYY-MM-DD" | The `date` cell isn't a date | Type it as `2027-10-02`, or clear it to use `compDate` |
| Amber "Heats: Event 1 Heat 3: date "…" is not a real date" | e.g. `2027-02-30` | Fix the date |
| A heat shows on the wrong day | Its `date` is blank, so it uses `compDate` | Fill in its `date` |
```

- [ ] **Step 4: README** — in "Previewing a different time", after the three examples add: "On a multi-day comp, the date part picks the day, e.g. `?at=2027-10-02T07:45`."

- [ ] **Step 5: Spec corrections** (found while planning) in the spec:

- In "Types and decoding", add: "`validateSchedule`'s overlap check compares heats only within the same date (a Saturday 8:00 heat doesn't overlap a Friday 8:00 heat)."
- In "Judge and head judge pages", replace the second bullet with: "When the comp has more than one day, the judge heat label adds the weekday: `Heat 3 of 5 · Sat`. The head-judge page lists events, not heats, so it only gains the Intermediate line."
- In the banner table, change the `not-comp-day` row's formats to "a single day keeps today's long label (`Saturday, October 2`); several days use short labels — consecutive `Fri Oct 1 – Sat Oct 2`, otherwise `Fri Oct 1 & Sun Oct 3` (`Fri Oct 1, Sat Oct 2 & Mon Oct 4`)", and the footer sentence likewise.

- [ ] **Step 6: Commit**

```bash
git add docs/deploy.md README.md docs/superpowers/specs/2026-09-29-multi-day-and-intermediate-design.md
git commit -m "docs: heat dates, 24-hour times and the Intermediate workout"
```

---

### Task 9: Ship and verify

Steps marked **(you)** need the Sheet owner.

- [ ] **Step 1: Push** — `git push origin main`; `gh run watch` the deploy until success.

- [ ] **Step 2 (you): Sheet** — follow `docs/deploy.md` §4b: add `date` to `Heats`, `intermediate` to `Events`, paste `Code.gs`, deploy a new version.

- [ ] **Step 3: Endpoint** — `curl -sL "$(sed -n 's/.*"\(https:[^"]*\)".*/\1/p' src/data/sheet-endpoint.ts)" | head -c 1500`
Expected: heats have `"date":` (`""` where blank), events have `"intermediate":`.

- [ ] **Step 4 (you): Try it** — give one heat tomorrow's date and one event an Intermediate workout; open https://12thstatecomp.com/ (and `?at=<that date>T07:00`). Expected: a day divider in that event, the banner/footer naming both days, an Intermediate line. Then restore the real values (or keep them if they're real) and **12th State → Update site fallback**.
