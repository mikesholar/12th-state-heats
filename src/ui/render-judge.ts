import { resolveJudgeHeat, type ManualPick } from "../core/resolve-judge-heat";
import type { Score } from "../core/score";
import type { Event, Lane, Schedule } from "../core/types";
import { esc } from "./html";

export type ScoreDraft = {
  readonly mode: Score["kind"];
  readonly minutes: string;
  readonly seconds: string;
  readonly rounds: string;
  readonly reps: string;
};

export type Notice =
  | { readonly kind: "recorded"; readonly text: string }
  | { readonly kind: "retrying" }
  | { readonly kind: "error"; readonly text: string };

export type RenderJudgeOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly event: Event;
  readonly lane: number;
  readonly now: Date;
  readonly judgeName: string | undefined;
  readonly sentHeats: readonly number[];
  readonly manual: ManualPick | undefined;
  readonly draft: ScoreDraft | undefined;
  readonly pending: number;
  readonly notice: Notice | undefined;
  readonly endpointConfigured: boolean;
  readonly onNameSubmit: (name: string) => void;
  readonly onNameClear: () => void;
  readonly onHeatChange: (heat: number) => void;
  readonly onModeChange: (mode: Score["kind"]) => void;
  readonly onSubmit: (score: Score) => void;
};

const SECONDS_PER_MINUTE = 60;

export const emptyDraft = (event: Event): ScoreDraft => ({
  mode: event.scoring === "time-or-rounds" ? "time" : "rounds-reps",
  minutes: "",
  seconds: "",
  rounds: "",
  reps: "",
});

const nameGateHtml = (): string => `
  <main class="main judge-gate">
    <form id="name-form" data-testid="name-form" class="name-form">
      <label for="judge-name">Your name</label>
      <input id="judge-name" name="name" type="text" autocomplete="name" autofocus required />
      <button type="submit" class="primary">Continue</button>
    </form>
  </main>`;

type HeaderOptions = {
  readonly event: Event;
  readonly lane: number;
  readonly laneLabel: string;
  readonly judgeName: string;
  readonly pending: number;
  readonly endpointConfigured: boolean;
};

const headerHtml = ({ event, lane, laneLabel, judgeName, pending, endpointConfigured }: HeaderOptions): string => `
  <header class="header judge-header" data-testid="judge-header">
    <div class="header-row">
      <div>
        <div class="event-kicker">Event ${event.number} · ${esc(event.title)}</div>
        <h1 class="title judge-lane">${esc(laneLabel)} ${lane}</h1>
      </div>
      <div class="judge-meta">
        <div class="judge-name">${esc(judgeName)}</div>
        ${pending > 0 ? `<div class="pending" data-testid="pending">${pending} pending</div>` : ""}
      </div>
    </div>
    ${endpointConfigured ? "" : `<div class="config-warning">Scoring not configured — scores will stay on this phone</div>`}
  </header>`;

const heatSelectorHtml = (options: RenderJudgeOptions, index: number, sent: boolean): string => {
  const total = options.event.heats.length;
  return `
  <div class="heat-selector">
    <button type="button" id="prev-heat" aria-label="Previous heat" ${index === 0 ? "disabled" : ""}>◀</button>
    <div class="heat-label" data-testid="heat-label">Heat ${options.event.heats[index]?.number ?? ""} of ${total}${sent ? ' <span aria-label="score sent">✓</span>' : ""}</div>
    <button type="button" id="next-heat" aria-label="Next heat" ${index === total - 1 ? "disabled" : ""}>▶</button>
  </div>`;
};

type TeamCardOptions = { readonly lane: Lane | undefined; readonly laneNumber: number; readonly laneLabel: string };

const teamCardHtml = ({ lane, laneNumber, laneLabel }: TeamCardOptions): string =>
  lane
    ? `<section class="team-card" data-testid="team-card">
        <div class="team-card-name">${esc(lane.team)}</div>
        <div class="team-card-athletes">${esc(lane.athletes)}</div>
        <div class="team-card-division">${esc(lane.division)}</div>
      </section>`
    : `<section class="team-card empty" data-testid="team-card">No team in ${esc(laneLabel.toLowerCase())} ${laneNumber} for this heat</section>`;

const stepperHtml = (id: string, label: string, value: string): string => `
  <div class="stepper">
    <label for="${id}">${label}</label>
    <div class="stepper-row">
      <button type="button" class="step" data-step="-1" data-target="${id}" aria-label="Fewer ${label.toLowerCase()}">−</button>
      <input id="${id}" name="${id}" type="number" inputmode="numeric" min="0" step="1" value="${esc(value)}" />
      <button type="button" class="step" data-step="1" data-target="${id}" aria-label="More ${label.toLowerCase()}">+</button>
    </div>
  </div>`;

