import { validateSchedule } from "./validate-schedule";
import { makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

const lanes = (count: number) => Array.from({ length: count }, (_, i) => makeLane({ lane: i + 1, team: `Team ${i + 1}` }));

describe("schedule validation", () => {
  it("accepts a well-formed schedule", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({ number: 1, heats: [makeHeat({ lanes: lanes(7) })] }),
        makeEvent({ number: 2, heats: [makeHeat({ start: "09:10", end: "09:20", lanes: lanes(8) })] }),
      ],
    });

    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("accepts a heat with no lanes claimed yet", () => {
    const schedule = makeSchedule({ events: [makeEvent({ heats: [makeHeat({ lanes: [] })] })] });

    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("rejects two teams sharing a lane in the same heat", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ heats: [makeHeat({ lanes: [...lanes(6), makeLane({ lane: 3, team: "Team 7" })] })] })],
    });

    expect(validateSchedule(schedule)).toEqual(["Event 1 Heat 1: lane 3 is assigned to more than one team"]);
  });

  it("rejects a lane number outside the event's lane count", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ lanes: 8, heats: [makeHeat({ lanes: [makeLane({ lane: 9 }), makeLane({ lane: 0, team: "Zero" })] })] })],
    });

    expect(validateSchedule(schedule)).toEqual([
      "Event 1 Heat 1: lane 9 is outside 1–8",
      "Event 1 Heat 1: lane 0 is outside 1–8",
    ]);
  });

  it("allows a team to skip an event", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({ number: 1, heats: [makeHeat({ lanes: lanes(2) })] }),
        makeEvent({ number: 2, heats: [makeHeat({ lanes: [makeLane({ lane: 1, team: "Team 1" })] })] }),
      ],
    });

    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("rejects overlapping heats within an event", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({
          heats: [makeHeat({ number: 1, start: "08:00", end: "08:08" }), makeHeat({ number: 2, start: "08:05", end: "08:13" })],
        }),
      ],
    });

    expect(validateSchedule(schedule)).toEqual(["Event 1 Heat 2: starts 08:05, overlaps Heat 1 ending 08:08"]);
  });

  it("rejects a heat that ends before it starts", () => {
    const schedule = makeSchedule({ events: [makeEvent({ heats: [makeHeat({ number: 3, start: "08:26", end: "08:21" })] })] });

    expect(validateSchedule(schedule)).toEqual(["Event 1 Heat 3: end 08:21 is not after start 08:26"]);
  });

  it("rejects an event with no heats", () => {
    const schedule = makeSchedule({ events: [makeEvent({ number: 1, heats: [] })] });

    expect(validateSchedule(schedule)).toEqual(["Event 1: has no heats"]);
  });

  it("rejects duplicate heat numbers within an event", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ heats: [makeHeat({ number: 2, start: "08:00", end: "08:08" }), makeHeat({ number: 2, start: "08:13", end: "08:21" })] })],
    });

    expect(validateSchedule(schedule)).toEqual(["Event 1: Heat 2 appears more than once"]);
  });

  it("rejects duplicate event numbers", () => {
    const schedule = makeSchedule({ events: [makeEvent({ number: 2 }), makeEvent({ number: 2 })] });

    expect(validateSchedule(schedule)).toEqual(["Event 2 appears more than once"]);
  });

  it("rejects a team size below one", () => {
    expect(validateSchedule(makeSchedule({ teamSize: 0 }))).toEqual(["teamSize must be at least 1"]);
  });

  it("rejects an empty division list without also flagging every lane", () => {
    const schedule = makeSchedule({ divisions: [], events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ lane: 1 })] })] })] });

    expect(validateSchedule(schedule)).toEqual(["divisions must list at least one division"]);
  });

  it("rejects a lane whose division is not in the list", () => {
    const schedule = makeSchedule({
      divisions: ["RX", "Scaled"],
      events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ lane: 3, division: "Open" })] })] })],
    });

    expect(validateSchedule(schedule)).toEqual(['Event 1 Heat 1: lane 3 division "Open" is not one of RX, Scaled']);
  });
});

describe("scoring configuration", () => {
  it("rejects a time-or-rounds event with no cap", () => {
    const schedule = makeSchedule({ events: [makeEvent({ number: 1, scoring: "time-or-rounds" })] });

    expect(validateSchedule(schedule)).toContain("Event 1: scoring is time-or-rounds but capSeconds is missing");
  });

  it("rejects a rounds-reps event that has a cap", () => {
    const schedule = makeSchedule({ events: [makeEvent({ number: 2, scoring: "rounds-reps", capSeconds: 600 })] });

    expect(validateSchedule(schedule)).toContain("Event 2: scoring is rounds-reps but capSeconds is set");
  });

  it("accepts a time-or-rounds event with a cap", () => {
    const schedule = makeSchedule({ events: [makeEvent({ scoring: "time-or-rounds", capSeconds: 480 })] });

    expect(validateSchedule(schedule)).toEqual([]);
  });
});
