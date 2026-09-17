import { decodeSchedule } from "./schedule-schema";
import { makeRawEvent, makeRawHeat, makeRawLane, makeRawSchedule, makeSchedule, makeEvent, makeHeat, makeLane } from "../test/factories";

const errorOf = (value: unknown): string => {
  const result = decodeSchedule(value);
  return result.success ? "" : result.error;
};

describe("decoding the schedule JSON", () => {
  it("turns the documented shape into a Schedule", () => {
    const result = decodeSchedule(makeRawSchedule());

    expect(result).toEqual({
      success: true,
      data: makeSchedule({
        events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ email: "a@example.com" })] })] })],
      }),
    });
  });

  it("omits email and capSeconds when they are blank", () => {
    const raw = makeRawSchedule({
      events: [makeRawEvent({ capSeconds: "", heats: [makeRawHeat({ lanes: [makeRawLane({ email: "" })] })] })],
    });

    const result = decodeSchedule(raw);

    expect(result.success && result.data.events[0]?.heats[0]?.lanes[0]).toEqual(makeLane());
    expect(result.success && "capSeconds" in (result.data.events[0] ?? {})).toBe(false);
  });

  it("accepts numbers written as strings and trims text", () => {
    const raw = makeRawSchedule({
      teamSize: "2",
      events: [makeRawEvent({ number: "1", lanes: "8", capSeconds: "480", scoring: "time-or-rounds", title: "  12th Gear " })],
    });

    const result = decodeSchedule(raw);

    expect(result.success && result.data.events[0]?.capSeconds).toBe(480);
    expect(result.success && result.data.events[0]?.title).toBe("12th Gear");
  });

  it("rejects anything that is not an object", () => {
    expect(errorOf(null)).toBe("Schedule is not an object");
    expect(errorOf([])).toBe("Schedule is not an object");
  });

  it("names the setting that is wrong", () => {
    expect(errorOf(makeRawSchedule({ compDate: "9/11/27" }))).toBe('Settings: compDate "9/11/27" must be YYYY-MM-DD');
    expect(errorOf(makeRawSchedule({ timeZone: "" }))).toBe("Settings: timeZone is missing");
    expect(errorOf(makeRawSchedule({ teamSize: "two" }))).toBe('Settings: teamSize "two" must be a whole number');
    expect(errorOf(makeRawSchedule({ divisions: "RX" }))).toBe("Settings: divisions must be a list");
    expect(errorOf(makeRawSchedule({ signupsOpen: "yes" }))).toBe("Settings: signupsOpen must be TRUE or FALSE");
    expect(errorOf(makeRawSchedule({ events: {} }))).toBe("Events: must be a list");
  });

  it("names the event that is wrong", () => {
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ number: "" })] }))).toBe('Events: number "" must be a whole number');
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ title: " " })] }))).toBe("Events: Event 1: title is missing");
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ number: 2, scoring: "amrap" })] }))).toBe(
      'Events: Event 2: scoring "amrap" must be time-or-rounds or rounds-reps',
    );
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ lanes: "eight" })] }))).toBe('Events: Event 1: lanes "eight" must be a whole number');
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats: "none" })] }))).toBe("Events: Event 1: heats must be a list");
  });

  it("names the heat that is wrong", () => {
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats: [makeRawHeat({ number: "x" })] })] }))).toBe(
      'Heats: Event 1: number "x" must be a whole number',
    );
    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats: [makeRawHeat({ number: 3, end: "8:21" })] })] }))).toBe(
      'Heats: Event 1 Heat 3: end "8:21" must be HH:MM',
    );
  });

  it("names the lane that is wrong", () => {
    const heats = [makeRawHeat({ number: 2, lanes: [makeRawLane({ lane: 4, team: "" })] })];

    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats })] }))).toBe("Slots: Event 1 Heat 2 lane 4: team is missing");
  });

  it("reports every semantic problem after the shape is right", () => {
    const heats = [makeRawHeat({ start: "08:26", end: "08:21", lanes: [makeRawLane({ lane: 9 })] })];

    expect(errorOf(makeRawSchedule({ events: [makeRawEvent({ heats })] }))).toBe(
      "Event 1 Heat 1: lane 9 is outside 1–8; Event 1 Heat 1: end 08:21 is not after start 08:26",
    );
  });
});
