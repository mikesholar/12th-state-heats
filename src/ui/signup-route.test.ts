import { readSignupCode } from "./signup-route";

describe("reading the sign-up code from the URL", () => {
  it("returns the s parameter, trimmed and lower-cased", () => {
    expect(readSignupCode("?s=93ZYQ ")).toBe("93zyq");
  });

  it("returns nothing when there is no s parameter", () => {
    expect(readSignupCode("?j=k8v2n")).toBeUndefined();
  });

  it("returns nothing for an empty s", () => {
    expect(readSignupCode("?s=")).toBeUndefined();
  });
});
