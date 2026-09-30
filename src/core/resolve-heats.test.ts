import { heatPhase, resolveHeats } from "./resolve-heats";
import { comp2026 as schedule } from "../test/comp-2026";
import { at, makeEvent, makeHeat, makeTwoDaySchedule } from "../test/factories";

const label = (ref: { event: { number: number }; heat: { number: number } } | undefined) =>
  ref ? `E${ref.event.number}H${ref.heat.number}` : undefined;

describe("resolving heats from the clock", () => {
  it("before the first heat: nothing running, first heat is next", () => {
    const status = resolveHeats(schedule, at("07:59"));

    expect(status.phase).toBe("before");
    expect(status.phase === "before" && label(status.next)).toBe("E1H1");
  });

  it("at the moment a heat starts it is current and the following heat is next", () => {
    const status = resolveHeats(schedule, at("08:00"));

    expect(status.phase).toBe("during");
    expect(status.phase === "during" && label(status.current)).toBe("E1H1");
    expect(status.phase === "during" && label(status.next)).toBe("E1H2");
  });

  it("in the transition gap between heats of one event nothing is current", () => {
    const status = resolveHeats(schedule, at("08:08"));

    expect(status.phase).toBe("during");
    expect(status.phase === "during" && status.current).toBeUndefined();
    expect(status.phase === "during" && label(status.next)).toBe("E1H2");
  });

  it("between events reports the gap and the next event's first heat", () => {
    const status = resolveHeats(schedule, at("10:20"));

    expect(status.phase).toBe("between-events");
    expect(status.phase === "between-events" && label(status.next)).toBe("E3H1");
  });

  it("during the last heat there is no next", () => {
    const status = resolveHeats(schedule, at("12:59"));

    expect(status.phase).toBe("during");
    expect(status.phase === "during" && label(status.current)).toBe("E3H5");
    expect(status.phase === "during" && status.next).toBeUndefined();
  });

  it("is finished once the last heat ends", () => {
    expect(resolveHeats(schedule, at("13:00")).phase).toBe("finished");
  });

  it("is not comp day on any other date", () => {
    expect(resolveHeats(schedule, at("09:15", "2026-09-11")).phase).toBe("not-comp-day");
    expect(resolveHeats(schedule, at("09:15", "2026-09-13")).phase).toBe("not-comp-day");
  });

  it("resolves a UTC instant against comp-local heat times", () => {
    const status = resolveHeats(schedule, new Date("2026-09-12T13:15:00Z"));

    expect(status.phase === "during" && label(status.current)).toBe("E2H1");
  });
});

describe("phase of a single heat", () => {
  const firstHeat = makeHeat({ start: "08:00", end: "08:08" });

  it("is upcoming before it starts", () => {
    expect(heatPhase(schedule, firstHeat, at("07:59"))).toBe("upcoming");
  });

  it("is current while running", () => {
    expect(heatPhase(schedule, firstHeat, at("08:07"))).toBe("current");
  });

  it("is past once it ends", () => {
    expect(heatPhase(schedule, firstHeat, at("08:08"))).toBe("past");
  });
});

describe("a comp over two days", () => {
  const twoDays = makeTwoDaySchedule();

  it("the day before, it is not a comp day", () => {
    expect(resolveHeats(twoDays, at("12:00", "2026-09-11")).phase).toBe("not-comp-day");
  });

  it("on day one, the first heat is that day's first heat", () => {
    const status = resolveHeats(twoDays, at("17:30", "2026-09-12"));

    expect(status.phase).toBe("before");
    expect(status.phase === "before" && label(status.next)).toBe("E1H1");
  });

  it("during day one's last heat there is no next heat today", () => {
    const status = resolveHeats(twoDays, at("18:05", "2026-09-12"));

    expect(status.phase).toBe("during");
    expect(status.phase === "during" && status.next).toBeUndefined();
  });

  it("after day one's last heat, the day is done and the next heat is tomorrow's first", () => {
    const status = resolveHeats(twoDays, at("18:10", "2026-09-12"));

    expect(status.phase).toBe("day-finished");
    expect(status.phase === "day-finished" && label(status.next)).toBe("E1H2");
  });

  it("on day two's morning, the first heat is day two's first heat", () => {
    const status = resolveHeats(twoDays, at("07:30", "2026-09-13"));

    expect(status.phase).toBe("before");
    expect(status.phase === "before" && label(status.next)).toBe("E1H2");
  });

  it("on day two, the gap between events points at the next event", () => {
    const status = resolveHeats(twoDays, at("08:30", "2026-09-13"));

    expect(status.phase).toBe("between-events");
    expect(status.phase === "between-events" && label(status.next)).toBe("E2H1");
  });

  it("after the last day's last heat, the comp is finished", () => {
    expect(resolveHeats(twoDays, at("09:10", "2026-09-13")).phase).toBe("finished");
  });

  it("a date between two comp days that are not consecutive is not a comp day", () => {
    const gapped = makeTwoDaySchedule({
      events: [makeEvent({ heats: [makeHeat({ number: 1 }), makeHeat({ number: 2, date: "2026-09-14" })] })],
    });

    expect(resolveHeats(gapped, at("09:00", "2026-09-13")).phase).toBe("not-comp-day");
  });
});
