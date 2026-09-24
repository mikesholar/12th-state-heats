import { fireEvent, getByLabelText, getByRole, getByTestId, queryByRole, queryByTestId } from "@testing-library/dom";
import { renderJudge, type RenderJudgeOptions } from "./render-judge";
import type { Event } from "../core/types";
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

    fireEvent.click(getByRole(root, "button", { name: "Not you? Change name" }));

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

  it("uses the sheet's word for a lane", () => {
    const positions = makeSchedule({ events: [capped, amrap], laneLabel: "Position" });
    const { root } = renderWith({ schedule: positions, manual: { heat: 2, at: at("09:12") } });

    expect(getByTestId(root, "judge-header")).toHaveTextContent("Position 5");
    expect(getByTestId(root, "team-card")).toHaveTextContent("No team in position 5 for this heat");
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

describe("the workout", () => {
  it("shows the event's format and its RX and Scaled versions", () => {
    const wod = makeEvent({ ...amrap, format: "AMRAP 10", rx: "10 Slam Balls (25/20)", scaled: "10 Slam Balls (15/10)" });
    const workout = getByTestId(renderWith({ event: wod }).root, "workout");

    expect(workout).toHaveTextContent("AMRAP 10");
    expect(workout).toHaveTextContent("RX 10 Slam Balls (25/20)");
    expect(workout).toHaveTextContent("Scaled 10 Slam Balls (15/10)");
  });

  const highlighted = (root: HTMLElement): readonly string[] =>
    Array.from(getByTestId(root, "workout").querySelectorAll('[aria-current="true"]'), (line) => line.textContent ?? "");

  const withDivision = (division: string): Event =>
    makeEvent({ ...amrap, rx: "RX version", scaled: "Scaled version", heats: [makeHeat({ number: 1, start: "09:10", end: "09:20", lanes: [makeLane({ lane: 5, division })] })] });

  it("highlights the Scaled version for a Scaled team", () => {
    const { root } = renderWith({ event: withDivision("Indy F Scaled") });

    expect(highlighted(root)).toEqual(["Scaled Scaled version"]);
  });

  it("highlights the RX version for an RX team", () => {
    const { root } = renderWith({ event: withDivision("F/F RX") });

    expect(highlighted(root)).toEqual(["RX RX version"]);
  });

  it("highlights neither version when the division doesn't say RX or Scaled", () => {
    const { root } = renderWith({ event: withDivision("Masters") });

    expect(highlighted(root)).toEqual([]);
  });

  it("highlights neither version when the lane is empty", () => {
    const { root } = renderWith({ manual: { heat: 2, at: at("09:12") } });

    expect(highlighted(root)).toEqual([]);
  });

  it("still shows the workout when the lane is empty", () => {
    const { root } = renderWith({ manual: { heat: 2, at: at("09:12") } });

    expect(getByTestId(root, "workout")).toBeInTheDocument();
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
    const { root } = renderWith({ notice: { kind: "error", text: "Enter a time" } });

    expect(getByRole(root, "alert")).toHaveTextContent("Enter a time");
    expect(getByTestId(root, "notice")).toHaveClass("error");
  });
});
