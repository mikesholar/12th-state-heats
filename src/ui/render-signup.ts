import { formatRange } from "../core/format";
import { isMine, mySlotIn, teamSizeOf, type ClaimDraft, type SlotKey } from "../core/signup";
import type { Division, Event, Heat, Lane, Schedule } from "../core/types";
import { esc } from "./html";

export type SignupNotice = {
  readonly kind: "error" | "info";
  readonly text: string;
  readonly at?: SlotKey;
};

export type RenderSignupOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly email: string | undefined;
  readonly sourceNotice: string | undefined;
  readonly live: boolean;
  readonly openForm: SlotKey | undefined;
  readonly draft: ClaimDraft;
  readonly notice: SignupNotice | undefined;
  readonly busy: boolean;
  readonly onEmailSubmit: (email: string) => void;
  readonly onEmailClear: () => void;
  readonly onOpenForm: (slot: SlotKey) => void;
  readonly onCloseForm: () => void;
  readonly onClaim: (draft: ClaimDraft) => void;
  readonly onRelease: (slot: SlotKey) => void;
  readonly onDraftChange: (draft: ClaimDraft) => void;
};

type SignupViewState = Pick<RenderSignupOptions, "schedule" | "openForm" | "draft" | "notice" | "busy"> & {
  readonly email: string | undefined;
  readonly canWrite: boolean;
};

const slotAttr = ({ event, heat, lane }: SlotKey): string => `${event}:${heat}:${lane}`;

const parseSlot = (value: string | undefined): SlotKey | undefined => {
  const [event, heat, lane] = (value ?? "").split(":").map(Number);
  if (event === undefined || heat === undefined || lane === undefined || [event, heat, lane].some(Number.isNaN)) return undefined;
  return { event, heat, lane };
};

const sameHeat = (a: SlotKey | undefined, event: Event, heat: Heat): boolean =>
  a !== undefined && a.event === event.number && a.heat === heat.number;

const compDateLabel = (schedule: Schedule): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: schedule.timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(
    new Date(`${schedule.compDate}T12:00:00Z`),
  );

const emailFormHtml = (): string => `
  <form id="email-form" data-testid="email-form" class="name-form">
    <label for="signup-email">Your email</label>
    <input id="signup-email" name="email" type="email" autocomplete="email" inputmode="email" required />
    <button type="submit" class="primary">Continue</button>
  </form>`;

const identityHtml = (email: string): string => `
  <div class="signup-identity">Signing up as <strong>${esc(email)}</strong> · <button type="button" class="link" id="change-email">Not you? Change email</button></div>`;

const noticeHtml = (notice: SignupNotice | undefined): string => {
  if (!notice) return "";
  const role = notice.kind === "error" ? "alert" : "status";
  return `<div class="notice ${notice.kind}" role="${role}" data-testid="notice">${esc(notice.text)}</div>`;
};

type HeaderOptions = Pick<RenderSignupOptions, "schedule" | "email" | "sourceNotice" | "notice" | "busy">;

const headerHtml = ({ schedule, email, sourceNotice, notice, busy }: HeaderOptions): string => `
  <header class="header">
    <div class="header-row">
      <h1 class="title"><img class="logo" src="${import.meta.env.BASE_URL}logo.png" alt="12th State CrossFit" /><span class="title-text">${esc(schedule.compName)}</span></h1>
      <span class="pill ${schedule.signupsOpen ? "open" : "closed"}" data-testid="signups-pill">${schedule.signupsOpen ? "Sign-ups open" : "Sign-ups closed"}</span>
    </div>
    <div class="signup-date">Sign-up · ${compDateLabel(schedule)}</div>
    ${sourceNotice ? `<div class="source-notice" role="status" data-testid="source-notice">${esc(sourceNotice)}</div>` : ""}
    ${email ? identityHtml(email) : emailFormHtml()}
    ${notice && !notice.at ? noticeHtml(notice) : ""}
    ${busy ? `<div class="notice info" role="status" aria-busy="true" data-testid="saving">Saving to the sheet…</div>` : ""}
  </header>`;

type ChipOptions = { readonly label: string; readonly slot: SlotKey };

