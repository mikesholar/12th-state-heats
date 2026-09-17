import { fireEvent, getByLabelText, getByRole, getByTestId, queryByTestId, queryByRole } from "@testing-library/dom";
import type { Mock } from "vitest";
import { startSignupPage } from "./signup-page";
import { loadLastClaim, saveLastClaim, saveSignupEmail } from "./signup-store";
import type { LoadedSchedule } from "../core/load-schedule";
import { makeClaimDraft, makeEvent, makeHeat, makeLane, makeLoadedSchedule, makeRawEvent, makeRawHeat, makeRawLane, makeRawSchedule, makeSchedule } from "../test/factories";

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

const ENDPOINT = "https://script.example/exec";
const ME = "mike@example.com";

const schedule = makeSchedule({
  events: [makeEvent({ number: 1, lanes: 2, heats: [makeHeat({ number: 1, lanes: [makeLane({ lane: 1, team: "Taken", email: "other@example.com" })] })] })],
});

const rawWithMine = makeRawSchedule({
  events: [
    makeRawEvent({
      number: 1,
      lanes: 2,
      heats: [
        makeRawHeat({
          number: 1,
          lanes: [
            makeRawLane({ lane: 1, team: "Taken", email: "other@example.com" }),
            makeRawLane({ lane: 2, team: "Fast but Questionable", athletes: "Caroline Ortiz + Mike Sholar", email: ME }),
          ],
        }),
      ],
    }),
  ],
});

const replying = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type StartOptions = {
  readonly fetchFn?: Mock<typeof fetch>;
  readonly loadSchedule?: Mock<() => Promise<LoadedSchedule>>;
  readonly initial?: LoadedSchedule;
};

