import { MINUTE_MS } from "./comp-time";
import { allHeatRefs, isRunning, type HeatRef } from "./resolve-heats";
import type { Schedule } from "./types";

export type TeamStatus =
  | { readonly kind: "on-floor"; readonly ref: HeatRef; readonly lane: number }
  | { readonly kind: "upcoming"; readonly ref: HeatRef; readonly lane: number; readonly minutesUntilStart: number }
  | { readonly kind: "done" };

type ResolveTeamOptions = {
  readonly schedule: Schedule;
  readonly team: string;
  readonly now: Date;
};

type TeamHeat = { readonly ref: HeatRef; readonly lane: number };

const teamHeats = (schedule: Schedule, team: string): readonly TeamHeat[] =>
  allHeatRefs(schedule).flatMap((ref) => {
    const lane = ref.heat.lanes.find((l) => l.team === team);
    return lane ? [{ ref, lane: lane.lane }] : [];
  });

export const resolveTeam = ({ schedule, team, now }: ResolveTeamOptions): TeamStatus => {
  const heats = teamHeats(schedule, team);

  const running = heats.find(({ ref }) => isRunning(ref, now));
  if (running) return { kind: "on-floor", ...running };

  const upcoming = heats.find(({ ref }) => ref.start > now);
  if (!upcoming) return { kind: "done" };

  const minutesUntilStart = Math.floor((upcoming.ref.start.getTime() - now.getTime()) / MINUTE_MS);
  return { kind: "upcoming", ...upcoming, minutesUntilStart };
};
