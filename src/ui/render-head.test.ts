import { getAllByTestId, getByText } from "@testing-library/dom";
import { renderHead } from "./render-head";
import type { JudgeCodeTable } from "../core/judge-codes";
import { makeEvent, makeSchedule } from "../test/factories";

const table: JudgeCodeTable = {
  aaaaa: { kind: "lane", event: 1, lane: 1 },
  bbbbb: { kind: "lane", event: 1, lane: 2 },
  ccccc: { kind: "lane", event: 2, lane: 1 },
  hhhhh: { kind: "head" },
};

const schedule = makeSchedule({
  events: [makeEvent({ number: 1, title: "12th Gear" }), makeEvent({ number: 2, title: "Extra Credit" })],
});

const renderIt = async () => {
  const root = document.createElement("div");
  await renderHead({ root, schedule, table, siteUrl: "https://example.test/heats/" });
  return root;
};

describe("the head judge assignment page", () => {
  it("shows one card per lane code, none for the head code", async () => {
    const root = await renderIt();

    expect(getAllByTestId(root, "judge-card")).toHaveLength(3);
    expect(root.textContent).not.toContain("hhhhh");
  });

  it("groups cards under their event", async () => {
    const root = await renderIt();

    const [first] = getAllByTestId(root, "event-group");
    expect(first).toHaveTextContent("Event 1");
    expect(first).toHaveTextContent("12th Gear");
    expect(first?.querySelectorAll('[data-testid="judge-card"]')).toHaveLength(2);
  });

  it("prints the lane, code, full URL and a QR code on each card", async () => {
    const root = await renderIt();

    const card = getByText(root, "Lane 2").closest('[data-testid="judge-card"]');
    expect(card).toHaveTextContent("bbbbb");
    expect(card).toHaveTextContent("https://example.test/heats/?j=bbbbb");
    expect(card?.querySelector("svg")).not.toBeNull();
  });

  it("labels cards with the sheet's word for a lane", async () => {
    const root = document.createElement("div");
    const positions = makeSchedule({ events: [makeEvent({ number: 1, lanes: 2 })], laneLabel: "Position" });

    await renderHead({ root, schedule: positions, table, siteUrl: "https://example.test/heats/" });

    expect(getByText(root, "Position 2").tagName).toBe("H3");
  });

  it("skips codes for lanes the event does not have", async () => {
    const root = document.createElement("div");
    const narrow = makeSchedule({ events: [makeEvent({ number: 1, lanes: 1 })] });

    await renderHead({ root, schedule: narrow, table, siteUrl: "https://example.test/heats/" });

    expect(getAllByTestId(root, "judge-card")).toHaveLength(1);
    expect(root.textContent).toContain("Lane 1");
    expect(root.textContent).not.toContain("Lane 2");
  });
});
