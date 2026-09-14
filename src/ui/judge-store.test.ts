import { loadJudgeName, saveJudgeName, loadSentHeats, markHeatSent, loadQueue, saveQueue } from "./judge-store";
import { makeSubmission } from "../test/factories";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("remembering the judge's name", () => {
  it("has no name until one is saved", () => {
    expect(loadJudgeName()).toBeUndefined();
  });

  it("returns the saved name", () => {
    saveJudgeName("Kim");
    expect(loadJudgeName()).toBe("Kim");
  });

  it("forgets the name when cleared", () => {
    saveJudgeName("Kim");
    saveJudgeName(undefined);
    expect(loadJudgeName()).toBeUndefined();
  });
});

describe("remembering which heats were sent from this phone", () => {
  it("starts empty for an event and lane", () => {
    expect(loadSentHeats({ event: 2, lane: 5 })).toEqual([]);
  });

  it("records heats per event and lane without duplicates", () => {
    markHeatSent({ event: 2, lane: 5, heat: 3 });
    markHeatSent({ event: 2, lane: 5, heat: 1 });
    markHeatSent({ event: 2, lane: 5, heat: 3 });

    expect(loadSentHeats({ event: 2, lane: 5 })).toEqual([1, 3]);
    expect(loadSentHeats({ event: 2, lane: 4 })).toEqual([]);
  });
});

describe("the pending submission queue", () => {
  it("starts empty", () => {
    expect(loadQueue()).toEqual([]);
  });

  it("round-trips submissions in order", () => {
    const a = makeSubmission({ clientId: "a" });
    const b = makeSubmission({ clientId: "b" });
    saveQueue([a, b]);

    expect(loadQueue()).toEqual([a, b]);
  });

  it("treats corrupt storage as empty", () => {
    localStorage.setItem("judge:queue", "{not json");

    expect(loadQueue()).toEqual([]);
  });
});

describe("when storage is unavailable", () => {
  it("degrades silently", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => saveJudgeName("Kim")).not.toThrow();
    expect(() => markHeatSent({ event: 1, lane: 1, heat: 1 })).not.toThrow();
    expect(() => saveQueue([makeSubmission()])).not.toThrow();
    expect(loadJudgeName()).toBeUndefined();
    expect(loadSentHeats({ event: 1, lane: 1 })).toEqual([]);
    expect(loadQueue()).toEqual([]);
  });
});
