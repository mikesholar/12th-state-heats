import { fireEvent, getByLabelText, getByRole, getByTestId, getByText, queryByRole, queryByTestId } from "@testing-library/dom";
import { renderJudge, type RenderJudgeOptions } from "./render-judge";
import { at, makeEvent, makeHeat, makeLane, makeSchedule } from "../test/factories";

afterEach(() => {
  document.body.innerHTML = "";
});

const amrap = makeEvent({
  number: 2,
  title: "Extra Credit",
  scoring: "rounds-reps",
  heats: [
    makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 5, team: "Rays of Glory", athletes: "David + Shelby", division: "F/M Scaled" })] }),
    makeHeat({ number: 2, start: "09:25", end: "09:35", lanes: [makeLane({ lane: 4, team: "Browne" })] }),
  ],
});
const capped = makeEvent({
  number: 1,
  title: "12th Gear",
  scoring: "time-or-rounds",
  capSeconds: 480,
  heats: [makeHeat({ number: 1, start: "08:00", end: "08:08", lanes: [makeLane({ lane: 5, team: "Glizzy Gals" })] })],
});

const renderWith = (overrides?: Partial<RenderJudgeOptions>) => {
  const root = document.createElement("div");
  document.body.append(root);
  const options: RenderJudgeOptions = {
    root,
    schedule: makeSchedule({ events: [capped, amrap] }),
    event: amrap,
    lane: 5,
    now: at("09:12"),
    judgeName: "Kim",
    sentHeats: [],
    manual: undefined,
    draft: undefined,
    pending: 0,
    notice: undefined,
    endpointConfigured: true,
    onNameSubmit: vi.fn(),
    onNameClear: vi.fn(),
    onHeatChange: vi.fn(),
    onModeChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  renderJudge(options);
  return { root, options };
};

describe("the name gate", () => {
  it("asks for a name when none is stored and shows nothing else", () => {
    const { root } = renderWith({ judgeName: undefined });

    expect(getByLabelText(root, "Your name")).toBeInTheDocument();
    expect(queryByTestId(root, "team-card")).toBeNull();
  });

  it("hands the trimmed name back on Continue", () => {
    const { root, options } = renderWith({ judgeName: undefined });

    fireEvent.input(getByLabelText(root, "Your name"), { target: { value: "  Kim " } });
    fireEvent.submit(getByTestId(root, "name-form"));

    expect(options.onNameSubmit).toHaveBeenCalledWith("Kim");
  });

  it("does not continue with a blank name", () => {
    const { root, options } = renderWith({ judgeName: undefined });

    fireEvent.submit(getByTestId(root, "name-form"));

    expect(options.onNameSubmit).not.toHaveBeenCalled();
  });

  it("offers to change the name from the footer", () => {
    const { root, options } = renderWith();

    fireEvent.click(getByText(root, "Not you? Change name"));

    expect(options.onNameClear).toHaveBeenCalled();
  });
});

describe("the header", () => {
  it("names the event, lane and judge", () => {
    const { root } = renderWith();

    const header = getByTestId(root, "judge-header").textContent ?? "";
    expect(header).toContain("Event 2");
    expect(header).toContain("Extra Credit");
    expect(header).toContain("Lane 5");
    expect(header).toContain("Kim");
  });

  it("shows a pending badge only while submissions are queued", () => {
    expect(queryByTestId(renderWith().root, "pending")).toBeNull();
    expect(getByTestId(renderWith({ pending: 2 }).root, "pending")).toHaveTextContent("2 pending");
  });

  it("warns when scoring is not configured", () => {
    const { root } = renderWith({ endpointConfigured: false });

    expect(root.textContent).toContain("Scoring not configured");
  });
});

describe("the heat selector", () => {
  it("shows the auto-selected heat and its position", () => {
    expect(getByTestId(renderWith().root, "heat-label")).toHaveTextContent("Heat 1 of 2");
  });

  it("moves to the next heat", () => {
    const { root, options } = renderWith();

    fireEvent.click(getByRole(root, "button", { name: "Next heat" }));

    expect(options.onHeatChange).toHaveBeenCalledWith(2);
  });

  it("disables previous on the first heat and next on the last", () => {
    expect(getByRole(renderWith().root, "button", { name: "Previous heat" })).toBeDisabled();
    expect(getByRole(renderWith({ manual: { heat: 2, at: at("09:12") } }).root, "button", { name: "Next heat" })).toBeDisabled();
  });

  it("ticks heats already sent from this phone", () => {
    const { root } = renderWith({ sentHeats: [1] });

    expect(getByTestId(root, "heat-label")).toHaveTextContent("✓");
  });
});

describe("the team card", () => {
  it("shows the team in the judge's lane for the selected heat", () => {
    const card = getByTestId(renderWith().root, "team-card").textContent ?? "";

    expect(card).toContain("Rays of Glory");
    expect(card).toContain("David + Shelby");
    expect(card).toContain("F/M Scaled");
  });

  it("says when the lane is empty and disables the form", () => {
    const { root } = renderWith({ manual: { heat: 2, at: at("09:12") } });

    expect(getByTestId(root, "team-card")).toHaveTextContent("No team in lane 5 for this heat");
    expect(queryByRole(root, "button", { name: "Submit score" })).toBeNull();
  });

  it("renders a hostile team name as text", () => {
    const hostile = makeEvent({
      ...amrap,
      heats: [makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 5, team: "<img src=x onerror=alert(1)>" })] })],
    });
    const { root } = renderWith({ event: hostile });

    expect(root.querySelector("img")).toBeNull();
    expect(getByTestId(root, "team-card").textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("the score form", () => {
  it("shows rounds and reps for an AMRAP", () => {
    const { root } = renderWith();

    expect(getByLabelText(root, "Rounds")).toBeInTheDocument();
    expect(getByLabelText(root, "Reps")).toBeInTheDocument();
    expect(queryByRole(root, "button", { name: "Finished" })).toBeNull();
  });

  it("shows Finished and Capped for a time-capped event, starting on Finished with a time input", () => {
    const { root } = renderWith({ event: capped, now: at("08:02") });

    expect(getByRole(root, "button", { name: "Finished" })).toHaveAttribute("aria-pressed", "true");
    expect(getByLabelText(root, "Minutes")).toBeInTheDocument();
    expect(getByLabelText(root, "Seconds")).toBeInTheDocument();
  });

  it("shows rounds and reps when the draft is on Capped", () => {
    const { root } = renderWith({
      event: capped,
      now: at("08:02"),
      draft: { mode: "rounds-reps", minutes: "", seconds: "", rounds: "9", reps: "14" },
    });

    expect(getByRole(root, "button", { name: "Capped" })).toHaveAttribute("aria-pressed", "true");
    expect(getByLabelText(root, "Rounds")).toHaveValue(9);
    expect(getByLabelText(root, "Reps")).toHaveValue(14);
  });

  it("reports a switch to Capped", () => {
    const { root, options } = renderWith({ event: capped, now: at("08:02") });

    fireEvent.click(getByRole(root, "button", { name: "Capped" }));

    expect(options.onModeChange).toHaveBeenCalledWith("rounds-reps");
  });

  it("submits rounds and reps as a score", () => {
    const { root, options } = renderWith();

    fireEvent.input(getByLabelText(root, "Rounds"), { target: { value: "4" } });
    fireEvent.input(getByLabelText(root, "Reps"), { target: { value: "7" } });
    fireEvent.submit(getByTestId(root, "score-form"));

    expect(options.onSubmit).toHaveBeenCalledWith({ kind: "rounds-reps", rounds: 4, reps: 7 });
  });

  it("submits minutes and seconds as a time", () => {
    const { root, options } = renderWith({ event: capped, now: at("08:02") });

    fireEvent.input(getByLabelText(root, "Minutes"), { target: { value: "7" } });
    fireEvent.input(getByLabelText(root, "Seconds"), { target: { value: "42" } });
    fireEvent.submit(getByTestId(root, "score-form"));

    expect(options.onSubmit).toHaveBeenCalledWith({ kind: "time", seconds: 462 });
  });

  it("steppers adjust the value", () => {
    const { root } = renderWith({ draft: { mode: "rounds-reps", minutes: "", seconds: "", rounds: "4", reps: "7" } });

    fireEvent.click(getByRole(root, "button", { name: "More reps" }));
    fireEvent.click(getByRole(root, "button", { name: "Fewer rounds" }));

    expect(getByLabelText(root, "Reps")).toHaveValue(8);
    expect(getByLabelText(root, "Rounds")).toHaveValue(3);
  });

  it("keeps focus on the field being typed in across a re-render", () => {
    const { root, options } = renderWith();
    getByLabelText(root, "Reps").focus();

    renderJudge(options);

    expect(document.activeElement).toBe(getByLabelText(root, "Reps"));
  });

  it("labels the button Update score once this heat has been sent", () => {
    expect(getByRole(renderWith({ sentHeats: [1] }).root, "button", { name: "Update score" })).toBeInTheDocument();
  });
});

describe("notices", () => {
  it("shows a recorded banner", () => {
    const { root } = renderWith({ notice: { kind: "recorded", text: "Recorded ✓ — Rays of Glory: 4 + 7" } });

    expect(getByTestId(root, "notice")).toHaveTextContent("Recorded ✓ — Rays of Glory: 4 + 7");
    expect(getByTestId(root, "notice")).toHaveClass("recorded");
  });

  it("shows a retrying banner", () => {
    expect(getByTestId(renderWith({ notice: { kind: "retrying" } }).root, "notice")).toHaveTextContent("Saved on this phone — will retry");
  });

  it("shows an error banner", () => {
    expect(getByTestId(renderWith({ notice: { kind: "error", text: "Enter a time" } }).root, "notice")).toHaveClass("error");
  });
});
