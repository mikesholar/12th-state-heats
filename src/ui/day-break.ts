import { formatCompDays } from "../core/format";
import type { Heat } from "../core/types";

const spansDays = (heats: readonly Heat[]): boolean => new Set(heats.map((heat) => heat.date)).size > 1;

const dayBreakHtml = (date: string): string =>
  `<div class="day-break" data-testid="day-break"><span>${formatCompDays({ days: [date], withYear: false })}</span></div>`;

type WithDayBreaksOptions = {
  readonly heats: readonly Heat[];
  readonly heatHtml: (heat: Heat) => string;
};

export const withDayBreaks = ({ heats, heatHtml }: WithDayBreaksOptions): string => {
  const breaks = spansDays(heats);
  return heats
    .map((heat, i) => `${breaks && heat.date !== heats[i - 1]?.date ? dayBreakHtml(heat.date) : ""}${heatHtml(heat)}`)
    .join("");
};
