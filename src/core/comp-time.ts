import type { Heat, Schedule } from "./types";

const MINUTE_MS = 60_000;

const partValue = (parts: readonly Intl.DateTimeFormatPart[], type: string): number =>
  Number(parts.find((part) => part.type === type)?.value ?? "0");

const zoneOffsetMinutes = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const asUtc = Date.UTC(
    partValue(parts, "year"),
    partValue(parts, "month") - 1,
    partValue(parts, "day"),
    partValue(parts, "hour"),
    partValue(parts, "minute"),
    partValue(parts, "second"),
  );

  return Math.round((asUtc - instant.getTime()) / MINUTE_MS);
};

type LocalToInstantOptions = {
  readonly date: string;
  readonly hhmm: string;
  readonly timeZone: string;
};

export const localToInstant = ({ date, hhmm, timeZone }: LocalToInstantOptions): Date => {
  const naive = new Date(`${date}T${hhmm}:00Z`);
  const firstGuess = new Date(naive.getTime() - zoneOffsetMinutes(naive, timeZone) * MINUTE_MS);
  return new Date(naive.getTime() - zoneOffsetMinutes(firstGuess, timeZone) * MINUTE_MS);
};

export const heatInstants = (
  schedule: Schedule,
  heat: Heat,
): { readonly start: Date; readonly end: Date } => ({
  start: localToInstant({ date: schedule.compDate, hhmm: heat.start, timeZone: schedule.timeZone }),
  end: localToInstant({ date: schedule.compDate, hhmm: heat.end, timeZone: schedule.timeZone }),
});

export const compDayOf = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
