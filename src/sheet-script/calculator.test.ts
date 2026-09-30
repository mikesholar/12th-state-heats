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

  it("refuses a heat that would end after midnight", () => {
    const rows = [makeRow({ start: "23:40" })];

    expect(planHeats(makePlanInput({ rows }))).toEqual({ ok: false, error: "Row 4: heat 2 would end after midnight (24:07)" });
  });

  it("refuses two blocks that overlap on the same day", () => {
    const rows = [makeRow(), makeRow({ row: 5, start: "18:20" })];

    expect(planHeats(makePlanInput({ rows }))).toEqual({ ok: false, error: "Row 5 starts 18:20, before row 4's last heat ends 18:27" });
  });

  it("refuses more heats in a block than fit in a day", () => {
    const result = planHeats(makePlanInput({ rows: [makeRow({ row: 5, heats: 100000 })] }));

    expect(result).toEqual({ ok: false, error: "Row 5: heats can't be more than 1440 in one day" });
  });

  it("only takes plain whole numbers", () => {
    const result = planHeats(makePlanInput({ rows: [makeRow({ row: 5, length: "1e1" })] }));

    expect(result).toEqual({ ok: false, error: "Row 5: length must be a whole number of at least 1" });
  });

  it("gives the same heats for numbers typed as text", () => {
    const asText = planHeats(makePlanInput({ rows: [makeRow({ length: "12", buffer: " 3 ", heats: "2" })] }));

    expect(asText).toEqual(planHeats(makePlanInput()));
  });

  it("allows a block to start exactly when the previous one ends", () => {
    const rows = [makeRow(), makeRow({ row: 5, start: "18:27", heats: 1 })];

    expect(planHeats(makePlanInput({ rows }))).toMatchObject({ ok: true, heats: [{ heat: 1 }, { heat: 2 }, { heat: 3, start: "18:27" }] });
  });

  it("refuses a heat ending exactly at midnight but allows one ending at 23:59", () => {
    const endingAt = (start: string) => planHeats(makePlanInput({ rows: [makeRow({ start, heats: 1 })] }));

    expect(endingAt("23:48")).toEqual({ ok: false, error: "Row 4: heat 1 would end after midnight (24:00)" });
    expect(endingAt("23:47")).toMatchObject({ ok: true, heats: [{ start: "23:47", end: "23:59" }] });
  });
});

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

  it("does not write prototype members into columns it has no value for", () => {
    const values = [["event", "heat", "date", "start", "end", "constructor"]];
    const result = heatsTableAfter({ values, event: 1, heats: threeHeats.slice(0, 1), zone: "UTC" });

    expect(result).toMatchObject({ values: [values[0], [1, 1, "2027-10-02", "18:00", "18:12", ""]] });
  });

  it("drops rows that only hold whitespace", () => {
    const values = [HEADER, ["  ", "", "", "", "", ""], [2, 1, "", "09:00", "09:10", ""]];

    expect(heatsTableAfter({ values, event: 1, heats: [], zone: "UTC" })).toMatchObject({
      values: [HEADER, [2, 1, "", "09:00", "09:10", ""]],
    });
  });
});

describe("the confirm message with incomplete sign-up rows", () => {
  it("ignores sign-ups with no heat", () => {
    expect(writeSummary({ event: 1, heats: threeHeats, existingHeatCount: 3, claims: [makeClaim({ heat: "" })] })).toEqual({
      title: "Write Event 1's heats?",
      message: "Replace Event 1's 3 heats with 3 heats (Sat Oct 2: 2, Sun Oct 3: 1)?",
    });
  });

  it("names a dropped sign-up with no team name", () => {
    expect(writeSummary({ event: 1, heats: threeHeats, existingHeatCount: 4, claims: [makeClaim({ heat: 4, team: "" })] })).toMatchObject({
      message: expect.stringContaining("Heat 4 lane 1 (no team name)."),
    });
  });
});
