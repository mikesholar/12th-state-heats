import { fireEvent, getByLabelText, getByRole, getByTestId, queryByTestId } from "@testing-library/dom";
import type { Mock } from "vitest";
import { startJudgePage } from "./judge-page";
import { loadQueue } from "./judge-store";
import { at, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";
import type { Event } from "../core/types";

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

const ENDPOINT = "https://script.google.com/macros/s/abc/exec";

const event = makeEvent({
  number: 2,
  title: "Extra Credit",
  scoring: "rounds-reps",
  heats: [
    makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 5, team: "Rays of Glory", division: "F/M Scaled" })] }),
    makeHeat({ number: 2, start: "09:25", end: "09:35", lanes: [makeLane({ lane: 5, team: "Browne", division: "F/M Scaled" })] }),
  ],
});

const capped = makeEvent({
  number: 1,
  title: "12th Gear",
  scoring: "time-or-rounds",
  capSeconds: 480,
  heats: [makeHeat({ number: 1, start: "08:00", end: "08:08", lanes: [makeLane({ lane: 5, team: "Glizzy Gals" })] })],
});

const replying = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const start = (options?: { fetchFn?: Mock<typeof fetch>; endpoint?: string; now?: () => Date; event?: Event }) => {
  const root = document.createElement("div");
  document.body.append(root);
  const fetchFn = options?.fetchFn ?? vi.fn<typeof fetch>().mockResolvedValue(replying({ ok: true }));
  const page = startJudgePage({
    root,
    schedule: makeSchedule({ events: [capped, event] }),
    event: options?.event ?? event,
    lane: 5,
    endpoint: options?.endpoint ?? ENDPOINT,
    now: options?.now ?? (() => at("09:12")),
    fetchFn,
    newClientId: () => "cid-1",
  });
  return { root, fetchFn, page };
};

const enterName = (root: HTMLElement, name = "Kim") => {
  fireEvent.input(getByLabelText(root, "Your name"), { target: { value: name } });
  fireEvent.submit(getByTestId(root, "name-form"));
};

const enterRoundsReps = (root: HTMLElement, rounds: string, reps: string) => {
  fireEvent.input(getByLabelText(root, "Rounds"), { target: { value: rounds } });
  fireEvent.input(getByLabelText(root, "Reps"), { target: { value: reps } });
  fireEvent.submit(getByTestId(root, "score-form"));
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a judge opening their link", () => {
  it("is asked for a name once, then sees the scoring page", async () => {
    const { root } = start();

    enterName(root);

    expect(getByTestId(root, "judge-header")).toHaveTextContent("Kim");
    expect(getByTestId(root, "team-card")).toHaveTextContent("Rays of Glory");
  });

  it("can change the name later", () => {
    const { root } = start();
    enterName(root);

    fireEvent.click(getByRole(root, "button", { name: "Not you? Change name" }));

    expect(getByLabelText(root, "Your name")).toBeInTheDocument();
  });
});

describe("submitting a score", () => {
  it("posts the record, shows it as recorded and ticks the heat", async () => {
    const { root, fetchFn } = start();
    enterName(root);

    enterRoundsReps(root, "4", "7");
    await flushPromises();

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      clientId: "cid-1",
      judge: "Kim",
      event: 2,
      heat: 1,
      lane: 5,
      team: "Rays of Glory",
      division: "F/M Scaled",
      scoreKind: "rounds-reps",
      rounds: 4,
      reps: 7,
      seconds: "",
    });
    expect(getByTestId(root, "notice")).toHaveTextContent("Recorded ✓ — Rays of Glory: 4 + 7");
    expect(getByTestId(root, "heat-label")).toHaveTextContent("✓");
    expect(getByRole(root, "button", { name: "Update score" })).toBeInTheDocument();
    expect(loadQueue()).toEqual([]);
  });

  it("shows a validation error and posts nothing", async () => {
    const { root, fetchFn } = start();
    enterName(root);

    enterRoundsReps(root, "0", "0");
    await flushPromises();

    expect(getByTestId(root, "notice")).toHaveTextContent("Enter at least one rep");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(queryByTestId(root, "pending")).toBeNull();
  });

  it("keeps the score on the phone and retries when the sheet is unreachable", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(replying({ ok: true }));
    const { root, page } = start({ fetchFn });
    enterName(root);

    enterRoundsReps(root, "4", "7");
    await flushPromises();

    expect(getByTestId(root, "notice")).toHaveTextContent("Saved on this phone — will retry");
    expect(getByTestId(root, "pending")).toHaveTextContent("1 pending");
    expect(getByTestId(root, "heat-label")).toHaveTextContent("✓");

    await page.tick();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(queryByTestId(root, "pending")).toBeNull();
    expect(queryByTestId(root, "notice")).toBeNull();
  });

  it("shows a rejection from the sheet and does not retry it", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(replying({ ok: false, error: "Unknown scoreKind" }));
    const { root, page } = start({ fetchFn });
    enterName(root);

    enterRoundsReps(root, "4", "7");
    await flushPromises();
    await page.tick();

    expect(getByTestId(root, "notice")).toHaveTextContent("Unknown scoreKind");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(loadQueue()).toEqual([]);
  });

  it("flags an unconfigured endpoint and keeps scores queued", async () => {
    const { root, fetchFn } = start({ endpoint: "" });
    enterName(root);

    expect(root.textContent).toContain("Scoring not configured");

    enterRoundsReps(root, "4", "7");
    await flushPromises();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(getByTestId(root, "pending")).toHaveTextContent("1 pending");
  });
});