const timeFieldsHtml = (draft: ScoreDraft): string => `
  <div class="time-fields">
    <div><label for="minutes">Minutes</label><input id="minutes" name="minutes" type="number" inputmode="numeric" min="0" step="1" value="${esc(draft.minutes)}" /></div>
    <span class="time-colon">:</span>
    <div><label for="seconds">Seconds</label><input id="seconds" name="seconds" type="number" inputmode="numeric" min="0" max="59" step="1" value="${esc(draft.seconds)}" /></div>
  </div>`;

const modeToggleHtml = (mode: Score["kind"]): string => `
  <div class="mode-toggle" role="group" aria-label="Result">
    <button type="button" class="mode" data-mode="time" aria-pressed="${mode === "time"}">Finished</button>
    <button type="button" class="mode" data-mode="rounds-reps" aria-pressed="${mode === "rounds-reps"}">Capped</button>
  </div>`;

const scoreFormHtml = (event: Event, draft: ScoreDraft, sent: boolean): string => {
  const fields =
    draft.mode === "time" ? timeFieldsHtml(draft) : stepperHtml("rounds", "Rounds", draft.rounds) + stepperHtml("reps", "Reps", draft.reps);
  return `
  <form id="score-form" data-testid="score-form" class="score-form">
    ${event.scoring === "time-or-rounds" ? modeToggleHtml(draft.mode) : ""}
    ${fields}
    <button type="submit" class="primary submit">${sent ? "Update score" : "Submit score"}</button>
  </form>`;
};

type WorkoutVersion = "rx" | "scaled";

const versionForDivision = (division: string | undefined): WorkoutVersion | undefined => {
  if (division && /\bscaled\b/i.test(division)) return "scaled";
  if (division && /\brx\b/i.test(division)) return "rx";
  return undefined;
};

type WodLineOptions = { readonly label: string; readonly text: string; readonly theirs: boolean };

const wodLineHtml = ({ label, text, theirs }: WodLineOptions): string =>
  `<div class="event-wod${theirs ? " wod-theirs" : ""}"${theirs ? ' aria-current="true"' : ""}><span class="wod-label">${label}</span> ${esc(text)}</div>`;

const workoutHtml = (event: Event, lane: Lane | undefined): string => {
  const version = versionForDivision(lane?.division);
  return `
  <section class="workout-card" data-testid="workout">
    <div class="event-format">${esc(event.format)}</div>
    ${wodLineHtml({ label: "RX", text: event.rx, theirs: version === "rx" })}
    ${wodLineHtml({ label: "Scaled", text: event.scaled, theirs: version === "scaled" })}
  </section>`;
};

const noticeHtml = (notice: Notice | undefined): string => {
  if (!notice) return "";
  const text = notice.kind === "retrying" ? "Saved on this phone — will retry" : notice.text;
  const role = notice.kind === "error" ? "alert" : "status";
  return `<div class="notice ${notice.kind}" role="${role}" data-testid="notice">${esc(text)}</div>`;
};

const numberOr = (value: string, fallback: number): number => (value.trim() === "" ? fallback : Number(value));

export const readDraft = (root: HTMLElement, fallback: ScoreDraft): ScoreDraft => {
  const value = (id: string, current: string): string => root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? current;
  const pressed = root.querySelector<HTMLButtonElement>('.mode[aria-pressed="true"]')?.dataset.mode;
  return {
    mode: pressed === "time" || pressed === "rounds-reps" ? pressed : fallback.mode,
    minutes: value("minutes", fallback.minutes),
    seconds: value("seconds", fallback.seconds),
    rounds: value("rounds", fallback.rounds),
    reps: value("reps", fallback.reps),
  };
};

const scoreFromDraft = (draft: ScoreDraft): Score =>
  draft.mode === "time"
    ? { kind: "time", seconds: numberOr(draft.minutes, 0) * SECONDS_PER_MINUTE + numberOr(draft.seconds, 0) }
    : { kind: "rounds-reps", rounds: numberOr(draft.rounds, 0), reps: numberOr(draft.reps, 0) };

const wireNameGate = (root: HTMLElement, onNameSubmit: (name: string) => void): void => {
  root.querySelector("#name-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = root.querySelector<HTMLInputElement>("#judge-name")?.value.trim() ?? "";
    if (name) onNameSubmit(name);
  });
};

const stepValue = ({ current, delta }: { readonly current: number; readonly delta: number }): number => Math.max(0, current + delta);

