import { buildClaim, buildRelease, emptyDraft, isMine, mySlotIn, teamSizeOf, validateClaim } from "./signup";
import { makeClaimDraft, makeDivision, makeEvent, makeHeat, makeLane } from "../test/factories";

const slot = { event: 2, heat: 3, lane: 5 };

const divisions = [makeDivision({ name: "Individual RX", teamSize: 1 }), makeDivision({ name: "F/M Scaled", teamSize: 2 })];

describe("validating a claim", () => {
  it("joins athlete names and keeps the team name for a team division", () => {
    const result = validateClaim({ draft: makeClaimDraft(), divisions });

    expect(result).toEqual({ success: true, data: { team: "Fast but Questionable", athletes: "Caroline Ortiz + Mike Sholar", division: "F/M Scaled" } });
  });

  it("uses the athlete's name as the team for an individual division", () => {
    const draft = makeClaimDraft({ team: "", athletes: ["  Mike Sholar "], division: "Individual RX" });

    expect(validateClaim({ draft, divisions })).toEqual({ success: true, data: { team: "Mike Sholar", athletes: "Mike Sholar", division: "Individual RX" } });
  });

  it("asks for the division before anything else", () => {
    expect(validateClaim({ draft: makeClaimDraft({ division: "" }), divisions })).toEqual({ success: false, error: "Pick a division" });
    expect(validateClaim({ draft: makeClaimDraft({ division: "Open" }), divisions })).toEqual({ success: false, error: "Pick a division" });
  });

  it("requires a team name for a team division", () => {
    expect(validateClaim({ draft: makeClaimDraft({ team: "  " }), divisions })).toEqual({ success: false, error: "Enter a team name" });
  });

  it("requires every athlete's name", () => {
    expect(validateClaim({ draft: makeClaimDraft({ athletes: ["Caroline Ortiz", ""] }), divisions })).toEqual({ success: false, error: "Enter a name for every athlete" });
    expect(validateClaim({ draft: makeClaimDraft({ athletes: ["Caroline Ortiz"] }), divisions })).toEqual({ success: false, error: "Enter a name for every athlete" });
  });

  it("asks an individual for their name", () => {
    expect(validateClaim({ draft: makeClaimDraft({ athletes: [""], division: "Individual RX" }), divisions })).toEqual({ success: false, error: "Enter your name" });
  });

  it("ignores extra athlete fields beyond the division's team size", () => {
    const result = validateClaim({ draft: makeClaimDraft({ athletes: ["A", "B", "C"] }), divisions });

    expect(result.success && result.data.athletes).toBe("A + B");
  });
});

describe("team size of a division", () => {
  it("looks the division up by name, defaulting to one field when none is chosen", () => {
    expect(teamSizeOf({ divisions, name: "F/M Scaled" })).toBe(2);
    expect(teamSizeOf({ divisions, name: "" })).toBe(0);
  });
});

describe("building requests", () => {
  it("builds a claim with the normalised email", () => {
    const fields = { team: "T", athletes: "A + B", division: "F/M RX" };

    expect(buildClaim({ slot, email: " Mike@Example.com ", fields })).toEqual({
      action: "claim",
      event: 2,
      heat: 3,
      lane: 5,
      email: "mike@example.com",
      team: "T",
      athletes: "A + B",
      division: "F/M RX",
    });
  });

  it("builds a release", () => {
    expect(buildRelease({ slot, email: "mike@example.com" })).toEqual({ action: "release", event: 2, heat: 3, lane: 5, email: "mike@example.com" });
  });
});

describe("recognising my own lanes", () => {
  it("matches by email, ignoring case and whitespace", () => {
    expect(isMine({ lane: makeLane({ email: "Mike@Example.com" }), email: " mike@example.com " })).toBe(true);
    expect(isMine({ lane: makeLane({ email: "other@example.com" }), email: "mike@example.com" })).toBe(false);
    expect(isMine({ lane: makeLane(), email: "mike@example.com" })).toBe(false);
  });

  it("finds the heat and lane I hold in an event", () => {
    const event = makeEvent({
      heats: [
        makeHeat({ number: 1, lanes: [makeLane({ lane: 2, email: "a@example.com" })] }),
        makeHeat({ number: 2, start: "08:13", end: "08:21", lanes: [makeLane({ lane: 4, email: "mike@example.com" })] }),
      ],
    });

    expect(mySlotIn({ event, email: "MIKE@example.com" })).toEqual({ heat: 2, lane: 4 });
    expect(mySlotIn({ event, email: "nobody@example.com" })).toBeUndefined();
  });
});

describe("the empty draft", () => {
  it("has no athlete fields until a division is picked", () => {
    expect(emptyDraft()).toEqual({ team: "", athletes: [], division: "" });
  });
});