const openChipHtml = ({ label, slot }: ChipOptions, interactive: boolean): string =>
  interactive
    ? `<button type="button" class="chip open" data-lane="${slot.lane}" data-claim="${slotAttr(slot)}">${esc(label)} ${slot.lane} · open</button>`
    : `<div class="chip open dim" data-lane="${slot.lane}" aria-disabled="true">${esc(label)} ${slot.lane} · open</div>`;

const takenChipHtml = ({ label, slot }: ChipOptions, lane: Lane): string =>
  `<div class="chip taken" data-lane="${slot.lane}">${esc(label)} ${slot.lane} · <b>${esc(lane.team)}</b> · ${esc(lane.division)}</div>`;

const mineChipHtml = ({ label, slot }: ChipOptions, lane: Lane, canRelease: boolean): string =>
  `<div class="chip mine" data-lane="${slot.lane}">${esc(label)} ${slot.lane} · <b>${esc(lane.team)}</b> · ${esc(lane.division)}${
    canRelease
      ? ` <button type="button" class="link" data-release="${slotAttr(slot)}" aria-label="Cancel ${esc(label.toLowerCase())} ${slot.lane}, heat ${slot.heat}">Cancel</button>`
      : ""
  }</div>`;

type ChipsOptions = {
  readonly label: string;
  readonly event: Event;
  readonly heat: Heat;
  readonly email: string | undefined;
  readonly alreadyIn: boolean;
  readonly canWrite: boolean;
};

const chipsHtml = ({ label, event, heat, email, alreadyIn, canWrite }: ChipsOptions): string =>
  Array.from({ length: event.lanes }, (_, i) => i + 1)
    .map((laneNumber) => {
      const chip = { label, slot: { event: event.number, heat: heat.number, lane: laneNumber } };
      const lane = heat.lanes.find((l) => l.lane === laneNumber);
      if (!lane) return openChipHtml(chip, canWrite && !alreadyIn);
      if (email !== undefined && isMine({ lane, email })) return mineChipHtml(chip, lane, canWrite);
      return takenChipHtml(chip, lane);
    })
    .join("");

const athleteLabel = (index: number, teamSize: number): string => (teamSize === 1 ? "Your name" : `Athlete ${index + 1}`);

const athleteFieldsHtml = (draft: ClaimDraft, teamSize: number): string =>
  Array.from({ length: teamSize }, (_, i) => {
    const id = `athlete-${i + 1}`;
    return `<label for="${id}">${athleteLabel(i, teamSize)}</label><input id="${id}" name="${id}" type="text" autocomplete="name" value="${esc(draft.athletes[i] ?? "")}" />`;
  }).join("");

const divisionOptionsHtml = (divisions: readonly Division[], selected: string): string =>
  [`<option value="">— pick a division —</option>`]
    .concat(divisions.map((d) => `<option value="${esc(d.name)}"${d.name === selected ? " selected" : ""}>${esc(d.name)}</option>`))
    .join("");

type FormOptions = { readonly schedule: Schedule; readonly slot: SlotKey; readonly draft: ClaimDraft; readonly busy: boolean };

const claimFormHtml = ({ schedule, slot, draft, busy }: FormOptions): string => {
  const teamSize = teamSizeOf({ divisions: schedule.divisions, name: draft.division });
  return `
  <form id="claim-form" data-testid="claim-form" class="claim-form">
    <label for="division">Division</label>
    <select id="division" name="division">${divisionOptionsHtml(schedule.divisions, draft.division)}</select>
    ${teamSize > 1 ? `<label for="team">Team name</label><input id="team" name="team" type="text" value="${esc(draft.team)}" />` : ""}
    ${athleteFieldsHtml(draft, teamSize)}
    <div class="claim-actions">
      <button type="submit" class="primary" ${busy ? 'disabled aria-busy="true"' : ""}>${busy ? "Claiming…" : `Claim ${esc(schedule.laneLabel.toLowerCase())} ${slot.lane}`}</button>
      <button type="button" class="link" id="dismiss-claim" ${busy ? "disabled" : ""}>Never mind</button>
    </div>
  </form>`;
};

type HeatOptions = SignupViewState & { readonly event: Event; readonly heat: Heat; readonly alreadyIn: boolean };

