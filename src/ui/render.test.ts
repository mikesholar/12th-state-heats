import { getByTestId, queryByTestId } from "@testing-library/dom";
import { render } from "./render";
import { snapshotSchedule as schedule } from "../data/snapshot";
import { at, makeSchedule } from "../test/factories";
import type { Schedule } from "../core/types";

const renderAt = (now: Date) => {
  const root = document.createElement("div");
  render({ root, schedule, now, sourceNotice: undefined });
  return { root };
};

const renderSchedule = (custom: Schedule, sourceNotice?: string) => {
  const root = document.createElement("div");
  document.body.append(root);
  render({ root, schedule: custom, now: at("08:15"), sourceNotice });
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

describe("lanes nobody has claimed", () => {
  it("are listed as open so the heat is always eight rows", () => {
    const { root } = renderAt(at("08:15"));

    const rows = root.querySelectorAll('[data-heat="E1H3"] tbody tr');
    expect(rows).toHaveLength(8);
    expect(rows[7]).toHaveClass("open");
    expect(rows[7]).toHaveTextContent(/^8\s*— open —$/);
  });
});

describe("the whole schedule", () => {
  it("lists every event and every team without choosing one", () => {
    const { root } = renderAt(at("08:15"));

    expect(root.querySelectorAll(".event")).toHaveLength(3);
    expect(root.querySelectorAll("tr[data-team]")).toHaveLength(110);
    expect(root.querySelector("#team-picker")).toBeNull();
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