describe("the clock tick", () => {
  it("keeps a half-typed score", async () => {
    const { root, page } = start();
    enterName(root);
    fireEvent.input(getByLabelText(root, "Rounds"), { target: { value: "3" } });

    await page.tick();

    expect(getByLabelText(root, "Rounds")).toHaveValue(3);
  });

  it("does not redraw while the judge is typing", async () => {
    const { root, page } = start();
    enterName(root);
    const rounds = getByLabelText(root, "Rounds");
    rounds.focus();
    fireEvent.input(rounds, { target: { value: "3" } });

    await page.tick();

    expect(getByLabelText(root, "Rounds")).toBe(rounds);
    expect(rounds).toHaveValue(3);
    expect(document.activeElement).toBe(rounds);
  });

  it("shows a rejection that arrived while the judge was typing", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(replying({ ok: false, error: "Unknown scoreKind" }));
    const { root, page } = start({ fetchFn });
    enterName(root);
    enterRoundsReps(root, "4", "7");
    await flushPromises();
    expect(getByTestId(root, "notice")).toHaveTextContent("Saved on this phone — will retry");

    getByLabelText(root, "Rounds").focus();
    await page.tick();
    getByLabelText(root, "Rounds").blur();
    await page.tick();

    expect(getByTestId(root, "notice")).toHaveTextContent("Unknown scoreKind");
    expect(queryByTestId(root, "pending")).toBeNull();
  });

  it("clears the retry banner after a drain that happened while the judge was typing", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(replying({ ok: true }));
    const { root, page } = start({ fetchFn });
    enterName(root);
    enterRoundsReps(root, "4", "7");
    await flushPromises();
    expect(getByTestId(root, "notice")).toHaveTextContent("Saved on this phone — will retry");

    getByLabelText(root, "Rounds").focus();
    await page.tick();
    getByLabelText(root, "Rounds").blur();
    await page.tick();

    expect(queryByTestId(root, "notice")).toBeNull();
    expect(queryByTestId(root, "pending")).toBeNull();
  });

  it("attributes the score to the heat the judge was shown, not the heat the clock has moved on to", async () => {
    const clock = { now: at("09:19") };
    const { root, page, fetchFn } = start({ now: () => clock.now });
    enterName(root);
    expect(getByTestId(root, "team-card")).toHaveTextContent("Rays of Glory");
    getByLabelText(root, "Rounds").focus();

    clock.now = at("09:24");
    await page.tick();
    expect(getByTestId(root, "team-card")).toHaveTextContent("Rays of Glory");
    enterRoundsReps(root, "4", "7");
    await flushPromises();

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ heat: 1, team: "Rays of Glory" });
    expect(getByTestId(root, "notice")).toHaveTextContent("Rays of Glory");
  });

  it("clears a half-entered score when the heat moves on", async () => {
    const clock = { now: at("09:22") };
    const { root, page } = start({ now: () => clock.now });
    enterName(root);
    expect(getByTestId(root, "team-card")).toHaveTextContent("Rays of Glory");
    fireEvent.click(getByRole(root, "button", { name: "More rounds" }));
    fireEvent.click(getByRole(root, "button", { name: "More rounds" }));
    expect(getByLabelText(root, "Rounds")).toHaveValue(2);

    clock.now = at("09:24");
    await page.tick();

    expect(getByTestId(root, "team-card")).toHaveTextContent("Browne");
    expect(getByLabelText(root, "Rounds")).toHaveValue(null);
  });

  it("keeps an invalid score on the heat the judge was scoring after the grace has expired", async () => {
    const clock = { now: at("09:22") };
    const { root, page } = start({ now: () => clock.now });
    enterName(root);
    expect(getByTestId(root, "team-card")).toHaveTextContent("Rays of Glory");
    getByLabelText(root, "Rounds").focus();
    fireEvent.input(getByLabelText(root, "Rounds"), { target: { value: "0" } });

    clock.now = at("09:24");
    await page.tick();
    fireEvent.submit(getByTestId(root, "score-form"));
    await flushPromises();

    expect(getByTestId(root, "team-card")).toHaveTextContent("Rays of Glory");
    expect(getByLabelText(root, "Rounds")).toHaveValue(0);
    expect(getByTestId(root, "notice")).toHaveTextContent("Enter at least one rep");
  });

  it("clears the form when the judge moves to another heat", () => {
    const { root } = start();
    enterName(root);
    fireEvent.input(getByLabelText(root, "Rounds"), { target: { value: "3" } });

    fireEvent.click(getByRole(root, "button", { name: "Next heat" }));

    expect(getByTestId(root, "team-card")).toHaveTextContent("Browne");
    expect(getByLabelText(root, "Rounds")).toHaveValue(null);
  });
});

describe("the Finished / Capped toggle", () => {
  it("switching to Capped and back keeps the typed time", () => {
    const { root } = start({ event: capped, now: () => at("08:02") });
    enterName(root);
    fireEvent.input(getByLabelText(root, "Minutes"), { target: { value: "7" } });
    fireEvent.input(getByLabelText(root, "Seconds"), { target: { value: "42" } });

    fireEvent.click(getByRole(root, "button", { name: "Capped" }));
    expect(getByLabelText(root, "Rounds")).toBeInTheDocument();

    fireEvent.click(getByRole(root, "button", { name: "Finished" }));

    expect(getByLabelText(root, "Minutes")).toHaveValue(7);
    expect(getByLabelText(root, "Seconds")).toHaveValue(42);
  });
});
