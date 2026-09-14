import { resolveJudgeHeat } from "./resolve-judge-heat";
import { at, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

const event = makeEvent({
  number: 2,
  heats: [
    makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 5, team: "Rays of Glory" })] }),
    makeHeat({ number: 2, start: "09:25", end: "09:35", lanes: [makeLane({ lane: 4, team: "Browne" })] }),
    makeHeat({ number: 3, start: "09:40", end: "09:50", lanes: [makeLane({ lane: 5, team: "C&C" })] }),
  ],
});
const schedule = makeSchedule({ events: [event] });

const resolve = (now: Date, manual?: { heat: number; at: Date }) =>
  resolveJudgeHeat({ schedule, event, lane: 5, now, manual });

describe("choosing which heat a lane judge should be looking at", () => {
  it("picks the first heat before the event starts", () => {
    expect(resolve(at("08:00")).heat.number).toBe(1);
  });

  it("picks the heat on the floor", () => {
    expect(resolve(at("09:27")).heat.number).toBe(2);
  });

  it("picks the next heat during the gap between heats", () => {
    expect(resolve(at("09:22")).heat.number).toBe(2);
  });

  it("stays on the last heat after the event is over", () => {
    expect(resolve(at("10:30")).heat.number).toBe(3);
  });

  it("gives the team in the judge's lane", () => {
    expect(resolve(at("09:12")).lane?.team).toBe("Rays of Glory");
  });

  it("reports an empty lane", () => {
    expect(resolve(at("09:27")).lane).toBeUndefined();
  });

  it("honours a manual pick made in the last ten minutes", () => {
    expect(resolve(at("09:42"), { heat: 1, at: at("09:35") }).heat.number).toBe(1);
  });

  it("drops a manual pick older than ten minutes", () => {
    expect(resolve(at("09:46"), { heat: 1, at: at("09:35") }).heat.number).toBe(3);
  });

  it("ignores a manual pick for a heat that does not exist", () => {
    expect(resolve(at("09:42"), { heat: 9, at: at("09:41") }).heat.number).toBe(3);
  });
});
