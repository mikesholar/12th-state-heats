import { schedule } from "./schedule";
import { judgeCodes } from "./judge-codes";
import { validateSchedule } from "../core/validate-schedule";

const laneFor = (team: string) =>
  schedule.events.map((event) => {
    const heat = event.heats.find((h) => h.lanes.some((l) => l.team === team));
    const lane = heat?.lanes.find((l) => l.team === team);
    return { event: event.number, heat: heat?.number, lane: lane?.lane };
  });

describe("the shipped schedule", () => {
  it("passes validation except for the one gap present in the source PDFs", () => {
    expect(validateSchedule(schedule)).toEqual(['"Jointly Unstable" is missing from Event 3']);
  });

  it("has three events of five heats each", () => {
    expect(schedule.events.map((e) => e.heats.length)).toEqual([5, 5, 5]);
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
  const laneAssignments = Object.values(judgeCodes).filter((a) => a.kind === "lane");

  it("cover every event and lane in the schedule exactly once", () => {
    const expected = schedule.events.flatMap((event) =>
      [...new Set(event.heats.flatMap((h) => h.lanes.map((l) => l.lane)))].map((lane) => `e${event.number}l${lane}`),
    );
    const actual = laneAssignments.map((a) => (a.kind === "lane" ? `e${a.event}l${a.lane}` : ""));

    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it("have exactly one head judge code", () => {
    expect(Object.values(judgeCodes).filter((a) => a.kind === "head")).toHaveLength(1);
  });

  it("are five lowercase alphanumerics", () => {
    Object.keys(judgeCodes).forEach((code) => expect(code).toMatch(/^[a-z0-9]{5}$/));
  });
});
