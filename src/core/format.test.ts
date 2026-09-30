import { formatClock, formatCompDays, formatCountdown, formatRange } from "./format";

describe("clock formatting", () => {
  it("drops the leading zero and shows 12-hour time without a suffix", () => {
    expect(formatClock("08:00")).toBe("8:00");
    expect(formatClock("12:48")).toBe("12:48");
    expect(formatClock("13:00")).toBe("1:00");
  });

  it("formats a heat's time range", () => {
    expect(formatRange("08:13", "08:21")).toBe("8:13 – 8:21");
  });
});

describe("countdown formatting", () => {
  it("says starting now at zero", () => {
    expect(formatCountdown(0)).toBe("starting now");
  });

  it("uses minutes under an hour", () => {
    expect(formatCountdown(42)).toBe("in 42 min");
  });

  it("uses hours and minutes over an hour", () => {
    expect(formatCountdown(72)).toBe("in 1 h 12 min");
  });

  it("omits minutes on an exact hour", () => {
    expect(formatCountdown(120)).toBe("in 2 h");
  });
});

describe("comp days label", () => {
  it("spells out a single day", () => {
    expect(formatCompDays({ days: ["2026-09-12"], withYear: false })).toBe("Saturday, September 12");
  });

  it("adds the year to a single day on request", () => {
    expect(formatCompDays({ days: ["2026-09-12"], withYear: true })).toBe("Saturday, September 12, 2026");
  });

  it("lists several days compactly", () => {
    expect(formatCompDays({ days: ["2026-09-12", "2026-09-13"], withYear: true })).toBe("Sat Sep 12 – Sun Sep 13");
  });
});
