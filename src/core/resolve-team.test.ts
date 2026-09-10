import { resolveTeam } from "./resolve-team";
import { schedule } from "../data/schedule";
import { at } from "../test/factories";

const TEAM = "Fast but Questionable";

describe("resolving a team's next heat", () => {
  it("points at the next event's heat and lane with minutes to go", () => {
    const status = resolveTeam({ schedule, team: TEAM, now: at("08:30") });

    expect(status.kind).toBe("upcoming");
    if (status.kind !== "upcoming") return;
    expect(status.ref.event.number).toBe(2);
    expect(status.ref.heat.number).toBe(1);
    expect(status.lane).toBe(8);
    expect(status.minutesUntilStart).toBe(40);
  });

  it("rounds partial minutes down", () => {
    const status = resolveTeam({ schedule, team: TEAM, now: new Date("2026-09-13T12:30:30-04:00") });

    expect(status.kind === "upcoming" && status.minutesUntilStart).toBe(17);
  });

  it("is on the floor while its heat runs", () => {
    const status = resolveTeam({ schedule, team: TEAM, now: at("09:15") });

    expect(status.kind).toBe("on-floor");
    if (status.kind !== "on-floor") return;
    expect(status.ref.event.number).toBe(2);
    expect(status.lane).toBe(8);
  });

  it("is done after its last heat ends", () => {
    expect(resolveTeam({ schedule, team: TEAM, now: at("13:00") }).kind).toBe("done");
  });

  it("is done for a team that has no heats", () => {
    expect(resolveTeam({ schedule, team: "Nobody", now: at("08:00") }).kind).toBe("done");
  });

  it("a team missing from the last event is done once its final heat ends", () => {
    const status = resolveTeam({ schedule, team: "Jointly Unstable", now: at("09:35") });

    expect(status.kind).toBe("done");
  });

  it("the day before, points at the team's first heat", () => {
    const status = resolveTeam({ schedule, team: TEAM, now: at("09:15", "2026-09-12") });

    expect(status.kind).toBe("upcoming");
    if (status.kind !== "upcoming") return;
    expect(status.ref.event.number).toBe(1);
    expect(status.lane).toBe(8);
  });
});
