import { fireEvent, getByLabelText, getByRole, getByTestId, getByText, queryByRole, queryByTestId, queryByText } from "@testing-library/dom";
import { readClaimDraft, renderSignup, type RenderSignupOptions } from "./render-signup";
import { emptyDraft } from "../core/signup";
import { DIVISIONS, DIVISION_NAMES, makeClaimDraft, makeDivision, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

afterEach(() => {
  document.body.innerHTML = "";
});

const ME = "mike@example.com";

const schedule = makeSchedule({
  divisions: [makeDivision({ name: "Individual RX", teamSize: 1 }), ...DIVISIONS],
  events: [
    makeEvent({
      number: 1,
      title: "12th Gear",
      lanes: 3,
      heats: [
        makeHeat({ number: 1, lanes: [makeLane({ lane: 1, team: "Resting WOD Face", division: "F/F Scaled", email: "other@example.com" })] }),
        makeHeat({ number: 2, start: "08:13", end: "08:21", lanes: [] }),
      ],
    }),
    makeEvent({
      number: 2,
      title: "Extra Credit",
      lanes: 2,
      heats: [makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 2, team: "Mine", division: "F/M RX", email: ME })] })],
    }),
  ],
});

const renderWith = (overrides?: Partial<RenderSignupOptions>) => {
  const root = document.createElement("div");
  document.body.append(root);
  const options: RenderSignupOptions = {
    root,
    schedule,
    email: ME,
    sourceNotice: undefined,
    live: true,
    openForm: undefined,
    draft: emptyDraft(),
    notice: undefined,
    busy: false,
    onEmailSubmit: vi.fn(),
    onEmailClear: vi.fn(),
    onOpenForm: vi.fn(),
    onCloseForm: vi.fn(),
    onClaim: vi.fn(),
    onRelease: vi.fn(),
    onDraftChange: vi.fn(),
    ...overrides,
  };
  renderSignup(options);
  return { root, options };
};

const chip = (root: HTMLElement, heat: string, lane: number) => root.querySelector(`[data-heat="${heat}"] [data-lane="${lane}"]`);

describe("the comp name", () => {
  it("heads the page and the tab", () => {
    const { root } = renderWith({ schedule: { ...schedule, compName: "2027 Throwdown" } });

    expect(root.querySelector("h1")).toHaveTextContent("2027 Throwdown");
    expect(document.title).toBe("2027 Throwdown — Sign up");
  });
});

describe("the workout", () => {
  it("shows each event's RX and Scaled versions so members can pick a division", () => {
    const withWod = { ...schedule, events: [makeEvent({ number: 1, title: "12th Gear", format: "12 Rounds", rx: "12 Slam Balls (25/20)", scaled: "12 Slam Balls (15/10)" })] };
    const { root } = renderWith({ schedule: withWod });

    const header = root.querySelector(".event-header");
    expect(header).toHaveTextContent("12 Rounds");
    expect(header).toHaveTextContent("RX 12 Slam Balls (25/20)");
    expect(header).toHaveTextContent("Scaled 12 Slam Balls (15/10)");
  });
});

describe("the email gate", () => {
  it("asks for an email and reports it", () => {
    const { root, options } = renderWith({ email: undefined });

    fireEvent.input(getByLabelText(root, "Your email"), { target: { value: "Mike@Example.com" } });
    fireEvent.submit(getByTestId(root, "email-form"));

    expect(options.onEmailSubmit).toHaveBeenCalledWith("Mike@Example.com");
    expect(queryByRole(root, "button", { name: /lane 2 · open/i })).toBeNull();
  });

  it("shows who is signing up and lets them change it", () => {
    const { root, options } = renderWith();

    expect(root.textContent).toContain(ME);
    fireEvent.click(getByRole(root, "button", { name: /change email/i }));

    expect(options.onEmailClear).toHaveBeenCalled();
  });
});

