import { compDayOf, heatInstants } from "./comp-time";
import { makeHeat, makeSchedule } from "../test/factories";

describe("heat instants", () => {
  it("converts comp-local heat times to absolute instants in the comp timezone", () => {
    const schedule = makeSchedule();
    const heat = makeHeat({ start: "09:10", end: "09:20" });

    const { start, end } = heatInstants(schedule, heat);

    expect(start.toISOString()).toBe("2026-09-12T13:10:00.000Z");
    expect(end.toISOString()).toBe("2026-09-12T13:20:00.000Z");
  });

  it("handles afternoon times past noon", () => {
    const { end } = heatInstants(makeSchedule(), makeHeat({ start: "12:48", end: "13:00" }));

    expect(end.toISOString()).toBe("2026-09-12T17:00:00.000Z");
  });
});

describe("comp day of an instant", () => {
  it("reports the calendar date in the comp timezone, not UTC", () => {
    const lateEvening = new Date("2026-09-13T02:00:00Z");

    expect(compDayOf(lateEvening, "America/New_York")).toBe("2026-09-12");
  });
});
