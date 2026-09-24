import { toString as qrToString } from "qrcode";
import type { JudgeCodeTable } from "../core/judge-codes";
import type { Event, Schedule } from "../core/types";
import { esc } from "./html";
import { workoutHtml } from "./render-workout";

type RenderHeadOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly table: JudgeCodeTable;
  readonly siteUrl: string;
};

type LaneCardsOptions = {
  readonly table: JudgeCodeTable;
  readonly event: Event;
  readonly siteUrl: string;
};

type LaneCard = { readonly code: string; readonly lane: number; readonly url: string; readonly svg: string };

type EventGroup = { readonly event: Event; readonly cards: readonly LaneCard[] };

const laneCards = async ({ table, event, siteUrl }: LaneCardsOptions): Promise<readonly LaneCard[]> => {
  const entries = Object.entries(table)
    .flatMap(([code, a]) => (a.kind === "lane" && a.event === event.number && a.lane <= event.lanes ? [{ code, lane: a.lane }] : []))
    .sort((a, b) => a.lane - b.lane);
  return Promise.all(
    entries.map(async ({ code, lane }) => {
      const url = `${siteUrl}?j=${code}`;
      return { code, lane, url, svg: await qrToString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
    }),
  );
};

const cardHtml = (laneLabel: string, { code, lane, url, svg }: LaneCard): string => `
  <article class="judge-card" data-testid="judge-card">
    <h3>${esc(laneLabel)} ${lane}</h3>
    <div class="qr">${svg}</div>
    <div class="judge-code">${esc(code)}</div>
    <div class="judge-url">${esc(url)}</div>
  </article>`;

const groupHtml = (event: Event): string => `
  <section class="event-group" data-testid="event-group">
    <h2>Event ${event.number} · ${esc(event.title)}</h2>
    ${workoutHtml({ event })}
    <div class="judge-cards" data-event="${event.number}"></div>
  </section>`;

const generatedGroups = ({ schedule, table, siteUrl }: RenderHeadOptions): Promise<readonly EventGroup[]> =>
  Promise.all(schedule.events.map(async (event) => ({ event, cards: await laneCards({ table, event, siteUrl }) })));

type FillCardsOptions = { readonly root: HTMLElement; readonly laneLabel: string; readonly group: EventGroup };

const fillCards = ({ root, laneLabel, group }: FillCardsOptions): void => {
  const container = root.querySelector(`.judge-cards[data-event="${group.event.number}"]`);
  if (container) container.innerHTML = group.cards.map((card) => cardHtml(laneLabel, card)).join("");
};

type GenerateOptions = { readonly page: RenderHeadOptions; readonly button: HTMLButtonElement };

const generate = async ({ page, button }: GenerateOptions): Promise<void> => {
  button.disabled = true;
  button.textContent = "Generating…";
  const groups = await generatedGroups(page).catch(() => undefined);
  if (!groups) {
    button.outerHTML = `<p class="loading">Couldn't make the QR codes — reload and try again.</p>`;
    return;
  }
  groups.forEach((group) => fillCards({ root: page.root, laneLabel: page.schedule.laneLabel, group }));
  button.remove();
};

export const renderHead = (options: RenderHeadOptions): void => {
  options.root.innerHTML = `
    <header class="header"><div class="header-row"><h1 class="title">Judge assignments</h1></div></header>
    <main class="main head-main">
      <button type="button" class="primary" id="generate-qr">Generate QR codes</button>
      ${options.schedule.events.map(groupHtml).join("")}
    </main>`;
  const button = options.root.querySelector<HTMLButtonElement>("#generate-qr");
  button?.addEventListener("click", () => void generate({ page: options, button }));
};
