import { buildSubmission } from "./submission";
import { at, makeEvent, makeHeat, makeLane, makeScore } from "../test/factories";

describe("building a submission record", () => {
  const base = {
    judge: "Kim",
    event: makeEvent({ number: 2 }),
    heat: makeHeat({ number: 3 }),
    lane: makeLane({ lane: 5, team: "Rays of Glory", division: "F/M Scaled" }),
    now: at("09:45"),
    clientId: "abc-123",
  };

  it("flattens a rounds-reps score with blank seconds", () => {
    expect(buildSubmission({ ...base, score: makeScore({ rounds: 4, reps: 7 }) })).toEqual({
      clientId: "abc-123",
      submittedAt: "2026-09-12T13:45:00.000Z",
      judge: "Kim",
      event: 2,
      heat: 3,
      lane: 5,
      team: "Rays of Glory",
      division: "F/M Scaled",
      scoreKind: "rounds-reps",
      seconds: "",
      rounds: 4,
      reps: 7,
    });
  });

  it("flattens a time score with blank rounds and reps", () => {
    const record = buildSubmission({ ...base, score: { kind: "time", seconds: 462 } });

    expect(record.scoreKind).toBe("time");
    expect(record.seconds).toBe(462);
    expect(record.rounds).toBe("");
    expect(record.reps).toBe("");
  });
});
