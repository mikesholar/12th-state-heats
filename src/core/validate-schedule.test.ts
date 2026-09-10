import { validateSchedule } from "./validate-schedule";
import { makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

const sevenLanes = (teamPrefix = "Team"): ReturnType<typeof makeLane>[] =>
  [1, 2, 3, 4, 5, 6, 7].map((lane) => makeLane({ lane, team: `${teamPrefix} ${lane}` }));

const fullHeat = (overrides?: Partial<ReturnType<typeof makeHeat>>) =>
  makeHeat({ lanes: sevenLanes(), ...overrides });

describe("schedule validation", () => {
  it("accepts a well-formed schedule", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({ number: 1, heats: [fullHeat()] }),
        makeEvent({ number: 2, heats: [fullHeat({ start: "09:10", end: "09:20" })] }),
      ],
    });

    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("rejects two teams sharing a lane in the same heat", () => {
    const lanes = [...sevenLanes().slice(0, 6), makeLane({ lane: 3, team: "Team 7" })];
    const schedule = makeSchedule({ events: [makeEvent({ heats: [makeHeat({ lanes })] })] });

    const errors = validateSchedule(schedule);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Event 1 Heat 1");
    expect(errors[0]).toContain("lane 3");
  });

  it("rejects a team that is missing from one of the events", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({ number: 1, heats: [fullHeat()] }),
        makeEvent({
          number: 2,
          heats: [fullHeat({ lanes: [...sevenLanes().slice(0, 6), makeLane({ lane: 7, team: "Team Seven" })] })],
        }),
      ],
    });

    const errors = validateSchedule(schedule);

    expect(errors.some((e) => e.includes('"Team 7"') && e.includes("Event 2"))).toBe(true);
    expect(errors.some((e) => e.includes('"Team Seven"') && e.includes("Event 1"))).toBe(true);
  });

  it("rejects overlapping heats within an event", () => {
    const schedule = makeSchedule({
      events: [
        makeEvent({
          heats: [
            fullHeat({ number: 1, start: "08:00", end: "08:08" }),
            fullHeat({ number: 2, start: "08:05", end: "08:13", lanes: sevenLanes() }),
          ],
        }),
      ],
    });

    const errors = validateSchedule(schedule);

    expect(errors.some((e) => e.includes("Event 1 Heat 2") && e.includes("overlaps"))).toBe(true);
  });

  it("rejects a heat with fewer than seven or more than eight lanes", () => {
    const schedule = makeSchedule({
      events: [makeEvent({ heats: [makeHeat({ lanes: sevenLanes().slice(0, 6) })] })],
    });

    const errors = validateSchedule(schedule);

    expect(errors.some((e) => e.includes("Event 1 Heat 1") && e.includes("6 lanes"))).toBe(true);
  });
});
