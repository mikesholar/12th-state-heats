import { formatClock, formatCountdown, formatRange } from "../core/format";
import { heatPhase, resolveHeats, type HeatRef, type HeatStatus } from "../core/resolve-heats";
import type { Event, Heat, Lane, Schedule } from "../core/types";
import { esc } from "./html";

export type RenderOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly now: Date;
  readonly sourceNotice: string | undefined;
};

const MINUTE_MS = 60_000;

const heatId = (ref: { readonly event: Event; readonly heat: Heat }): string =>
  `E${ref.event.number}H${ref.heat.number}`;

const minutesUntil = (instant: Date, now: Date): number =>
  Math.floor((instant.getTime() - now.getTime()) / MINUTE_MS);

const compDateLabel = (schedule: Schedule): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${schedule.compDate}T12:00:00Z`));

const clockLabel = (schedule: Schedule, now: Date): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: schedule.timeZone, hour: "numeric", minute: "2-digit" }).format(now);

type HeaderOptions = {
  readonly schedule: Schedule;
  readonly now: Date;
  readonly sourceNotice: string | undefined;
};

const headerHtml = ({ schedule, now, sourceNotice }: HeaderOptions): string => `
  <header class="header">
    <div class="header-row">
      <h1 class="title"><img class="logo" src="${import.meta.env.BASE_URL}logo.png" alt="12th State CrossFit" /><span class="title-text">${esc(schedule.compName)}</span></h1>
      <div class="clock" aria-label="Current time">${clockLabel(schedule, now)}</div>
    </div>
    ${sourceNotice ? `<div class="source-notice" role="status" data-testid="source-notice">${esc(sourceNotice)}</div>` : ""}
  </header>`;

const refLabel = (ref: HeatRef): string => `Event ${ref.event.number} · Heat ${ref.heat.number}`;

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

const laneRowHtml = (lane: Lane): string => `
  <tr data-team="${esc(lane.team)}">
    <td class="lane-num">${lane.lane}</td>
    <td class="lane-team"><div class="team-name">${esc(lane.team)}</div><div class="athletes">${esc(lane.athletes)}</div></td>
    <td class="lane-div">${esc(lane.division)}</td>
  </tr>`;

const openRowHtml = (laneNumber: number): string => `
  <tr class="open">
    <td class="lane-num">${laneNumber}</td>
    <td class="lane-team"><div class="team-name">— open —</div></td>
    <td class="lane-div"></td>
  </tr>`;

const laneRowsHtml = (event: Event, heat: Heat): string =>
  Array.from({ length: event.lanes }, (_, i) => i + 1)
    .map((laneNumber) => {
      const lane = heat.lanes.find((l) => l.lane === laneNumber);
      return lane ? laneRowHtml(lane) : openRowHtml(laneNumber);
    })
    .join("");

type HeatCardOptions = {
  readonly schedule: Schedule;
  readonly event: Event;
  readonly heat: Heat;
  readonly now: Date;
  readonly status: HeatStatus;
};

const heatTag = (id: string, status: HeatStatus): string => {
  const current = status.phase === "during" ? status.current : undefined;
  const next = status.phase === "during" || status.phase === "before" || status.phase === "between-events" ? status.next : undefined;
  if (current && heatId(current) === id) return `<span class="tag now">NOW</span>`;
  if (next && heatId(next) === id) return `<span class="tag next">NEXT</span>`;
  return "";
};

const heatCardHtml = ({ schedule, event, heat, now, status }: HeatCardOptions): string => {
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
      <thead><tr><th>${esc(schedule.laneLabel)}</th><th>Team</th><th>Div</th></tr></thead>
      <tbody>${laneRowsHtml(event, heat)}</tbody>
    </table>
  </article>`;
};

const eventHtml = (schedule: Schedule, event: Event, now: Date, status: HeatStatus): string => `
  <section class="event" id="event-${event.number}">
    <header class="event-header">
      <div class="event-kicker">Event ${event.number}</div>
      <h2>${esc(event.title)}</h2>
      <div class="event-format">${esc(event.format)}</div>
      <div class="event-wod"><span class="wod-label">RX</span> ${esc(event.rx)}</div>
      <div class="event-wod"><span class="wod-label">Scaled</span> ${esc(event.scaled)}</div>
    </header>
    ${event.heats.map((heat) => heatCardHtml({ schedule, event, heat, now, status })).join("")}
  </section>`;

export const render = ({ root, schedule, now, sourceNotice }: RenderOptions): void => {
  document.title = `${schedule.compName} — Heats`;
  const status = resolveHeats(schedule, now);

  root.innerHTML = `
    ${headerHtml({ schedule, now, sourceNotice })}
    <main class="main">
      ${bannerHtml(schedule, status, now)}
      ${schedule.events.map((event) => eventHtml(schedule, event, now, status)).join("")}
    </main>
    <footer class="footer">Times are Eastern · ${compDateLabel(schedule)}</footer>`;
};
