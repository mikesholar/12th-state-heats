import { readJudgeCode } from "./judge-route";

describe("reading the judge code from the URL", () => {
  it("returns the j parameter", () => {
    expect(readJudgeCode("?j=k8v2n")).toBe("k8v2n");
  });

  it("returns nothing when there is no j parameter", () => {
    expect(readJudgeCode("?at=2026-09-12T08:30")).toBeUndefined();
  });

  it("returns nothing for an empty j", () => {
    expect(readJudgeCode("?j=")).toBeUndefined();
  });
});
