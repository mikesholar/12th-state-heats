import { fireEvent, findAllByTestId, findByText, getByRole, queryAllByTestId } from "@testing-library/dom";
import { renderHead } from "./render-head";
import type { JudgeCodeTable } from "../core/judge-codes";
import type { Schedule } from "../core/types";
import { makeEvent, makeSchedule } from "../test/factories";

afterEach(() => {
  document.body.innerHTML = "";
});

const table: JudgeCodeTable = {
  aaaaa: { kind: "lane", event: 1, lane: 1 },
  bbbbb: { kind: "lane", event: 1, lane: 2 },
  ccccc: { kind: "lane", event: 2, lane: 1 },
  hhhhh: { kind: "head" },
};

const schedule = makeSchedule({
  events: [makeEvent({ number: 1, title: "12th Gear" }), makeEvent({ number: 2, title: "Extra Credit" })],
});

type RenderItOptions = { readonly schedule?: Schedule; readonly siteUrl?: string };

const renderIt = (options: RenderItOptions = {}) => {
  const root = document.createElement("div");
  document.body.append(root);
  renderHead({ root, schedule: options.schedule ?? schedule, table, siteUrl: options.siteUrl ?? "https://example.test/heats/" });
  return root;
};

const generate = async (options: RenderItOptions = {}) => {
  const root = renderIt(options);
  fireEvent.click(getByRole(root, "button", { name: "Generate QR codes" }));
  await findAllByTestId(root, "judge-card");
  return root;
};

describe("the head judge assignment page", () => {
  it("offers a button to generate the QR codes instead of drawing them straight away", () => {
    const root = renderIt();

    expect(getByRole(root, "button", { name: "Generate QR codes" })).toBeEnabled();
    expect(queryAllByTestId(root, "judge-card")).toHaveLength(0);
  });

  it("shows one card per lane code, none for the head code, once generated", async () => {
    const root = await generate();

    expect(queryAllByTestId(root, "judge-card")).toHaveLength(3);
    expect(root.textContent).not.toContain("hhhhh");
  });

  it("groups cards under their event", async () => {
    const root = await generate();

    const [first] = queryAllByTestId(root, "event-group");
    expect(first).toHaveTextContent("Event 1");
    expect(first).toHaveTextContent("12th Gear");
    expect(first?.querySelectorAll('[data-testid="judge-card"]')).toHaveLength(2);
  });

  it("prints the lane, code, full URL and a QR code on each card", async () => {
    const root = await generate();

    const card = (await findByText(root, "Lane 2")).closest('[data-testid="judge-card"]');
    expect(card).toHaveTextContent("bbbbb");
    expect(card).toHaveTextContent("https://example.test/heats/?j=bbbbb");
    expect(card?.querySelector("svg")).not.toBeNull();
  });

  it("labels cards with the sheet's word for a lane", async () => {
    const positions = makeSchedule({ events: [makeEvent({ number: 1, lanes: 2 })], laneLabel: "Position" });

    const root = await generate({ schedule: positions });

    expect((await findByText(root, "Position 2")).tagName).toBe("H3");
  });

  it("skips codes for lanes the event does not have", async () => {
    const narrow = makeSchedule({ events: [makeEvent({ number: 1, lanes: 1 })] });

    const root = await generate({ schedule: narrow });

    expect(queryAllByTestId(root, "judge-card")).toHaveLength(1);
    expect(root.textContent).toContain("Lane 1");
    expect(root.textContent).not.toContain("Lane 2");
  });

  it("shows each event's format and its RX and Scaled versions before any QR codes are generated", () => {
    const withWod = makeSchedule({
      events: [makeEvent({ number: 1, lanes: 1, format: "AMRAP 10", rx: "10 Slam Balls (25/20)", scaled: "10 Slam Balls (15/10)" })],
    });

    const root = renderIt({ schedule: withWod });

    expect(queryAllByTestId(root, "judge-card")).toHaveLength(0);

    const [group] = queryAllByTestId(root, "event-group");
    expect(group).toHaveTextContent("AMRAP 10");
    expect(group).toHaveTextContent("RX 10 Slam Balls (25/20)");
    expect(group).toHaveTextContent("Scaled 10 Slam Balls (15/10)");
    expect(group?.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
  });

  it("tells the head judge when the QR codes can't be made", async () => {
    const root = renderIt({ siteUrl: `https://example.test/${"x".repeat(5000)}/` });

    fireEvent.click(getByRole(root, "button", { name: "Generate QR codes" }));

    expect(await findByText(root, "Couldn't make the QR codes — reload and try again.")).toBeInTheDocument();
    expect(queryAllByTestId(root, "judge-card")).toHaveLength(0);
    expect(queryAllByTestId(root, "workout")).toHaveLength(2);
  });
});
