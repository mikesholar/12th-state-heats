import { heatInstants } from "./comp-time";
import type { Event, Heat, Lane, Schedule } from "./types";

export type ManualPick = { readonly heat: number; readonly at: Date };

export type JudgeHeat = {
  readonly heat: Heat;
  readonly index: number;
  readonly lane: Lane | undefined;
};

type ResolveJudgeHeatOptions = {
  readonly schedule: Schedule;
  readonly event: Event;
  readonly lane: number;
  readonly now: Date;
  readonly manual: ManualPick | undefined;
};

const MANUAL_PICK_TTL_MS = 10 * 60_000;

const manualStillFresh = (manual: ManualPick | undefined, now: Date): manual is ManualPick =>
  manual !== undefined && now.getTime() - manual.at.getTime() < MANUAL_PICK_TTL_MS;

const autoHeat = (schedule: Schedule, event: Event, now: Date): Heat | undefined => {
  const timed = event.heats.map((heat) => ({ heat, ...heatInstants(schedule, heat) }));
  const running = timed.find(({ start, end }) => start <= now && now < end);
  const next = timed.find(({ start }) => start > now);
  return (running ?? next)?.heat ?? event.heats.at(-1);
};

export const resolveJudgeHeat = ({ schedule, event, lane, now, manual }: ResolveJudgeHeatOptions): JudgeHeat => {
  const manualHeat = manualStillFresh(manual, now) ? event.heats.find((h) => h.number === manual.heat) : undefined;
  const heat = manualHeat ?? autoHeat(schedule, event, now);
  if (!heat) throw new Error(`Event ${event.number} has no heats`);
  return {
    heat,
    index: event.heats.indexOf(heat),
    lane: heat.lanes.find((l) => l.lane === lane),
  };
};
