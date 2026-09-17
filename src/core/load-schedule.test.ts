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
