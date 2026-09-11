import { formatClock, formatCountdown, formatRange } from "../core/format";
import { heatPhase, resolveHeats, type HeatRef, type HeatStatus } from "../core/resolve-heats";
import { resolveTeam, type TeamStatus } from "../core/resolve-team";
import type { Event, Heat, Lane, Schedule } from "../core/types";

export type RenderOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly now: Date;
  readonly selectedTeam: string | undefined;
  readonly onTeamChange: (team: string | undefined) => void;
};

const MINUTE_MS = 60_000;

const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const heatId = (ref: { readonly event: Event; readonly heat: Heat }): string =>
  `E${ref.event.number}H${ref.heat.number}`;

const minutesUntil = (instant: Date, now: Date): number =>
  Math.floor((instant.getTime() - now.getTime()) / MINUTE_MS);

const allTeams = (schedule: Schedule): readonly string[] =>
  [...new Set(schedule.events.flatMap((e) => e.heats.flatMap((h) => h.lanes.map((l) => l.team))))].sort((a, b) =>
    a.localeCompare(b),
  );

const compDateLabel = (schedule: Schedule): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${schedule.compDate}T12:00:00Z`));

const clockLabel = (schedule: Schedule, now: Date): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: schedule.timeZone, hour: "numeric", minute: "2-digit" }).format(now);

const stripHtml = (team: string, status: TeamStatus): string => {
  const summary =
    status.kind === "done"
      ? "Done — nice work"
      : status.kind === "on-floor"
        ? `On the floor · Lane ${status.lane}`
        : `E${status.ref.event.number} · H${status.ref.heat.number} · Lane ${status.lane} · ${formatCountdown(status.minutesUntilStart)}`;
  return `<div class="my-strip ${status.kind}" data-testid="my-strip"><span class="strip-team">${esc(team)}</span><span class="strip-summary">${summary}</span></div>`;
};

type HeaderOptions = {
  readonly schedule: Schedule;
  readonly now: Date;
  readonly selectedTeam: string | undefined;
  readonly teamStatus: TeamStatus | undefined;
};

const headerHtml = ({ schedule, now, selectedTeam, teamStatus }: HeaderOptions): string => `
  <header class="header">
    <div class="header-row">
      <h1 class="title"><img class="logo" src="${import.meta.env.BASE_URL}logo.png" alt="12th State CrossFit" /><span class="title-text">12 Years of 12th State</span></h1>
      <div class="clock" aria-label="Current time">${clockLabel(schedule, now)}</div>
    </div>
    <label class="picker${selectedTeam ? " compact" : ""}">
      <span>I'm on…</span>
      <select id="team-picker">
        <option value="">— pick your team —</option>
        ${allTeams(schedule)
          .map((team) => `<option value="${esc(team)}"${team === selectedTeam ? " selected" : ""}>${esc(team)}</option>`)
          .join("")}
      </select>
    </label>
    ${selectedTeam && teamStatus ? stripHtml(selectedTeam, teamStatus) : ""}
  </header>`;

const refLabel = (ref: HeatRef): string => `Event ${ref.event.number} · Heat ${ref.heat.number}`;

const myHeatHtml = (team: string, status: TeamStatus): string => {
  if (status.kind === "done") {
    return `<section class="my-heat done" data-testid="my-heat">
      <div class="my-team">${esc(team)}</div>
      <div class="my-headline">You're done — nice work 🎉</div>
    </section>`;
  }
  if (status.kind === "on-floor") {
    return `<section class="my-heat on-floor" data-testid="my-heat">
      <div class="my-team">${esc(team)}</div>
      <div class="my-headline">ON THE FLOOR</div>
      <div class="my-lane">Lane <strong>${status.lane}</strong></div>
      <div class="my-detail">${refLabel(status.ref)} · ends ${formatClock(status.ref.heat.end)}</div>
    </section>`;
  }
  return `<section class="my-heat upcoming" data-testid="my-heat">
    <div class="my-team">${esc(team)}</div>
    <div class="my-headline">${refLabel(status.ref)}</div>
    <div class="my-lane">Lane <strong>${status.lane}</strong></div>
    <div class="my-detail">${formatClock(status.ref.heat.start)} · ${formatCountdown(status.minutesUntilStart)}</div>
  </section>`;
};

const bannerHtml = (schedule: Schedule, status: HeatStatus, now: Date): string => {
  const wrap = (inner: string) => `<section class="banner" data-testid="banner">${inner}</section>`;
  switch (status.phase) {
    case "not-comp-day":
      return wrap(`<div class="banner-line"><span class="tag">COMP DAY</span> ${compDateLabel(schedule)}</div>`);
    case "before":
      return wrap(
        `<div class="banner-line"><span class="tag next">FIRST HEAT</span> First heat ${formatClock(status.next.heat.start)} AM · ${formatCountdown(minutesUntil(status.next.start, now))}</div>`,
      );
    case "between-events":
      return wrap(
        `<div class="banner-line"><span class="tag next">BREAK</span> Event ${status.next.event.number} starts ${formatClock(status.next.heat.start)} · ${formatCountdown(minutesUntil(status.next.start, now))}</div>`,
      );
    case "finished":
      return wrap(`<div class="banner-line"><span class="tag">DONE</span> Comp complete 🎉</div>`);
    case "during": {
      const nowLine = status.current
        ? `<div class="banner-line"><span class="tag now">NOW</span> ${refLabel(status.current)} · ends ${formatClock(status.current.heat.end)}</div>`
        : `<div class="banner-line muted"><span class="tag">TRANSITION</span> Lanes resetting</div>`;
      const nextLine = status.next
        ? `<div class="banner-line"><span class="tag next">NEXT</span> ${refLabel(status.next)} · ${formatClock(status.next.heat.start)} · ${formatCountdown(minutesUntil(status.next.start, now))}</div>`
        : `<div class="banner-line muted">Last heat of the day</div>`;
      return wrap(nowLine + nextLine);
    }
  }
};

const laneRowHtml = (lane: Lane, selectedTeam: string | undefined): string => `
  <tr data-team="${esc(lane.team)}" class="${lane.team === selectedTeam ? "mine" : ""}">
    <td class="lane-num">${lane.lane}</td>
    <td class="lane-team"><div class="team-name">${esc(lane.team)}</div><div class="athletes">${esc(lane.athletes)}</div></td>
    <td class="lane-div">${esc(lane.division)}</td>
  </tr>`;

type HeatCardOptions = {
  readonly schedule: Schedule;
  readonly event: Event;
  readonly heat: Heat;
  readonly now: Date;
  readonly status: HeatStatus;
  readonly selectedTeam: string | undefined;
};

const heatTag = (id: string, status: HeatStatus): string => {
  const current = status.phase === "during" ? status.current : undefined;
  const next = status.phase === "during" || status.phase === "before" || status.phase === "between-events" ? status.next : undefined;
  if (current && heatId(current) === id) return `<span class="tag now">NOW</span>`;
  if (next && heatId(next) === id) return `<span class="tag next">NEXT</span>`;
  return "";
};

const heatCardHtml = ({ schedule, event, heat, now, status, selectedTeam }: HeatCardOptions): string => {
  const id = heatId({ event, heat });
  const phase = status.phase === "not-comp-day" ? "upcoming" : heatPhase(schedule, heat, now);
  return `
  <article class="heat ${phase}" data-heat="${id}">
    <header class="heat-header">
      <h3>Heat ${heat.number}</h3>
      <span class="heat-time">${formatRange(heat.start, heat.end)}</span>
      ${heatTag(id, status)}
    </header>
    <table class="lanes">
      <thead><tr><th>Lane</th><th>Team</th><th>Div</th></tr></thead>
      <tbody>${heat.lanes.map((lane) => laneRowHtml(lane, selectedTeam)).join("")}</tbody>
    </table>
  </article>`;
};

const eventHtml = (schedule: Schedule, event: Event, now: Date, status: HeatStatus, selectedTeam: string | undefined): string => `
  <section class="event" id="event-${event.number}">
    <header class="event-header">
      <div class="event-kicker">Event ${event.number}</div>
      <h2>${esc(event.title)}</h2>
      <div class="event-format">${esc(event.format)}</div>
      <div class="event-wod"><span class="wod-label">RX</span> ${esc(event.rx)}</div>
      <div class="event-wod"><span class="wod-label">Scaled</span> ${esc(event.scaled)}</div>
    </header>
    ${event.heats.map((heat) => heatCardHtml({ schedule, event, heat, now, status, selectedTeam })).join("")}
  </section>`;

export const render = ({ root, schedule, now, selectedTeam, onTeamChange }: RenderOptions): void => {
  const status = resolveHeats(schedule, now);
  const teamStatus = selectedTeam ? resolveTeam({ schedule, team: selectedTeam, now }) : undefined;
  const myHeat = selectedTeam && teamStatus ? myHeatHtml(selectedTeam, teamStatus) : "";

  root.innerHTML = `
    ${headerHtml({ schedule, now, selectedTeam, teamStatus })}
    <main class="main">
      ${myHeat}
      ${bannerHtml(schedule, status, now)}
      ${schedule.events.map((event) => eventHtml(schedule, event, now, status, selectedTeam)).join("")}
    </main>
    <footer class="footer">Times are Eastern · ${compDateLabel(schedule)}</footer>`;

  const picker = root.querySelector<HTMLSelectElement>("#team-picker");
  picker?.addEventListener("change", () => onTeamChange(picker.value === "" ? undefined : picker.value));
};