const heatHtml = (options: HeatOptions): string => {
  const { schedule, event, heat, email, alreadyIn, openForm, draft, notice, busy, canWrite } = options;
  const formSlot = openForm !== undefined && sameHeat(openForm, event, heat) ? openForm : undefined;
  return `
  <article class="heat" data-heat="E${event.number}H${heat.number}">
    <header class="heat-header">
      <h3>Heat ${heat.number}</h3>
      <span class="heat-time">${formatRange(heat.start, heat.end)}</span>
    </header>
    <div class="chips">${chipsHtml({ label: schedule.laneLabel, event, heat, email, alreadyIn, canWrite })}</div>
    ${formSlot ? claimFormHtml({ schedule, slot: formSlot, draft, busy }) : ""}
    ${notice && sameHeat(notice.at, event, heat) ? noticeHtml(notice) : ""}
  </article>`;
};

type EventOptions = SignupViewState & { readonly event: Event };

const eventHtml = (options: EventOptions): string => {
  const { event, email, schedule } = options;
  const mine = email === undefined ? undefined : mySlotIn({ event, email });
  return `
  <section class="event" id="event-${event.number}">
    <header class="event-header">
      <div class="event-kicker">Event ${event.number}</div>
      <h2>${esc(event.title)}</h2>
      <div class="event-format">${esc(event.format)}</div>
      ${mine ? `<div class="your-slot" data-testid="your-slot-${event.number}">You're in Heat ${mine.heat}, ${esc(schedule.laneLabel.toLowerCase())} ${mine.lane}</div>` : ""}
    </header>
    ${event.heats.map((heat) => heatHtml({ ...options, heat, alreadyIn: mine !== undefined })).join("")}
  </section>`;
};

const inputValue = (root: HTMLElement, id: string): string | undefined => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value;

type ReadClaimDraftOptions = { readonly root: HTMLElement; readonly fallback: ClaimDraft };

export const readClaimDraft = ({ root, fallback }: ReadClaimDraftOptions): ClaimDraft => {
  if (!root.querySelector("#claim-form")) return fallback;
  const typed = [...root.querySelectorAll<HTMLInputElement>('[id^="athlete-"]')].map((input) => input.value);
  return {
    team: inputValue(root, "team") ?? fallback.team,
    athletes: Array.from({ length: Math.max(typed.length, fallback.athletes.length) }, (_, i) => typed[i] ?? fallback.athletes[i] ?? ""),
    division: inputValue(root, "division") ?? fallback.division,
  };
};

const wire = (options: RenderSignupOptions): void => {
  const { root, draft } = options;
  root.querySelector("#email-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = root.querySelector<HTMLInputElement>("#signup-email")?.value ?? "";
    if (value.trim() !== "") options.onEmailSubmit(value);
  });
  root.querySelector("#change-email")?.addEventListener("click", () => options.onEmailClear());
  root.querySelectorAll<HTMLButtonElement>("[data-claim]").forEach((button) =>
    button.addEventListener("click", () => {
      const slot = parseSlot(button.dataset.claim);
      if (slot) options.onOpenForm(slot);
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-release]").forEach((button) =>
    button.addEventListener("click", () => {
      const slot = parseSlot(button.dataset.release);
      if (slot) options.onRelease(slot);
    }),
  );
  root.querySelector("#dismiss-claim")?.addEventListener("click", () => options.onCloseForm());
  root.querySelector("#claim-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    options.onClaim(readClaimDraft({ root, fallback: draft }));
  });
  root.querySelector("#division")?.addEventListener("change", () => options.onDraftChange(readClaimDraft({ root, fallback: draft })));
};

export const renderSignup = (options: RenderSignupOptions): void => {
  document.title = `${options.schedule.compName} — Sign up`;
  const { root, schedule, email, openForm, draft, notice, busy, live } = options;
  const canWrite = email !== undefined && schedule.signupsOpen && live && !busy;
  const view: SignupViewState = { schedule, openForm, draft, notice, busy, email, canWrite };
  root.innerHTML = `
    ${headerHtml(options)}
    <main class="main signup-main">
      ${schedule.events.map((event) => eventHtml({ ...view, event })).join("")}
    </main>
    <footer class="footer">One lane per event · ${compDateLabel(schedule)}</footer>`;
  wire(options);
};
