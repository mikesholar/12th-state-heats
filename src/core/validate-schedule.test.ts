import { validateSchedule } from "./validate-schedule";
import { makeDivision, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

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

  it("rejects a schedule with no events", () => {
    expect(validateSchedule(makeSchedule({ events: [] }))).toEqual(["Events: must list at least one event"]);
  });

  it("rejects an empty division list without also flagging every lane", () => {
    const schedule = makeSchedule({ divisions: [], events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ lane: 1 })] })] })] });

    expect(validateSchedule(schedule)).toEqual(["divisions must list at least one division"]);
  });

  it("rejects a lane whose division is not in the list", () => {
    const schedule = makeSchedule({
      divisions: [makeDivision({ name: "RX" }), makeDivision({ name: "Scaled" })],
      events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ lane: 3, division: "Open" })] })] })],
    });

    expect(validateSchedule(schedule)).toEqual(['Event 1 Heat 1: lane 3 division "Open" is not one of RX, Scaled']);
  });

  it("rejects a division with a team size below one", () => {
    const schedule = makeSchedule({ divisions: [makeDivision({ name: "Solo", teamSize: 0 })], events: [makeEvent({ heats: [makeHeat({ lanes: [] })] })] });

    expect(validateSchedule(schedule)).toEqual(['Divisions: "Solo" teamSize must be at least 1']);
  });

  it("rejects duplicate division names", () => {
    const schedule = makeSchedule({ divisions: [makeDivision({ name: "RX" }), makeDivision({ name: "RX" })], events: [makeEvent({ heats: [makeHeat({ lanes: [] })] })] });

    expect(validateSchedule(schedule)).toEqual(['Divisions: "RX" appears more than once']);
  });

  it("accepts heats listed out of chronological order when they do not overlap", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ heats: [makeHeat({ number: 2, start: "08:13", end: "08:21" }), makeHeat({ number: 1, start: "08:00", end: "08:08" })] })],
    });

    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("reports an overlap with an earlier heat that is not the immediately preceding one", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({
          heats: [
            makeHeat({ number: 1, start: "08:00", end: "08:30" }),
            makeHeat({ number: 2, start: "08:05", end: "08:10" }),
            makeHeat({ number: 3, start: "08:20", end: "08:25" }),
          ],
        }),
      ],
    });

    expect(validateSchedule(schedule)).toEqual([
      "Event 1 Heat 2: starts 08:05, overlaps Heat 1 ending 08:30",
      "Event 1 Heat 3: starts 08:20, overlaps Heat 1 ending 08:30",
    ]);
  });

  it("accepts back-to-back heats", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ heats: [makeHeat({ number: 1, start: "08:00", end: "08:08" }), makeHeat({ number: 2, start: "08:08", end: "08:16" })] })],
    });

    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("rejects a zero-length heat", () => {
    const schedule = makeSchedule({ events: [makeEvent({ heats: [makeHeat({ start: "08:00", end: "08:00" })] })] });

    expect(validateSchedule(schedule)).toEqual(["Event 1 Heat 1: end 08:00 is not after start 08:00"]);
  });

  it("rejects an event with fewer than one lane", () => {
    const schedule = makeSchedule({ events: [makeEvent({ lanes: 0, heats: [makeHeat({ lanes: [] })] })] });

    expect(validateSchedule(schedule)).toEqual(["Event 1: lanes must be at least 1"]);
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
