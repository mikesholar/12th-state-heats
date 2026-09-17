import { snapshotSchedule as schedule } from "./snapshot";
import { judgeCodes, signupCode } from "./judge-codes";

const laneFor = (team: string) =>
  schedule.events.map((event) => {
    const heat = event.heats.find((h) => h.lanes.some((l) => l.team === team));
    const lane = heat?.lanes.find((l) => l.team === team);
    return { event: event.number, heat: heat?.number, lane: lane?.lane };
  });

describe("the committed snapshot", () => {
  it("pins the 2026 settings", () => {
    expect(schedule.compDate).toBe("2026-09-12");
    expect(schedule.teamSize).toBe(2);
  });

  it("carries no member emails (it is committed to a public repo)", () => {
    expect(schedule.events.flatMap((e) => e.heats.flatMap((h) => h.lanes)).some((l) => l.email !== undefined)).toBe(false);
  });

  it("has three events of five heats each, eight lanes wide", () => {
    expect(schedule.events.map((e) => e.heats.length)).toEqual([5, 5, 5]);
    expect(schedule.events.map((e) => e.lanes)).toEqual([8, 8, 8]);
  });

  it("has 37 distinct teams, 36 of which appear in Event 3", () => {
    const teamsIn = (eventIndex: number) =>
      new Set(schedule.events[eventIndex]?.heats.flatMap((h) => h.lanes.map((l) => l.team)));
    expect(teamsIn(0).size).toBe(37);
    expect(teamsIn(1).size).toBe(37);
    expect(teamsIn(2).size).toBe(36);
  });

  it("puts 12th State Dumpys in lane 5 of Event 1 Heat 2 (correcting the PDF's duplicate lane 6)", () => {
    expect(laneFor("12th State Dumpys")[0]).toEqual({ event: 1, heat: 2, lane: 5 });
    expect(laneFor("Couple of Cooters")[0]).toEqual({ event: 1, heat: 2, lane: 6 });
  });

  it("places Fast but Questionable as transcribed", () => {
    expect(laneFor("Fast but Questionable")).toEqual([
      { event: 1, heat: 2, lane: 8 },
      { event: 2, heat: 1, lane: 8 },
      { event: 3, heat: 5, lane: 2 },
    ]);
  });

  it("ends the day at 1:00 PM", () => {
    expect(schedule.events[2]?.heats[4]?.end).toBe("13:00");
  });
});

describe("the shipped judge codes", () => {
  const laneKeys = Object.values(judgeCodes).flatMap((a) => (a.kind === "lane" ? [`e${a.event}l${a.lane}`] : []));

  it("cover every event and lane in the snapshot", () => {
    const needed = schedule.events.flatMap((event) => Array.from({ length: event.lanes }, (_, i) => `e${event.number}l${i + 1}`));

    needed.forEach((key) => expect(laneKeys).toContain(key));
  });

  it("cover a 6-event by 12-lane grid so the Sheet can grow without regenerating", () => {
    expect(laneKeys).toHaveLength(6 * 12);
    expect(laneKeys).toContain("e6l12");
  });

  it("have exactly one head judge code", () => {
    expect(Object.values(judgeCodes).filter((a) => a.kind === "head")).toHaveLength(1);
  });

  it("have a sign-up code that is not also a judge code", () => {
    expect(signupCode).toMatch(/^[a-z0-9]{5}$/);
    expect(Object.keys(judgeCodes)).not.toContain(signupCode);
  });

  it("are five lowercase alphanumerics", () => {
    Object.keys(judgeCodes).forEach((code) => expect(code).toMatch(/^[a-z0-9]{5}$/));
  });
});
