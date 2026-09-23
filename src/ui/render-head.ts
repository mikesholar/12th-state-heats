import { toString as qrToString } from "qrcode";
import type { JudgeCodeTable } from "../core/judge-codes";
import type { Event, Schedule } from "../core/types";
import { esc } from "./html";

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

const groupHtml = (laneLabel: string, { event, cards }: EventGroup): string => `
  <section class="event-group" data-testid="event-group">
    <h2>Event ${event.number} · ${esc(event.title)}</h2>
    <div class="judge-cards">${cards.map((card) => cardHtml(laneLabel, card)).join("")}</div>
  </section>`;

const generatedHtml = async ({ schedule, table, siteUrl }: RenderHeadOptions): Promise<string> => {
  const groups = await Promise.all(
    schedule.events.map(async (event) => ({ event, cards: await laneCards({ table, event, siteUrl }) })),
  );
  return groups.map((group) => groupHtml(schedule.laneLabel, group)).join("");
};

type GenerateOptions = { readonly page: RenderHeadOptions; readonly button: HTMLButtonElement };

const generate = async ({ page, button }: GenerateOptions): Promise<void> => {
  const main = page.root.querySelector(".head-main");
  if (!main) return;
  button.disabled = true;
  button.textContent = "Generating…";
  main.innerHTML = await generatedHtml(page).catch(
    () => `<p class="loading">Couldn't make the QR codes — reload and try again.</p>`,
  );
};

export const renderHead = (options: RenderHeadOptions): void => {
  options.root.innerHTML = `
    <header class="header"><div class="header-row"><h1 class="title">Judge assignments</h1></div></header>
    <main class="main head-main">
      <button type="button" class="primary" id="generate-qr">Generate QR codes</button>
    </main>`;
  const button = options.root.querySelector<HTMLButtonElement>("#generate-qr");
  button?.addEventListener("click", () => void generate({ page: options, button }));
};
