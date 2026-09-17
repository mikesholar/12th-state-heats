import { fireEvent, getByTestId, queryByTestId, getByLabelText } from "@testing-library/dom";
import { render } from "./render";
import { snapshotSchedule as schedule } from "../data/snapshot";
import { at, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";
import type { Schedule } from "../core/types";

const TEAM = "Fast but Questionable";

const renderAt = (now: Date, selectedTeam?: string, onTeamChange = vi.fn()) => {
  const root = document.createElement("div");
  render({ root, schedule, now, selectedTeam, onTeamChange, sourceNotice: undefined });
  return { root, onTeamChange };
};

const renderSchedule = (custom: Schedule, sourceNotice?: string) => {
  const root = document.createElement("div");
  document.body.append(root);
  render({ root, schedule: custom, now: at("08:15"), selectedTeam: undefined, onTeamChange: vi.fn(), sourceNotice });
  return root;
};

const bannerText = (root: HTMLElement) => getByTestId(root, "banner").textContent ?? "";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the up-next banner", () => {
  it("before the first heat, announces it", () => {
    const { root } = renderAt(at("07:59"));

    expect(bannerText(root)).toContain("First heat 8:00");
  });

  it("during a heat, shows what is on the floor and what is next with a countdown", () => {
    const { root } = renderAt(at("08:03"));

    const text = bannerText(root);
    expect(text).toContain("NOW");
    expect(text).toContain("Event 1");
    expect(text).toContain("Heat 1");
    expect(text).toContain("NEXT");
    expect(text).toContain("Heat 2");
    expect(text).toContain("in 10 min");
  });

  it("between events, points at the next event's start", () => {
    const { root } = renderAt(at("10:20"));

    const text = bannerText(root);
    expect(text).toContain("Event 3 starts 11:40");
    expect(text).toContain("in 1 h 20 min");
  });

  it("after the last heat, says the comp is complete", () => {
    expect(bannerText(renderAt(at("13:00")).root)).toContain("Comp complete");
  });

  it("on any other day, shows the comp date", () => {
    expect(bannerText(renderAt(at("09:15", "2026-09-11")).root)).toContain("Saturday, September 12");
  });
});

describe("the my-heat card", () => {
  it("is absent until a team is chosen", () => {
    const { root } = renderAt(at("08:30"));

    expect(queryByTestId(root, "my-heat")).toBeNull();
  });

  it("shows the team's next event, heat, lane, start time and countdown", () => {
    const { root } = renderAt(at("08:30"), TEAM);

    const text = getByTestId(root, "my-heat").textContent ?? "";
    expect(text).toContain("Event 2");
    expect(text).toContain("Heat 1");
    expect(text).toContain("Lane 8");
    expect(text).toContain("9:10");
    expect(text).toContain("in 40 min");
  });

  it("says on the floor during the team's heat", () => {
    const { root } = renderAt(at("09:15"), TEAM);

    const text = getByTestId(root, "my-heat").textContent ?? "";
    expect(text).toContain("ON THE FLOOR");
    expect(text).toContain("Lane 8");
    expect(text).toContain("ends 9:20");
  });

  it("congratulates the team once they are finished", () => {
    const { root } = renderAt(at("13:00"), TEAM);

    expect(getByTestId(root, "my-heat").textContent).toContain("You're done");
  });

  it("highlights the chosen team's row in every heat it appears in", () => {
    const { root } = renderAt(at("08:30"), TEAM);

    const rows = root.querySelectorAll(`[data-team="${TEAM}"]`);
    expect(rows).toHaveLength(3);
    rows.forEach((row) => expect(row).toHaveClass("mine"));
  });
});

