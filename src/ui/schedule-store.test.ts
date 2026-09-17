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
