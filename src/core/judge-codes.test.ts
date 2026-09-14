import { resolveJudgeCode, type JudgeCodeTable } from "./judge-codes";

const table: JudgeCodeTable = {
  k8v2n: { kind: "lane", event: 2, lane: 5 },
  hq7xm: { kind: "head" },
};

describe("resolving a judge code", () => {
  it("finds a lane assignment", () => {
    expect(resolveJudgeCode({ table, code: "k8v2n" })).toEqual({ kind: "lane", event: 2, lane: 5 });
  });

  it("finds the head judge", () => {
    expect(resolveJudgeCode({ table, code: "hq7xm" })).toEqual({ kind: "head" });
  });

  it("reports an unknown code", () => {
    expect(resolveJudgeCode({ table, code: "nope1" })).toEqual({ kind: "unknown" });
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(resolveJudgeCode({ table, code: " K8V2N " })).toEqual({ kind: "lane", event: 2, lane: 5 });
  });

  it("treats a missing code as unknown", () => {
    expect(resolveJudgeCode({ table, code: undefined })).toEqual({ kind: "unknown" });
  });
});
