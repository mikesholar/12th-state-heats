import { fireEvent, getByLabelText, getByRole, getByTestId, getByText, queryByRole, queryByTestId, queryByText } from "@testing-library/dom";
import { readClaimDraft, renderSignup, type RenderSignupOptions } from "./render-signup";
import { emptyDraft } from "../core/signup";
import { DIVISIONS, makeClaimDraft, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

afterEach(() => {
  document.body.innerHTML = "";
});

const ME = "mike@example.com";

const schedule = makeSchedule({
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
    draft: emptyDraft(2),
    notice: undefined,
    busy: false,
    onEmailSubmit: vi.fn(),
    onEmailClear: vi.fn(),
    onOpenForm: vi.fn(),
    onCloseForm: vi.fn(),
    onClaim: vi.fn(),
    onRelease: vi.fn(),
    ...overrides,
  };
  renderSignup(options);
  return { root, options };
};

const chip = (root: HTMLElement, heat: string, lane: number) => root.querySelector(`[data-heat="${heat}"] [data-lane="${lane}"]`);

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

  it("is read-only while busy", () => {
    const { root } = renderWith({ busy: true });

    expect(root.querySelectorAll("button.chip")).toHaveLength(0);
    expect(queryByText(root, "Cancel")).toBeNull();
  });
});

describe("the claim form", () => {
  it("opens under the tapped heat with team, one field per athlete and a division select, pre-filled", () => {
    const { root } = renderWith({ openForm: { event: 1, heat: 2, lane: 1 }, draft: makeClaimDraft() });

    const form = getByTestId(root, "claim-form");
    expect(form.closest('[data-heat="E1H2"]')).not.toBeNull();
    expect(getByLabelText<HTMLInputElement>(root, "Team name").value).toBe("Fast but Questionable");
    expect(getByLabelText<HTMLInputElement>(root, "Athlete 1").value).toBe("Caroline Ortiz");
    expect(getByLabelText<HTMLInputElement>(root, "Athlete 2").value).toBe("Mike Sholar");
    expect(getByLabelText<HTMLSelectElement>(root, "Division").value).toBe("F/M Scaled");
    expect(getByRole(root, "button", { name: "Claim lane 1" })).toBeInTheDocument();
  });

  it("asks an individual only for their name", () => {
    const solo = { ...schedule, teamSize: 1 };
    const { root } = renderWith({ schedule: solo, openForm: { event: 1, heat: 2, lane: 1 }, draft: emptyDraft(1) });

    expect(queryByText(root, "Team name")).toBeNull();
    expect(getByLabelText(root, "Your name")).toBeInTheDocument();
  });

  it("submits what was typed", () => {
    const { root, options } = renderWith({ openForm: { event: 1, heat: 2, lane: 1 }, draft: emptyDraft(2) });

    fireEvent.input(getByLabelText(root, "Team name"), { target: { value: "New Team" } });
    fireEvent.input(getByLabelText(root, "Athlete 1"), { target: { value: "A" } });
    fireEvent.input(getByLabelText(root, "Athlete 2"), { target: { value: "B" } });
    fireEvent.change(getByLabelText(root, "Division"), { target: { value: "M/M RX" } });
    fireEvent.submit(getByTestId(root, "claim-form"));

    expect(options.onClaim).toHaveBeenCalledWith({ team: "New Team", athletes: ["A", "B"], division: "M/M RX" });
  });

  it("can be dismissed", () => {
    const { root, options } = renderWith({ openForm: { event: 1, heat: 2, lane: 1 } });

    fireEvent.click(getByRole(root, "button", { name: "Never mind" }));

    expect(options.onCloseForm).toHaveBeenCalled();
  });

  it("lists the divisions from the schedule", () => {
    const { root } = renderWith({ openForm: { event: 1, heat: 2, lane: 1 } });

    const labels = [...getByLabelText<HTMLSelectElement>(root, "Division").options].map((o) => o.textContent);
    expect(labels).toEqual(["— pick a division —", ...DIVISIONS]);
  });

  it("disables the submit while busy", () => {
    const { root } = renderWith({ openForm: { event: 1, heat: 2, lane: 1 }, busy: true });

    expect(getByRole(root, "button", { name: "Claim lane 1" })).toBeDisabled();
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

    expect(readClaimDraft({ root, teamSize: 2, fallback: emptyDraft(2) })).toEqual(makeClaimDraft());
  });

  it("falls back when the form is not on the page", () => {
    const { root } = renderWith();

    expect(readClaimDraft({ root, teamSize: 2, fallback: makeClaimDraft() })).toEqual(makeClaimDraft());
  });
});
