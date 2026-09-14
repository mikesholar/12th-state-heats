import { toString as qrToString } from "qrcode";
import type { JudgeCodeTable } from "../core/judge-codes";
import type { Schedule } from "../core/types";
import { esc } from "./html";

type RenderHeadOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly table: JudgeCodeTable;
  readonly siteUrl: string;
};

type LaneCard = { readonly code: string; readonly lane: number; readonly url: string; readonly svg: string };

const laneCards = async (table: JudgeCodeTable, eventNumber: number, siteUrl: string): Promise<readonly LaneCard[]> => {
  const entries = Object.entries(table)
    .flatMap(([code, a]) => (a.kind === "lane" && a.event === eventNumber ? [{ code, lane: a.lane }] : []))
    .sort((a, b) => a.lane - b.lane);
  return Promise.all(
    entries.map(async ({ code, lane }) => {
      const url = `${siteUrl}?j=${code}`;
      return { code, lane, url, svg: await qrToString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
    }),
  );
};

const cardHtml = ({ code, lane, url, svg }: LaneCard): string => `
  <article class="judge-card" data-testid="judge-card">
    <h3>Lane ${lane}</h3>
    <div class="qr">${svg}</div>
    <div class="judge-code">${esc(code)}</div>
    <div class="judge-url">${esc(url)}</div>
  </article>`;

export const renderHead = async ({ root, schedule, table, siteUrl }: RenderHeadOptions): Promise<void> => {
  const groups = await Promise.all(
    schedule.events.map(async (event) => ({ event, cards: await laneCards(table, event.number, siteUrl) })),
  );
  root.innerHTML = `
    <header class="header"><div class="header-row"><h1 class="title">Judge assignments</h1></div></header>
    <main class="main head-main">
      ${groups
        .map(
          ({ event, cards }) => `
        <section class="event-group" data-testid="event-group">
          <h2>Event ${event.number} · ${esc(event.title)}</h2>
          <div class="judge-cards">${cards.map(cardHtml).join("")}</div>
        </section>`,
        )
        .join("")}
    </main>`;
};
