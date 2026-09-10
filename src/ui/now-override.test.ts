import { readNowOverride } from "./now-override";

describe("previewing the page at a chosen time", () => {
  it("uses the real clock when no override is given", () => {
    const real = new Date("2026-09-10T20:00:00Z");

    expect(readNowOverride("", real)).toBe(real);
  });

  it("reads an Eastern wall-clock time from ?at=", () => {
    const now = readNowOverride("?at=2026-09-12T08:30", new Date());

    expect(now.toISOString()).toBe("2026-09-12T12:30:00.000Z");
  });

  it("ignores an unparseable override", () => {
    const real = new Date("2026-09-10T20:00:00Z");

    expect(readNowOverride("?at=yesterday", real)).toBe(real);
  });
});