const stepTarget = (root: HTMLElement, button: HTMLButtonElement): HTMLInputElement | null => {
  const id = button.dataset.target;
  return id ? root.querySelector<HTMLInputElement>(`#${id}`) : null;
};

const wireSteppers = (root: HTMLElement): void => {
  root.querySelectorAll<HTMLButtonElement>(".step").forEach((button) =>
    button.addEventListener("click", () => {
      const input = stepTarget(root, button);
      if (!input) return;
      input.value = String(stepValue({ current: numberOr(input.value, 0), delta: Number(button.dataset.step ?? "0") }));
    }),
  );
};

const wireModeToggle = (root: HTMLElement, onModeChange: (mode: Score["kind"]) => void): void => {
  root.querySelectorAll<HTMLButtonElement>(".mode").forEach((button) =>
    button.addEventListener("click", () => onModeChange(button.dataset.mode === "time" ? "time" : "rounds-reps")),
  );
};

const wireHeatSelector = (root: HTMLElement, heatNumbers: readonly number[], index: number, onHeatChange: (heat: number) => void): void => {
  root.querySelector("#prev-heat")?.addEventListener("click", () => {
    const target = heatNumbers[index - 1];
    if (target !== undefined) onHeatChange(target);
  });
  root.querySelector("#next-heat")?.addEventListener("click", () => {
    const target = heatNumbers[index + 1];
    if (target !== undefined) onHeatChange(target);
  });
};

const wireMain = (options: RenderJudgeOptions, draft: ScoreDraft, heatNumbers: readonly number[], index: number): void => {
  const { root, onHeatChange, onModeChange, onSubmit, onNameClear } = options;
  wireHeatSelector(root, heatNumbers, index, onHeatChange);
  root.querySelector("#change-name")?.addEventListener("click", () => onNameClear());
  wireModeToggle(root, onModeChange);
  wireSteppers(root);
  root.querySelector("#score-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    onSubmit(scoreFromDraft(readDraft(root, draft)));
  });
};

type SavedFocus = { readonly id: string; readonly start: number | null; readonly end: number | null };

const readSelection = (input: HTMLInputElement): Pick<SavedFocus, "start" | "end"> => {
  try {
    return { start: input.selectionStart, end: input.selectionEnd };
  } catch {
    return { start: null, end: null };
  }
};

const captureFocus = (root: HTMLElement): SavedFocus | undefined => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active) || active.id === "") return undefined;
  const selection = active instanceof HTMLInputElement ? readSelection(active) : { start: null, end: null };
  return { id: active.id, ...selection };
};

const restoreSelection = (input: HTMLInputElement, saved: SavedFocus): void => {
  if (saved.start === null || saved.end === null) return;
  try {
    input.setSelectionRange(saved.start, saved.end);
  } catch {
    return;
  }
};

const restoreFocus = (root: HTMLElement, saved: SavedFocus | undefined): void => {
  if (!saved) return;
  const target = root.querySelector<HTMLElement>(`#${CSS.escape(saved.id)}`);
  if (!target) return;
  target.focus();
  if (target instanceof HTMLInputElement) restoreSelection(target, saved);
};

export const renderJudge = (options: RenderJudgeOptions): void => {
  const { root, schedule, event, lane, now, judgeName, sentHeats, manual, notice } = options;
  const saved = captureFocus(root);

  if (!judgeName) {
    root.innerHTML = nameGateHtml();
    wireNameGate(root, options.onNameSubmit);
    restoreFocus(root, saved);
    return;
  }

  const draft = options.draft ?? emptyDraft(event);
  const selected = resolveJudgeHeat({ schedule, event, lane, now, manual });
  const sent = sentHeats.includes(selected.heat.number);
  const heatNumbers = event.heats.map((h) => h.number);

  root.innerHTML = `
    ${headerHtml({ event, lane, laneLabel: schedule.laneLabel, judgeName, pending: options.pending, endpointConfigured: options.endpointConfigured })}
    <main class="main judge-main">
      ${heatSelectorHtml(options, selected.index, sent)}
      ${teamCardHtml({ lane: selected.lane, laneNumber: lane, laneLabel: schedule.laneLabel })}
      ${noticeHtml(notice)}
      ${selected.lane ? scoreFormHtml(event, draft, sent) : ""}
      ${workoutHtml(event, selected.lane)}
    </main>
    <footer class="footer"><button type="button" class="link" id="change-name">Not you? Change name</button></footer>`;

  wireMain(options, draft, heatNumbers, selected.index);
  restoreFocus(root, saved);
};