const start = (options?: StartOptions) => {
  const root = document.createElement("div");
  document.body.append(root);
  const fetchFn = options?.fetchFn ?? vi.fn<typeof fetch>().mockResolvedValue(replying({ ok: true, schedule: rawWithMine }));
  const loadSchedule = options?.loadSchedule ?? vi.fn<() => Promise<LoadedSchedule>>().mockResolvedValue(makeLoadedSchedule({ schedule }));
  const page = startSignupPage({ root, initial: options?.initial ?? makeLoadedSchedule({ schedule }), loadSchedule, endpoint: ENDPOINT, fetchFn });
  return { root, page, fetchFn, loadSchedule };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fillForm = (root: HTMLElement) => {
  fireEvent.input(getByLabelText(root, "Team name"), { target: { value: "Fast but Questionable" } });
  fireEvent.input(getByLabelText(root, "Athlete 1"), { target: { value: "Caroline Ortiz" } });
  fireEvent.input(getByLabelText(root, "Athlete 2"), { target: { value: "Mike Sholar" } });
  fireEvent.change(getByLabelText(root, "Division"), { target: { value: "F/M Scaled" } });
};

const openLane2 = (root: HTMLElement) => fireEvent.click(getByRole(root, "button", { name: /lane 2 · open/i }));

describe("identity", () => {
  it("remembers the email once entered", () => {
    const { root } = start();

    fireEvent.input(getByLabelText(root, "Your email"), { target: { value: "Mike@Example.com" } });
    fireEvent.submit(getByTestId(root, "email-form"));

    expect(root.textContent).toContain(ME);
    expect(getByRole(root, "button", { name: /lane 2 · open/i })).toBeInTheDocument();
  });

  it("forgets it on request", () => {
    saveSignupEmail(ME);
    const { root } = start();

    fireEvent.click(getByRole(root, "button", { name: /change email/i }));

    expect(getByLabelText(root, "Your email")).toBeInTheDocument();
  });
});

describe("claiming", () => {
  it("opens the form, posts the claim and redraws from the reply", async () => {
    saveSignupEmail(ME);
    const { root, fetchFn } = start();

    openLane2(root);
    fillForm(root);
    fireEvent.submit(getByTestId(root, "claim-form"));
    await flush();

    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
      action: "claim",
      event: 1,
      heat: 1,
      lane: 2,
      email: ME,
      team: "Fast but Questionable",
      athletes: "Caroline Ortiz + Mike Sholar",
      division: "F/M Scaled",
    });
    expect(queryByTestId(root, "claim-form")).toBeNull();
    expect(root.querySelector('[data-lane="2"]')).toHaveClass("mine");
    expect(loadLastClaim()).toEqual(makeClaimDraft());
  });

  it("pre-fills the form from the last claim", () => {
    saveSignupEmail(ME);
    saveLastClaim(makeClaimDraft({ team: "Again" }));
    const { root } = start();

    openLane2(root);

    expect(getByLabelText<HTMLInputElement>(root, "Team name").value).toBe("Again");
  });

  it("rejects a blank form before posting and keeps what was typed", async () => {
    saveSignupEmail(ME);
    const { root, fetchFn } = start();

    openLane2(root);
    fireEvent.input(getByLabelText(root, "Team name"), { target: { value: "Half" } });
    fireEvent.submit(getByTestId(root, "claim-form"));
    await flush();

    expect(getByTestId(root, "notice")).toHaveTextContent("Enter a name for every athlete");
    expect(getByLabelText<HTMLInputElement>(root, "Team name").value).toBe("Half");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("shows the sheet's refusal under the heat and redraws the slot as taken", async () => {
    saveSignupEmail(ME);
    const takenByOther = makeRawSchedule({
      events: [
        makeRawEvent({
          number: 1,
          lanes: 2,
          heats: [
            makeRawHeat({
              number: 1,
              lanes: [makeRawLane({ lane: 1, team: "Taken", email: "other@example.com" }), makeRawLane({ lane: 2, team: "Sniped", email: "third@example.com" })],
            }),
          ],
        }),
      ],
    });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(replying({ ok: false, error: "Lane 2 was just taken", schedule: takenByOther }));
    const { root } = start({ fetchFn });

    openLane2(root);
    fillForm(root);
    fireEvent.submit(getByTestId(root, "claim-form"));
    await flush();

    expect(getByTestId(root, "notice")).toHaveTextContent("Lane 2 was just taken");
    expect(root.querySelector('[data-lane="2"]')).toHaveTextContent("Sniped");
    expect(queryByTestId(root, "claim-form")).toBeNull();
  });

  it("says so when the sheet cannot be reached and keeps the form", async () => {
    saveSignupEmail(ME);
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const { root } = start({ fetchFn });

    openLane2(root);
    fillForm(root);
    fireEvent.submit(getByTestId(root, "claim-form"));
    await flush();

    expect(getByTestId(root, "notice")).toHaveTextContent("Couldn't reach the sheet — try again");
    expect(getByLabelText<HTMLInputElement>(root, "Team name").value).toBe("Fast but Questionable");
  });

  it("refreshes from the sheet when an accepted reply has no usable schedule", async () => {
    saveSignupEmail(ME);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(replying({ ok: true }));
    const loadSchedule = vi.fn<() => Promise<LoadedSchedule>>().mockResolvedValue(makeLoadedSchedule({ schedule }));
    const { root } = start({ fetchFn, loadSchedule });

    openLane2(root);
    fillForm(root);
    fireEvent.submit(getByTestId(root, "claim-form"));
    await flush();

    expect(loadSchedule).toHaveBeenCalled();
    expect(queryByTestId(root, "claim-form")).toBeNull();
  });
});

describe("cancelling", () => {
  it("posts the release and redraws", async () => {
    saveSignupEmail(ME);
    const mine = makeSchedule({
      events: [makeEvent({ number: 1, lanes: 2, heats: [makeHeat({ number: 1, lanes: [makeLane({ lane: 2, team: "Mine", email: ME })] })] })],
    });
    const emptied = makeRawSchedule({ events: [makeRawEvent({ number: 1, lanes: 2, heats: [makeRawHeat({ number: 1, lanes: [] })] })] });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(replying({ ok: true, schedule: emptied }));
    const { root } = start({ fetchFn, initial: makeLoadedSchedule({ schedule: mine }) });

    fireEvent.click(getByRole(root, "button", { name: "Cancel" }));
    await flush();

    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({ action: "release", event: 1, heat: 1, lane: 2, email: ME });
    expect(getByRole(root, "button", { name: /lane 2 · open/i })).toBeInTheDocument();
  });
});

describe("refreshing", () => {
  it("redraws from the sheet on refresh", async () => {
    saveSignupEmail(ME);
    const closed = makeLoadedSchedule({ schedule: { ...schedule, signupsOpen: false } });
    const loadSchedule = vi.fn<() => Promise<LoadedSchedule>>().mockResolvedValue(closed);
    const { root, page } = start({ loadSchedule });

    await page.refresh();

    expect(getByTestId(root, "signups-pill")).toHaveTextContent("Sign-ups closed");
    expect(queryByRole(root, "button", { name: /lane 2 · open/i })).toBeNull();
  });

  it("does not refresh while the claim form is open", async () => {
    saveSignupEmail(ME);
    const { root, page, loadSchedule } = start();

    openLane2(root);
    await page.refresh();

    expect(loadSchedule).not.toHaveBeenCalled();
    expect(getByTestId(root, "claim-form")).toBeInTheDocument();
  });

  it("shows the stale-schedule pill and blocks writes when not live", () => {
    saveSignupEmail(ME);
    const { root } = start({ initial: makeLoadedSchedule({ schedule, source: "cached", reason: "unreachable" }) });

    expect(getByTestId(root, "source-notice")).toHaveTextContent("Offline");
    expect(queryByRole(root, "button", { name: /lane 2 · open/i })).toBeNull();
  });
});