describe("lane chips", () => {
  it("shows open lanes as buttons, taken lanes with their team, mine with a cancel", () => {
    const { root } = renderWith();

    expect(chip(root, "E1H1", 2)?.tagName).toBe("BUTTON");
    expect(chip(root, "E1H1", 1)).toHaveTextContent("Resting WOD Face");
    expect(chip(root, "E1H1", 1)).toHaveTextContent("F/F Scaled");
    expect(chip(root, "E1H1", 1)?.tagName).toBe("DIV");
    expect(chip(root, "E2H1", 2)).toHaveClass("mine");
    expect(chip(root, "E2H1", 2)?.querySelector("button")).toHaveTextContent("Cancel");
  });

  it("reports which slot was tapped", () => {
    const { root, options } = renderWith();

    const target = chip(root, "E1H1", 3);
    if (!(target instanceof HTMLButtonElement)) throw new Error("expected an open-lane button");
    fireEvent.click(target);

    expect(options.onOpenForm).toHaveBeenCalledWith({ event: 1, heat: 1, lane: 3 });
  });

  it("offers every open lane in every heat", () => {
    const { root } = renderWith();

    expect(chip(root, "E1H1", 2)?.tagName).toBe("BUTTON");
    expect(chip(root, "E1H2", 1)?.tagName).toBe("BUTTON");
    expect(chip(root, "E1H2", 3)?.tagName).toBe("BUTTON");
  });

  it("dims the open lanes of an event I am already in", () => {
    const { root } = renderWith();

    expect(chip(root, "E2H1", 1)?.tagName).toBe("DIV");
    expect(chip(root, "E2H1", 1)).toHaveClass("dim");
    expect(getByTestId(root, "your-slot-2")).toHaveTextContent("You're in Heat 1, lane 2");
  });

  it("reports a cancel", () => {
    const { root, options } = renderWith();

    fireEvent.click(getByText(root, "Cancel"));

    expect(options.onRelease).toHaveBeenCalledWith({ event: 2, heat: 1, lane: 2 });
  });

  it("is read-only when sign-ups are closed", () => {
    const { root } = renderWith({ schedule: { ...schedule, signupsOpen: false } });

    expect(root.querySelectorAll("button.chip")).toHaveLength(0);
    expect(queryByText(root, "Cancel")).toBeNull();
    expect(getByTestId(root, "signups-pill")).toHaveTextContent("Sign-ups closed");
  });

  it("is read-only when the schedule is not live", () => {
    const { root } = renderWith({ live: false, sourceNotice: "Offline — showing last known schedule" });

    expect(root.querySelectorAll("button.chip")).toHaveLength(0);
    expect(queryByText(root, "Cancel")).toBeNull();
    expect(getByTestId(root, "source-notice")).toHaveTextContent("Offline");
  });

  it("says it is saving while a write is in flight", () => {
    const { root } = renderWith({ busy: true });

    expect(getByTestId(root, "saving")).toHaveTextContent("Notifying the Coaches!");
    expect(queryByTestId(renderWith().root, "saving")).toBeNull();
  });

  it("is read-only while busy", () => {
    const { root } = renderWith({ busy: true });

    expect(root.querySelectorAll("button.chip")).toHaveLength(0);
    expect(queryByText(root, "Cancel")).toBeNull();
  });
});

describe("what a lane is called", () => {
  it("uses the sheet's word on chips, the claim button and the cancel name", () => {
    const positions = { ...schedule, laneLabel: "Position" };
    const { root } = renderWith({ schedule: positions, openForm: { event: 1, heat: 2, lane: 1 }, draft: makeClaimDraft() });

    expect(chip(root, "E1H1", 2)).toHaveTextContent("Position 2 · open");
    expect(chip(root, "E1H1", 1)).toHaveTextContent("Position 1 ·");
    expect(getByTestId(root, "your-slot-2")).toHaveTextContent("You're in Heat 1, position 2");
    expect(getByRole(root, "button", { name: "Claim position 1" })).toBeInTheDocument();
    expect(getByRole(root, "button", { name: /^cancel position 2/i })).toBeInTheDocument();
    expect(root.textContent).not.toMatch(/\bLane\b/);
  });
});