describe("the team picker", () => {
  it("lists every team alphabetically with a placeholder first", () => {
    const { root } = renderAt(at("08:30"));

    const picker = getByLabelText<HTMLSelectElement>(root, /i'm on/i);
    const labels = [...picker.options].map((o) => o.textContent);
    expect(labels[0]).toMatch(/pick your team/i);
    expect(labels.slice(1)).toHaveLength(37);
    expect(labels.slice(1)).toEqual([...labels.slice(1)].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
  });

  it("reports the chosen team", () => {
    const { root, onTeamChange } = renderAt(at("08:30"));

    fireEvent.change(getByLabelText(root, /i'm on/i), { target: { value: "Glizzy Gals" } });

    expect(onTeamChange).toHaveBeenCalledWith("Glizzy Gals");
  });

  it("shows the remembered team as selected", () => {
    const { root } = renderAt(at("08:30"), "Glizzy Gals");

    expect(getByLabelText<HTMLSelectElement>(root, /i'm on/i).value).toBe("Glizzy Gals");
  });
});

describe("the schedule", () => {
  it("marks heats as past, current or upcoming", () => {
    const { root } = renderAt(at("08:15"));

    expect(root.querySelector('[data-heat="E1H1"]')).toHaveClass("past");
    expect(root.querySelector('[data-heat="E1H2"]')).toHaveClass("current");
    expect(root.querySelector('[data-heat="E1H3"]')).toHaveClass("upcoming");
  });

  it("tags the current and next heat cards", () => {
    const { root } = renderAt(at("08:15"));

    expect(root.querySelector('[data-heat="E1H2"]')?.textContent).toContain("NOW");
    expect(root.querySelector('[data-heat="E1H3"]')?.textContent).toContain("NEXT");
  });

  it("lists each lane with team, athletes and division", () => {
    const { root } = renderAt(at("08:15"));

    const row = root.querySelector('[data-heat="E1H2"] [data-team="Fast but Questionable"]');
    expect(row?.textContent).toContain("8");
    expect(row?.textContent).toContain("Caroline Ortiz + Mike Sholar");
    expect(row?.textContent).toContain("F/M Scaled");
  });

  it("shows each event's workout description", () => {
    const { root } = renderAt(at("08:15"));

    expect(root.textContent).toContain("12th Gear");
    expect(root.textContent).toContain("40 Wall Balls");
  });
});

describe("the sticky header strip", () => {
  it("is absent until a team is chosen", () => {
    const { root } = renderAt(at("08:30"));

    expect(queryByTestId(root, "my-strip")).toBeNull();
  });

  it("keeps the team's lane and countdown visible while scrolled", () => {
    const { root } = renderAt(at("08:30"), TEAM);

    const text = getByTestId(root, "my-strip").textContent ?? "";
    expect(text).toContain("E2 · H1");
    expect(text).toContain("Lane 8");
    expect(text).toContain("in 40 min");
  });

  it("says on the floor during the team's heat", () => {
    const { root } = renderAt(at("09:15"), TEAM);

    expect(getByTestId(root, "my-strip").textContent).toContain("On the floor");
  });

  it("says done after the team's last heat", () => {
    const { root } = renderAt(at("13:00"), TEAM);

    expect(getByTestId(root, "my-strip").textContent).toContain("Done");
  });
});

describe("lanes nobody has claimed", () => {
  it("are listed as open so the heat is always eight rows", () => {
    const { root } = renderAt(at("08:15"));

    const rows = root.querySelectorAll('[data-heat="E1H3"] tbody tr');
    expect(rows).toHaveLength(8);
    expect(rows[7]).toHaveClass("open");
    expect(rows[7]).toHaveTextContent(/^8\s*— open —$/);
  });

  it("are not offered in the team picker", () => {
    const custom = makeSchedule({ events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ team: "Only Team" })] })] })] });

    const picker = getByLabelText<HTMLSelectElement>(renderSchedule(custom), /i'm on/i);

    expect([...picker.options].map((o) => o.textContent)).toEqual(["— pick your team —", "Only Team"]);
  });
});

describe("an individual comp", () => {
  it("asks who you are rather than which team you are on", () => {
    const custom = makeSchedule({ teamSize: 1, events: [makeEvent({ heats: [makeHeat({ lanes: [makeLane({ team: "Mike Sholar" })] })] })] });

    const root = renderSchedule(custom);

    expect(getByLabelText(root, /^i'm…$/i)).toBeInTheDocument();
    expect(root.textContent).toContain("pick your name");
  });
});

describe("the source notice", () => {
  it("is absent when the schedule is live", () => {
    expect(queryByTestId(renderSchedule(makeSchedule()), "source-notice")).toBeNull();
  });

  it("shows the notice when the schedule is stale", () => {
    const root = renderSchedule(makeSchedule(), "Offline — showing last known schedule");

    expect(getByTestId(root, "source-notice")).toHaveTextContent("Offline — showing last known schedule");
  });

  it("escapes sheet-derived text in the notice", () => {
    const root = renderSchedule(makeSchedule(), 'Sheet has a problem: Events: Event 1: title "<b>x</b>" is odd');

    expect(getByTestId(root, "source-notice").querySelector("b")).toBeNull();
    expect(getByTestId(root, "source-notice")).toHaveTextContent('"<b>x</b>"');
  });
});
