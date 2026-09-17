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