describe("the claim form", () => {
  const open = { event: 1, heat: 2, lane: 1 };

  it("asks for the division first and shows no name fields until one is picked", () => {
    const { root } = renderWith({ openForm: open, draft: emptyDraft() });

    expect(getByLabelText(root, "Division")).toBeInTheDocument();
    expect(root.querySelectorAll('[id^="athlete-"]')).toHaveLength(0);
    expect(queryByText(root, "Team name")).toBeNull();
    expect(getByRole(root, "button", { name: "Claim lane 1" })).toBeInTheDocument();
  });

  it("shows team name and one field per athlete for a team division, pre-filled", () => {
    const { root } = renderWith({ openForm: open, draft: makeClaimDraft() });

    expect(getByTestId(root, "claim-form").closest('[data-heat="E1H2"]')).not.toBeNull();
    expect(getByLabelText<HTMLSelectElement>(root, "Division").value).toBe("F/M Scaled");
    expect(getByLabelText<HTMLInputElement>(root, "Team name").value).toBe("Fast but Questionable");
    expect(getByLabelText<HTMLInputElement>(root, "Athlete 1").value).toBe("Caroline Ortiz");
    expect(getByLabelText<HTMLInputElement>(root, "Athlete 2").value).toBe("Mike Sholar");
  });

  it("asks an individual only for their name", () => {
    const { root } = renderWith({ openForm: open, draft: makeClaimDraft({ division: "Individual RX", athletes: [""] }) });

    expect(queryByText(root, "Team name")).toBeNull();
    expect(getByLabelText(root, "Your name")).toBeInTheDocument();
    expect(root.querySelectorAll('[id^="athlete-"]')).toHaveLength(1);
  });

  it("reports the draft when the division changes so the fields can follow", () => {
    const { root, options } = renderWith({ openForm: open, draft: makeClaimDraft() });

    fireEvent.input(getByLabelText(root, "Team name"), { target: { value: "Kept" } });
    fireEvent.change(getByLabelText(root, "Division"), { target: { value: "Individual RX" } });

    expect(options.onDraftChange).toHaveBeenCalledWith({ team: "Kept", athletes: ["Caroline Ortiz", "Mike Sholar"], division: "Individual RX" });
  });

  it("submits what was typed", () => {
    const { root, options } = renderWith({ openForm: open, draft: makeClaimDraft({ team: "", athletes: ["", ""] }) });

    fireEvent.input(getByLabelText(root, "Team name"), { target: { value: "New Team" } });
    fireEvent.input(getByLabelText(root, "Athlete 1"), { target: { value: "A" } });
    fireEvent.input(getByLabelText(root, "Athlete 2"), { target: { value: "B" } });
    fireEvent.submit(getByTestId(root, "claim-form"));

    expect(options.onClaim).toHaveBeenCalledWith({ team: "New Team", athletes: ["A", "B"], division: "F/M Scaled" });
  });

  it("can be dismissed", () => {
    const { root, options } = renderWith({ openForm: open });

    fireEvent.click(getByRole(root, "button", { name: "Never mind" }));

    expect(options.onCloseForm).toHaveBeenCalled();
  });

  it("lists the divisions from the schedule", () => {
    const { root } = renderWith({ openForm: open });

    const labels = [...getByLabelText<HTMLSelectElement>(root, "Division").options].map((o) => o.textContent);
    expect(labels).toEqual(["— pick a division —", "Individual RX", ...DIVISION_NAMES]);
  });

  it("disables the submit and says so while the claim is in flight", () => {
    const { root } = renderWith({ openForm: open, draft: makeClaimDraft(), busy: true });

    const submit = getByRole(root, "button", { name: "Claiming…" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(getByRole(root, "button", { name: "Never mind" })).toBeDisabled();
  });
});

describe("notices", () => {
  it("shows an error under the heat it belongs to", () => {
    const { root } = renderWith({ notice: { kind: "error", text: "Lane 3 was just taken", at: { event: 1, heat: 1, lane: 3 } } });

    const notice = getByTestId(root, "notice");
    expect(notice).toHaveTextContent("Lane 3 was just taken");
    expect(notice.closest('[data-heat="E1H1"]')).not.toBeNull();
    expect(notice).toHaveAttribute("role", "alert");
  });

  it("shows a general notice in the header", () => {
    const { root } = renderWith({ notice: { kind: "error", text: "Couldn't reach the sheet — try again" } });

    expect(getByTestId(root, "notice").closest("header")).not.toBeNull();
  });

  it("has no notice element otherwise", () => {
    expect(queryByTestId(renderWith().root, "notice")).toBeNull();
  });

  it("gives an info notice a status role", () => {
    const { root } = renderWith({ notice: { kind: "info", text: "Saved" } });

    expect(getByTestId(root, "notice")).toHaveAttribute("role", "status");
  });
});

describe("reading the draft back", () => {
  it("returns the current field values", () => {
    const { root } = renderWith({ openForm: { event: 1, heat: 2, lane: 1 }, draft: makeClaimDraft() });

    expect(readClaimDraft({ root, fallback: emptyDraft() })).toEqual(makeClaimDraft());
  });

  it("keeps names beyond the visible fields so switching division and back loses nothing", () => {
    const { root } = renderWith({ openForm: { event: 1, heat: 2, lane: 1 }, draft: makeClaimDraft({ division: "Individual RX", athletes: ["Caroline Ortiz"] }) });

    const fallback = makeClaimDraft({ athletes: ["Old", "Mike Sholar"] });

    expect(readClaimDraft({ root, fallback }).athletes).toEqual(["Caroline Ortiz", "Mike Sholar"]);
  });

  it("falls back when the form is not on the page", () => {
    const { root } = renderWith();

    expect(readClaimDraft({ root, fallback: makeClaimDraft() })).toEqual(makeClaimDraft());
  });
});
