import { loadTeam, saveTeam } from "./team-store";

describe("remembering the chosen team", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns nothing when no team has been chosen", () => {
    expect(loadTeam()).toBeUndefined();
  });

  it("returns the team that was saved", () => {
    saveTeam("Glizzy Gals");

    expect(loadTeam()).toBe("Glizzy Gals");
  });

  it("forgets the team when cleared", () => {
    saveTeam("Glizzy Gals");
    saveTeam(undefined);

    expect(loadTeam()).toBeUndefined();
  });

  it("degrades to no team when storage is unavailable", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => saveTeam("Glizzy Gals")).not.toThrow();
    expect(loadTeam()).toBeUndefined();
  });
});
