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

const headerHtml = ({ event, lane, judgeName, pending, endpointConfigured }: RenderJudgeOptions): string => `
  <header class="header judge-header" data-testid="judge-header">
    <div class="header-row">
      <div>
        <div class="event-kicker">Event ${event.number} · ${esc(event.title)}</div>
        <h1 class="title judge-lane">Lane ${lane}</h1>
      </div>
      <div class="judge-meta">
        <div class="judge-name">${esc(judgeName ?? "")}</div>
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
    <div class="heat-label" data-testid="heat-label">Heat ${options.event.heats[index]?.number ?? ""} of ${total}${sent ? " ✓" : ""}</div>
    <button type="button" id="next-heat" aria-label="Next heat" ${index === total - 1 ? "disabled" : ""}>▶</button>
  </div>`;
};

const teamCardHtml = (lane: Lane | undefined, laneNumber: number): string =>
  lane
    ? `<section class="team-card" data-testid="team-card">
        <div class="team-card-name">${esc(lane.team)}</div>
        <div class="team-card-athletes">${esc(lane.athletes)}</div>
        <div class="team-card-division">${esc(lane.division)}</div>
      </section>`
    : `<section class="team-card empty" data-testid="team-card">No team in lane ${laneNumber} for this heat</section>`;

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

const noticeHtml = (notice: Notice | undefined): string => {
  if (!notice) return "";
  const text = notice.kind === "retrying" ? "Saved on this phone — will retry" : notice.text;
  return `<div class="notice ${notice.kind}" data-testid="notice">${esc(text)}</div>`;
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

const wireMain = (options: RenderJudgeOptions, draft: ScoreDraft, heatNumbers: readonly number[], index: number): void => {
  const { root, onHeatChange, onModeChange, onSubmit, onNameClear } = options;
  root.querySelector("#prev-heat")?.addEventListener("click", () => onHeatChange(heatNumbers[index - 1] ?? heatNumbers[0] ?? 1));
  root.querySelector("#next-heat")?.addEventListener("click", () => onHeatChange(heatNumbers[index + 1] ?? heatNumbers.at(-1) ?? 1));
  root.querySelector("#change-name")?.addEventListener("click", (e) => {
    e.preventDefault();
    onNameClear();
  });
  root.querySelectorAll<HTMLButtonElement>(".mode").forEach((button) =>
    button.addEventListener("click", () => onModeChange(button.dataset.mode === "time" ? "time" : "rounds-reps")),
  );
  root.querySelectorAll<HTMLButtonElement>(".step").forEach((button) =>
    button.addEventListener("click", () => {
      const input = root.querySelector<HTMLInputElement>(`#${button.dataset.target ?? ""}`);
      if (!input) return;
      input.value = String(Math.max(0, numberOr(input.value, 0) + Number(button.dataset.step ?? "0")));
    }),
  );
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
    ${headerHtml(options)}
    <main class="main judge-main">
      ${heatSelectorHtml(options, selected.index, sent)}
      ${teamCardHtml(selected.lane, lane)}
      ${noticeHtml(notice)}
      ${selected.lane ? scoreFormHtml(event, draft, sent) : ""}
    </main>
    <footer class="footer"><a href="#" id="change-name">Not you? Change name</a></footer>`;

  wireMain(options, draft, heatNumbers, selected.index);
  restoreFocus(root, saved);
};
