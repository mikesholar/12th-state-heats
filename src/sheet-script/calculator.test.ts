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
});
