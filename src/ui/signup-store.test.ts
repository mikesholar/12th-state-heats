import { loadLastClaim, loadSignupEmail, saveLastClaim, saveSignupEmail } from "./signup-store";
import { makeClaimDraft } from "../test/factories";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the remembered sign-up email", () => {
  it("is absent on a fresh phone", () => {
    expect(loadSignupEmail()).toBeUndefined();
  });

  it("round-trips, normalised", () => {
    saveSignupEmail(" Mike@Example.com ");

    expect(loadSignupEmail()).toBe("mike@example.com");
  });

  it("can be forgotten", () => {
    saveSignupEmail("mike@example.com");
    saveSignupEmail(undefined);

    expect(loadSignupEmail()).toBeUndefined();
  });
});

describe("the last claim", () => {
  it("round-trips so the next event's form is pre-filled", () => {
    saveLastClaim(makeClaimDraft());

    expect(loadLastClaim()).toEqual(makeClaimDraft());
  });

  it("ignores a stored value that is not a draft", () => {
    localStorage.setItem("signup:last", JSON.stringify({ team: 1 }));

    expect(loadLastClaim()).toBeUndefined();
  });

  it("degrades gracefully without storage", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => saveSignupEmail("a@b.c")).not.toThrow();
    expect(loadSignupEmail()).toBeUndefined();
    expect(loadLastClaim()).toBeUndefined();
  });
});
