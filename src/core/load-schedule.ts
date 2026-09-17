import type { Schedule } from "./types";

export type FetchOutcome =
  | { readonly kind: "loaded"; readonly schedule: Schedule }
  | { readonly kind: "unreachable" }
  | { readonly kind: "invalid"; readonly reason: string };

export type ScheduleSource = "live" | "cached" | "snapshot";

export type LoadedSchedule = {
  readonly schedule: Schedule;
  readonly source: ScheduleSource;
  readonly reason?: string;
};

type ChooseScheduleOptions = {
  readonly fetched: FetchOutcome;
  readonly cached: Schedule | undefined;
  readonly snapshot: Schedule;
};

const UNREACHABLE = "unreachable";

export const chooseSchedule = ({ fetched, cached, snapshot }: ChooseScheduleOptions): LoadedSchedule => {
  if (fetched.kind === "loaded") return { schedule: fetched.schedule, source: "live" };
  const reason = fetched.kind === "unreachable" ? UNREACHABLE : fetched.reason;
  return cached ? { schedule: cached, source: "cached", reason } : { schedule: snapshot, source: "snapshot", reason };
};

export const sourceNotice = (loaded: LoadedSchedule): string | undefined => {
  if (loaded.source === "live") return undefined;
  if (loaded.reason === UNREACHABLE || loaded.reason === undefined) return "Offline — showing last known schedule";
  return `Sheet has a problem: ${loaded.reason} — showing last known schedule`;
};
