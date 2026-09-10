import { compDayOf, heatInstants } from "./comp-time";
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
  | { readonly phase: "finished" };

export type HeatPhase = "past" | "current" | "upcoming";

export const allHeatRefs = (schedule: Schedule): readonly HeatRef[] =>
  schedule.events
    .flatMap((event) => event.heats.map((heat) => ({ event, heat, ...heatInstants(schedule, heat) })))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

const isRunning = (ref: HeatRef, now: Date): boolean => ref.start <= now && now < ref.end;

export const resolveHeats = (schedule: Schedule, now: Date): HeatStatus => {
  if (compDayOf(now, schedule.timeZone) !== schedule.compDate) return { phase: "not-comp-day" };

  const refs = allHeatRefs(schedule);
  const first = refs[0];
  if (!first) return { phase: "finished" };
  if (now < first.start) return { phase: "before", next: first };

  const current = refs.find((ref) => isRunning(ref, now));
  const next = refs.find((ref) => ref.start > now);
  if (!current && !next) return { phase: "finished" };

  const lastEnded = [...refs].reverse().find((ref) => ref.end <= now);
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
