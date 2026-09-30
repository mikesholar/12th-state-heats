import { compDayOf, compDays, heatInstants } from "./comp-time";
import type { Event, Heat, Schedule } from "./types";

export type HeatRef = {
  readonly event: Event;
  readonly heat: Heat;
  readonly start: Date;
  readonly end: Date;
};

export type HeatStatus =
  | { readonly phase: "not-comp-day" }
  | { readonly phase: "before"; readonly next: HeatRef }
  | { readonly phase: "during"; readonly current: HeatRef | undefined; readonly next: HeatRef | undefined }
  | { readonly phase: "between-events"; readonly next: HeatRef }
  | { readonly phase: "day-finished"; readonly next: HeatRef }
  | { readonly phase: "finished" };

export type HeatPhase = "past" | "current" | "upcoming";

export const allHeatRefs = (schedule: Schedule): readonly HeatRef[] =>
  schedule.events
    .flatMap((event) => event.heats.map((heat) => ({ event, heat, ...heatInstants(schedule, heat) })))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

export const isRunning = ({ start, end }: { readonly start: Date; readonly end: Date }, now: Date): boolean =>
  start <= now && now < end;

const afterToday = (refs: readonly HeatRef[], now: Date): HeatStatus => {
  const later = refs.find((ref) => ref.start > now);
  return later ? { phase: "day-finished", next: later } : { phase: "finished" };
};

export const resolveHeats = (schedule: Schedule, now: Date): HeatStatus => {
  const today = compDayOf(now, schedule.timeZone);
  if (!compDays(schedule).includes(today)) return { phase: "not-comp-day" };

  const refs = allHeatRefs(schedule);
  const todays = refs.filter((ref) => ref.heat.date === today);
  const first = todays[0];
  if (!first) return { phase: "finished" };
  if (now < first.start) return { phase: "before", next: first };

  const current = todays.find((ref) => isRunning(ref, now));
  const next = todays.find((ref) => ref.start > now);
  if (!current && !next) return afterToday(refs, now);

  const lastEnded = [...todays].reverse().find((ref) => ref.end <= now);
  const inGapBetweenEvents = !current && next && lastEnded && lastEnded.event !== next.event;
  if (inGapBetweenEvents) return { phase: "between-events", next };

  return { phase: "during", current, next };
};

export const heatPhase = (schedule: Schedule, heat: Heat, now: Date): HeatPhase => {
  const { start, end } = heatInstants(schedule, heat);
  if (now < start) return "upcoming";
  if (now < end) return "current";
  return "past";
};
