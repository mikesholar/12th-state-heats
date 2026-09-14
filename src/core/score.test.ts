import { formatScore, validateScore, type Score } from "./score";
import { makeScore } from "../test/factories";

const time = (seconds: number): Score => ({ kind: "time", seconds });

describe("validating a score for a time-or-rounds event", () => {
  const capped = { scoring: "time-or-rounds", capSeconds: 480 } as const;

  it("accepts a finish time under the cap", () => {
    expect(validateScore({ ...capped, score: time(462) })).toEqual({ success: true, data: time(462) });
  });

  it("accepts a finish time exactly at the cap", () => {
    expect(validateScore({ ...capped, score: time(480) }).success).toBe(true);
  });

  it("rejects a finish time over the cap and points at Capped", () => {
    expect(validateScore({ ...capped, score: time(481) })).toEqual({
      success: false,
      error: "Time can't exceed the 8:00 cap — use Capped",
    });
  });

  it("rejects a zero time", () => {
    expect(validateScore({ ...capped, score: time(0) })).toEqual({ success: false, error: "Enter a time" });
  });

  it("rejects fractional seconds", () => {
    expect(validateScore({ ...capped, score: time(462.5) })).toEqual({ success: false, error: "Time must be whole seconds" });
  });

  it("rejects a negative time", () => {
    expect(validateScore({ ...capped, score: time(-5) })).toEqual({ success: false, error: "Enter a time" });
  });

  it("accepts rounds and reps when capped", () => {
    expect(validateScore({ ...capped, score: makeScore({ rounds: 9, reps: 14 }) }).success).toBe(true);
  });

  it("rejects zero rounds and zero reps", () => {
    expect(validateScore({ ...capped, score: makeScore({ rounds: 0, reps: 0 }) })).toEqual({
      success: false,
      error: "Enter at least one rep",
    });
  });
});

describe("validating a score for a rounds-reps event", () => {
  const amrap = { scoring: "rounds-reps", capSeconds: undefined } as const;

  it("accepts rounds and reps", () => {
    expect(validateScore({ ...amrap, score: makeScore({ rounds: 0, reps: 3 }) }).success).toBe(true);
  });

  it("rejects a time", () => {
    expect(validateScore({ ...amrap, score: time(300) })).toEqual({
      success: false,
      error: "This event is scored in rounds and reps",
    });
  });

  it("rejects negative reps", () => {
    expect(validateScore({ ...amrap, score: makeScore({ reps: -1 }) })).toEqual({
      success: false,
      error: "Rounds and reps can't be negative",
    });
  });

  it("rejects fractional rounds", () => {
    expect(validateScore({ ...amrap, score: makeScore({ rounds: 1.5 }) })).toEqual({
      success: false,
      error: "Rounds and reps must be whole numbers",
    });
  });
});

describe("formatting a score", () => {
  it("shows a time as m:ss", () => {
    expect(formatScore(time(462))).toBe("7:42");
  });

  it("pads seconds", () => {
    expect(formatScore(time(605))).toBe("10:05");
  });

  it("shows rounds plus reps", () => {
    expect(formatScore(makeScore({ rounds: 9, reps: 14 }))).toBe("9 + 14");
  });
});
